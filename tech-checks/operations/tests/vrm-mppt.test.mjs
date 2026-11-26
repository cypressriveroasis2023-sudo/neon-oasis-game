import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseMppt, readVrmMppt, mpptFresh, mpptFlags, mpptLine, peerYield} from '../src/vrmMppt.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';
import {safeVrmMppt} from '../../supabase/functions/cos-vrm-mppt-read/read.ts';

const local = (day, hour, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const NOW = local(26, 11), S = Math.round(NOW / 1000);
const unit = (id, over = {}) => ({installationId: id, name: 'HELIOS 00' + (id % 10), observedAt: S - 120, yieldToday: 0.42, yieldYesterday: 0.88, peakToday: 350, peakYesterday: 361, panelVolts: 32.4, errorCode: 0, ...over});
// Every installation and reading here is synthetic.

test('server projection and app parser accept the same shape and refuse anything odd', () => {
  const body = {units: [unit(1), unit(2, {yieldToday: null, panelVolts: null})]};
  assert.deepEqual(safeVrmMppt(body, NOW).units.map(u => u.installationId), [1, 2]);
  const map = parseMppt(safeVrmMppt(body, NOW), NOW);
  assert.equal(map.get(1).yieldYesterday, 0.88); assert.equal(map.get(2).panelVolts, null);
  for (const bad of [{units: [unit(1), unit(1)]}, {units: [unit(1, {errorCode: 'x'})]}, {units: [unit(1, {panelVolts: 9999})]}, {units: [unit(1, {observedAt: S + 99999})]}, {units: 'no'}, null]) {
    assert.throws(() => safeVrmMppt(bad, NOW)); assert.equal(parseMppt(bad, NOW), null);
  }
  assert.throws(() => safeVrmMppt({units: [{...unit(1), name: 'Shop bench'}]}, NOW));
});

test('reading: one POST with the caller token; any failure means no panel line', async () => {
  let seen;
  // The reader checks timestamps against the real clock.
  const ok = async (url, init) => { seen = {url, init}; return Response.json({units: [unit(1, {observedAt: Math.round(Date.now() / 1000) - 120})]}); };
  const map = await readVrmMppt(ok, 'synthetic-token');
  assert.equal(map.size, 1);
  assert.equal(seen.url, 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-mppt-read');
  assert.equal(seen.init.headers.Authorization, 'Bearer synthetic-token'); assert.equal(seen.init.body, '{"action":"read"}');
  assert.equal(await readVrmMppt(async () => new Response('', {status: 403}), 't'), null);
  assert.equal(await readVrmMppt(async () => { throw new Error('offline'); }, 't'), null);
  assert.equal(await readVrmMppt(ok, null), null);
});

test('only a charger that is reporting now is shown; an unplugged unit shows nothing', () => {
  const m = parseMppt({units: [unit(1), unit(2, {observedAt: S - 86400})]}, NOW);
  assert.equal(mpptFresh(m.get(1), NOW), true); assert.equal(mpptFresh(m.get(2), NOW), false);
  assert.equal(mpptLine(m.get(1), NOW), '0.42 kWh today · 0.88 yesterday · peak 350 W · panels 32 V');
  assert.equal(mpptLine(m.get(2), NOW), null); assert.deepEqual(mpptFlags(m.get(2), NOW), []);
  assert.equal(mpptLine(undefined, NOW), null);
});

test('flags: charger error always; dead panels only in daylight; low yield only when the unit needed the sun', () => {
  const one = over => parseMppt({units: [unit(1, over)]}, NOW).get(1);
  assert.deepEqual(mpptFlags(one({}), NOW), []);
  assert.deepEqual(mpptFlags(one({errorCode: 33}), NOW), [{kind: 'charger', line: 'Solar charger error · panel voltage too high'}]);
  assert.deepEqual(mpptFlags(one({errorCode: 116}), NOW), [{kind: 'charger', line: 'Solar charger error · code 116'}]);
  assert.deepEqual(mpptFlags(one({panelVolts: 1.4}), NOW), [{kind: 'panel', line: 'Panels not producing · 1 V at the charger in daylight'}]);
  const night = local(26, 22), dark = parseMppt({units: [unit(1, {panelVolts: 0, observedAt: Math.round(night / 1000) - 60})]}, night).get(1);
  assert.deepEqual(mpptFlags(dark, night), []);
  const weak = one({yieldYesterday: 0.3});
  assert.deepEqual(mpptFlags(weak, NOW, {needed: true, peerYield: 0.9}), [{kind: 'panel', line: 'Panels made 0.3 kWh yesterday · the others made about 0.9 kWh'}]);
  assert.deepEqual(mpptFlags(weak, NOW, {needed: false, peerYield: 0.9}), []);          // stayed full: it simply needed little
  assert.deepEqual(mpptFlags(weak, NOW, {needed: true, peerYield: 0.2}), []);           // everyone was low: a gray day
  assert.deepEqual(mpptFlags(weak, NOW, {needed: true, peerYield: null}), []);
});

test('peer yield is the middle of the fresh Field units and needs four of them', () => {
  const m = parseMppt({units: [unit(1, {yieldYesterday: 0.8}), unit(2, {yieldYesterday: 0.9}), unit(3, {yieldYesterday: 1.0}), unit(4, {yieldYesterday: 0.1}), unit(5, {yieldYesterday: 5, observedAt: S - 86400})]}, NOW);
  assert.equal(peerYield(m, [1, 2, 3, 4, 5], NOW), 0.8500000000000001);
  assert.equal(peerYield(m, [1, 2, 3], NOW), null); assert.equal(peerYield(null, [1], NOW), null);
});

test('Needs attention: charger error ranks just under a Victron alarm; panel trouble is listed for Field units only', () => {
  const m = v => ({metric: 'battery_soc', value: v, unit: '%', source: 'system', instance: 0, observedAt: new Date(NOW - 60000).toISOString()});
  const units = [1, 2, 3].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/' + id + '/dashboard', embedUrl: null}));
  const rows = units.map(u => ({installationId: u.installationId, name: u.name, lastAttemptAt: null, errorCode: null, measurements: [m(90)]}));
  const inventory = [{unitNumber: 'HELIOS 001', placement: 'FIELD'}, {unitNumber: 'HELIOS 002', placement: 'FIELD'}, {unitNumber: 'HELIOS 003', placement: 'SHOP'}];
  const mppt = parseMppt({units: [unit(1, {panelVolts: 2}), unit(2, {errorCode: 18}), unit(3, {errorCode: 18, panelVolts: 0})]}, NOW);
  const list = victronNeedsAttention(units, rows, inventory, NOW, null, null, null, mppt);
  assert.deepEqual(list.map(i => [i.name, i.kind, i.line]), [
    ['HELIOS 002', 'charger', 'Solar charger error · charger over-current'],
    ['HELIOS 001', 'panel', 'Panels not producing · 2 V at the charger in daylight']]);
  assert.deepEqual(victronNeedsAttention(units, rows, inventory, NOW, null, null, null, null), []);
});

test('database read: one row per Helios, chargers added together, service role only', async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema cos_vrm_private;
    create table cos_vrm_private.installations(installation_id bigint primary key, name text not null);
    create table cos_vrm_private.mppt_latest(installation_id bigint, instance integer, path text, value numeric, observed_at timestamptz, checked_at timestamptz default now(), primary key(installation_id, instance, path));
    insert into cos_vrm_private.installations values(7001,'HELIOS 001'),(7002,'Shop bench'),(7003,'HELIOS 003');
    insert into cos_vrm_private.mppt_latest(installation_id,instance,path,value,observed_at) values
      (7001,278,'/Pv/V',32.4,'2026-11-26T17:00:00Z'),(7001,278,'/History/Daily/0/Yield',0.42,'2026-11-26T16:00:00Z'),(7001,279,'/History/Daily/0/Yield',0.10,'2026-11-26T16:00:00Z'),
      (7001,278,'/History/Daily/1/Yield',0.88,'2026-11-26T06:00:00Z'),(7001,278,'/History/Daily/0/MaxPower',350,'2026-11-26T16:30:00Z'),(7001,278,'/ErrorCode',0,'2026-11-20T00:00:00Z'),
      (7002,1,'/Pv/V',30,'2026-11-26T17:00:00Z');`);
  await db.exec(readFileSync(new URL('../db/20261126_cos_vrm_mppt_read.sql', import.meta.url), 'utf8'));
  const out = (await db.query('select public.cos_vrm_mppt_read() v')).rows[0].v;
  assert.deepEqual(out, {units: [{installationId: 7001, name: 'HELIOS 001', observedAt: Date.parse('2026-11-26T17:00:00Z') / 1000,
    yieldToday: 0.52, yieldYesterday: 0.88, peakToday: 350, peakYesterday: null, panelVolts: 32.4, errorCode: 0}]});
  assert.equal(safeVrmMppt(out, Date.parse('2026-11-26T17:05:00Z')).units.length, 1);
  for (const role of ['anon', 'authenticated']) { await db.exec('begin; set local role ' + role); await assert.rejects(db.query('select public.cos_vrm_mppt_read()'), /permission denied/); await db.exec('rollback'); }
});
