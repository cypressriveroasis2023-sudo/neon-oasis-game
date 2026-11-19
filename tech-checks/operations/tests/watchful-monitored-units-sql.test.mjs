import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql = readFileSync(new URL('../db/20261119_watchful_monitored_units.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../db/20261119_watchful_monitored_units_rollback.sql', import.meta.url), 'utf8');
const readSql = readFileSync(new URL('../db/20261119_watchful_monitored_units_read.sql', import.meta.url), 'utf8');
const readRollback = readFileSync(new URL('../db/20261119_watchful_monitored_units_read_rollback.sql', import.meta.url), 'utf8');

test('the Watchful roster is private: RLS on, anon has nothing, authenticated can only read', async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(sql);
  const table = await db.query(`
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'watchful_monitored_units'
  `);
  assert.equal(table.rows[0].relrowsecurity, true);
  const grants = await db.query(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'watchful_monitored_units'
    order by grantee, privilege_type
  `);
  const held = grants.rows.map(row => `${row.grantee}:${row.privilege_type}`);
  assert.deepEqual(held.filter(item => item.startsWith('anon:')), []);
  assert.deepEqual(held.filter(item => item.startsWith('authenticated:')), ['authenticated:SELECT']);
  assert.ok(held.includes('service_role:INSERT'));
  assert.equal(sql.includes('to anon'), false);
  await db.exec(rollback);
  const gone = await db.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'watchful_monitored_units'
  `);
  assert.equal(gone.rows.length, 0);
  const policies = await db.query(`
    select pol.polname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relname = 'watchful_monitored_units'
  `);
  assert.equal(policies.rows.length, 0);
  const leftover = await db.query(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'watchful_monitored_units'
  `);
  assert.equal(leftover.rows.length, 0);
  await db.close();
});

test('the read-time columns are additive and their rollback restores the required observation time', async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(sql);
  await db.exec(readSql);
  const columns = await db.query(`
    select column_name, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'watchful_monitored_units'
      and column_name in ('snapshot_at', 'fetched_at', 'arming', 'project_id')
    order by column_name
  `);
  assert.deepEqual(columns.rows, [
    {column_name: 'arming', is_nullable: 'YES'},
    {column_name: 'fetched_at', is_nullable: 'YES'},
    {column_name: 'project_id', is_nullable: 'YES'},
    {column_name: 'snapshot_at', is_nullable: 'YES'},
  ]);
  const types = await db.query(`
    select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'watchful_monitored_units' and column_name = 'project_id'
  `);
  assert.equal(types.rows[0].data_type, 'uuid');
  await assert.rejects(db.exec(`insert into public.watchful_monitored_units
    (snapshot_id, unit_name, canonical_unit_key, site_name, unit_group, unit_status, cameras_up, cameras_down, snapshot_at, fetched_at)
    values ('3f2504e0-4f89-41d3-9b0c-030507090a0c', 'Sniper 9', 'SNIPER|9', 'Fixture Site', 'Avigilon', 'up', 1, 0, '2026-11-19T14:00:00Z', '2099-01-01T00:00:00Z')`), /future/);
  await db.exec(`insert into public.watchful_monitored_units
    (snapshot_id, unit_name, canonical_unit_key, site_name, unit_group, unit_status, cameras_up, cameras_down, snapshot_at, fetched_at, arming, project_id)
    values ('3f2504e0-4f89-41d3-9b0c-030507090a0b', 'Sniper 2', 'SNIPER|2', 'Fixture Site', 'Avigilon', 'up', 1, 0, null, '2026-11-19T14:30:00Z', 'unknown', '3f2504e0-4f89-41d3-9b0c-030507090a0b')`);
  await db.exec(readRollback);
  const kept = await db.query(`select unit_name, snapshot_at from public.watchful_monitored_units`);
  assert.equal(kept.rows.length, 1);
  assert.equal(kept.rows[0].unit_name, 'Sniper 2');
  assert.equal(new Date(kept.rows[0].snapshot_at).toISOString(), '2026-11-19T14:30:00.000Z');
  const after = await db.query(`
    select column_name, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'watchful_monitored_units'
      and column_name in ('snapshot_at', 'fetched_at', 'arming', 'project_id')
  `);
  assert.deepEqual(after.rows, [{column_name: 'snapshot_at', is_nullable: 'NO'}]);
  await db.exec(rollback);
  await db.close();
});
