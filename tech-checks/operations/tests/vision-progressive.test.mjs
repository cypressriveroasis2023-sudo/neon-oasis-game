import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSources, emptyTodayDashboard, loadTodayDashboard, loadCompanyEquipment, summarizeTodayDashboard } from '../src/todayDashboardData.ts';
import { resource, snapshot, now } from './fixtures/camera-evidence-fixtures.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('each company source publishes a new independent snapshot without waiting for the slowest source', async () => {
  const sources = new Map(dashboardSources.map(([, path]) => [path, deferred()]));
  const updates = [];
  const pending = loadTodayDashboard({ get: path => sources.get(path).promise }, value => updates.push(value));
  assert.deepEqual(updates, []);
  assert.equal(summarizeTodayDashboard(emptyTodayDashboard()).attention, null);

  sources.get('/api/quotes').resolve({ data: { items: [{ id: 'synthetic-quote' }] } });
  await tick();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].quotes.length, 1);
  assert.equal(updates[0].jobs, null);
  assert.equal(summarizeTodayDashboard(updates[0]).attention, null);

  sources.get('/api/jobs').reject({ response: { status: 403 } });
  await tick();
  assert.equal(updates.length, 2);
  assert.match(updates[1].errors.jobs, /Owner access/);
  assert.deepEqual(updates[0].errors, {}, 'previously delivered snapshots do not acquire later errors');
  for (const [, path] of dashboardSources) if (!['/api/jobs', '/api/quotes'].includes(path)) sources.get(path).resolve({ data: { items: [] } });
  const result = await pending;
  assert.equal(updates.length, dashboardSources.length);
  assert.equal(result.jobs, null);
  assert.deepEqual(result.tasks, []);
  assert.equal(updates[0].tasks, null, 'later settlement does not mutate earlier null placeholders');
});

test('company equipment publishes camera and router results separately and isolates malformed sources', async () => {
  for (const cameraFirst of [true, false]) {
    const camera = deferred(), routers = deferred(), updates = [];
    const pending = loadCompanyEquipment({ get: path => path.includes('camera-health') ? camera.promise : routers.promise }, value => updates.push(value));
    const cameraData = snapshot([resource(1)]);
    const routerData = { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date(now).toISOString() };
    if (cameraFirst) camera.resolve({ data: cameraData });
    else routers.resolve({ data: routerData });
    await tick();
    assert.equal(updates.length, 1);
    assert.ok(updates[0][cameraFirst ? 'camera' : 'routers']);
    assert.equal(updates[0][cameraFirst ? 'routers' : 'camera'], null);
    if (cameraFirst) routers.resolve({ data: { ...routerData, gpsAvailable: true } });
    else camera.resolve({ data: { ...cameraData, totalDevices: 99 } });
    const result = await pending;
    assert.equal(updates.length, 2);
    assert.match(result.errors[cameraFirst ? 'routers' : 'camera'], /could not be loaded/);
    assert.deepEqual(updates[0].errors, {});
    assert.equal(result[cameraFirst ? 'routers' : 'camera'], null);
  }
});
