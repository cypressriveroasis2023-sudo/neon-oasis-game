import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql = readFileSync(new URL('../db/20261119_watchful_monitored_units.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../db/20261119_watchful_monitored_units_rollback.sql', import.meta.url), 'utf8');

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
