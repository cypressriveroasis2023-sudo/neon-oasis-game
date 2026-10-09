import { test, expect } from '@playwright/test';
import { openWorkspace } from './navigation-helper.mjs';
import { resource, snapshot, now } from './fixtures/camera-evidence-fixtures.mjs';

const origin = 'http://127.0.0.1:4173';
const paths = {
  camera: '/api/camera-health/summary-v3', routers: '/api/routers', power: '/api/vrm-portal',
  equipment: '/api/equipment', field: '/api/field-map', team: '/api/team-production',
  jobs: '/api/jobs', quotes: '/api/quotes', invoices: '/api/ar', purchasing: '/api/purchasing', tasks: '/api/owner-tasks',
};
const stamp = new Date(now).toISOString();
const shop = { id: '11111111-1111-4111-8111-111111111111', unitNumber: 'SYNTHETIC-SHOP-1', status: 'available', currentLocationType: 'shop' };
const fieldUnit = { id: '22222222-2222-4222-8222-222222222222', unitNumber: 'SYNTHETIC-FIELD-1', status: 'installed', currentLocationType: 'site', address: '1 Synthetic St', latitude: null, longitude: null };
const routers = items => ({ items, generatedAt: stamp, source: 'camera_health', gpsAvailable: false });
const router = { id: 'synthetic-router', unitKey: 'Synthetic unit', name: 'Synthetic router', model: 'Synthetic', publicIp: null, unitIp: null, port: null, protocol: null, probeStatus: 'unknown', checkedAt: null, lastRecoveredAt: null, reportedStatus: 'Unknown', reportedAt: null, reportedSource: 'Synthetic', savedLatencyMs: null, match: 'unmatched', candidateUnit: null, gps: null };
const field = items => ({ items, summary: { fieldUnits: items.length, mappedUnits: 0, unitGps: 0, missingGps: items.length }, generatedAt: stamp });
const job = { id: '33333333-3333-4333-8333-333333333333', jobNumber: 'SYNTHETIC-JOB-1', jobType: 'Delivery', customer: 'Synthetic customer', site: 'Synthetic site', status: 'Scheduled', stage: 'IT Prep' };

async function mount(page, { held = [], failures = [], payloads = {} } = {}) {
  const gates = new Map();
  const state = {
    requests: [], failures: new Set(failures), errors: [],
    payloads: {
      [paths.camera]: snapshot([resource(1)]), [paths.routers]: routers([router]),
      [paths.power]: { items: [{ id: 'synthetic-power' }] }, [paths.equipment]: { items: [shop], models: [] },
      [paths.field]: field([fieldUnit]), [paths.team]: { items: [{ id: 'synthetic-member', active: true }] },
      [paths.jobs]: { items: [job] }, [paths.quotes]: { items: [{ id: 'synthetic-quote', status: 'Draft' }] },
      ...payloads,
    },
    hold(path) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      const gate = { promise, release, pending: 0 };
      gates.set(path, gate);
      return gate;
    },
    detach(path) { const gate = gates.get(path); gates.delete(path); return gate; },
    release(path) { const gate = this.detach(path); gate?.release(); return gate; },
  };
  held.forEach(path => state.hold(path));
  page.on('pageerror', error => state.errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/vision-progressive-fixture') return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe src="/"></iframe><script>window.syntheticToken='synthetic-session-one';addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:window.syntheticToken},location.origin)})</script>` });
    if (url.startsWith(origin + '/')) return route.continue();
    if (!url.endsWith('/functions/v1/cos-operations-pages')) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON();
    state.requests.push(request);
    expect(request.method).toBe('GET');
    const failed = state.failures.has(request.path);
    const data = request.path === '/api/session' ? { authorized: true, name: 'Synthetic owner', role: 'Owner' }
      : state.payloads[request.path] ?? { items: [] };
    // Capture each response at request time so a late response really contains older data.
    const body = JSON.stringify(failed ? { error: 'Synthetic source unavailable' } : data);
    const gate = gates.get(request.path);
    if (gate) { gate.pending++; await gate.promise; }
    try { await route.fulfill({ status: failed ? 503 : 200, headers, contentType: 'application/json', body }); }
    finally { if (gate) gate.pending--; }
  });
  await page.goto('/vision-progressive-fixture');
  const frame = page.frameLocator('iframe');
  const dashboard = frame.getByRole('region', { name: 'VISION dashboard', exact: true });
  const overview = frame.getByRole('region', { name: 'Company overview', exact: true });
  await expect(dashboard).toBeVisible();
  return { frame, dashboard, overview, state };
}
const card = (dashboard, label) => dashboard.locator('.vision-area-card').filter({ hasText: label });

