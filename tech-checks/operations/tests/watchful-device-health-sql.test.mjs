import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {parseWatchfulCsv, watchfulSourceSha256} from '../../supabase/functions/cos-watchful-device-health/model.ts';

const OWNER = '3f073784-96e7-43d8-b9e0-33ab31c3c8b1';
const IT = 'd0757b64-9623-4adc-afff-21cc7853e88a';
const OTHER_IT = '11111111-2222-4333-8444-555555555555';
const RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEXT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db;

const payload = rows => JSON.stringify(rows.map(row => ({
  rowKey: row.rowKey, deviceName: row.deviceName, site: row.site, deviceType: row.deviceType,
  reportedStatus: row.reportedStatus, lastSeenAt: row.lastSeenAt,
})));

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.user_profiles (user_id uuid primary key, active boolean not null, department text not null);
    insert into public.user_profiles values
      ('${OWNER}', true, 'owner'),
      ('${IT}', true, 'it'),
      ('${OTHER_IT}', true, 'it'),
      ('7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', true, 'service');
    grant select on public.user_profiles to authenticated;
  `);
  await db.exec(await readFile(new URL('../db/20261118_cos_watchful_device_health.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());

const asService = async (text, args) => {
  await db.exec('set role service_role');
  try { return await db.query(text, args); }
  finally { try { await db.exec('reset role'); } catch { /* a refused call aborts only its own statement */ } }
};
const load = (actor, runId, rows, sha, at = '2026-11-17T22:30:00Z') => asService(
  'select public.cos_watchful_device_health_load($1,$2,$3,$4,$5::jsonb) value',
  [actor, runId, at, sha, payload(rows)],
);

test('the load is idempotent per run, keeps older runs, and refuses everyone except Owner and verified IT', async () => {
  const csv = await readFile(new URL('./fixtures/watchful-device-health.csv', import.meta.url), 'utf8');
  const rows = parseWatchfulCsv(csv);
  const sha = await watchfulSourceSha256(csv);
  await assert.rejects(load(OTHER_IT, RUN, rows, sha), /Owner or verified IT/);
  await assert.rejects(load('7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', RUN, rows, sha), /Owner or verified IT/);
  const first = (await load(OWNER, RUN, rows, sha)).rows[0].value;
  assert.equal(first.inserted, 5);
  assert.equal(first.deleted, 0);
  const again = (await load(IT, RUN, rows, sha)).rows[0].value;
  assert.deepEqual(again, {...first, inserted: 0, updated: 0, unchanged: 5});
  const changed = rows.map(row => row.deviceName === 'NVR Fixture Alpha' ? {...row, reportedStatus: 'down'} : row);
  const edited = (await load(OWNER, RUN, changed, sha)).rows[0].value;
  assert.equal(edited.updated, 1);
  assert.equal(edited.inserted, 0);
  assert.equal(edited.unchanged, 4);
  const kept = rows.filter(row => row.deviceName !== 'VMS Fixture Delta');
  const replay = (await load(OWNER, RUN, kept, sha)).rows[0].value;
  assert.equal(replay.deleted, 0);
  assert.equal((await db.query('select count(*)::int n from public.watchful_device_health where run_id = $1', [RUN])).rows[0].n, 5);
  const second = (await load(OWNER, NEXT, kept, 'ab'.repeat(32), '2026-11-17T23:00:00Z')).rows[0].value;
  assert.equal(second.inserted, 4);
  assert.equal((await db.query('select count(*)::int n from public.watchful_device_health')).rows[0].n, 9);
  const latest = (await asService('select public.cos_watchful_device_health_read($1) value', [IT])).rows[0].value;
  assert.equal(latest.runId, NEXT);
  assert.equal(latest.rows.length, 4);
  assert.equal(JSON.stringify(latest).includes('imsi'), false);
});

test('row level security lets only Owner and verified IT read, and nobody can delete', async () => {
  const privileges = async role => (await db.query(
    `select has_table_privilege($1,'public.watchful_device_health','SELECT') as read,
            has_table_privilege($1,'public.watchful_device_health','INSERT') as insert,
            has_table_privilege($1,'public.watchful_device_health','DELETE') as delete`,
    [role],
  )).rows[0];
  assert.deepEqual(await privileges('anon'), {read: false, insert: false, delete: false});
  assert.equal((await privileges('authenticated')).read, true);
  assert.equal((await privileges('authenticated')).delete, false);
  assert.equal((await privileges('service_role')).delete, false);
  const seen = async actor => {
    await db.exec('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db.exec('set role authenticated');
      const rows = (await db.query('select count(*)::int n from public.watchful_device_health')).rows[0].n;
      await db.exec('reset role');
      await db.exec('commit');
      return rows;
    } catch (error) {
      try { await db.exec('reset role'); } catch { /* the refusal aborted the transaction */ }
      try { await db.exec('rollback'); } catch { /* already closed */ }
      throw error;
    }
  };
  assert.equal(await seen(OWNER), 9);
  assert.equal(await seen(IT), 9);
  assert.equal(await seen(OTHER_IT), 0);
  await db.exec('begin');
  await db.exec('set role anon');
  await assert.rejects(db.query('select count(*) from public.watchful_device_health'), /permission denied/);
  try { await db.exec('reset role'); } catch { /* aborted */ }
  await db.exec('rollback');
});
