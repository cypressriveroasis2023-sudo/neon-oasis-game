import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration = readFileSync(new URL('../db/20261124_cos_vrm_power_history.sql', import.meta.url), 'utf8');
const obs = (metric, value, unit, observedAt, source = 'system', instance = 0) => ({metric, value, unit, observedAt, source, instance});

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema cos_vrm_private;
    create table cos_vrm_private.installations(installation_id bigint primary key, name text not null, last_seen_at timestamptz,
      available boolean, power_observations jsonb, power_last_attempt_at timestamptz, power_error_code text, sharing_enabled boolean);`);
  return db;
}
const save = (db, id, name, list) => db.query(`insert into cos_vrm_private.installations(installation_id,name,available,power_observations)
  values($1,$2,true,$3::jsonb) on conflict(installation_id) do update set power_observations=excluded.power_observations`, [id, name, JSON.stringify(list)]);
const rows = async db => (await db.query('select installation_id::int id, extract(epoch from observed_at)::bigint t, soc::float, solar_w::float, battery_w::float, voltage::float from cos_vrm_private.power_history order by 1,2')).rows;

test('each saved Helios reading leaves one history point; repeats and non-Helios rows add nothing', async () => {
  const db = await setup();
  await save(db, 1, 'HELIOS 001', [obs('battery_soc', 80, '%', '2026-11-24T10:00:00Z')]);
  await db.exec(migration);
  // The migration seeds the reading already saved.
  assert.equal((await rows(db)).length, 1);
  await save(db, 1, 'HELIOS 001', [obs('battery_soc', 75, '%', '2026-11-24T10:15:00Z'), obs('battery_soc', 60, '%', '2026-11-24T10:15:00Z', 'battery', 278),
    obs('solar_power', 300, 'W', '2026-11-24T10:15:00Z'), obs('battery_power', -20, 'W', '2026-11-24T10:15:00Z'), obs('battery_voltage', 25.8, 'V', '2026-11-24T10:15:00Z')]);
  // Same reading saved again (an unplugged unit): no new point.
  await save(db, 1, 'HELIOS 001', [obs('battery_soc', 75, '%', '2026-11-24T10:15:00Z')]);
  await save(db, 2, 'Shop bench', [obs('battery_soc', 50, '%', '2026-11-24T10:15:00Z')]);
  const r = await rows(db);
  assert.equal(r.length, 2);
  // System reading wins over the separate battery monitor; never an average.
  assert.deepEqual(r[1], {id: 1, t: Date.parse('2026-11-24T10:15:00Z') / 1000, soc: 75, solar_w: 300, battery_w: -20, voltage: 25.8});
});

test('without a system reading the lowest single battery is kept', async () => {
  const db = await setup(); await db.exec(migration);
  await save(db, 3, 'HELIOS 003', [obs('battery_soc', 90, '%', '2026-11-24T11:00:00Z', 'battery', 278), obs('battery_soc', 15, '%', '2026-11-24T11:00:00Z', 'battery', 512)]);
  assert.equal((await rows(db))[0].soc, 15);
});

test('a malformed reading never stops the Victron save', async () => {
  const db = await setup(); await db.exec(migration);
  await save(db, 4, 'HELIOS 004', [obs('battery_soc', 80, '%', 'not-a-time')]);
  const saved = (await db.query("select power_observations->0->>'observedAt' t from cos_vrm_private.installations where installation_id=4")).rows[0];
  assert.equal(saved.t, 'not-a-time');
  assert.equal((await rows(db)).length, 0);
});

test('history older than 8 days is dropped as new readings arrive', async () => {
  const db = await setup(); await db.exec(migration);
  const old = new Date(Date.now() - 9 * 864e5).toISOString(), recent = new Date(Date.now() - 60000).toISOString();
  await save(db, 5, 'HELIOS 005', [obs('battery_soc', 70, '%', old)]);
  await save(db, 5, 'HELIOS 005', [obs('battery_soc', 71, '%', recent)]);
  const r = await rows(db);
  assert.equal(r.length, 1);
  assert.equal(r[0].soc, 71);
});

test('the history read returns Helios only, recent points oldest first, and only the service role may call it', async () => {
  const db = await setup(); await db.exec(migration);
  const a = new Date(Date.now() - 3 * 3600e3).toISOString(), b = new Date(Date.now() - 3600e3).toISOString(), old = new Date(Date.now() - 72 * 3600e3).toISOString();
  await save(db, 6, 'HELIOS 006', [obs('battery_soc', 50, '%', old)]);
  await save(db, 6, 'HELIOS 006', [obs('battery_soc', 60, '%', a), obs('solar_power', 100, 'W', a)]);
  await save(db, 6, 'HELIOS 006', [obs('battery_soc', 65, '%', b)]);
  const out = (await db.query('select public.cos_vrm_power_history(48) j')).rows[0].j;
  assert.equal(out.hours, 48);
  assert.equal(out.units.length, 1);
  assert.deepEqual(out.units[0].points.map(p => p[1]), [60, 65]);
  assert.deepEqual(out.units[0].points[0].slice(1), [60, 100, null]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select public.cos_vrm_power_history(48)'));
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from cos_vrm_private.power_history'));
});
