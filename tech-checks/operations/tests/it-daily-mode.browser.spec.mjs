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
const sources = ['field', 'cameras', 'victron', 'tracker'];
const labels = ['Fleet Dashboard', 'Camera Health', 'Victron Power', '2027 Unit Tracker'];
const routes = { cameras: '#camera-health', field: '#fleet-dashboard', victron: '#victron-vrm', tracker: '#unit-tracker' };
const sourcePaths = { cameras: '/api/camera-health/summary-v3', field: '/api/field-map', victron: '/api/vrm-fleet', tracker: '/api/unit-tracker' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const daily = frame => frame.getByRole('region', { name: 'IT daily dashboard', exact: true });
const card = (frame, id) => daily(frame).locator('[data-source="' + id + '"]');

function fixture({ role = 'it', linked = true, holdCapability = false, slowLegacy = false, preview = false, ...options } = {}) {
  // The synthetic capability RPC must honor the real legacy IT allowlist.
  let html = itHomeFixture(role, linked, { dashboard: true, ...options, capability:linked&&options.capability!==false });
  if (slowLegacy) html = html.replace('async function loadITManagedTickets(){return []};', 'async function loadITManagedTickets(){return new Promise(()=>{});};');
  if(options.legacyCameraOnly)html=html.replaceAll('4f7044b5-86b6-411f-8898-39bb64b4ddbc','05bf20fe-19f7-4db7-ac05-5b2a5f681fdf');
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
    c.db.rpc = async (name, args) => { window.fixtureRpcCalls.push({name, args}); if (name === 'techcheck_transfer_readiness_v1') return {error:{code:'PGRST202',message:'Synthetic transfer backend absent'}}; if (name.startsWith('techcheck_transfer_') || name === 'submit_techcheck_transfer_v1') throw new Error('Synthetic transfer writes prohibited'); if (name === 'cos_verified_fleet_capabilities_v1' && window.fixtureHeldCapability) await window.fixtureCapabilityGate; return originalRpc(name, args); };
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
    if(options.legacyCameraOnly && url.origin===origin && url.pathname==='/camera-health.html'){state.cameraLoads=(state.cameraLoads||0)+1;return route.fulfill({contentType:'text/html',body:'<h1>Provider diagnostics</h1><label>Camera search<input value=""></label>'});}
    if (url.origin === origin && url.pathname === '/it-daily-fixture') return route.fulfill({contentType: 'text/html', body: fixture(options)});
    if (url.origin === origin && ['/it-daily-host.js', '/it-feature-availability.js', '/field-map-display-host.js', '/verified-it-fleet-host.js', '/production-assignments-host.js', '/it-ticket-instructions-host.js', '/it-mhelp-projection.js', '/transfers/desk.js', '/transfers/model.js', '/transfers/readiness.js', '/transfers/client.js', '/service-signoff-ui.js', '/tech-check-rules.js'].includes(url.pathname)) {
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
  await page.goto(origin + '/it-daily-fixture' + (options.deepLink ?? '#it-dashboard'));
  return {state, frame: page.frameLocator('#cosITDailyFrame')};
}


const desktop = page => page.setViewportSize({width:1200,height:840});
const phone = page => page.setViewportSize({width:390,height:844});
const options = extra => ({deepLink:'',fieldDiagnostics:true,...extra});
async function readyFleet(frame) {
  await expect(frame.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();
  await expect(frame.locator('.cos-fleet-map-canvas')).toBeVisible();
  await expect(frame.getByRole('region',{name:'IT daily dashboard',exact:true})).toHaveCount(0);
}
async function assertReadBoundary(page,state) {
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.calls.every(call=>call.method==='GET'&&call.body===null)).toBe(true);
  const rpc=await page.evaluate(()=>window.fixtureRpcCalls.map(call=>call.name));
  // The synthetic missing-backend probe is read-only. No private context,
  // equipment submission, technician queue or identity mutation is permitted.
  const allowed=new Set(['cos_verified_fleet_capabilities_v1','techcheck_transfer_readiness_v1']);
  expect(rpc.every(name=>allowed.has(name)),JSON.stringify(rpc)).toBe(true);
  expect(rpc.some(name=>name==='techcheck_transfer_context_v1'||name==='submit_techcheck_transfer_v1')).toBe(false);
}
async function navMenu(frame) {
  await frame.getByRole('button',{name:'More',exact:true}).first().click();
  const menu=frame.getByRole('dialog',{name:'Operations navigation'});
  await expect(menu).toBeVisible();
  return menu;
}
async function scopedMenu(frame) {
  const menu=await navMenu(frame);
  const nav=menu.getByRole('navigation',{name:'COS Operations',exact:true});
  await expect(nav.getByRole('button')).toHaveCount(2);
  for(const name of ['Fleet Dashboard','Camera Health'])await expect(nav.getByRole('button',{name,exact:true})).toBeVisible();
  for(const name of ['IT Dashboard','Victron Power','2027 Unit Tracker','Tech Checks','MHelp','Team','Dispatch'])await expect(nav.getByRole('button',{name,exact:true})).toHaveCount(0);
  return {menu,nav};
}
async function choose(frame,name) {
  const {nav}=await scopedMenu(frame);
  await nav.getByRole('button',{name,exact:true}).click();
}

for(const view of ['Fleet Dashboard','Camera Health'])test('verified desktop IT opens '+view+' without extra workspaces',async({page},info)=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame); // The phone/desktop host deliberately starts Fleet.
  if(view==='Camera Health'){
    await choose(frame,'Camera Health');
    await expect(frame.locator('.cos-fleet-table-wrap')).toBeVisible();
    await expect(frame.locator('.cos-fleet-map-canvas')).toHaveCount(0);
  }
  await expect(page.locator('#cosITDailyFrame')).toHaveAttribute('title','Fleet Dashboard and Camera Health');
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  const {menu}=await scopedMenu(frame);
  await menu.getByRole('button',{name:/Close menu/}).click();
  await expect(frame.getByRole('button',{name:'Advanced camera diagnostics',exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('IT-desktop-'+view.replaceAll(' ','-')+'.png'),fullPage:true});
  await assertReadBoundary(page,state);
});

test('desktop IT can switch map to health and retain Back Forward and reload',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame);
  await choose(frame,'Camera Health');
  await expect(frame.locator('.cos-fleet-table-wrap')).toBeVisible();
  await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#camera-health');
  await frame.locator('body').evaluate(()=>history.back());
  await readyFleet(frame);
  await frame.locator('body').evaluate(()=>history.forward());
  await expect(frame.locator('.cos-fleet-table-wrap')).toBeVisible();
  await frame.locator('body').evaluate(()=>location.reload());
  await expect(frame.locator('.cos-fleet-table-wrap')).toBeVisible();
  await assertReadBoundary(page,state);
});