test('fast fleet cards, company sources and equipment render while independent slow sources are checking', async ({ page }) => {
  const { frame, dashboard, overview, state } = await mount(page, { held: Object.values(paths) });
  await expect(dashboard.getByText('Checking connected records…', { exact: true })).toHaveCount(6);
  await expect(overview).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Schedule & Parts: Checking…', exact: true })).toBeVisible();
  await expect(overview.getByText('Checking Camera Health…', { exact: true })).toBeVisible();
  await expect(overview.getByText('Checking router inventory…', { exact: true })).toBeVisible();
  await expect(overview).not.toContainText('0 review items');
  await expect(overview).not.toContainText('Nothing currently needs Owner attention');

  for (const path of [paths.routers, paths.power, paths.equipment, paths.team, paths.quotes, paths.purchasing, paths.tasks]) state.release(path);
  await expect(card(dashboard, 'InHand Routers')).toContainText('1 routers · view connection checks');
  await expect(card(dashboard, 'Victron Power')).toContainText('1 power installations · open dashboards');
  await expect(card(dashboard, 'Units On Hand')).toContainText('1 confirmed on hand · 0 placement not recorded');
  await expect(card(dashboard, 'Team')).toContainText('1 active team members');
  await expect(overview.getByText('1 stored router record', { exact: true })).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Quote: 1 quote', exact: true })).toBeVisible();
  await expect(card(dashboard, 'Field View')).toContainText('Checking connected records…');
  await expect(card(dashboard, 'Camera Health')).toContainText('Checking connected records…');
  await expect(dashboard.getByRole('button', { name: 'Checking fleet…', exact: true })).toBeDisabled();

  state.release(paths.jobs);
  await expect(overview.getByRole('button', { name: 'Schedule & Parts: 1 job', exact: true })).toBeVisible();
  await expect(frame.getByRole('region', { name: 'Daily workspace', exact: true })).toContainText(job.jobNumber);
  state.release(paths.camera);
  await expect(card(dashboard, 'Camera Health')).toContainText('Provider systems: 1 online · 0 offline · 0 review');
  await expect(overview.getByText('No provider systems flagged', { exact: true })).toBeVisible();
  await expect(overview).not.toContainText('Nothing currently needs Owner attention');
  state.release(paths.invoices);
  await expect(frame.getByRole('button', { name: 'Refresh Overview', exact: true })).toBeEnabled();
  await expect(card(dashboard, 'Field View')).toContainText('Checking connected records…');
  state.release(paths.field);
  await expect(card(dashboard, 'Field View')).toContainText('1 field units · 0 mapped · 1 with addresses');
  await expect(dashboard.getByRole('button', { name: 'Refresh fleet', exact: true })).toBeEnabled();
  expect(state.errors).toEqual([]);
});

test('failed and malformed cards settle independently without turning unknown data into healthy zero', async ({ page }) => {
  const { dashboard, overview, state } = await mount(page, {
    held: [paths.field], failures: [paths.power, paths.routers],
    payloads: { [paths.camera]: { rows: [] }, [paths.equipment]: { items: [null] } },
  });
  await expect(card(dashboard, 'Team')).toContainText('1 active team members');
  for (const label of ['InHand Routers', 'Victron Power', 'Units On Hand']) await expect(card(dashboard, label)).toContainText('Status unavailable · open to check');
  await expect(card(dashboard, 'Camera Health')).toContainText('Health unavailable · source-separated inventory not verified');
  await expect(overview.getByText('Health unavailable', { exact: true })).toBeVisible();
  await expect(overview.getByText('Router count unavailable', { exact: true })).toBeVisible();
  await expect(card(dashboard, 'Field View')).toContainText('Checking connected records…');
  state.release(paths.field);
  await expect(dashboard.getByRole('button', { name: 'Refresh fleet', exact: true })).toBeEnabled();
  expect(state.errors).toEqual([]);
});

