import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {misfiledFieldCameras} from '../src/misfiledFieldCameras.ts';

const sql = readFileSync(new URL('../proposals/misfiled-field-cameras.sql', import.meta.url), 'utf8');

test('exact name or id can be proposed, and ambiguous cameras are only listed', () => {
  const report = misfiledFieldCameras([
    {id: '11', unitKey: 'Sniper 12', deviceName: 'Sniper 12 CAM 1', organization: 'ROOT'},
    {id: '12', unitKey: 'Sniper 13', deviceName: 'Sniper 13', organization: 'SHOP'},
    {id: '13', unitKey: 'Sniper 14', deviceName: 'Sniper 14', organization: 'UNASSIGNED'},
    {id: '14', unitKey: 'Sniper 15', deviceName: 'Sniper 15', organization: 'Fixture Field'},
  ], [
    {id: 'u12', unitNumber: 'Sniper 12', placement: 'FIELD', organization: 'Fixture Field'},
    {id: 'u13a', unitNumber: 'Sniper 13', placement: 'FIELD', organization: 'Fixture Field'},
    {id: 'u13b', unitNumber: 'Sniper 13', placement: 'FIELD', organization: 'Fixture Field'},
    {id: 'u14', unitNumber: 'Other 14', placement: 'FIELD', cameraId: '13', organization: 'Fixture Field'},
    {id: 'u15', unitNumber: 'Sniper 15', placement: 'FIELD', organization: 'Fixture Field'},
  ]);
  assert.deepEqual(report.proposals.map(row => row.cameraId), ['11', '13']);
  assert.equal(report.proposals[0].by, 'name');
  assert.equal(report.proposals[1].by, 'id');
  assert.equal(report.ambiguous.length, 1);
  assert.equal(report.ambiguous[0].cameraId, '12');
});

test('the reviewed SQL moves one exact camera and rolls it back', async () => {
  assert.match(sql, /BEFORE SNAPSHOT/);
  assert.match(sql, /-- APPLY/);
  assert.match(sql, /-- ROLLBACK/);
  assert.doesNotMatch(sql, /device_serial|public_ip|imsi|iccid|imei/i);
  const db = new PGlite();
  await db.exec(`
    create table public.camera_devices (id bigint primary key, unit_key text, device_name text, organization text);
    create table public.equipment_units (id text primary key, unit_number text, current_location_type text, camera_device_id text, field_organization text);
    insert into public.camera_devices values
      (11, 'Sniper 12', 'Sniper 12 CAM 1', 'ROOT'),
      (12, 'Sniper 13', 'Sniper 13', 'SHOP');
    insert into public.equipment_units values
      ('u12', 'Sniper 12', 'FIELD', '', 'Fixture Field'),
      ('u13a', 'Sniper 13', 'FIELD', '', 'Fixture Field'),
      ('u13b', 'Sniper 13', 'FIELD', '', 'Fixture Field');
  `);
  const before = sql.slice(sql.indexOf('-- BEFORE SNAPSHOT'), sql.indexOf('-- AMBIGUOUS'));
  const apply = sql.slice(sql.indexOf('-- APPLY'), sql.indexOf('-- ROLLBACK'));
  const rollback = sql.slice(sql.indexOf('-- ROLLBACK'));
  await db.exec(before);
  await db.exec(apply);
  const moved = await db.query(`select unit_key, organization from public.camera_devices order by id`);
  assert.equal(moved.rows[0].unit_key, 'Sniper 12');
  assert.equal(moved.rows[0].organization, 'Fixture Field');
  assert.equal(moved.rows[1].organization, 'SHOP');
  await db.exec(rollback);
  const restored = await db.query(`select organization from public.camera_devices where id = 11`);
  assert.equal(restored.rows[0].organization, 'ROOT');
  await db.close();
});