test('forbidden direct URL and browser-history workspaces return to Fleet without work reads',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame);
  for(const hash of ['#mhelp','#tech-check','#unit-tracker','#victron-vrm','#it-dashboard','#jobs','#dispatch']){
    await frame.locator('body').evaluate((_,value)=>{location.hash=value;},hash);
    await expect.poll(()=>frame.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard');
    await readyFleet(frame);
  }
  expect(state.calls.some(call=>/\/api\/(?:unit-tracker|tech\/|jobs|mhelp)/.test(call.path))).toBe(false);
  await assertReadBoundary(page,state);
});

test('an IT session cannot open legacy prep, ticket creation or Owner-only diagnostics',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame);
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  await expect(page.locator('#techMenuButton')).toBeHidden();
  for(const name of ['Create ticket','Advanced camera diagnostics','Register in COS inventory →','Review equipment identity']){
    await expect(frame.getByRole('button',{name,exact:true})).toHaveCount(0);
  }
  await page.evaluate(()=>{
    document.getElementById('fixtureOldAction').click();
    document.getElementById('fixtureOldForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  expect(await page.evaluate(()=>window.fixtureLegacyActions)).toBe(0);
  await assertReadBoundary(page,state);
});

test('delayed Fleet capability never revives a signed-out session',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options({holdCapability:true}));
  await expect.poll(()=>page.evaluate(()=>window.fixtureRpcCalls.some(c=>c.name==='cos_verified_fleet_capabilities_v1'))).toBe(true);
  await page.evaluate(()=>window.logout());
  await page.evaluate(()=>window.fixtureReleaseCapability());
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await expect(page.locator('#authView')).toBeVisible();
  expect(state.calls).toEqual([]);
  await page.evaluate(()=>window.fixtureLogin('it'));
  await readyFleet(frame);
  await assertReadBoundary(page,state);
});

test('an old camera read cannot recreate a private iframe after account exit',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options({holdSource:'cameras'}));
  await expect.poll(()=>state.calls.some(call=>call.path===sourcePaths.cameras)).toBe(true);
  await page.evaluate(()=>window.logout());
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  state.release('cameras');
  await page.evaluate(()=>window.fixtureLogin('it'));
  await readyFleet(frame);
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  await assertReadBoundary(page,state);
});

