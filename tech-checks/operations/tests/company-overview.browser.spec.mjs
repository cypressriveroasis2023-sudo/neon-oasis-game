import { test, expect } from '@playwright/test';
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const stamp = '2026-10-06T13:00:00.000Z';
const jobs = [
  { id: '11111111-1111-4111-8111-111111111111', jobNumber: 'FIX-101', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Unscheduled', stage: 'IT Prep' },
  { id: '22222222-2222-4222-8222-222222222222', jobNumber: 'FIX-102', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Scheduled', stage: 'IT Prep' },
  { id: '33333333-3333-4333-8333-333333333333', jobNumber: 'FIX-103', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'In Progress', stage: 'Service Delivery' },
  { id: '44444444-4444-4444-8444-444444444444', jobNumber: 'FIX-104', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Owner Review', stage: 'Owner Review' },
  { id: '55555555-5555-4555-8555-555555555555', jobNumber: 'FIX-105', jobType: 'Delivery', customer: 'Fixture customer', site: 'Fixture site', status: 'Billing Ready', stage: 'Billing' },
];
const camera = { totalDevices: 3, online: 1, offline: 1, review: 1, shopRoot: 0, healthRows: 3, fieldDevices: 3, refreshedAt: stamp, rows: [{ id: 'c1', name: 'Fixture camera 1', status: 'online' }, { id: 'c2', name: 'Fixture camera 2', status: 'offline' }, { id: 'c3', name: 'Fixture camera 3', status: 'review' }] };
const router = { id: 'r1', unitKey: 'Fixture Unit', name: 'Fixture router', model: 'Fixture', publicIp: null, unitIp: null, port: null, protocol: null, probeStatus: 'unknown', checkedAt: null, lastRecoveredAt: null, reportedStatus: 'Unknown', reportedAt: null, reportedSource: 'Fixture', savedLatencyMs: null, match: 'unmatched', candidateUnit: null, gps: null };
async function mount(page) {
  const state = { failures: new Set(), requests: [] };
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/company-overview-test') return route.fulfill({ contentType: 'text/html', body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe title="Company overview test" src="/"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,accessToken:'synthetic-only',role:'owner'},location.origin)});</script></body></html>` });
    if (url.startsWith(origin + '/')) return route.continue();
    if (url !== edge) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON();
    state.requests.push(request);
    if (request.method !== 'GET') throw new Error('Overview made an unexpected write');
    if (state.failures.has(request.path)) return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture unavailable' }) });
    const data = request.path === '/api/session' ? { authorized: true, name: 'Fixture Owner', role: 'Owner' }
      : request.path === '/api/jobs' ? { items: jobs }
      : request.path === '/api/camera-health/summary' ? camera
      : request.path === '/api/routers' ? { items: [router], generatedAt: stamp, source: 'camera_health', gpsAvailable: false }
      : request.path === '/api/quotes' ? { items: [{ id: 'q1', quoteNumber: 'FIX-Q1', status: 'Draft' }, { id: 'q2', quoteNumber: 'FIX-Q2', status: 'Pending Owner Approval' }] }
      : { items: [] };
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(origin + '/company-overview-test');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toBeVisible();
  return { frame, state };
}

test('company overview orders real health sources before the eight-stage customer journey', async ({ page }, testInfo) => {
  const { frame, state } = await mount(page);
  const overview = frame.getByRole('region', { name: 'Company overview', exact: true });
  expect(await overview.locator('.company-health-card h2').allTextContents()).toEqual(['Camera Health', 'InHand Routers', 'Victron power']);
  await expect(overview.getByText('2 field devices need attention', { exact: true })).toBeVisible();
  await expect(overview.getByText('1 stored router record', { exact: true })).toBeVisible();
  await expect(overview.getByText('Live GPS setup pending', { exact: true })).toBeVisible();
  await expect(overview.getByText('POWER STATUS NOT AVAILABLE IN THIS VIEW', { exact: true })).toBeVisible();
  const lifecycle = overview.getByRole('navigation', { name: 'Company job lifecycle' });
  expect(await lifecycle.locator('strong').allTextContents()).toEqual(['Quote', 'Agreement', 'Signed', 'Schedule & Parts', 'IT Prep', 'Service Install', 'Closeout', 'Billing']);
  await expect(lifecycle.getByRole('button', { name: 'Quote: 2 quotes', exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('button', { name: 'Agreement: Not connected', exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('button', { name: 'Signed: Not connected', exact: true })).toBeVisible();
  await lifecycle.getByRole('button', { name: 'Agreement: Not connected', exact: true }).click();
  await expect(overview.getByText('Agreement tracking is not connected.', { exact: true })).toBeVisible();
  const healthBox = await overview.locator('.company-health-grid').boundingBox();
  const stagesBox = await lifecycle.boundingBox();
  const attentionBox = await overview.getByRole('heading', { name: 'What needs attention' }).boundingBox();
  expect(healthBox.y + healthBox.height).toBeLessThan(stagesBox.y);
  expect(stagesBox.y + stagesBox.height).toBeLessThan(attentionBox.y);
  const gridColumns = await lifecycle.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(gridColumns).toBe(testInfo.project.name.startsWith('mobile') ? 2 : 8);
  const overflow = await frame.locator('body').evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right, left: el.getBoundingClientRect().left })).filter(el => el.right > innerWidth + 1 || el.left < -1).slice(0, 12) }));
  expect(overflow, JSON.stringify(overflow)).toMatchObject({ scrollWidth: overflow.width });
  expect(state.requests.every(item => item.method === 'GET')).toBe(true);
  await frame.locator('body').evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('company-overview.png') });
});

