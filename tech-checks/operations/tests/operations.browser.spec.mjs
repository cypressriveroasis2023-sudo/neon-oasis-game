import { test, expect } from '@playwright/test';

// Synthetic records exist only in this test file. Every external request is
// intercepted or blocked; these tests cannot read or mutate production data.
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const now = '2026-10-04T15:00:00.000Z';
const day = '2026-10-04';
const jobId = '11111111-1111-4111-8111-111111111111';
const visitId = '22222222-2222-4222-8222-222222222222';
const unitId = '33333333-3333-4333-8333-333333333333';
const missingUnitId = '44444444-4444-4444-8444-444444444444';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwGQAAAAASUVORK5CYII=', 'base64');

const harness = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style></head><body><iframe id="operations" title="Operations fixture" src="/?theme=classic"></iframe><script>window.addEventListener("message",function(event){var frame=document.getElementById("operations");if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=="COS_OPERATIONS_TOKEN_REQUEST")return;event.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:event.data.requestId,accessToken:"synthetic-owner-session",role:"owner"},location.origin);});</script></body></html>';

function makeFixture() {
  return {
    jobs: [
      { id: jobId, visitId, jobNumber: 'FIX-101', customer: 'Fixture North Yard', site: 'North Gate', department: 'service', technician: 'Unassigned', status: 'unscheduled', priority: 'high', jobType: 'Service', equipment: 'Sniper', equipmentUnitTag: 'FIX-SN-001', instructions: 'Synthetic inspection assignment' },
      { id: '55555555-5555-4555-8555-555555555555', visitId: '66666666-6666-4666-8666-666666666666', jobNumber: 'FIX-102', customer: 'Fixture East Gate', site: 'East Entrance', department: 'it', technician: 'Jordan IT', status: 'scheduled', scheduled: day + ' 08:00', scheduledEnd: day + ' 10:00', priority: 'medium', jobType: 'Delivery' },
    ],
    tasks: [{ id: '77777777-7777-4777-8777-777777777777', title: 'Fixture inventory review', assignedTo: 'Casey Service', assignedDepartment: 'service', status: 'assigned', dueAt: day + ' 10:00', priority: 'high' }],
    readiness: [
      { userId: '88888888-8888-4888-8888-888888888888', name: 'Casey Service', department: 'service', status: 'not started', result: {} },
      { userId: '99999999-9999-4999-8999-999999999999', name: 'Jordan IT', department: 'it', status: 'not started', result: {} },
    ],
    units: [
      { id: unitId, unitNumber: 'FIX-SN-001', modelName: 'Sniper', status: 'installed', customer: 'Fixture North Yard', site: 'North Gate', latitude: 29.7604, longitude: -95.3698, gpsAccuracyM: null, coordinateSource: 'manual', gpsRecordedAt: now, hasUnitGps: true },
      { id: missingUnitId, unitNumber: 'FIX-RG-002', modelName: 'Ranger', status: 'assigned', customer: 'Fixture East Gate', site: 'East Entrance', latitude: null, longitude: null, gpsAccuracyM: null, coordinateSource: null, gpsRecordedAt: null, hasUnitGps: false },
    ],
    histories: new Map(),
    requests: [],
    writes: [],
    failedPaths: new Set(),
    readbackMismatch: false,
    generation: 0,
  };
}
function mapSnapshot(state) {
  const mapped = state.units.filter(unit => Number.isFinite(unit.latitude) && Number.isFinite(unit.longitude)).length;
  return { items: state.units, summary: { fieldUnits: state.units.length, mappedUnits: mapped, unitGps: state.units.filter(unit => unit.hasUnitGps).length, missingGps: state.units.length - mapped }, generatedAt: new Date(Date.parse(now) + state.generation).toISOString() };
}
async function fixturePage(page) {
  const state = makeFixture();
  await page.clock.install({ time: new Date(now) });
  await page.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === origin + '/harness') return route.fulfill({ status: 200, contentType: 'text/html', body: harness });
    if (url.startsWith(origin + '/')) return route.continue();
    if (/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    if (url !== edge) return route.abort('blockedbyclient');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' } });
    expect(request.method()).toBe('POST');
    expect(await request.headerValue('authorization')).toBe('Bearer synthetic-owner-session');
    const envelope = request.postDataJSON();
    const { path, method, body } = envelope;
    state.requests.push(envelope);
    if (state.failedPaths.has(path)) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic source unavailable' }) });
    let data;
    if (method === 'GET') {
      if (path === '/api/session') data = { authorized: true, name: 'Fixture Owner', role: 'Owner' };
      else if (path === '/api/jobs') data = { items: state.jobs };
      else if (path === '/api/owner-tasks') data = { items: state.tasks };
      else if (['/api/quotes', '/api/ar', '/api/purchasing'].includes(path)) data = { items: [] };
      else if (path === '/api/owner/control-data') data = { sites: [], truckChecks: [], serviceTechnicians: state.readiness.filter(row => row.department === 'service').map(row => row.name), itTechnicians: state.readiness.filter(row => row.department === 'it').map(row => row.name) };
      else if (path === '/api/daily-board') data = { jobs: state.readbackMismatch ? state.jobs.map(job => ({ ...job, technician: 'Previous Service' })) : state.jobs, tasks: state.tasks, readiness: state.readiness, asOf: now };
      else if (path === '/api/field-map') data = mapSnapshot(state);
      else if (/^\/api\/field-map\/[^/]+\/history$/.test(path)) data = { items: state.histories.get(path.split('/')[3]) || [] };
      else throw new Error('Unexpected fixture GET: ' + path);
    } else if (method === 'POST') {
      state.writes.push(envelope);
      const schedule = /^\/api\/jobs\/([^/]+)\/(schedule|assign)$/.exec(path);
      const gps = /^\/api\/field-map\/([^/]+)\/gps$/.exec(path);
      if (schedule) {
        const job = state.jobs.find(row => row.id === schedule[1]);
        if (!job) throw new Error('Unknown fixture job');
        Object.assign(job, { technician: body.technician, status: 'scheduled' }, schedule[2] === 'schedule' ? { scheduled: body.start, scheduledEnd: body.end } : {});
        data = { accepted: true };
      } else if (gps) {
        const unit = state.units.find(row => row.id === gps[1]);
        if (!unit) throw new Error('Unknown fixture unit');
        state.generation++;
        const recordedAt = new Date(Date.parse(now) + state.generation).toISOString();
        Object.assign(unit, { latitude: body.latitude, longitude: body.longitude, gpsAccuracyM: body.accuracyM, coordinateSource: body.source, gpsRecordedAt: recordedAt, hasUnitGps: true });
        const record = { id: 'fixture-gps-' + state.generation, latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM, source: body.source, note: body.note, recordedAt, recordedBy: 'Fixture Owner' };
        state.histories.set(unit.id, [record, ...(state.histories.get(unit.id) || [])]);
        data = { ...record, id: unit.id };
      } else throw new Error('Unexpected fixture POST: ' + path);
    } else throw new Error('Unexpected fixture method: ' + method);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(data) });
  });
  // Chromium may send the preflight through routing; Playwright fulfills the
  // intercepted cross-origin fetch directly, so no backend request is emitted.
  await page.goto('/harness');
  const frame = page.frameLocator('#operations');
  await expect(frame.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  return { state, frame };
}
async function open(frame, name) {
  await frame.getByRole('button', { name, exact: true }).first().click();
}
async function noOverflow(page) {
  const iframe = page.frames().find(frame => frame.parentFrame());
  const size = await iframe.evaluate(() => ({ width: innerWidth, content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
  expect(size.content).toBeLessThanOrEqual(size.width + 1);
  const outer = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(outer.content).toBeLessThanOrEqual(outer.width + 1);
}
async function assignmentDialog(frame) {
  await frame.locator('.daily-board-card').filter({ hasText: 'Fixture North Yard' }).click();
  const details = frame.getByRole('dialog', { name: 'Work details' });
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Schedule / Reassign' }).click();
  const dialog = frame.getByRole('dialog', { name: 'Schedule and reassign job' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Service date').fill(day);
  await dialog.getByLabel('Start time').fill('09:00');
  await dialog.getByLabel('End time').fill('11:00');
  await dialog.getByLabel('Technician').selectOption('Casey Service');
  return dialog;
}

test('Today preserves verified sources when one source fails and fits the viewport', async ({ page }) => {
  const { state, frame } = await fixturePage(page);
  await expect(frame.getByText('Dashboard sources loaded.', { exact: true })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Operational Timeline' })).toBeVisible();
  await noOverflow(page);
  state.failedPaths.add('/api/jobs');
  await frame.getByRole('button', { name: 'Refresh Today' }).click();
  await expect(frame.getByRole('alert', { name: 'Dashboard data unavailable' })).toBeVisible();
  await expect(frame.getByText('Jobs could not be loaded. Retry before relying on this view.', { exact: true })).toBeVisible();
  await expect(frame.locator('.stats article').filter({ hasText: 'ACTIVE JOBS' }).locator('b')).toHaveText('—');
  await expect(frame.locator('.stats article').filter({ hasText: 'OWNER TASKS' }).locator('b')).toHaveText('1');
  await noOverflow(page);
});

test('Daily Board filters, validates scheduling and confirms persisted assignment after reload', async ({ page }) => {
  const { state, frame } = await fixturePage(page);
  await open(frame, 'Daily Board');
  await expect(frame.locator('.daily-board-card')).toHaveCount(3);
  await frame.getByLabel('Department', { exact: true }).selectOption('it');
  await expect(frame.locator('.daily-board-card')).toHaveCount(1);
  await expect(frame.locator('.daily-board-card')).toContainText('Fixture East Gate');
  await frame.getByLabel('Department', { exact: true }).selectOption('');
  await frame.getByLabel('Technician', { exact: true }).selectOption('Casey Service');
  await expect(frame.locator('.daily-board-card')).toHaveCount(1);
  await expect(frame.locator('.daily-board-card')).toContainText('Fixture inventory review');
  await frame.getByLabel('Technician', { exact: true }).selectOption('');
  await noOverflow(page);
  const dialog = await assignmentDialog(frame);
  await dialog.getByLabel('End time').fill('08:00');
  await dialog.getByRole('button', { name: 'Save Schedule & Assignment' }).click();
  await expect(dialog.getByRole('alert')).toContainText('End time must be after start time.');
  expect(state.writes).toHaveLength(0);
  await noOverflow(page);
  await dialog.getByLabel('End time').fill('11:00');
  await dialog.getByRole('button', { name: 'Save Schedule & Assignment' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Schedule and technician assignment saved and verified.' })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toEqual({ start: day + ' 09:00', end: day + ' 11:00', technician: 'Casey Service' });
  await page.reload();
  await open(frame, 'Daily Board');
  const saved = frame.getByRole('region', { name: 'Casey Service', exact: true }).locator('.daily-board-card').filter({ hasText: 'Fixture North Yard' });
  await expect(saved).toContainText(day + ' 09:00 CT');
  await expect(saved).toHaveClass(/daily-board-scheduled/);
  await noOverflow(page);
});

test('Daily Board keeps the last snapshot when refresh fails and reports unverified saves', async ({ page }) => {
  const { state, frame } = await fixturePage(page);
  await open(frame, 'Daily Board');
  await expect(frame.locator('.daily-board-card')).toHaveCount(3);
  state.failedPaths.add('/api/daily-board');
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(frame.getByRole('alert')).toContainText('Showing the last successful snapshot.');
  await expect(frame.locator('.daily-board-card')).toHaveCount(3);
  state.failedPaths.delete('/api/daily-board');
  state.readbackMismatch = true;
  const dialog = await assignmentDialog(frame);
  await dialog.getByRole('button', { name: 'Save Schedule & Assignment' }).click();
  await expect(frame.getByRole('alert')).toContainText('Save accepted, but the requested assignment could not be confirmed.');
  await expect(frame.getByText('Schedule and technician assignment saved and verified.', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});

test('Field Map selection, GPS validation and one confirmed write survive browser reload', async ({ page }) => {
  const { state, frame } = await fixturePage(page);
  await open(frame, 'Field Map');
  const units = frame.getByRole('complementary', { name: 'Field units' });
  await expect(units.getByRole('button')).toHaveCount(2);
  await expect(frame.locator('.field-map-canvas .leaflet-container, .field-map-canvas.leaflet-container')).toBeVisible();
  await noOverflow(page);
  await units.getByRole('button').filter({ hasText: 'FIX-RG-002' }).click();
  await expect(frame.locator('.field-map-detail h2')).toHaveText('FIX-RG-002');
  await frame.locator('.cos-field-pin-wrap').filter({ hasText: 'FIX-SN-001' }).click();
  await expect(frame.locator('.field-map-detail h2')).toHaveText('FIX-SN-001');
  await units.getByRole('button').filter({ hasText: 'FIX-RG-002' }).click();
  await frame.getByLabel('Latitude', { exact: true }).fill('91');
  await frame.getByLabel('Longitude', { exact: true }).fill('-95.400000');
  await frame.getByRole('button', { name: 'Save Unit GPS' }).click();
  await expect(frame.getByRole('alert')).toContainText('Latitude must be between -90 and 90.');
  expect(state.writes).toHaveLength(0);
  await frame.getByLabel('Latitude', { exact: true }).fill('29.800000');
  await frame.getByLabel('Accuracy (meters)', { exact: true }).fill('');
  await frame.getByLabel('Source').selectOption('manual');
  await frame.getByLabel('Note', { exact: true }).fill('Synthetic gate location');
  await frame.getByRole('button', { name: 'Save Unit GPS' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'FIX-RG-002 GPS location saved and verified.' }).first()).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].path).toBe('/api/field-map/' + missingUnitId + '/gps');
  expect(state.writes[0].body).toEqual({ latitude: 29.8, longitude: -95.4, accuracyM: null, source: 'manual', note: 'Synthetic gate location' });
  await page.reload();
  await open(frame, 'Field Map');
  await frame.getByRole('complementary', { name: 'Field units' }).getByRole('button').filter({ hasText: 'FIX-RG-002' }).click();
  await expect(frame.getByLabel('Latitude', { exact: true })).toHaveValue('29.8');
  await expect(frame.getByLabel('Longitude', { exact: true })).toHaveValue('-95.4');
  await expect(frame.locator('.field-map-history')).toContainText('Synthetic gate location');
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});
