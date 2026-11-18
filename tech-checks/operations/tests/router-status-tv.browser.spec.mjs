import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const time = '2026-10-12T15:00:00Z';
const stale = '2026-10-12T10:00:00Z';
const cors = {'access-control-allow-origin': origin};
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}iframe{width:100%;height:1080px;border:0}</style></head><body><header id="hostToolbar">Host tools</header><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=>"owner",getEffectiveRole:()=>"owner",getSession:()=>({user:{id:"fixture-owner"}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:"fixture-owner"},access_token:"synthetic-owner-session"}}})}}};</script><script type="module" src="/operations-host.js"></script></body></html>`;

test.use({viewport: {width: 1920, height: 1080}});

test('TV board shows Unknown for a stale reading and In Shop for a shop unit', async ({page}, info) => {
  const unit = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', unitNumber: 'Sniper 312', modelName: 'SNIPER', status: 'installed', site: 'Fixture field site', address: '19017 Lee Rd, Humble, TX 77032', latitude: 29.986, longitude: -95.311, locationVerification: 'owner_verified', locationVerifiedAt: time, gpsRecordedAt: time};
  const shopUnit = {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', unitNumber: 'Sniper 44', modelName: 'SNIPER', status: 'available', placement: 'shop', currentLocationType: 'shop', site: 'Fixture shop', address: 'Shop bench'};
  const camera = {id: 'fixture-resource', name: 'Sniper 312 connection', unit: 'Sniper 312', status: 'offline', scope: 'field', activationState: 'active', serviceEvidence: {kind: 'service_port', source: 'Saved connection', status: 'offline', active: true, resource: 'service', observedAt: time, lastOnlineAt: stale, reachable: false, confirmedOutage: true}};
  const shopCamera = {...camera, id: 'shop-resource', name: 'Sniper 44 connection', unit: 'Sniper 44', scope: 'shop'};
  const router = {id: 'tv-router', unitKey: 'Sniper 312', name: 'Fixture InHand', model: 'IR615', publicIp: null, unitIp: null, port: 443, protocol: 'https', probeStatus: 'online', checkedAt: stale, lastRecoveredAt: stale, reportedStatus: 'Online', reportedAt: stale, reportedSource: 'Synthetic fixture', match: 'exact_name', candidateUnit: {id: unit.id, unitNumber: 'Sniper 312'}, gps: null, boardStatus: 'Online', boardCheckedAt: stale, boardOutage: false, doNotUse: true};
  const shopRouter = {...router, id: 'shop-router', unitKey: 'Sniper 44', name: 'Shop InHand', probeStatus: 'offline', checkedAt: time, boardStatus: 'Offline', boardCheckedAt: time, boardOutage: true, doNotUse: false, candidateUnit: {id: shopUnit.id, unitNumber: 'Sniper 44'}};
  await page.clock.install({time: new Date(time)});
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname === '/tv-harness') return route.fulfill({contentType: 'text/html', body: harness});
      if (url.pathname === '/operations-host.js') return route.fulfill({contentType: 'application/javascript', body: await readFile(new URL('../../operations-host.js', import.meta.url), 'utf8')});
      if (url.pathname === '/field-map-display-host.js') return route.fulfill({contentType: 'application/javascript', body: await readFile(new URL('../../field-map-display-host.js', import.meta.url), 'utf8')});
      if (url.pathname.startsWith('/operations/dist/')) return route.fulfill({path: dist + url.pathname.slice('/operations/dist/'.length)});
      return route.continue();
    }
    if (url.href !== edge) return route.abort('blockedbyclient');
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers: {...cors, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type'}});
    const {path, method} = request.postDataJSON();
    if (path === '/api/tv-board/settings') return route.fulfill({headers: cors, json: {sections: ['camera'], revision: 1, updatedAt: time, rotationSeconds: 60}});
    if (method !== 'GET') return route.fulfill({status: 403, headers: cors, json: {error: 'Display cannot write'}});
    if (path === '/api/daily-board') return route.fulfill({headers: cors, json: {jobs: [], tasks: [], readiness: [], asOf: time}});
    if (path === '/api/field-map') return route.fulfill({headers: cors, json: {items: [unit, shopUnit], summary: {fieldUnits: 2, mappedUnits: 1, unitGps: 1, missingGps: 1}, generatedAt: time}});
    if (path === '/api/routers') return route.fulfill({headers: cors, json: {items: [router, shopRouter], generatedAt: time, source: 'camera_health', gpsAvailable: false, doNotUseKeys: []}});
    if (path === '/api/camera-health/summary-v3') return route.fulfill({headers: cors, json: {totalDevices: 2, online: 0, offline: 1, review: 0, shopRoot: 1, healthRows: 2, fieldDevices: 1, refreshedAt: time, evidenceVersion: 2, inventory: {allRecords: 2, activeFieldRecords: 1, activeShopRecords: 1, inactiveRecords: 0, unknownScopeRecords: 0}, rows: [camera, shopCamera]}});
    return route.fulfill({headers: cors, json: path === '/api/session' ? {authorized: true, name: 'Fixture Owner', role: 'Owner', features: {}} : {items: []}});
  });
  await page.goto('/tv-harness?tvBoard=1');
  const frame = page.frameLocator('#cosOperationsFrame');
  const board = frame.getByRole('region', {name: 'Tech Check TV Board'});
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-section', 'camera');
  const record = frame.locator('.tv-fleet-record').filter({hasText: 'Sniper 312'});
  await expect(record).toBeVisible();
  await expect(record).toContainText('Unknown');
  await expect(record).not.toContainText('Online');
  const shop = frame.locator('.tv-fleet-record').filter({hasText: 'Sniper 44'});
  await expect(shop.locator('.cos-signal-shop')).toHaveText('In Shop');
  await expect(shop.locator('.cos-signal-shop')).not.toContainText('Offline');
  expect(await shop.locator('.cos-signal-shop').evaluate(node => getComputedStyle(node).color)).toBe('rgb(100, 116, 139)');
  const badge = record.locator('.cos-do-not-use-badge');
  await expect(badge).toHaveText('DO NOT USE');
  expect(await badge.evaluate(node => getComputedStyle(node).color)).toBe('rgb(154, 52, 18)');
  await page.screenshot({path: info.outputPath('tv-board.png'), fullPage: true});
  if (info.project.name === 'desktop-1440') await page.screenshot({path: '/opt/cursor/artifacts/router-status/tv-board.png', fullPage: true});
});