test('refresh replaces failed sources with unavailable values and recovers verified zero separately', async ({ page }) => {
  const { frame, state } = await mount(page);
  state.failures.add('/api/jobs');
  state.failures.add('/api/camera-health/summary');
  state.failures.add('/api/routers');
  await frame.getByRole('button', { name: 'Refresh Overview', exact: true }).click();
  await expect(frame.getByText('Health unavailable', { exact: true })).toBeVisible();
  await expect(frame.getByText('Router count unavailable', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Schedule & Parts: Unavailable', exact: true })).toBeVisible();
  await expect(frame.getByText('Nothing currently needs Owner attention in the loaded review sources.', { exact: true })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: 'Quote: 2 quotes', exact: true })).toBeVisible();
  state.failures.clear();
  await frame.getByRole('button', { name: 'Retry dashboard', exact: true }).click();
  await expect(frame.getByText('2 field devices need attention', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'IT Prep: 0 jobs', exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true })).toBeVisible();
  expect(state.requests.every(item => item.method === 'GET')).toBe(true);
});

test('stage selection keeps the real job search and selected-detail back flow', async ({ page }) => {
  const { frame } = await mount(page);
  await frame.getByRole('button', { name: 'Schedule & Parts: 2 jobs', exact: true }).click();
  const workspace = frame.getByRole('region', { name: 'Daily workspace', exact: true });
  await expect(workspace.getByRole('button', { name: /FIX-101/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /FIX-103/ })).toHaveCount(0);
  await workspace.getByRole('searchbox', { name: 'Find an active job' }).fill('FIX-102');
  await expect(workspace.getByRole('button', { name: /FIX-101/ })).toHaveCount(0);
  await workspace.getByRole('button', { name: /FIX-102/ }).click();
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toHaveCount(0);
  await frame.getByRole('button', { name: /Back to jobs/ }).click();
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /FIX-102/ })).toBeFocused();
  await frame.locator('body').evaluate(() => history.forward());
  await expect(frame.getByRole('heading', { name: 'Company overview', exact: true })).toHaveCount(0);
  await expect(frame.getByRole('button', { name: /Back to jobs/ })).toBeVisible();
  await frame.locator('body').evaluate(() => history.back());
  await expect(workspace.getByRole('button', { name: /FIX-102/ })).toBeFocused();
  await frame.getByRole('button', { name: 'Billing: 1 job', exact: true }).click();
  await expect(workspace.getByRole('button', { name: /FIX-105/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: /FIX-102/ })).toHaveCount(0);
  expect(await frame.locator('body').evaluate(() => location.hash)).toContain('#today');
});


test('intermediate-width stage cards preserve all labels, counts and arrows', async ({ page }, testInfo) => {
  for (const width of [701, 768]) {
    await page.setViewportSize({ width, height: 1100 });
    const { frame } = await mount(page);
    const lifecycle = frame.getByRole('navigation', { name: 'Company job lifecycle' });
    await expect(lifecycle.getByRole('button')).toHaveCount(8);
    expect(await lifecycle.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    const geometry = await lifecycle.locator('.company-stage').evaluateAll(cards => cards.map(card => ({
      label: card.getAttribute('aria-label'), width: card.clientWidth, content: card.scrollWidth,
      overflowingChildren: [...card.querySelectorAll('strong, .company-stage-total')].filter(child => child.scrollWidth > child.clientWidth).map(child => child.textContent),
    })));
    for (const card of geometry) {
      expect(card.content, width + 'px ' + card.label).toBeLessThanOrEqual(card.width);
      expect(card.overflowingChildren, width + 'px ' + card.label).toEqual([]);
    }
    expect(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath('company-overview-' + width + '.png') });
  }
});
