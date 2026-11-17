import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {parseInhandRouterCsv} from '../../supabase/functions/cos-inhand-router-status/model.ts';

const OWNER = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const IT = 'd0757b64-9623-4adc-afff-21cc7853e88a';
const OTHER = '11111111-2222-4333-8444-555555555555';
let db;

const rowsOf = text => JSON.stringify(parseInhandRouterCsv(text).map(row => ({
  name: row.name, serial: row.serial, status: row.status, lastSeenAt: row.lastSeenAt, ip: row.ip, deviceId: row.deviceId,
})));

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.user_profiles (user_id uuid primary key, active boolean not null, department text not null);
    insert into public.user_profiles values ('${OWNER}', true, 'owner'), ('${IT}', true, 'it'), ('${OTHER}', true, 'service');
    create table public.camera_unit_routers (
      id bigint primary key,
      unit_key text,
      router_name text,
      current_status text,
      last_checked_at timestamptz,
      last_online_at timestamptz,
      status_observed_at timestamptz,
      router_public_ip inet,
      updated_at timestamptz
    );
    insert into public.camera_unit_routers (id, unit_key, router_name, current_status, router_public_ip, updated_at)
    values (1, 'FIXTURE 1', 'Old name', 'unknown', '198.51.100.10', '2026-01-01'),
           (2, 'FIXTURE 2', 'Other', 'online', '198.51.100.11', '2026-01-01');
  `);
  await db.exec(await readFile(new URL('../db/20261118_cos_inhand_router_status.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());

const load = async (actor, csv) => {
  await db.exec('set role service_role');
  try {
    return (await db.query('select public.cos_inhand_router_status_load($1, $2::jsonb) value', [actor, rowsOf(csv)])).rows[0].value;
  } finally {
    try { await db.exec('reset role'); } catch { /* a refusal aborts only its statement */ }
  }
};
const ids = async () => (await db.query('select id, router_name, current_status, host(router_public_ip) ip, last_checked_at, status_observed_at, inhand_serial, inhand_device_id from public.camera_unit_routers order by id')).rows;
const seenAt = row => row.status_observed_at ? new Date(row.status_observed_at).toISOString() : null;

test('the loader refuses to run until the serial columns exist', async () => {
  const csv = await readFile(new URL('./fixtures/inhand-router-status.csv', import.meta.url), 'utf8');
  await assert.rejects(load(OWNER, csv), /Router serial columns are not installed/);
  assert.deepEqual((await db.query('select id from public.camera_unit_routers order by id')).rows, [{id: 1}, {id: 2}]);
});

test('exact serials are updated in place, unmatched serials are reported, and a replay writes nothing', async () => {
  await db.exec('alter table public.camera_unit_routers add column inhand_serial text');
  await db.exec('alter table public.camera_unit_routers add column inhand_device_id text');
  await db.exec("update public.camera_unit_routers set inhand_serial = 'RF3152533024049' where id = 1");
  await db.exec("update public.camera_unit_routers set inhand_serial = 'RF0000000000002' where id = 2");
  const csv = await readFile(new URL('./fixtures/inhand-router-status.csv', import.meta.url), 'utf8');
  const first = await load(OWNER, csv);
  assert.equal(first.updated, 1);
  assert.equal(first.unchanged, 0);
  assert.equal(first.created, 0);
  assert.equal(first.deleted, 0);
  assert.equal(first.unmatched.length, 1);
  assert.equal(first.unmatched[0].serial, 'RF-NOT-IN-INVENTORY');
  assert.equal(first.unmatched[0].reason, 'none');
  assert.equal(JSON.stringify(first.unmatched).includes('203.0.113.51'), false);
  assert.equal(first.matched[0].ip, '203.0.113.50');
  const after = await ids();
  assert.equal(after.length, 2);
  assert.equal(after[0].router_name, 'Old name');
  assert.equal(after[0].current_status, 'online');
  assert.equal(after[0].ip, '203.0.113.50');
  assert.equal(after[0].inhand_serial, 'RF3152533024049');
  assert.equal(seenAt(after[0]), '2026-11-17T22:00:00.000Z');
  assert.equal(after[0].last_checked_at, null);
  assert.equal(after[1].current_status, 'online');
  assert.equal(after[1].ip, '198.51.100.11');
  const again = await load(IT, csv);
  assert.equal(again.updated, 0);
  assert.equal(again.unchanged, 1);
  assert.equal(again.deleted, 0);
  const renamed = csv.replace('Fixture Router One', 'A different label');
  const labelOnly = await load(OWNER, renamed);
  assert.equal(labelOnly.updated, 0);
  assert.equal((await ids())[0].router_name, 'Old name');
  await db.exec("update public.camera_unit_routers set last_checked_at = '2026-11-17T22:30:00Z' where id = 1");
  const older = await load(OWNER, 'Name,Serial,Online/Offline,Last Seen,IP\nFixture Router One,RF3152533024049,offline,2026-11-17T21:00:00.000Z,203.0.113.60\n');
  assert.equal(older.updated, 0);
  assert.equal(older.unchanged, 1);
  const equal = await load(OWNER, 'Name,Serial,Online/Offline,Last Seen,IP\nFixture Router One,RF3152533024049,offline,2026-11-17T22:30:00.000Z,203.0.113.61\n');
  assert.equal(equal.updated, 0);
  assert.equal(equal.unchanged, 1);
  let held = (await ids())[0];
  assert.equal(held.current_status, 'online');
  assert.equal(held.ip, '203.0.113.50');
  assert.equal(seenAt(held), '2026-11-17T22:00:00.000Z');
  assert.equal(new Date(held.last_checked_at).toISOString(), '2026-11-17T22:30:00.000Z');
  const newer = await load(OWNER, 'Name,Serial,Online/Offline,Last Seen,IP\nFixture Router One,RF3152533024049,offline,2026-11-17T22:31:00.000Z,203.0.113.62\n');
  assert.equal(newer.updated, 1);
  assert.equal(newer.unchanged, 0);
  held = (await ids())[0];
  assert.equal(held.current_status, 'offline');
  assert.equal(held.ip, '203.0.113.62');
  assert.equal(seenAt(held), '2026-11-17T22:31:00.000Z');
  assert.equal(new Date(held.last_checked_at).toISOString(), '2026-11-17T22:30:00.000Z');
  const withDevice = csv.replace('2026-11-17T22:00:00.000Z', '2026-11-17T23:00:00.000Z').replace(
    'Name,Serial,Online/Offline,Last Seen,IP',
    'Name,Serial,Online/Offline,Last Seen,IP,Device ID',
  ).replace('203.0.113.50', '203.0.113.50,dev-fixture-1').replace('203.0.113.51', '203.0.113.51,');
  const device = await load(OWNER, withDevice);
  assert.equal(device.updated, 1);
  assert.equal((await ids())[0].inhand_device_id, 'dev-fixture-1');
  const deviceAgain = await load(OWNER, withDevice);
  assert.equal(deviceAgain.updated, 0);
  assert.equal(deviceAgain.unchanged, 1);
  await db.exec("insert into public.camera_unit_routers (id, unit_key, router_name, current_status, inhand_serial) values (3, 'FIXTURE 3', 'Twin', 'online', 'RF0000000000002')");
  const ambiguous = await load(OWNER, 'Name,Serial,Online/Offline,Last Seen,IP\nTwin,RF0000000000002,offline,2026-11-17T22:10:00.000Z,203.0.113.52\n');
  assert.equal(ambiguous.updated, 0);
  assert.equal(ambiguous.unmatched[0].reason, 'ambiguous');
  assert.equal((await ids()).filter(row => row.inhand_serial === 'RF0000000000002').every(row => row.current_status === 'online'), true);
  await assert.rejects(load(OTHER, csv), /Owner or verified IT/);
  const secret = '89014103211118510720';
  await assert.rejects(
    load(OWNER, 'Name,Serial,Online/Offline,Last Seen,IP\nSecret,' + secret + ',offline,2026-11-17T22:10:00.000Z,203.0.113.53\n'),
    error => {
      assert.match(String(error.message || error), /SIM identifier was refused/);
      assert.equal(String(error.message || error).includes(secret), false);
      return true;
    },
  );
  await db.exec('set role service_role');
  try {
    await assert.rejects(db.query('select public.cos_inhand_router_status_load($1, $2::jsonb) value', [OWNER, JSON.stringify([{
      name: 'Secret', serial: secret, status: 'offline', lastSeenAt: '2026-11-17T22:10:00.000Z', ip: '203.0.113.53', deviceId: null,
    }])]), error => {
      assert.match(String(error.message || error), /SIM identifier was refused/);
      assert.equal(String(error.message || error).includes(secret), false);
      return true;
    });
  } finally {
    try { await db.exec('reset role'); } catch { /* the refusal aborts only its statement */ }
  }
  assert.equal((await db.query("select count(*)::int n from public.camera_unit_routers where inhand_serial = $1", [secret])).rows[0].n, 0);
  assert.deepEqual((await db.query('select id from public.camera_unit_routers order by id')).rows.map(row => row.id), [1, 2, 3]);
});
