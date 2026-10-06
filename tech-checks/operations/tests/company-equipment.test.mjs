import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCompanyEquipment } from '../src/todayDashboardData.ts';
const stamp = '2026-10-06T13:00:00.000Z';
const camera = { totalDevices: 3, online: 1, offline: 1, review: 1, shopRoot: 0, healthRows: 3, fieldDevices: 3, refreshedAt: stamp, rows: [{ id: 'c1', name: 'Fixture camera 1', status: 'online' }, { id: 'c2', name: 'Fixture camera 2', status: 'offline' }, { id: 'c3', name: 'Fixture camera 3', status: 'review' }] };
const routers = { items: [], generatedAt: stamp, source: 'camera_health', gpsAvailable: false };

test('company equipment reads only validated camera and stored router sources', async () => {
  const paths = [];
  const result = await loadCompanyEquipment({ get: async path => { paths.push(path); return { data: path.includes('camera-health') ? camera : routers }; } });
  assert.deepEqual(paths.sort(), ['/api/camera-health/summary', '/api/routers']);
  assert.equal(result.camera.offline + result.camera.review, 2);
  assert.equal(result.routers.items.length, 0);
  assert.equal(result.routers.gpsAvailable, false);
  assert.deepEqual(result.errors, {});
});

test('company equipment never substitutes an empty collection or healthy zero after failure', async () => {
  for (const failedPath of ['/api/camera-health/summary', '/api/routers']) {
    const result = await loadCompanyEquipment({ get: async path => { if (path === failedPath) throw new Error('Fixture unavailable'); return { data: path.includes('camera-health') ? camera : routers }; } });
    const key = failedPath.includes('camera-health') ? 'camera' : 'routers';
    assert.equal(result[key], null);
    assert.match(result.errors[key], /could not be loaded/);
    assert.ok(result[key === 'camera' ? 'routers' : 'camera']);
  }
});

test('invalid camera totals, malformed router snapshots and denied sources fail independently', async () => {
  const malformed = await loadCompanyEquipment({ get: async path => ({ data: path.includes('camera-health') ? { ...camera, online: 9 } : { ...routers, gpsAvailable: true } }) });
  assert.equal(malformed.camera, null);
  assert.equal(malformed.routers, null);
  assert.equal(Object.keys(malformed.errors).length, 2);
  const denied = await loadCompanyEquipment({ get: async () => { throw { response: { status: 403 } }; } });
  assert.match(denied.errors.camera, /Owner access/);
  assert.match(denied.errors.routers, /Owner access/);
});
