import {test, expect} from '@playwright/test';
import {openWorkspace} from './navigation-helper.mjs';
import {auditDarkPresentation} from './dark-presentation-audit.mjs';
import {snapshot, resource} from './fixtures/camera-evidence-fixtures.mjs';

const origin = process.env.COS_WATCHFUL_TEST_ORIGIN || 'http://127.0.0.1:4173';
const portal = 'https://v2.watchful.co.nz/sites';
const shortcut = frame => frame.getByRole('region', {name: 'Watchful', exact: true});

// Synthetic sessions and records only. Even the portal's new tab is intercepted.
// This shortcut belongs to the explicit Owner overview, not the default Fleet landing.
async function mount(page, context, {authorized = true, role = 'Owner', mode = ''} = {}) {
  const state = {calls: [], portalRequests: [], errors: []};
  page.on('pageerror', error => state.errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === portal) {
      state.portalRequests.push({url, headers: request.headers()});
      return route.fulfill({contentType: 'text/html', body: '<title>Synthetic Watchful portal</title><h1>Synthetic portal</h1>'});
    }
    if (url === origin + '/watchful-shortcut-fixture') return route.fulfill({contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="/${mode ? '?mode=' + mode + '#it-dashboard' : '#today'}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${mode === 'fleet' ? 'it' : 'owner'}',accessToken:'synthetic-only'},location.origin)})</script>`});
    if (url.startsWith(origin + '/')) return route.continue();
    if (!url.endsWith('/functions/v1/cos-operations-pages')) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'};
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const call = request.postDataJSON(); state.calls.push(call); expect(call.method).toBe('GET');
    const stamp = new Date().toISOString();
    const data = call.path === '/api/session' ? {authorized, name: 'Synthetic account', role, legacyOwner: role === 'Owner', features: {fleetAccess: role !== 'Service', vrmRead: true, unitTracker: true}}
      : call.path === '/api/field-map' ? {items: [], inventoryItems: [], summary: {fieldUnits: 0, mappedUnits: 0, unitGps: 0, missingGps: 0}, generatedAt: stamp}
      : call.path === '/api/camera-health/summary-v3' ? snapshot([resource(1)])
      : call.path === '/api/routers' ? {items: [], source: 'camera_health', gpsAvailable: false, generatedAt: stamp}
      : call.path === '/api/daily-board' ? {jobs: [], tasks: [], readiness: [], asOf: stamp}
      : {items: []};
    return route.fulfill({headers, contentType: 'application/json', body: JSON.stringify(data)});
  });
  await page.goto(origin + '/watchful-shortcut-fixture');
  return {frame: page.frameLocator('iframe'), state};
}

test('Owner Watchful area opens the exact portal separately with keyboard and click', async ({page, context}, testInfo) => {
  const {frame, state} = await mount(page, context);
  const area = shortcut(frame), link = area.getByRole('link', {name: 'Open Watchful', exact: true});
  await expect(area).toBeVisible();
  await expect(area).toContainText('EXTERNAL PORTAL');
  await expect(link).toHaveAttribute('href', portal);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAccessibleDescription('Opens in a new tab. Watchful may ask you to sign in.');
  await expect(frame.locator('.vision-area-card')).toHaveCount(6);
  expect(state.portalRequests).toHaveLength(0);
  const dashboardUrl = await frame.locator('body').evaluate(() => location.href);
  await link.focus(); await expect(link).toBeFocused();
  for (const activate of [() => link.press('Enter'), () => link.click()]) {
    const opened = context.waitForEvent('page'); await activate(); const popup = await opened;
    await popup.waitForLoadState();
    expect(popup.url()).toBe(portal);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    expect(await frame.locator('body').evaluate(() => location.href)).toBe(dashboardUrl);
    await popup.close();
  }
  expect(state.portalRequests).toHaveLength(2);
  for (const request of state.portalRequests) {
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers.referer).toBeUndefined();
  }
  expect(state.calls.every(call => call.method === 'GET' && !call.path.toLowerCase().includes('watchful'))).toBe(true);
  const size = await frame.locator('body').evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  expect((await auditDarkPresentation(area)).failures).toEqual([]);
  expect(state.errors).toEqual([]);
  await area.screenshot({path: testInfo.outputPath('owner-watchful-shortcut.png')});
});

test('Watchful stays on the Owner dashboard across workspace navigation', async ({page, context}) => {
  const {frame} = await mount(page, context);
  await expect(shortcut(frame)).toBeVisible();
  await openWorkspace(frame, 'Team');
  await expect(shortcut(frame)).toHaveCount(0);
  await openWorkspace(frame, 'Today');
  await expect(shortcut(frame)).toBeVisible();
});

for (const account of [
  {name: 'unauthorized Owner', authorized: false},
  {name: 'IT Fleet workspace', role: 'IT', mode: 'fleet'},
  {name: 'Owner viewing IT daily tools', role: 'Owner', mode: 'fleet'},
  {name: 'non-Owner session', role: 'Service'},
]) test('Watchful is absent for ' + account.name, async ({page, context}) => {
  const {frame, state} = await mount(page, context, account);
  if (account.mode) {
    await expect(frame.getByRole('region', {name: 'COS Fleet Dashboard', exact: true})).toBeVisible();
    await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#fleet-dashboard');
    if (page.viewportSize().width <= 700) await frame.getByRole('button', {name: 'More', exact: true}).click();
    const nav=frame.getByRole('navigation',{name:'COS Operations',exact:true});
    await expect(nav.getByRole('button')).toHaveCount(2);
    await expect(nav.getByRole('button',{name:'Fleet Dashboard',exact:true})).toBeVisible();
    await expect(nav.getByRole('button',{name:'Camera Health',exact:true})).toBeVisible();
    await expect(frame.getByRole('button',{name:'Register in COS inventory →',exact:true})).toHaveCount(0);
  } else if (account.authorized === false) await expect(frame.getByRole('heading', {name: 'Operations access needs attention'})).toBeVisible();
  else await expect(frame.getByRole('region', {name: 'VISION dashboard'})).toBeVisible();
  await expect(shortcut(frame)).toHaveCount(0);
  await expect(frame.getByRole('link', {name: 'Open Watchful', exact: true})).toHaveCount(0);
  expect(state.portalRequests).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