test('an unavailable Camera Health read never proves units healthy or changes placement',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame);
  state.fail[sourcePaths.cameras]=true;
  await frame.getByRole('button',{name:/Refresh data/}).first().click();
  await expect(frame.locator('.cos-fleet-message[role="alert"]')).toContainText('source');
  await expect(frame.locator('.cos-fleet-map-canvas')).toBeVisible();
  delete state.fail[sourcePaths.cameras];
  await frame.getByRole('button',{name:/Refresh data/}).first().click();
  await expect(frame.locator('.cos-fleet-map-canvas')).toBeVisible();
  await assertReadBoundary(page,state);
});

test('late legacy redraw and overlays cannot revive disabled forms',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame);
  await page.evaluate(()=>{window.renderITHome();window.fixtureAddLegacyOverlays();});
  for(const id of ['wlHelpOverlay','wlGuidedTourLayer','wlTechMenuPanel','wlNotificationPanel']){
    await expect(page.locator('#'+id)).toBeHidden();
  }
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  await readyFleet(frame);
  await assertReadBoundary(page,state);
});

test('Owner viewing IT desktop tools preserves Owner account controls on return',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options({role:'owner'}));
  await expect(page.locator('#fixtureOwnerControl')).toBeVisible();
  await page.evaluate(()=>window.show('it'));
  await readyFleet(frame);
  await expect(page.locator('#cosITDailyFrame')).toHaveAttribute('src',/mode=it-daily/);
  await page.evaluate(()=>window.show('owner'));
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await page.locator('#fixtureOwnerControl').click();
  expect(await page.evaluate(()=>window.fixtureOwnerActions)).toBe(1);
  await page.evaluate(()=>window.show('it'));
  await readyFleet(frame);
  await assertReadBoundary(page,state);
});

test('Owner test-persona preview is not an authorized equipment or Fleet session',async({page})=>{
  await desktop(page);
  const {state}=await mount(page,options({role:'owner',preview:true}));
  await expect(page.locator('#cosITDailyHost')).toContainText('preview persona');
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  expect(await page.evaluate(()=>window.fixtureTokens)).toBe(0);
  await page.locator('#fixtureReturnOwner').click();
  await expect(page.locator('#fixtureOwnerControl')).toBeVisible();
  expect(state.calls).toEqual([]);
});

test('Service, inactive, unlinked and denied Fleet actors are never granted an IT iframe',async({page})=>{
  await desktop(page);
  for(const value of [{role:'service'},{linked:false},{active:false},{archived:true},{capability:false}]){
    const {state}=await mount(page,options(value));
    await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
    if(value.role==='service')await expect(page.locator('#fixtureServiceControl')).toBeVisible();
    else await expect(page.locator('#cosITDailyHost')).toContainText('access could not be verified');
    expect(state.calls).toEqual([]);
  }
});

test('a denied native Operations session remains read-only and shows retry',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options({failSession:true}));
  await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
  await expect(frame.getByRole('button',{name:'Tech Checks',exact:true})).toHaveCount(0);
  await expect(frame.getByRole('button',{name:'Retry Operations access',exact:true})).toBeVisible();
  delete state.fail['/api/session'];
  await frame.getByRole('button',{name:'Retry Operations access',exact:true}).click();
  await readyFleet(frame);
  await assertReadBoundary(page,state);
});

test('phone IT exposes only held check-in/check-out when rollout is unavailable',async({page})=>{
  test.setTimeout(30000);
  await phone(page);
  const {state}=await mount(page,options());
  await expect(page.locator('#cosITDailyHost')).toBeVisible();
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeDisabled({timeout:13000});
  await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toBeDisabled();
  await expect(page.locator('#existing-it-tool')).toBeHidden();
  expect(state.calls.every(call=>call.method==='GET')).toBe(true);
});