test('fleet refresh clears old summaries, rejects repeated starts and publishes each new result immediately', async ({ page }) => {
  const { dashboard, state } = await mount(page);
  const refresh = dashboard.getByRole('button', { name: 'Refresh fleet', exact: true });
  await expect(refresh).toBeEnabled();
  const before = state.requests.filter(request => request.path === paths.field).length;
  state.hold(paths.field);
  state.hold(paths.camera);
  state.failures.add(paths.routers);
  state.payloads[paths.team] = { items: [{ active: true }, { active: true }] };
  state.payloads[paths.field] = { items: [] }; // Missing totals must become unavailable, never zero.
  await refresh.evaluate(button => { button.click(); button.click(); });
  await expect(card(dashboard, 'Team')).toContainText('2 active team members');
  await expect(card(dashboard, 'InHand Routers')).toContainText('Status unavailable · open to check');
  await expect(card(dashboard, 'Field View')).toContainText('Checking connected records…');
  await expect(card(dashboard, 'Field View')).not.toContainText('1 field units');
  await expect(card(dashboard, 'Camera Health')).not.toContainText('Provider systems: 1 online');
  expect(state.requests.filter(request => request.path === paths.field)).toHaveLength(before + 1);
  state.release(paths.field);
  await expect(card(dashboard, 'Field View')).toContainText('Status unavailable · open to check');
  await expect(dashboard.getByRole('button', { name: 'Checking fleet…', exact: true })).toBeDisabled();
  state.release(paths.camera);
  await expect(refresh).toBeEnabled();
  state.failures.clear();
  state.payloads[paths.field] = field([]);
  await refresh.click();
  await expect(card(dashboard, 'Field View')).toContainText('0 field units · 0 mapped · 0 with addresses');
  await expect(card(dashboard, 'InHand Routers')).toContainText('1 routers');
  expect(state.errors).toEqual([]);
});

test('company refresh removes stale counts while healthy sources recover ahead of failed slow sources', async ({ page }) => {
  const { frame, overview, state } = await mount(page);
  const refresh = frame.getByRole('button', { name: 'Refresh Overview', exact: true });
  await expect(refresh).toBeEnabled();
  state.hold(paths.jobs);
  state.hold(paths.camera);
  state.failures.add(paths.jobs);
  state.failures.add(paths.camera);
  state.payloads[paths.routers] = routers([]);
  await refresh.click();
  await expect(overview.getByText('0 stored router records', { exact: true })).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Quote: 1 quote', exact: true })).toBeVisible();
  await expect(overview.getByRole('button', { name: 'Schedule & Parts: Checking…', exact: true })).toBeVisible();
  await expect(overview.getByText('Checking Camera Health…', { exact: true })).toBeVisible();
  await expect(overview).not.toContainText('No provider systems flagged');
  await expect(frame.getByRole('region', { name: 'Daily workspace', exact: true })).toHaveCount(0);
  await expect(overview).not.toContainText('Nothing currently needs Owner attention');
  state.release(paths.jobs);
  await expect(overview.getByRole('button', { name: 'Schedule & Parts: Unavailable', exact: true })).toBeVisible();
  await expect(frame.getByRole('alert', { name: 'Dashboard data unavailable' })).toContainText('Jobs could not be loaded');
  await expect(overview.getByText('Checking Camera Health…', { exact: true })).toBeVisible();
  state.release(paths.camera);
  await expect(overview.getByText('Health unavailable', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Retry dashboard', exact: true })).toBeEnabled();
  expect(state.errors).toEqual([]);
});

test('late responses after navigation and a changed session cannot overwrite the new dashboard', async ({ page }) => {
  const { frame, dashboard, state } = await mount(page, { held: [paths.field, paths.jobs] });
  await expect(card(dashboard, 'Team')).toContainText('1 active team members');
  await openWorkspace(frame, 'Operations');
  await expect(dashboard).toHaveCount(0);
  const oldField = state.detach(paths.field);
  const oldJobs = state.detach(paths.jobs);
  expect(oldField.pending).toBeGreaterThan(0);
  expect(oldJobs.pending).toBeGreaterThan(0);
  // Navigation remounts both readers. A later round must start from checking, not old state.
  state.payloads[paths.field] = field([]);
  state.payloads[paths.jobs] = { items: [] };
  state.hold(paths.field);
  state.hold(paths.jobs);
  await page.evaluate(() => { window.syntheticToken = 'synthetic-session-two'; });
  await openWorkspace(frame, 'Today');
  await expect(card(dashboard, 'Field View')).toContainText('Checking connected records…');
  await expect(frame.getByRole('region', { name: 'Daily workspace', exact: true })).toHaveCount(0);
  state.release(paths.field);
  state.release(paths.jobs);
  await expect(card(dashboard, 'Field View')).toContainText('0 field units · 0 mapped · 0 with addresses');
  await expect(frame.getByRole('region', { name: 'Daily workspace', exact: true })).toContainText('No active jobs in the loaded records.');
  oldField.release();
  oldJobs.release();
  await expect.poll(() => oldField.pending + oldJobs.pending).toBe(0);
  await expect(card(dashboard, 'Field View')).toContainText('0 field units · 0 mapped · 0 with addresses');
  await expect(frame.getByRole('region', { name: 'Daily workspace', exact: true })).not.toContainText(job.jobNumber);
  expect(state.errors).toEqual([]);
});
