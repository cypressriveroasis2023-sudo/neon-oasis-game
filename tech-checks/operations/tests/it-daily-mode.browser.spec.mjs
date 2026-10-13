import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itHomeFixture } from './it-home-fixture.mjs';
import { snapshot, resource } from './fixtures/camera-evidence-fixtures.mjs';
import { traverseIframeHistory } from './helpers/iframeHistory.mjs';

// Real protected legacy Home, the daily host, and the built Operations app.
// All subjects, records, auth tokens and external responses are synthetic.
const origin = process.env.COS_IT_DAILY_TEST_ORIGIN || 'http://127.0.0.1:4173';
const dist = resolve(process.env.COS_IT_DAILY_TEST_DIST || fileURLToPath(new URL('../dist', import.meta.url)));
const readHost = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const sources = ['cameras', 'field', 'victron', 'tracker'];
const labels = ['Camera Health', 'Fleet Dashboard', 'Victron View', '2027 Unit Tracker'];
const routes = { cameras: '#camera-health', field: '#fleet-dashboard', victron: '#victron-vrm', tracker: '#unit-tracker' };
const sourcePaths = { cameras: '/api/camera-health/summary-v3', field: '/api/field-map', victron: '/api/vrm-fleet', tracker: '/api/unit-tracker' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const daily = frame => frame.getByRole('region', { name: 'IT daily dashboard', exact: true });
const card = (frame, id) => daily(frame).locator('[data-source="' + id + '"]');

function fixture({ role = 'it', linked = true, holdCapability = false, slowLegacy = false, preview = false, ...options } = {}) {
  let html = itHomeFixture(role, linked, { dashboard: true, ...options });
  if (slowLegacy) html = html.replace('async function loadITManagedTickets(){return []};', 'async function loadITManagedTickets(){return new Promise(()=>{});};');
  const setup = `<script>(() => {
    window.fixtureEffectiveRole = ${JSON.stringify(preview ? 'it' : role)};
    window.fixturePreview = ${preview}; window.fixtureAuthenticated = true;
    window.fixtureRpcCalls = []; window.fixtureLegacyActions = 0; window.fixtureOwnerActions = 0;
    window.fixtureAuthListeners = []; window.fixtureTokenResponses = [];
    window.fixtureHeldCapability = ${holdCapability};
    window.fixtureCapabilityGate = new Promise(resolve => window.fixtureReleaseCapability = () => { window.fixtureHeldCapability = false; resolve(); });
    const app = document.getElementById('appView');
    const auth = document.createElement('div'); auth.id = 'authView'; auth.className = 'hidden'; auth.textContent = 'Synthetic sign in'; document.body.prepend(auth);
    const owner = document.createElement('section'); owner.id = 'view-owner'; owner.className = 'hidden'; owner.innerHTML = '<button id="fixtureOwnerControl">Owner account controls</button>'; app.append(owner);
    const service = document.createElement('section'); service.id = 'view-svc'; service.className = 'hidden'; service.innerHTML = '<button id="fixtureServiceControl">Service workflow</button>'; app.append(service);
    for (const name of ['it', 'svc', 'owner']) { const tab = document.createElement('button'); tab.id = 'tab-' + name; tab.textContent = name; tab.onclick = () => window.show(name); app.prepend(tab); }
    const mobileTop = document.createElement('div'); mobileTop.className = 'mobileTop'; mobileTop.innerHTML = '<button id="techMenuButton">Legacy Menu</button><button id="fixtureLogout">Sign out fixture</button>'; app.prepend(mobileTop);
    const banner = document.createElement('section'); banner.id = 'ownerTestAppBanner'; banner.innerHTML = '<button id="fixtureReturnOwner">Return to Owner</button>'; app.prepend(banner);
    const old = document.getElementById('existing-it-tool'); old.innerHTML = '<button id="fixtureOldAction">Create IT prep</button><form id="fixtureOldForm"><input><button>Save prep</button></form>';
    document.getElementById('fixtureOldAction').onclick = () => window.fixtureLegacyActions++;
    document.getElementById('fixtureOldForm').onsubmit = event => { event.preventDefault(); window.fixtureLegacyActions++; };
    document.getElementById('fixtureOwnerControl').onclick = () => window.fixtureOwnerActions++;
    window.fixtureAddLegacyOverlays = () => {
      for (const id of ['wlHelpOverlay', 'wlGuidedTourLayer', 'wlTechMenuPanel', 'wlNotificationPanel']) {
        let node = document.getElementById(id); if (!node) { node = document.createElement('section'); node.id = id; node.innerHTML = '<button>Old technician action</button>'; document.body.append(node); }
        node.classList.remove('hidden'); node.querySelector('button').onclick = () => window.fixtureLegacyActions++;
      }
    };
    window.show = view => {
      for (const name of ['it', 'svc', 'owner']) document.getElementById('view-' + name).classList.toggle('hidden', name !== view);
      window.dispatchEvent(new CustomEvent('techcheck:view-changed', {detail: {view}}));
    };
    window.fixtureSetRole = (role, preview = false) => {
      window.fixtureRole = role; window.fixtureEffectiveRole = preview ? 'it' : role; window.fixturePreview = preview;
      document.body.classList.toggle('owner-test-role-preview', preview);
      document.body.classList.toggle('owner-test-role-it', preview);
      document.getElementById('whoRole').textContent = role === 'owner' && !preview ? 'Owner/Admin' : role === 'service' ? 'Service Tech' : 'IT Technician';
      document.getElementById('appView').classList.toggle('fixture-role-change');
      window.show(role === 'owner' && !preview ? 'owner' : role === 'service' ? 'svc' : 'it');
    };
    window.ownerTestReturnToOwner = () => window.fixtureSetRole('owner');
    window.ownerTestEndSession = window.ownerTestReturnToOwner;
    document.getElementById('fixtureReturnOwner').onclick = window.ownerTestReturnToOwner;
    window.fixtureSession = () => window.fixtureAuthenticated && window.fixtureSubject ? {user: {id: window.fixtureSubject}, access_token: 'synthetic-only'} : null;
    window.logout = async () => {
      window.fixtureAuthenticated = false; app.classList.add('hidden'); auth.classList.remove('hidden');
      for (const fn of window.fixtureAuthListeners) fn('SIGNED_OUT', null);
    };
    window.fixtureLogin = role => {
      window.fixtureAuthenticated = true; app.classList.remove('hidden'); auth.classList.add('hidden'); window.fixtureSetRole(role);
      for (const fn of window.fixtureAuthListeners) fn('SIGNED_IN', window.fixtureSession());
    };
    document.getElementById('fixtureLogout').onclick = window.logout;
    const c = window.TechCheckContext, originalRpc = c.db.rpc;
    c.getEffectiveRole = () => window.fixtureEffectiveRole;
    c.getSession = window.fixtureSession;
    c.getOwnerTestSession = () => window.fixturePreview ? {preview_role: 'it', target_role: 'it', ticket: 'SYN-TEST', persona_id: 'synthetic-persona'} : null;
    c.getEffectiveIdentity = () => ({id: window.fixturePreview ? 'synthetic-persona' : window.fixtureSubject, role: window.fixtureEffectiveRole, owner_test: window.fixturePreview});
    c.db.rpc = async (name, args) => { window.fixtureRpcCalls.push({name, args}); if (name === 'cos_verified_fleet_capabilities_v1' && window.fixtureHeldCapability) await window.fixtureCapabilityGate; return originalRpc(name, args); };
    c.db.auth.onAuthStateChange = fn => { window.fixtureAuthListeners.push(fn); return {data: {subscription: {unsubscribe() {}}}}; };
    c.db.auth.getSession = async () => { window.fixtureTokens++; return {data: {session: window.fixtureSession()}}; };
    window.addEventListener('message', event => { if (event.data?.type === 'COS_OPERATIONS_TOKEN_RESPONSE') window.fixtureTokenResponses.push(event.data); });
    window.fixtureSetRole(${JSON.stringify(role)}, ${preview});
  })();</script>
  <script type="module" src="/it-daily-host.js"></script>
  <script type="module" src="/verified-it-fleet-host.js"></script>
  <script type="module" src="/production-assignments-host.js"></script>
  <script type="module" src="/it-ticket-instructions-host.js"></script>`;
  return html.replace('<script type="module" src="/fleet-host-fixture.js"></script>', setup);
}

async function mount(page, options = {}) {
  const state = { calls: [], errors: [], unexpected: [], held: new Map(), fail: options.failSession ? {'/api/session': true} : {}, role: options.role || 'it' };
  if (options.holdSource) state.held.set(sourcePaths[options.holdSource], gate());
  state.release = source => state.held.get(sourcePaths[source] || source)?.release();
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/it-daily-fixture') return route.fulfill({contentType: 'text/html', body: fixture(options)});
    if (url.origin === origin && ['/it-daily-host.js', '/it-feature-availability.js', '/field-map-display-host.js', '/verified-it-fleet-host.js', '/production-assignments-host.js', '/it-ticket-instructions-host.js', '/it-mhelp-projection.js'].includes(url.pathname)) {
      return route.fulfill({contentType: 'text/javascript', body: readHost(url.pathname.slice(1))});
    }
    if (url.origin === origin && url.pathname.startsWith('/resources/fonts/')) return route.fulfill({path: new URL('../../resources/fonts/' + url.pathname.split('/').pop(), import.meta.url).pathname});
    if (url.origin === origin && url.pathname === '/techcheck-eye-favicon-32.png') return route.fulfill({path: new URL('../../techcheck-eye-favicon-32.png', import.meta.url).pathname});
    if (url.origin === origin) {
      const pathname = url.pathname.replace(/^\/operations\/dist/, '') || '/';
      const path = resolve(dist, pathname === '/' ? 'index.html' : '.' + decodeURIComponent(pathname));
      if (path.startsWith(dist + '/') && existsSync(path)) return route.fulfill({path, contentType: {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.png': 'image/png'}[extname(path)] || 'application/octet-stream'});
      return route.abort();
    }
    if (!url.pathname.endsWith('/functions/v1/cos-operations-pages')) return route.abort();
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'};
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const call = request.postDataJSON(); state.calls.push(call);
    const allowedReads = ['/api/session', '/api/tech/session', ...Object.values(sourcePaths), ...(options.fieldDiagnostics ? ['/api/routers'] : [])];
    if (call.method !== 'GET' || !allowedReads.includes(call.path)) {
      state.unexpected.push(call);
      return route.fulfill({status: 405, headers, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic fixture refuses this request'})});
    }
    await state.held.get(call.path)?.promise;
    if (state.fail[call.path]) return route.fulfill({status: 503, headers, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic source unavailable'})});
    const now = new Date().toISOString(), owner = state.role === 'owner';
    const unit = {id: '11111111-1111-4111-8111-111111111111', unitNumber: 'Helios 001', modelName: 'Helios', status: 'installed', currentLocationType: 'site', site: 'Synthetic north site', address: '100 Synthetic Road, Houston TX 77001', latitude: 29.76, longitude: -95.37, locationVerification: 'owner_verified', gpsRecordedAt: now, locationVerifiedAt: now, coordinateSource: 'site', hasUnitGps: true};
    const data = {
      '/api/session': {authorized: true, legacyOwner: owner, role: owner ? 'Owner' : 'IT', name: 'Synthetic Technician', features: {fleetAccess: true, unitTracker: options.unitTracker !== false, vrmRead: options.vrmRead !== false, importedUnitAddressEdit: false}},
      '/api/tech/session': {authorized: true, legacyTechnician: true, department: 'it', productionTechnicianUserId: '22222222-2222-4222-8222-222222222222'},
      '/api/field-map': {items: [unit], inventoryItems: [unit], summary: {fieldUnits: 1, mappedUnits: 1, unitGps: 1, missingGps: 0}, generatedAt: now},
      // Fleet Dashboard reads saved router observations without opening the paused Router workspace.
      '/api/routers': {items: [], source: 'camera_health', gpsAvailable: false, generatedAt: now},
      '/api/camera-health/summary-v3': snapshot([resource(1, 'Helios 001', {name: 'Synthetic camera', status: 'online', checkedAt: now, evidence: {kind: 'provider', source: 'Star4Live', resource: 'camera', active: true, status: 'online', observedAt: now, lastOnlineAt: now}})]),
      '/api/vrm-fleet': {items: [{installationId: 9100001, name: 'Synthetic power site', portalUrl: 'https://vrm.victronenergy.com/installation/9100001/dashboard', embedUrl: null}], sync: {state: 'current', lastAttemptAt: now, lastSuccessAt: now, nextSyncAt: now, error: null, scheduleActive: true}},
      '/api/unit-tracker': {contract: 'COS_UNIT_TRACKER_OUTBOX_V1', workbookId: '1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA', connector: {enabled: false, state: 'awaiting_sheets_connection'}, queueEnabled: false, availability: options.trackerUnavailable ? 'unavailable' : 'available', sources: [], requests: [], sourcesHeld: 0, sourcesTruncated: false, requestsTruncated: false},
    }[call.path];
    return route.fulfill({headers, contentType: 'application/json', body: JSON.stringify(data)});
  });
  await page.goto(origin + '/it-daily-fixture' + (options.deepLink || ''));
  return {state, frame: page.frameLocator('#cosITDailyFrame')};
}

async function ready(frame, except) {
  await expect(daily(frame)).toBeVisible();
  await expect(daily(frame).getByRole('heading', {name: 'Daily views', exact: true})).toBeVisible();
  await expect(daily(frame).locator('[data-source]')).toHaveCount(4);
  expect(await daily(frame).locator('[data-source]').evaluateAll(nodes => nodes.map(node => node.dataset.source))).toEqual(sources);
  for (const source of sources.filter(source => source !== except)) await expect(card(frame, source).locator('time')).toHaveCount(1);
}
async function assertReads(page, state) {
  expect(state.errors).toEqual([]); expect(state.unexpected).toEqual([]);
  expect(state.calls.every(call => call.method === 'GET' && call.body === null)).toBe(true);
  const names = await page.evaluate(() => window.fixtureRpcCalls.map(call => call.name));
  expect(names.every(name => name === 'cos_verified_fleet_capabilities_v1')).toBe(true);
}
async function menu(frame) {
  await frame.getByRole('button', {name: 'More', exact: true}).first().click();
  return frame.getByRole('dialog', {name: 'Operations navigation'});
}

for (const secondVerified of [false, true]) test('daily mode has exactly four views for verified IT ' + (secondVerified ? 'second' : 'first'), async ({page}, info) => {
  const {frame, state} = await mount(page, {secondVerified}); await ready(frame);
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(1);
  await expect(page.locator('#cosITDailyFrame')).toHaveAttribute('title', 'IT daily views');
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  await expect(page.locator('#techMenuButton')).toBeHidden();
  for (let index = 0; index < sources.length; index++) {
    await expect(card(frame, sources[index])).toContainText(labels[index]);
    expect((await card(frame, sources[index]).getByRole('button', {name: /^Open /}).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expect(daily(frame)).not.toContainText(/MHelp information|Assigned checks|Router inventory/);
  const nav = await menu(frame);
  for (const label of labels) await expect(nav.getByRole('button', {name: label, exact: true})).toBeVisible();
  await expect(nav.getByRole('button', {name: /Tech Checks|InHand Routers|MHelp|Team|Dispatch|Money|Vision assistant/})).toHaveCount(0);
  await nav.getByRole('button', {name: /Close menu/}).click();
  const fit = await frame.locator('body').evaluate(() => ({width: innerWidth, content: document.documentElement.scrollWidth}));
  expect(fit.content).toBeLessThanOrEqual(fit.width);
  expect(state.calls.some(call => call.path === '/api/routers')).toBe(false);
  await page.screenshot({path: info.outputPath('it-daily-four.png'), fullPage: true}); await assertReads(page, state);
});

test('each allowed view survives Back, Forward and reload', async ({page}) => {
  const {frame, state} = await mount(page, {fieldDiagnostics: true}); await ready(frame);
  expect(state.calls.some(call => call.path === '/api/routers')).toBe(false);
  for (const source of sources) {
    await card(frame, source).getByRole('button', {name: /^Open /}).click();
    await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe(routes[source]);
    if (source === 'cameras') await expect(frame.locator('.camera-overview-card')).toHaveCount(1);
    if (source === 'field') await expect(frame.getByLabel('Interactive fleet installation map')).toBeVisible();
    if (source === 'victron') await expect(frame.getByRole('navigation', {name: 'Helios installations'}).getByRole('button')).toHaveCount(1);
    if (source === 'tracker') await expect(frame.getByRole('region', {name: 'Unit Tracker workspace'})).toBeVisible();
    await traverseIframeHistory(frame, 'back', '#it-dashboard'); await ready(frame);
    await traverseIframeHistory(frame, 'forward', routes[source]);
    await frame.locator('body').evaluate(() => location.reload());
    await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe(routes[source]);
    await (await menu(frame)).getByRole('button', {name: /^(Daily views|IT Dashboard)$/}).click(); await ready(frame);
  }
  await page.reload(); await ready(frame); await assertReads(page, state);
});

for (const role of ['it', 'owner']) test(role + ' daily menu stays on screen through header changes and phone rotation', async ({page}) => {
  const {frame, state} = await mount(page, {role});
  if (role === 'owner') await page.evaluate(() => window.show('it'));
  await ready(frame);
  for (const viewport of [{width:390,height:844},{width:390,height:640},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    await page.locator('#ownerTestAppBanner').evaluate(node => {node.style.paddingBottom='28px';});
    await expect.poll(async () => {
      const bounds = await frame.getByRole('button', {name:'More',exact:true}).first().boundingBox();
      return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
    }).toBe(true);
    const nav = await menu(frame);
    await expect(nav).toBeVisible();
    await nav.getByRole('button', {name:/Close menu/}).click();
    await expect(nav).toHaveCount(0);
    await page.locator('#ownerTestAppBanner').evaluate(node => {node.style.paddingBottom='0px';});
  }
  if (role === 'owner') {
    await page.evaluate(() => window.show('owner'));
    await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
    await expect(page.locator('#fixtureOwnerControl')).toBeVisible();
  }
  await assertReads(page,state);
});

test('blocked direct and history routes cannot mount paused features', async ({page}) => {
  const {frame, state} = await mount(page, {deepLink: '?itHome=checks#tech-checks/it'}); await ready(frame);
  for (const hash of ['#mhelp', '#tech-check', '#inhand-routers', '#team', '#jobs', '#calendar']) {
    await frame.locator('body').evaluate((_node, hash) => { location.hash = hash; }, hash);
    await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#it-dashboard'); await ready(frame);
    await frame.locator('body').evaluate(() => history.back()); await ready(frame);
  }
  expect(state.calls.some(call => call.path === '/api/routers')).toBe(false);
  await assertReads(page, state);
});

test('legacy redraw, repeated clicks, synthetic events and old overlays remain unavailable', async ({page}) => {
  const {frame, state} = await mount(page, {fieldDiagnostics: true}); await ready(frame);
  expect(state.calls.some(call => call.path === '/api/routers')).toBe(false);
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => { window.renderITHome(); window.fixtureAddLegacyOverlays(); });
    await ready(frame); await expect(page.locator('#cosITDailyFrame')).toHaveCount(1);
    for (const id of ['wlHelpOverlay', 'wlGuidedTourLayer', 'wlTechMenuPanel', 'wlNotificationPanel']) await expect(page.locator('#' + id)).toBeHidden();
    await page.evaluate(() => {
      document.getElementById('fixtureOldAction').click();
      document.getElementById('fixtureOldForm').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
      document.querySelector('#wlTechMenuPanel button').click();
    });
    expect(await page.evaluate(() => window.fixtureLegacyActions)).toBe(0);
    await card(frame, 'field').getByRole('button', {name: /^Open /}).evaluate(button => {button.click(); button.click();});
    await expect(frame.getByLabel('Interactive fleet installation map')).toBeVisible(); await expect(page.locator('#cosITDailyFrame')).toHaveCount(1);
    await (await menu(frame)).getByRole('button', {name: /^(Daily views|IT Dashboard)$/}).click(); await ready(frame);
  }
  await assertReads(page, state);
});

test('daily view opens independently of a stalled old IT Home loader', async ({page}) => {
  const {frame, state} = await mount(page, {slowLegacy: true}); await ready(frame);
  await expect(page.locator('#wlItHome')).toContainText('Loading Home'); await assertReads(page, state);
});

for (const source of sources) test(source + ' slow and failed source does not block the other three views', async ({page}) => {
  const {frame, state} = await mount(page, {holdSource: source}); await ready(frame, source);
  await expect(card(frame,source).locator('.it-dashboard-status')).toHaveText('Loading');await expect(card(frame,source).locator('time')).toHaveCount(0);
  state.fail[sourcePaths[source]] = true; state.release(source);
  await expect(card(frame,source).locator('.it-dashboard-status')).toHaveText('Unavailable');await expect(card(frame,source).locator('time')).toHaveCount(0);
  const before = state.calls.length; delete state.fail[sourcePaths[source]];
  await card(frame, source).getByRole('button', {name: /^Retry /}).click(); await ready(frame);
  // A fresh fleet retry rechecks both inputs; a healthy source stays available.
  const refreshed=['cameras','field'].includes(source)?['cameras','field']:[source];
  expect(state.calls.slice(before).map(call => call.path).sort()).toEqual(refreshed.map(id=>sourcePaths[id]).sort()); await assertReads(page, state);
});

test('late capability cannot reopen a signed-out session; relogin restores only daily views', async ({page}) => {
  const {frame, state} = await mount(page, {holdCapability: true});
  await expect.poll(() => page.evaluate(() => window.fixtureRpcCalls.some(call => call.name === 'cos_verified_fleet_capabilities_v1'))).toBe(true);
  await page.evaluate(() => window.logout()); await page.evaluate(() => window.fixtureReleaseCapability());
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0); await expect(page.locator('#authView')).toBeVisible();
  expect(state.calls).toEqual([]);
  await page.evaluate(() => window.fixtureLogin('it')); await ready(frame);
  await page.evaluate(() => window.logout()); await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await page.evaluate(() => window.fixtureLogin('it')); await ready(frame); await assertReads(page, state);
});

test('Owner can enter and leave IT presentation without changing Owner controls', async ({page}) => {
  const {frame, state} = await mount(page, {role: 'owner'});
  await expect(page.locator('#fixtureOwnerControl')).toBeVisible(); await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await page.locator('#fixtureOwnerControl').click();
  await page.evaluate(() => window.show('it')); await ready(frame);
  await expect(page.locator('#cosITDailyFrame')).toHaveAttribute('src', /mode=it-daily/);
  await page.evaluate(() => window.show('owner'));
  await expect(page.locator('#fixtureOwnerControl')).toBeVisible(); await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await page.locator('#fixtureOwnerControl').click(); expect(await page.evaluate(() => window.fixtureOwnerActions)).toBe(2);
  await page.evaluate(() => window.show('it')); await ready(frame); await assertReads(page, state);
});

test('Owner persona preview has no iframe/token and can still return to Owner', async ({page}) => {
  const {state} = await mount(page, {role: 'owner', preview: true});
  await expect(page.locator('#cosITDailyHost')).toBeVisible(); await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await expect(page.locator('#cosITDailyHost')).toContainText(/persona|paused|unavailable/i);
  expect(await page.evaluate(() => window.fixtureTokens)).toBe(0); expect(state.calls).toEqual([]);
  await page.locator('#fixtureReturnOwner').click(); await expect(page.locator('#fixtureOwnerControl')).toBeVisible();
});

test('the integrated fleet deep link opens through the existing verified IT daily gate', async ({page}) => {
  const {frame,state}=await mount(page,{deepLink:'?fleetDashboard=1',fieldDiagnostics:true});
  await expect(page.locator('#cosITDailyFrame')).toHaveAttribute('src',/mode=fleet.*#fleet-dashboard$/);
  await expect(frame.getByRole('heading',{name:'Know what’s in the field.'})).toBeVisible();
  await expect(frame.locator('.cos-fleet-stat-field strong')).toHaveText('1');
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  await expect(frame.getByRole('button',{name:'Register in COS inventory →'})).toHaveCount(0);
  await assertReads(page,state);
});

for (const options of [{role: 'service'}, {linked: false}, {active: false}, {archived: true}, {capability: false}]) test('availability preserves existing identity limits ' + JSON.stringify(options), async ({page}) => {
  const {state} = await mount(page, options);
  await expect.poll(() => page.evaluate(() => window.COS_IT_DAILY_ONLY)).toBe(true);
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  if (options.role === 'service') {
    await expect(page.locator('#fixtureServiceControl')).toBeVisible();
    await expect(page.locator('#cosProductionAssignmentsButton')).toBeVisible();
  } else {
    await expect(page.locator('#cosITDailyHost')).toContainText('access could not be verified');
    await expect(page.locator('#existing-it-tool')).toBeHidden();
  }
  expect(await page.evaluate(() => window.fixtureTokens)).toBe(0); expect(state.calls).toEqual([]);
});


test('direct production-assignments mode remains paused without reading or claiming work', async ({page}) => {
  const {frame, state} = await mount(page); await ready(frame);
  const before = state.calls.length;
  await frame.locator('body').evaluate(() => { location.href = location.pathname + '?mode=production-assignments'; });
  await expect(frame.getByRole('alert')).toContainText('IT assignment workflows are paused until further notice');
  await expect(frame.getByRole('region', {name: 'Shared IT queue'})).toHaveCount(0);
  expect(state.calls.slice(before).map(call => call.path)).toEqual(['/api/tech/session']);
  await frame.getByRole('button', {name: 'Refresh assignments', exact: true}).click();
  await expect.poll(() => state.calls.slice(before).length).toBe(2);
  await expect(frame.getByRole('alert')).toContainText('paused');
  expect(state.calls.slice(before).every(call => call.path === '/api/tech/session' && call.method === 'GET')).toBe(true);
  await assertReads(page, state);
});


test('a late source response cannot replace a new login or revive an old iframe', async ({page}) => {
  const {frame, state} = await mount(page, {holdSource: 'cameras'}); await ready(frame, 'cameras');
  const held = state.held.get(sourcePaths.cameras);
  await page.evaluate(() => window.logout()); await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  state.held.delete(sourcePaths.cameras);
  await page.evaluate(() => window.fixtureLogin('it')); await ready(frame);
  held.release(); await ready(frame); await expect(page.locator('#cosITDailyFrame')).toHaveCount(1);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await ready(frame); await expect(page.locator('#existing-it-tool')).toBeHidden(); await assertReads(page, state);
});


for (const [feature, source, label] of [['unitTracker', 'tracker', '2027 Unit Tracker'], ['vrmRead', 'victron', 'Victron View']]) test(feature + ' remains disabled when the current account lacks its capability', async ({page}) => {
  const {frame, state} = await mount(page, {[feature]: false}); await ready(frame, source);
  await expect(card(frame, source).locator('.it-dashboard-status')).toHaveText('Access not enabled');
  await expect(card(frame, source).getByRole('button', {name: /^Open /})).toBeDisabled();
  expect(state.calls.some(call => call.path === sourcePaths[source])).toBe(false);
  const nav = await menu(frame); await expect(nav.getByRole('button', {name: label, exact: true})).toHaveCount(0);
  await nav.getByRole('button', {name: /Close menu/}).click();
  await frame.locator('body').evaluate((_node, hash) => {location.hash = hash;}, routes[source]);
  await expect.poll(() => frame.locator('body').evaluate(() => location.hash)).toBe('#it-dashboard');
  expect(state.calls.some(call => call.path === sourcePaths[source])).toBe(false); await assertReads(page, state);
});


for (const exit of ['logout', 'Owner return']) test('stale legacy overlays stay closed after ' + exit, async ({page}) => {
  const {frame, state} = await mount(page, {role: exit === 'Owner return' ? 'owner' : 'it'});
  if (exit === 'Owner return') await page.evaluate(() => window.show('it'));
  await ready(frame);
  await page.evaluate(() => window.fixtureAddLegacyOverlays());
  const ids = ['wlHelpOverlay', 'wlGuidedTourLayer', 'wlTechMenuPanel', 'wlNotificationPanel'];
  for (const id of ids) await expect(page.locator('#' + id)).toBeHidden();
  await expect(page.locator('#techMenuButton')).toBeHidden();
  if (exit === 'logout') await page.evaluate(() => window.logout());
  else await page.evaluate(() => window.show('owner'));
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  for (const id of ids) await expect(page.locator('#' + id)).toBeHidden();
  if (exit === 'logout') await expect(page.locator('#authView')).toBeVisible();
  else {
    await expect(page.locator('#fixtureOwnerControl')).toBeVisible();
    await page.locator('#fixtureOwnerControl').click();
    expect(await page.evaluate(() => window.fixtureOwnerActions)).toBe(1);
    expect(await page.locator('#techMenuButton').evaluate(node => node.inert)).toBe(false);
  }
  await assertReads(page, state);
});


test('failed IT session verification never offers Owner or paused workflow controls', async ({page}) => {
  const {frame,state}=await mount(page,{failSession:true});
  await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
  await expect(frame.getByRole('button',{name:'Tech Checks',exact:true})).toHaveCount(0);
  await expect(frame.getByRole('button',{name:'Open dispatch board',exact:true})).toHaveCount(0);
  await expect(frame.getByRole('button',{name:'Vision assistant',exact:true})).toHaveCount(0);
  await expect(frame.getByRole('button',{name:'Retry Operations access',exact:true})).toHaveCount(1);
  expect(state.calls.every(call=>call.path==='/api/session')).toBe(true);
  delete state.fail['/api/session'];
  await frame.getByRole('button',{name:'Retry Operations access',exact:true}).click();
  await ready(frame); await assertReads(page,state);
});

for (const role of ['it', 'owner']) test(role + ' daily tracker opens the original sheet while COS summary is unavailable', async ({page}) => {
  const {frame, state} = await mount(page, {role, trackerUnavailable: true});
  if (role === 'owner') await page.evaluate(() => window.show('it'));
  await ready(frame, 'tracker');
  const tracker = card(frame, 'tracker');
  await expect(tracker.locator('.it-dashboard-status')).toHaveText('Unavailable');
  await expect(tracker).toContainText('COS summary is unavailable. Open the 2027 Google Sheet for current tracker records.');
  await expect(tracker.locator('.it-dashboard-count')).toHaveCount(0);
  const link = tracker.getByRole('link', {name: 'Open 2027 Google Sheet'});
  await expect(link).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA/edit');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const callsBefore = state.calls.length;
  await page.context().route('https://docs.google.com/spreadsheets/**', route => route.fulfill({contentType: 'text/html', body: '<h1>Synthetic original tracker</h1>'}));
  const popupPromise = page.waitForEvent('popup');
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://docs.google.com/spreadsheets/d/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA/edit');
  expect(state.calls.length).toBe(callsBefore);
  await popup.close();
  await expect(tracker.getByRole('button', {name: 'Open COS inventory'})).toBeEnabled();
  await assertReads(page, state);
});

test('daily tracker source link is absent when the current account lacks tracker access', async ({page}) => {
  const {frame, state} = await mount(page, {unitTracker: false});
  await ready(frame, 'tracker');
  await expect(card(frame, 'tracker').getByRole('link')).toHaveCount(0);
  await expect(card(frame, 'tracker').getByRole('button', {name: 'Open COS inventory'})).toBeDisabled();
  expect(state.calls.some(call => call.path === '/api/unit-tracker')).toBe(false);
  await assertReads(page, state);
});
