import { openWorkspace } from './navigation-helper.mjs';
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
      { id: unitId, unitNumber: 'FIX-SN-001', modelName: 'Sniper', status: 'installed', customer: 'Fixture North Yard', site: 'North Gate', address:'1 Fixture St, Test City', latitude: 29.7604, longitude: -95.3698, gpsAccuracyM: null, coordinateSource: 'manual', gpsRecordedAt: now, hasUnitGps: true },
      { id: missingUnitId, unitNumber: 'FIX-RG-002', modelName: 'Ranger', status: 'assigned', customer: 'Fixture East Gate', site: 'East Entrance', address:'2 Fixture St, Test City', latitude: null, longitude: null, gpsAccuracyM: null, coordinateSource: null, gpsRecordedAt: null, hasUnitGps: false },
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
async function fixturePage(page,{locationWritesEnabled=true}={}) {
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
      if (path === '/api/session') data = { authorized: true, name: 'Fixture Owner', role: 'Owner', features:{fieldLocationVerification:locationWritesEnabled} };
      else if (path === '/api/routers') data = { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date().toISOString() };
      else if (path === '/api/camera-health/summary-v3') data = {totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:now,rows:[]};
      else if (path === '/api/jobs') data = { items: state.jobs };
      else if (path === '/api/team-production') data = { items: [] };
      else if (path === '/api/owner-tasks') data = { items: state.tasks };
      else if (['/api/quotes', '/api/ar', '/api/purchasing', '/api/vrm-portal', '/api/equipment', '/api/team-production', '/api/customers', '/api/sites'].includes(path)) data = { items: [] };
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
        Object.assign(unit, { latitude: body.latitude, longitude: body.longitude, gpsAccuracyM: body.accuracyM, coordinateSource: body.source, gpsRecordedAt: recordedAt, hasUnitGps: true, locationVerification:'owner_verified',locationVerifiedAt:recordedAt });
        const record = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-'+String(state.generation).padStart(12,'0'), latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM, source: body.source, note: body.note, recordedAt, recordedBy: 'Fixture Owner' };
        unit.locationHistoryId=record.id;
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
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toBeVisible();
  return { state, frame };
}
async function open(frame, name) { await openWorkspace(frame, name);
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

test('approved workspace selects real job details and opens only that job without writes', async ({ page }, testInfo) => {
  const { state, frame } = await fixturePage(page);
  await frame.getByRole('button', { name: /Delivery · FIX-102/ }).click();
  const details=frame.getByRole('complementary',{name:'Selected job details'});
  await expect(details).toContainText('Jordan IT');
  await expect(details).toContainText('East Entrance');
  for(const width of [320,390,1024,1440,2560]){
    await page.setViewportSize({width,height:1000});
    const layout=await frame.locator('.workspace-overview').evaluate(el=>({right:el.getBoundingClientRect().right,viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
    expect(layout.right).toBeLessThanOrEqual(layout.viewport+1);
    expect(layout.scroll).toBeLessThanOrEqual(layout.viewport+1);
  }
  await page.setViewportSize(testInfo.project.use.viewport);
  await page.screenshot({path:testInfo.outputPath('approved-workspace.png'),fullPage:true});
  await details.getByRole('button',{name:'Open job & actions →'}).click();
  await expect(frame.locator('.ops-workflows .record')).toHaveCount(1);
  await expect(frame.locator('.ops-workflows .record')).toContainText('FIX-102');
  await frame.getByRole('button',{name:'Show all jobs'}).click();
  await expect(frame.locator('.ops-workflows .record')).toHaveCount(2);
  expect(state.writes).toEqual([]);
});

test('Today preserves verified sources when one source fails and fits the viewport', async ({ page }) => {
  const { state, frame } = await fixturePage(page);
  await expect(frame.getByText('Connected sources loaded. Agreement and signature tracking is not connected.', { exact: true })).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Operational Timeline' })).toBeVisible();
  await noOverflow(page);
  state.failedPaths.add('/api/jobs');
  await frame.getByRole('button', { name: 'Refresh Overview' }).click();
  await expect(frame.getByRole('alert', { name: 'Dashboard data unavailable' })).toBeVisible();
  await expect(frame.getByText('Jobs could not be loaded. Retry before relying on this view.', { exact: true })).toBeVisible();
  await expect(frame.getByRole('navigation',{name:'Company job lifecycle'}).getByRole('button',{name:'Schedule & Parts: Unavailable',exact:true})).toBeVisible();
  await expect(frame.getByRole('navigation',{name:'Company job lifecycle'}).getByRole('button',{name:'Quote: 0 quotes',exact:true})).toBeVisible();
  await noOverflow(page);
});

test('Job flow opens the exact lifecycle and returns to its source before scheduling the same job', async ({page}) => {
  const {frame,state}=await fixturePage(page);
  await open(frame,'Jobs');
  const job=frame.locator('.ops-workflows .record').filter({hasText:'FIX-101'});
  await job.getByRole('button',{name:'View lifecycle',exact:true}).click();
  const detail=frame.getByRole('complementary',{name:'Selected job details'});
  await expect(detail).toContainText('FIX-101');
  await expect(detail).not.toContainText('FIX-102');
  await detail.getByRole('button',{name:'← Back to jobs',exact:true}).click();
  expect(await frame.locator('body').evaluate(()=>location.hash)).toBe('#jobs');
  await job.getByRole('button',{name:'View lifecycle',exact:true}).click();
  await detail.getByRole('button',{name:'Schedule this job →',exact:true}).click();
  expect(await frame.locator('body').evaluate(()=>location.hash)).toBe('#unscheduled?job='+jobId);
  await expect(frame.locator('.ops-workflows .record')).toHaveCount(1);
  await expect(frame.locator('.ops-workflows .record')).toContainText('FIX-101');
  await expect(frame.locator('.ops-workflows .record').getByRole('button',{name:'Schedule + Assign',exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);
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
  const card = frame.locator('.daily-board-card').filter({ hasText: 'Fixture North Yard' });
  await card.click();
  await expect(frame.getByRole('button', { name: 'Schedule / Reassign' })).toBeDisabled();
  await frame.getByRole('button', { name: 'Close details' }).click();
  state.failedPaths.add('/api/daily-board');
  await frame.getByRole('button', { name: 'Refresh before another assignment' }).click();
  await expect(frame.getByRole('alert').first()).toContainText('Showing the last successful snapshot.');
  await card.click();
  await expect(frame.getByRole('button', { name: 'Schedule / Reassign' })).toBeDisabled();
  await frame.getByRole('button', { name: 'Close details' }).click();
  expect(state.writes).toHaveLength(1);
  state.failedPaths.delete('/api/daily-board');
  state.readbackMismatch = false;
  await frame.getByRole('button', { name: 'Refresh before another assignment' }).click();
  const recovered = await assignmentDialog(frame);
  await recovered.getByRole('button', { name: 'Save Schedule & Assignment' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'Schedule and technician assignment saved and verified.' })).toBeVisible();
  expect(state.writes).toHaveLength(2);
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
  await units.getByRole('button').filter({ hasText: 'FIX-SN-001' }).click();
  await expect(frame.locator('.field-map-detail h2')).toHaveText('FIX-SN-001');
  await units.getByRole('button').filter({ hasText: 'FIX-RG-002' }).click();
  await frame.getByLabel('Latitude', { exact: true }).fill('91');
  await frame.getByLabel('Longitude', { exact: true }).fill('-95.400000');
  await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
  await frame.getByRole('button', { name: 'Save verified location' }).click();
  await expect(frame.getByRole('alert')).toContainText('Latitude must be between -90 and 90.');
  expect(state.writes).toHaveLength(0);
  await frame.getByLabel('Latitude', { exact: true }).fill('29.800000');
  await frame.getByLabel('Accuracy (meters)', { exact: true }).fill('');
  await frame.getByLabel('Source').selectOption('manual');
  await frame.getByLabel('Verification note', { exact: true }).fill('Synthetic gate location');
  await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
  await frame.getByRole('button', { name: 'Save verified location' }).click();
  await expect(frame.getByRole('status').filter({ hasText: 'FIX-RG-002 location saved and read back successfully.' }).first()).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].path).toBe('/api/field-map/' + missingUnitId + '/gps');
  expect(state.writes[0].body).toMatchObject({ latitude: 29.8, longitude: -95.4, accuracyM: null, source: 'manual' });
  expect(state.writes[0].body.note).toMatch(/^COS_FIELD_LOCATION_V1\|address_sha256=[a-f0-9]{64}\|confirmed=true\nSynthetic gate location$/);
  await page.reload();
  await open(frame, 'Field Map');
  await frame.getByRole('complementary', { name: 'Field units' }).getByRole('button').filter({ hasText: 'FIX-RG-002' }).click();
  await expect(frame.getByLabel('Latitude', { exact: true })).toHaveValue('29.8');
  await expect(frame.getByLabel('Longitude', { exact: true })).toHaveValue('-95.4');
  await expect(frame.locator('.field-map-history')).toContainText('Synthetic gate location');
  expect(state.writes).toHaveLength(1);
  await noOverflow(page);
});


test('Field Map blocks another GPS write until a successful manual refresh', async ({ page }) => {
  const { state, frame } = await fixturePage(page);
  await open(frame, 'Field Map');
  await frame.locator('.field-map-list>button').first().click();
  const save = frame.getByRole('button', { name: 'Save verified location' });
  await expect(save).toBeDisabled();
  await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
  await expect(save).toBeEnabled();
  await frame.getByLabel('Latitude', { exact: true }).fill('29.81');
  await frame.getByLabel('Longitude', { exact: true }).fill('-95.3698');
  state.failedPaths.add('/api/field-map');
  await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
  await save.click();
  await expect(frame.getByRole('alert').first()).toContainText('GPS may have been saved');
  await expect(save).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(frame.getByRole('alert').first()).toContainText('Synthetic source unavailable');
  await expect(save).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  state.failedPaths.delete('/api/field-map');
  await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(save).toBeDisabled();
  await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
  await expect(save).toBeEnabled();
  await expect(frame.getByLabel('Latitude', { exact: true })).toHaveValue('29.81');
  await frame.getByLabel('Latitude', { exact: true }).fill('29.82');
  await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
  await save.click();
  await expect(frame.getByRole('status').filter({ hasText: 'location saved and read back successfully.' }).first()).toBeVisible();
  expect(state.writes).toHaveLength(2);
});

test('Overview mobile job detail preserves selection through Back, Forward, reload and resize',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {frame,state}=await fixturePage(page);
  const search=frame.getByRole('searchbox',{name:'Find an active job'});
  await search.fill('East');
  const selected=frame.getByRole('button',{name:/Delivery · FIX-102/});
  await selected.click();
  const detail=frame.getByRole('complementary',{name:'Selected job details'});
  await expect(detail).toBeVisible();
  await expect(frame.locator('.workspace-work')).toBeHidden();
  await expect(detail).toContainText('East Entrance');
  const hash=await frame.locator('body').evaluate(()=>location.hash);
  expect(hash).toContain('job=55555555-5555-4555-8555-555555555555');
  expect(hash).toContain('detail=1');
  await detail.getByRole('button',{name:'← Back to jobs',exact:true}).click();
  await expect(search).toHaveValue('East');
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute('aria-pressed','true');
  await expect(detail).toBeHidden();
  await frame.locator('body').evaluate(()=>history.forward());
  await expect(detail).toBeVisible();
  for(const width of [1024,390,1440,320]){
    await page.setViewportSize({width,height:900});
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('East Entrance');
    await noOverflow(page);
  }
  await frame.locator('body').evaluate(()=>location.reload());
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('East Entrance');
  await detail.getByRole('button',{name:'Open job & actions →'}).click();
  await expect(frame.locator('.ops-workflows .record')).toHaveCount(1);
  await expect(frame.locator('.ops-workflows .record')).toContainText('FIX-102');
  await frame.locator('body').evaluate(()=>history.back());
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('East Entrance');
  expect(state.writes).toEqual([]);
});
test('a stale Overview job link never substitutes another record or action',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {frame,state}=await fixturePage(page);
  await frame.locator('body').evaluate(()=>{location.hash='today?job=missing-job&detail=1';});
  const detail=frame.getByRole('complementary',{name:'Selected job details'});
  await expect(detail.getByRole('heading',{name:'Selected job is unavailable'})).toBeVisible();
  await expect(detail.getByRole('button',{name:'Open job & actions →'})).toHaveCount(0);
  await detail.getByRole('button',{name:'← Back to jobs',exact:true}).click();
  await expect(frame.locator('.workspace-work')).toBeVisible();
  await expect(detail).toBeHidden();
  expect(state.writes).toEqual([]);
});

test('Field View keeps address verification explicit and hides changed-address pins',async({page},info)=>{
 const {state,frame}=await fixturePage(page);
 state.units[0].address='1 Fixture St, Test City';
 state.units[1].address='2 Fixture St, Test City';
 await open(frame,'Field Map');
 const units=frame.getByRole('complementary',{name:'Field units'});
 await expect(units).toContainText('HISTORICAL PIN');
 await expect(units).toContainText('ADDRESS ONLY');
 await expect(units).toContainText('Camera status unverified');
 await frame.locator('.field-map-list>button').first().click();
 const save=frame.getByRole('button',{name:'Save verified location'});
 await expect(save).toBeDisabled();
 await expect(frame.getByRole('link',{name:'Look up recorded installation address ↗'})).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query=1%20Fixture%20St%2C%20Test%20City');
 await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
 await frame.getByLabel('Latitude',{exact:true}).fill('29.8001');
 await frame.getByLabel('Longitude',{exact:true}).fill('-95.3698');
 await expect(save).toBeDisabled();
 await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).check();
 await save.click();
 await expect(frame.locator('.field-map-detail')).toContainText('VERIFIED PIN');
 expect(state.writes).toHaveLength(1);
 Object.assign(state.units[0],{address:'3 New Fixture St, Test City',latitude:null,longitude:null,locationVerification:'address_changed',locationVerifiedAt:null});state.generation++;
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(units).toContainText('ADDRESS CHANGED');
 await expect(frame.locator('.cos-field-pin-wrap')).toHaveCount(0);
 await expect(frame.locator('.field-map-detail')).toContainText('3 New Fixture St');
 await expect(frame.locator('.field-map-detail')).toContainText('Verify the new location');
 expect(state.writes).toHaveLength(1);
 state.units[0].address='';state.generation++;
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(save).toBeDisabled();
 await expect(frame.getByRole('checkbox',{name:/I checked that these coordinates match/})).toBeDisabled();
 await units.getByRole('button').filter({hasText:'FIX-RG-002'}).click();
 await frame.locator('.field-map-detail').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('field-location-verification.png'),fullPage:true});
 await frame.getByRole('checkbox',{name:/I checked that these coordinates match/}).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('field-location-verification-form.png'),fullPage:true});
});

test('Field View never offers GPS writes before verified projection capability is enabled',async({page})=>{
 const {frame,state}=await fixturePage(page,{locationWritesEnabled:false});
 await open(frame,'Field Map');
 await frame.locator('.field-map-list>button').first().click();
 await expect(frame.getByText('Verified location editing is not enabled for this backend yet.',{exact:false})).toBeVisible();
 await expect(frame.getByRole('button',{name:'Save verified location'})).toHaveCount(0);
 await expect(frame.getByRole('button',{name:'Use My Current GPS'})).toHaveCount(0);
 await expect(frame.getByLabel('Latitude',{exact:true})).toHaveCount(0);
 expect(state.writes).toEqual([]);
});
