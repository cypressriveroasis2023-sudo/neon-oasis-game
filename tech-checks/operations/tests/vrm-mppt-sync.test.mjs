import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseMpptRecords, createMpptSyncHandler, MPPT_PATHS} from '../../supabase/functions/cos-vrm-mppt-sync/mppt.ts';

const migration = readFileSync(new URL('../db/20261125_cos_vrm_mppt_readings.sql', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-25T18:00:00Z'), T = NOW / 1000 - 60;
const rec = (path, rawValue, extra = {}) => ({idSite: 7001, timestamp: T, instance: 278, dbusServiceType: 'solarcharger', dbusPath: path, rawValue, formattedValue: 'x', ...extra});
// Every credential, installation and reading here is synthetic. No real database or network is touched.
const SECRET = 'a'.repeat(64);

test('keeps only known charger readings, newest per charger; other charger paths are listed by name only', () => {
  const {rows, paths} = parseMpptRecords([
    rec('/Pv/V', 68.4), rec('/Pv/V', 66.1, {timestamp: T - 900}), rec('/State', '3'), rec('/History/Daily/0/Yield', 1.13),
    rec('/ErrorCode', 0), rec('/Settings/BmsPresent', 1), rec('/Pv/V', 70, {dbusServiceType: 'battery'}),
    rec('/Pv/V', 70, {idSite: 9999}), rec('/Pv/V', 9999), rec('/Pv/V', 'high'), rec('/Pv/V', 60, {timestamp: NOW / 1000 + 9999}),
    rec('/bad path!', 1), rec('/Pv/V', 61, {instance: 279}),
  ], 7001, NOW);
  assert.deepEqual(rows.map(r => [r.instance, r.path, r.value]), [
    [278, '/ErrorCode', 0], [278, '/History/Daily/0/Yield', 1.13], [278, '/Pv/V', 68.4], [278, '/State', 3], [279, '/Pv/V', 61]]);
  assert.equal(rows[0].observedAt, new Date(T * 1000).toISOString());
  assert.deepEqual(paths, ['/ErrorCode', '/History/Daily/0/Yield', '/Pv/V', '/Settings/BmsPresent', '/State']);
  assert.throws(() => parseMpptRecords({}, 7001, NOW), /invalid_response/);
});

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema cos_vrm_private; create schema net; create schema vault;
    create table cos_vrm_private.installations(installation_id bigint primary key, name text not null, available boolean not null default true);
    create table cos_vrm_private.sync_state(singleton boolean primary key default true, lease_id uuid, lease_until timestamptz, retry_after_at timestamptz, last_success_at timestamptz, error_code text);
    create table cos_vrm_private.power_history(installation_id bigint, observed_at timestamptz, primary key(installation_id, observed_at));
    create table net.synthetic_requests(id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds integer);
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as
      'insert into net.synthetic_requests(url,headers,body,timeout_milliseconds) values($1,$2,$3,$4) returning id';
    create table vault.secrets(name text primary key, secret text);
    create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
    insert into vault.secrets values('cos_vrm_sync_secret','${SECRET}');
    insert into cos_vrm_private.sync_state(last_success_at) values(now());
    insert into cos_vrm_private.installations values(7001,'HELIOS 001'),(7002,'HELIOS 002'),(7003,'Shop bench'),(7004,'HELIOS 004');
    insert into cos_vrm_private.power_history values(7001, now() - interval '10 minutes'),(7002, now() - interval '3 days'),(7003, now());`);
  await db.exec(migration);
  return db;
}
const call = async (db, name, args) => (await db.query('select public.' + name + '(' + args.map((_, i) => '$' + (i + 1) + '::jsonb').join(',') + ') v', args.map(a => JSON.stringify(a)))).rows[0].v;
const row = (path, value, observedAt = new Date(Date.now() - 60000).toISOString(), installationId = 7001, instance = 278) => ({installationId, instance, path, value, observedAt});

test('targets: only Helios units that reported in the last day, and only while the fleet sync is healthy', async () => {
  const db = await database();
  assert.deepEqual(await call(db, 'cos_vrm_mppt_targets', []), {ready: true, ids: [7001]});
  for (const broken of ["error_code='provider'", "lease_until=now()+interval '1 minute'", "retry_after_at=now()+interval '5 minutes'", "last_success_at=now()-interval '2 hours'"]) {
    await db.exec('begin; update cos_vrm_private.sync_state set ' + broken);
    assert.equal((await call(db, 'cos_vrm_mppt_targets', [])).ready, false, broken);
    await db.exec('rollback');
  }
});

test('save: keeps known readings for known Helios units, skips everything else, never fails the batch', async () => {
  const db = await database();
  const old = new Date(Date.now() - 3600000).toISOString();
  const kept = await call(db, 'cos_vrm_mppt_save', [[
    row('/Pv/V', 68.4), row('/State', 3), row('/History/Daily/0/Yield', 1.13),
    row('/Pv/V', 50, old),                                   // older than what is already saved
    row('/Settings/BmsPresent', 1), row('/Pv/V', 70, undefined, 7003), row('/Pv/V', 70, undefined, 9999),
    row('/Pv/V', 70, 'not-a-time'), row('/Pv/V', 1e9), {...row('/Pv/V', 1), extra: true}, 'junk',
    row('/Pv/V', 70, new Date(Date.now() + 3600000).toISOString()),
  ], ['/Pv/V', '/State', '/Settings/BmsPresent', 'not a path', 5]]);
  assert.equal(kept, 4);
  const latest = (await db.query('select path, value::float v from cos_vrm_private.mppt_latest order by path')).rows;
  assert.deepEqual(latest, [{path: '/History/Daily/0/Yield', v: 1.13}, {path: '/Pv/V', v: 68.4}, {path: '/State', v: 3}]);
  assert.equal((await db.query('select count(*)::int n from cos_vrm_private.mppt_history')).rows[0].n, 4);
  assert.deepEqual((await db.query('select path from cos_vrm_private.mppt_paths_seen order by 1')).rows.map(r => r.path), ['/Pv/V', '/Settings/BmsPresent', '/State']);
  // The same batch again adds no history, and history older than 10 days is dropped.
  await db.exec("insert into cos_vrm_private.mppt_history values(7001,278,'/Pv/V',now()-interval '11 days',1)");
  await call(db, 'cos_vrm_mppt_save', [[row('/Pv/V', 68.4, (await db.query("select observed_at from cos_vrm_private.mppt_latest where path='/Pv/V'")).rows[0].observed_at.toISOString())], []]);
  assert.equal((await db.query('select count(*)::int n from cos_vrm_private.mppt_history')).rows[0].n, 4);
  await assert.rejects(call(db, 'cos_vrm_mppt_save', [{}, []]), /Invalid MPPT batch/);
});

test('only the service role may call the functions; the scheduled call carries the vault credential and nothing else', async () => {
  const db = await database();
  for (const role of ['anon', 'authenticated']) for (const fn of ['cos_vrm_mppt_targets()', "cos_vrm_mppt_save('[]'::jsonb,'[]'::jsonb)"]) {
    await db.exec('begin; set local role ' + role);
    await assert.rejects(db.query('select public.' + fn), /permission denied/);
    await db.exec('rollback');
  }
  await db.exec('set role service_role'); assert.equal(await call(db, 'cos_vrm_mppt_save', [[], []]), 0); await db.exec('reset role');
  assert.equal((await db.query('select cos_vrm_private.enqueue_mppt_sync() id')).rows[0].id, 1);
  const sent = (await db.query('select * from net.synthetic_requests')).rows[0];
  assert.equal(sent.url, 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-mppt-sync');
  assert.deepEqual(sent.headers, {'Content-Type': 'application/json', 'x-cos-vrm-sync': SECRET});
  assert.deepEqual(sent.body, {}); assert.equal(sent.timeout_milliseconds, 60000);
  await db.exec("update cos_vrm_private.sync_state set lease_until=now()+interval '1 minute'");
  assert.equal((await db.query('select cos_vrm_private.enqueue_mppt_sync() id')).rows[0].id, null);
});

function harness({targets = {ready: true, ids: [7001, 7002]}, victron, token = 'synthetic-token', authorized = true} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    const u = String(url); calls.push({url: u, init});
    if (u.includes('/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1], body = JSON.parse(init.body);
      const out = name === 'cos_vrm_scheduler_authorized' ? authorized : name === 'cos_vrm_mppt_targets' ? targets : name === 'cos_vrm_mppt_save' ? body.p_rows.length : null;
      return Response.json(out);
    }
    return victron(u, init);
  };
  const handler = createMpptSyncHandler({platformUrl: 'https://synthetic.invalid', serviceKey: 'synthetic-service', getAccessToken: () => token, fetch: fetcher, wait: async () => {}, clock: () => NOW});
  const post = (headers = {'x-cos-vrm-sync': SECRET}) => handler(new Request('https://synthetic.invalid/functions/v1/cos-vrm-mppt-sync', {method: 'POST', headers, body: '{}'}));
  return {calls, post, handler};
}
const page = (id, list) => Response.json({success: true, num_records: list.length, records: list.map(r => ({...r, idSite: id}))});

test('handler: reads each target once, saves numbers only, and answers with counts only', async () => {
  const h = harness({victron: async u => page(Number(u.match(/installations\/(\d+)/)[1]), [rec('/Pv/V', 68.4), rec('/State', 3), rec('/Yield/Power', 250)])});
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true, state: 'current', units: 2, rows: 4});
  const victron = h.calls.filter(c => c.url.startsWith('https://vrmapi.victronenergy.com/'));
  assert.deepEqual(victron.map(c => [c.init.method, c.url.replace('https://vrmapi.victronenergy.com/v2', '')]), [
    ['GET', '/installations/7001/diagnostics?count=500&page=1'], ['GET', '/installations/7002/diagnostics?count=500&page=1']]);
  assert.equal(victron[0].init.headers['X-Authorization'], 'Token synthetic-token');
  const save = JSON.parse(h.calls.find(c => c.url.endsWith('/rpc/cos_vrm_mppt_save')).init.body);
  assert.deepEqual(Object.keys(save.p_rows[0]).sort(), ['installationId', 'instance', 'observedAt', 'path', 'value']);
  assert.deepEqual(save.p_paths, ['/Pv/V', '/State', '/Yield/Power']);
});

test('handler: stands back when the fleet sync is not healthy, and stops on Victron trouble', async () => {
  const idle = harness({targets: {ready: false, ids: [7001]}, victron: async () => { throw new Error('must not call Victron'); }});
  assert.deepEqual(await (await idle.post()).json(), {ok: true, state: 'skipped', units: 0, rows: 0});
  let n = 0;
  const limited = harness({victron: async () => { n++; return new Response('', {status: 429}); }});
  const r = await limited.post();
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), {ok: false, state: 'rate_limit', units: 0, rows: 0}); assert.equal(n, 1);
  const bad = harness({victron: async u => u.includes('7001') ? Response.json({success: true, num_records: 'x', records: []}) : page(7002, [rec('/Pv/V', 60)])});
  assert.deepEqual(await (await bad.post()).json(), {ok: true, state: 'current', units: 1, rows: 1});
});

test('handler: refuses anything that is not the scheduled call', async () => {
  const h = harness({victron: async () => { throw new Error('must not call Victron'); }});
  assert.equal((await h.handler(new Request('https://synthetic.invalid/x', {method: 'GET'}))).status, 405);
  assert.equal((await h.handler(new Request('https://synthetic.invalid/x?a=1', {method: 'POST', headers: {'x-cos-vrm-sync': SECRET}}))).status, 405);
  assert.equal((await h.post({'x-cos-vrm-sync': SECRET, origin: 'https://example.invalid'})).status, 405);
  assert.equal((await h.post({})).status, 401);
  assert.equal((await h.post({'x-cos-vrm-sync': 'short'})).status, 401);
  assert.equal((await harness({authorized: false, victron: async () => page(1, [])}).post()).status, 401);
  assert.equal((await harness({token: '', victron: async () => page(1, [])}).post()).status, 503);
  assert.ok(Object.keys(MPPT_PATHS).every(p => /^\/[A-Za-z0-9/]{1,60}$/.test(p)));
});

test('the database keeps exactly the readings the function sends', () => {
  const known = migration.match(/known constant text\[\] := array\[([^\]]+)\]/)[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(known.sort(), Object.keys(MPPT_PATHS).sort());
});
