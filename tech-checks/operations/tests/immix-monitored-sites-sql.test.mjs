import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql = readFileSync(new URL('../db/20261119_immix_monitored_sites.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../db/20261119_immix_monitored_sites_rollback.sql', import.meta.url), 'utf8');

test('the Immix site list is private and the rollback removes it', async () => {
  assert.doesNotMatch(sql, /insert\s+into/i);
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(sql);
  const grants = await db.query(`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'immix_monitored_sites'
    order by grantee, privilege_type
  `);
  const held = grants.rows.map(row => `${row.grantee}:${row.privilege_type}`);
  assert.deepEqual(held.filter(item => item.startsWith('anon:')), []);
  assert.deepEqual(held.filter(item => item.startsWith('authenticated:')), ['authenticated:SELECT']);
  await db.exec(rollback);
  const gone = await db.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'immix_monitored_sites'
  `);
  assert.equal(gone.rows.length, 0);
  const policies = await db.query(`
    select pol.polname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    where c.relname = 'immix_monitored_sites'
  `);
  assert.equal(policies.rows.length, 0);
  await db.close();
});
