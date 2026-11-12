import {test, before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const ORG = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const OTHER_ORG = '00000000-0000-4000-8000-000000000001';
const OWNER = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const IT = 'd0757b64-9623-4adc-afff-21cc7853e88a';
const DENIED = '11111111-2222-3333-4444-555555555555';
let db, request = 0;
const nextRequest = () => '0d3a6038-1f3e-4a2e-9d7a-' + String(++request).padStart(12, '0');

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema app_private;`);
  // Stand in for the platform's own identity guard: the Owner and verified IT pass, nobody else does.
  await db.exec(`create function app_private.cos_owner_identity_assert_actor(p_actor uuid,p_org uuid,p_write boolean) returns void
   language plpgsql as $$begin
    if p_actor not in ('${OWNER}','${IT}') or p_org<>'${ORG}' then raise exception 'An active COS Owner or verified IT account is required' using errcode='PT403'; end if;
    if p_write and p_actor<>'${OWNER}' then raise exception 'An active COS Owner account is required' using errcode='PT403'; end if;
   end;$$;`);
  await db.exec(await readFile(new URL('../db/20261112_fleet_unit_status_hand_edits.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));

const payload = (over = {}) => ({unitKey: 'SOLARSPOTTER 029', field: 'site', action: 'set',
  value: 'ERock - Hyperion', providerValue: 'root', actorName: 'James Martin', actorRole: 'owner', reason: 'Moved by hand', ...over});
const as = async (role, text, args = []) => {
  await db.exec('reset role'); await db.exec('set role ' + role);
  try { return (await db.query(text, args)).rows; }
  // A refused statement aborts the transaction, so resetting the role may fail
  // too. The refusal itself is what the test is reading.
  finally { try { await db.exec('reset role'); } catch { /* the caller's savepoint restores it */ } }
};
const edit = async (over = {}, actor = OWNER, id = nextRequest(), org = ORG) =>
  (await as('service_role', 'select public.cos_camera_unit_hand_edit_v1($1,$2,$3,$4) value', [actor, org, id, JSON.stringify(payload(over))]))[0].value;
const state = async (actor = OWNER, org = ORG) =>
  (await as('service_role', 'select public.cos_camera_unit_hand_edit_state_v1($1,$2) value', [actor, org]))[0].value;
// A refusal aborts the surrounding transaction, so each expected failure runs
// inside its own savepoint and the test can carry on afterwards.
let mark = 0;
const refuses = async (run, pattern) => {
  const point = 'expected_refusal_' + (++mark);
  await db.exec('savepoint ' + point);
  try { await run(); } catch (error) {
    await db.exec('rollback to savepoint ' + point);
    assert.match(String(error.message || error), pattern);
    return;
  }
  await db.exec('release savepoint ' + point);
  throw new Error('Expected a refusal matching ' + pattern);
};
const log = async (text = 'select * from cos_fleet_hand_edit_private.unit_status_edit_log') => (await db.query(text)).rows;

test('the Owner and verified IT may record an edit; nobody else may', async () => {
  assert.equal((await edit()).applied, true);
  assert.equal((await edit({actorName: 'Teddy Hopper', actorRole: 'it', value: 'Preload Garland'}, IT)).applied, true);
  await refuses(() => edit({}, DENIED), /Owner or verified IT/);
});

test('reading the edits needs the same accounts', async () => {
  assert.equal((await state()).contract, 'COS_UNIT_STATUS_HAND_EDITS_V1');
  assert.equal((await state(IT)).contract, 'COS_UNIT_STATUS_HAND_EDITS_V1');
  await refuses(() => state(DENIED), /Owner or verified IT/);
});

test('the latest edit wins and the earlier one stays on the record', async () => {
  await edit({unitKey: 'SPOTTER 500', value: 'First Site'});
  await edit({unitKey: 'SPOTTER 500', value: 'Second Site'});
  const current = (await state()).edits.filter(row => row.unit_key === 'SPOTTER 500' && row.field === 'site');
  assert.equal(current.length, 1);
  assert.equal(current[0].value, 'Second Site');
  assert.equal((await log("select * from cos_fleet_hand_edit_private.unit_status_edit_log where upper(btrim(unit_key))='SPOTTER 500'")).length, 2);
});

test('an edit records who made it, their role, the reason and the provider value', async () => {
  await edit({unitKey: 'SPOTTER 501', value: 'A Site', providerValue: 'root', reason: 'Tech moved it'});
  const row = (await state()).edits.find(r => r.unit_key === 'SPOTTER 501');
  assert.equal(row.actor_name, 'James Martin');
  assert.equal(row.actor_role, 'owner');
  assert.equal(row.reason, 'Tech moved it');
  assert.equal(row.provider_value, 'root');
  assert.ok(row.created_at);
});

test('the same request sent twice is the same edit, and a reused id for another edit is refused', async () => {
  const id = nextRequest();
  assert.equal((await edit({unitKey: 'SPOTTER 502', value: 'A Site'}, OWNER, id)).applied, true);
  const again = await edit({unitKey: 'SPOTTER 502', value: 'A Site'}, OWNER, id);
  assert.equal(again.applied, false);
  assert.equal(again.repeat, true);
  await refuses(() => edit({unitKey: 'SPOTTER 502', value: 'Another Site'}, OWNER, id), /already used for a different edit/);
  assert.equal((await log("select * from cos_fleet_hand_edit_private.unit_status_edit_log where upper(btrim(unit_key))='SPOTTER 502'")).length, 1);
});

test('nothing can be updated or deleted, including by the owner of the table', async () => {
  await edit({unitKey: 'SPOTTER 503', value: 'A Site'});
  await refuses(() => db.exec("update cos_fleet_hand_edit_private.unit_status_edit_log set value='x' where upper(btrim(unit_key))='SPOTTER 503'"), /append-only/);
  await refuses(() => db.exec("delete from cos_fleet_hand_edit_private.unit_status_edit_log where upper(btrim(unit_key))='SPOTTER 503'"), /append-only/);
  assert.equal((await log("select * from cos_fleet_hand_edit_private.unit_status_edit_log where upper(btrim(unit_key))='SPOTTER 503'"))[0].value, 'A Site');
});

test('only the three fields are editable, and camera status is not one of them', async () => {
  for (const field of ['vigilant_status', 'state', 'online', 'unit_key', 'organization', '']) {
    await refuses(() => edit({field, value: 'Online'}), /Hand edit is incomplete/);
  }
  assert.equal((await edit({unitKey: 'SPOTTER 504', field: 'placement', value: 'FIELD'})).applied, true);
  assert.equal((await edit({unitKey: 'SPOTTER 505', field: 'public_ip', value: '38.246.195.93'})).applied, true);
});

test('a placement is one of two words and a site name is not root', async () => {
  for (const value of ['ROOT', 'yes', 'FIELDS']) await refuses(() => edit({field: 'placement', value}), /either in the FIELD or in the SHOP/);
  for (const value of ['root', 'ROOT', 'Shop']) await refuses(() => edit({field: 'site', value}), /root is not a site name/);
  assert.equal((await edit({unitKey: 'SPOTTER 506', field: 'placement', value: 'field'})).value, 'FIELD');
});

test('only a public IPv4 is stored', async () => {
  for (const value of ['10.0.0.1', '192.168.10.17', '172.16.4.4', '127.0.0.1', '169.254.1.1', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '1.2.3', '1.2.3.256', 'not an ip', '38.246.195.93/24', '2001:db8::1']) {
    await refuses(() => edit({field: 'public_ip', value}), /public IPv4/);
  }
  assert.equal((await edit({unitKey: 'SPOTTER 507', field: 'public_ip', value: '166.203.205.83'})).value, '166.203.205.83');
});

test('a set needs a value, a clear must not carry one, and a clear is itself recorded', async () => {
  await refuses(() => edit({value: null}), /A value is required/);
  await refuses(() => edit({action: 'clear', value: 'Something'}), /does not take a value/);
  assert.equal((await edit({unitKey: 'SPOTTER 508', action: 'clear', value: null})).applied, true);
  assert.equal((await state()).edits.find(r => r.unit_key === 'SPOTTER 508').action, 'clear');
});

test('an unknown role, a blank name, a blank unit and an over-long reason are refused', async () => {
  await refuses(() => edit({actorRole: 'technician'}), /Hand edit is incomplete/);
  await refuses(() => edit({actorName: '   '}), /Hand edit is incomplete/);
  await refuses(() => edit({reason: 'x'.repeat(401)}), /Hand edit is incomplete/);
  await refuses(() => edit({unitKey: '  '}), /Hand edit is incomplete/);
});

test('edits are kept per organization', async () => {
  await edit({unitKey: 'SPOTTER 600', value: 'A Site'});
  await db.query(`insert into cos_fleet_hand_edit_private.unit_status_edit_log(id,organization_id,unit_key,field,action,value,actor,actor_name,actor_role)
    values ($1,$2,'SPOTTER 601','site','set','Another Company Site',$3,'James Martin','owner')`, [nextRequest(), OTHER_ORG, OWNER]);
  const edits = (await state()).edits;
  assert.equal(edits.some(r => r.unit_key === 'SPOTTER 600'), true);
  assert.equal(edits.some(r => r.unit_key === 'SPOTTER 601'), false, "another organization's edit was returned");
  await refuses(() => state(OWNER, OTHER_ORG), /Owner or verified IT/);
});

test('the API roles cannot reach the table or the functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    await refuses(() => as(role, 'select 1 from cos_fleet_hand_edit_private.unit_status_edit_log'), /permission denied/);
    await refuses(() => as(role, `select public.cos_camera_unit_hand_edit_state_v1('${OWNER}','${ORG}')`), /permission denied/);
    await refuses(() => as(role, `select public.cos_camera_unit_hand_edit_v1('${OWNER}','${ORG}','${nextRequest()}','{}'::jsonb)`), /permission denied/);
  }
});

test('installing twice changes nothing', async () => {
  await db.exec(await readFile(new URL('../db/20261112_fleet_unit_status_hand_edits.sql', import.meta.url), 'utf8'));
  const tables = await db.query("select count(*) n from information_schema.tables where table_schema='cos_fleet_hand_edit_private'");
  assert.equal(Number(tables.rows[0].n), 1);
});