test('phone Owner preview cannot become an equipment transfer actor',async({page})=>{
  await phone(page);
  const {state}=await mount(page,options({role:'owner',preview:true}));
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await expect(page.locator('#cosITDailyHost')).toContainText('preview persona');
  await expect(page.getByRole('button',{name:'Check Out / Hand Off',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toBeDisabled();
  expect(state.calls).toEqual([]);
});

test('crossing phone boundary swaps the workspace without carrying a private iframe',async({page})=>{
  await desktop(page);
  const {frame}=await mount(page,options());
  await readyFleet(frame);
  await phone(page);
  await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Check In / Return',exact:true})).toBeDisabled({timeout:13000});
  await desktop(page);
  await readyFleet(frame);
  await expect(page.locator('#existing-it-tool')).toBeHidden();
});

test('bad direct production-assignments route cannot mount shared IT queue',async({page})=>{
  await desktop(page);
  const {frame,state}=await mount(page,options());
  await readyFleet(frame);
  await frame.locator('body').evaluate(()=>{location.href=location.pathname+'?mode=production-assignments';});
  await expect(frame.getByRole('alert')).toContainText('IT assignment workflows are paused');
  await expect(frame.getByRole('region',{name:'Shared IT queue'})).toHaveCount(0);
  expect(state.calls.filter(call=>call.path.startsWith('/api/tech/')).every(call=>call.method==='GET')).toBe(true);
});

test('same-account sign-in confirmations preserve the board and current search',async({page})=>{
 await desktop(page);
 const {frame,state}=await mount(page,options());
 await readyFleet(frame);
 const search=frame.getByRole('searchbox',{name:'Search units, customers, sites or addresses'});
 await search.fill('Helios');
 await page.locator('#cosITDailyFrame').evaluate(n=>{window.fixtureStableFrame=n;window.fixtureFrameRemovals=0;new MutationObserver(records=>{for(const r of records)for(const removed of r.removedNodes)if(removed===n||removed.contains?.(n))window.fixtureFrameRemovals++;}).observe(document.body,{subtree:true,childList:true});});
 await page.evaluate(()=>{for(const event of ['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED','SIGNED_IN'])for(const fn of window.fixtureAuthListeners)fn(event,window.fixtureSession());});
 await expect(search).toHaveValue('Helios');
 expect(await page.evaluate(()=>({same:document.getElementById('cosITDailyFrame')===window.fixtureStableFrame,removals:window.fixtureFrameRemovals}))).toEqual({same:true,removals:0});
 await assertReadBoundary(page,state);
});

test('sign-out clears IT immediately even before the surrounding profile catches up',async({page})=>{
 await desktop(page);const {frame}=await mount(page,options());await readyFleet(frame);
 await page.evaluate(()=>{for(const fn of window.fixtureAuthListeners)fn('SIGNED_OUT',null);});
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 await page.evaluate(()=>{document.body.classList.toggle('late-legacy-redraw');window.dispatchEvent(new Event('pageshow'));});
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
});

for(const event of ['SIGNED_IN','TOKEN_REFRESHED'])test(`changed account ${event} removes old IT before profile catch-up`,async({page})=>{
 await desktop(page);const {frame}=await mount(page,options());await readyFleet(frame);
 await page.evaluate(event=>{for(const fn of window.fixtureAuthListeners)fn(event,{user:{id:'33333333-3333-4333-8333-333333333333'}});},event);
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 await page.evaluate(()=>document.body.classList.toggle('late-profile-redraw'));
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
});

test('same-account auth retains the selected phone view and unsent form',async({page})=>{
 await phone(page);await mount(page,options());
 const nav=page.getByRole('navigation',{name:'IT daily views'});await expect(nav).toBeVisible();
 await page.locator('#cosITDailyHost').evaluate(n=>{const f=document.createElement('form');f.innerHTML='<label>Unsent note<input name="note" value="Keep my handoff"></label>';n.append(f);});
 await page.evaluate(()=>{for(const fn of window.fixtureAuthListeners)fn('SIGNED_IN',window.fixtureSession());});
 await expect(page.getByRole('textbox',{name:'Unsent note'})).toHaveValue('Keep my handoff');
 await expect(nav.getByRole('button',{name:'Check out / check in',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('same-account confirmation still removes a board when fleet access is revoked',async({page})=>{
 await desktop(page);const {frame}=await mount(page,options());await readyFleet(frame);
 await page.evaluate(()=>{window.fixtureCapability=false;for(const fn of window.fixtureAuthListeners)fn('SIGNED_IN',window.fixtureSession());});
 await expect(page.locator('#cosITDailyFrame')).toHaveCount(0);
 await expect(page.getByRole('status')).toContainText('access could not be verified');
});

test('legacy IT provider diagnostics stays loaded through repeated sign-in confirmations',async({page})=>{
 await desktop(page);const {frame,state}=await mount(page,options({legacyCameraOnly:true}));
 await expect(frame.getByRole('heading',{name:'Provider diagnostics'})).toBeVisible();
 const search=frame.getByRole('textbox',{name:'Camera search'});await search.fill('Sniper 148');
 await page.evaluate(()=>{for(const fn of window.fixtureAuthListeners)fn('SIGNED_IN',window.fixtureSession());});
 await expect(search).toHaveValue('Sniper 148');
 expect(state.cameraLoads).toBe(1);
 await expect(page.locator('#cosITDailyFrame')).toBeVisible();
});
