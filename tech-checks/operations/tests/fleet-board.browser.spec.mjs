import {test,expect} from '@playwright/test';
import {mountFleet,field} from './fleet-dashboard-fixtures.mjs';
import {resource,snapshot,withStatus,fresh} from './fixtures/camera-evidence-fixtures.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const fits = (frame)=>frame.locator('html').evaluate(()=>({
  html: document.documentElement.scrollHeight<=document.documentElement.clientHeight+1,
  body: document.body.scrollHeight<=document.body.clientHeight+1,
  y: window.scrollY,
}));

const prepared = () => {
  const next = structuredClone(field);
  const touch = (item) => {
    if (item.unitNumber === 'Helios 1') {
      item.eyeNumber = 'EYE-14';
      item.immix = true;
      item.contacts = [{name: 'Fixture Contact', phone: '555-0100', email: 'fixture@example.test'}];
      item.latitude = 29.76; item.longitude = -95.37;
      item.locationVerification = 'owner_verified';
    }
    if (item.unitNumber === 'Spotter 1') {
      item.latitude = 29.9; item.longitude = -95.2;
      item.locationVerification = 'owner_verified';
      item.coordinateSource = 'owner';
      item.gpsRecordedAt = fresh;
      item.locationVerifiedAt = fresh;
    }
  };
  next.items.forEach(touch);
  next.inventoryItems.forEach(touch);
  return next;
};

test('reviewed unit rows stay mounted at 390, 1024, and 1440', async ({page}) => {
  const {app} = await mountFleet(page, true);
  await expect(app.locator('.cos-fleet-unit-row').first()).toBeVisible();
  await expect(app.locator('.cos-board')).toHaveCount(0);
  await expect(app.locator('.cos-fleet-tabs')).toHaveCount(1);
  await expect(app.locator('.cos-equipment-totals')).toHaveCount(1);
});

test('a 1920 screen keeps the reviewed unit rows until the board flag is on', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const {app} = await mountFleet(page, true);
  await expect(app.locator('.cos-fleet-unit-row').first()).toBeVisible();
  await expect(app.locator('.cos-board')).toHaveCount(0);
  await expect(app.locator('.cos-fleet-map-footnote')).toHaveCount(1);
});

test('the desktop board stays on one screen and opens problems and a site', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const {app} = await mountFleet(page, true, {field: prepared(), fleetBoard: true});
  const board = app.locator('.cos-board');
  await expect(board).toBeVisible();
  await expect(board.locator('[data-board-box=units]')).toContainText('Units online');
  await expect(board.locator('[data-board-box=cameras]')).toContainText('Cameras online');
  await expect(board.locator('[data-board-box=sites]')).toContainText('not available');
  await expect(board.locator('[data-board-box=problems]')).toBeEnabled();
  await expect(app.locator('.cos-board-note')).toContainText('Address estimates');
  await expect(app.locator('.cos-board-foot')).toContainText('In shop');
  const retired = ['.cos-fleet-heading','.cos-fleet-tabs','.cos-source-alerts','.cos-source-strip','.cos-mhelp-connection-alert','.cos-fleet-tab-summary','.cos-phone-board-info','.cos-fleet-vision-toggle','div.cos-board-search','.cos-fleet-unit-panel','.cos-fleet-map-toolbar','.cos-fleet-map-legend','.cos-fleet-pin-view','.cos-fleet-camera-total','.cos-fleet-source-details','.cos-fleet-map-footnote','.cos-equipment-totals'];
  for (const selector of retired) await expect(app.locator(selector)).toHaveCount(0);
  const visible = await app.locator('.cos-fleet-board').innerText();
  expect(visible).not.toMatch(/Solar support|Unverified|Saved health|health refresh|Location key/);
  const boxes = await app.locator('[data-board-box]').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return {x: box.x, y: box.y, width: box.width, height: box.height};
  }));
  const legend = await app.locator('.cos-board-legend').boundingBox();
  const read = await app.locator('.cos-board-read').boundingBox();
  const note = await app.locator('.cos-board-note').boundingBox();
  const overlaps = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width - 1 > b.x && a.y < b.y + b.height - 1 && a.y + a.height - 1 > b.y;
  expect(boxes).toHaveLength(4);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
  for (const box of boxes) {
    expect(overlaps(box, legend)).toBe(false);
    expect(overlaps(box, read)).toBe(false);
    expect(overlaps(box, note)).toBe(false);
  }
  expect(overlaps(legend, read)).toBe(false);
  expect(overlaps(note, legend)).toBe(false);
  expect(overlaps(note, read)).toBe(false);
  await expect(app.locator('.leaflet-control-zoom')).toHaveCount(0);
  await expect(app.locator('label.cos-board-search')).toHaveCount(0);
  await expect(board.locator('[data-board-box=problems] small')).toHaveText('1 problem');
  await expect(board.locator('[data-board-box=units] strong')).toContainText('/ 3');
  await expect.poll(() => fits(app)).toEqual({html: true, body: true, y: 0});
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_main.png'});
  await board.locator('[data-board-box=problems]').click();
  const card = app.locator('.cos-board-card');
  await expect(card).toContainText('Offline');
  await expect(card).toContainText('not available');
  await expect(card).not.toContainText('Down');
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_problems.png'});
  await card.getByRole('button', {name: /Spotter 1/}).click();
  await expect(card).toContainText('Spotter 1');
  await expect(card.locator('[data-status=offline]')).toBeVisible();
  await expect(card.locator('.cos-board-cam.is-down')).toBeVisible();
  const opened = await app.locator('.cos-fleet-board').innerText();
  expect(opened).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  expect(opened).not.toMatch(/SIM number|password|credential/i);
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_site_red.png'});
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_search.png'});
  const good = app.locator('.cos-board-dot[data-dot=green]');
  await good.evaluate(node => node.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await expect(card).toContainText('Immix');
  await expect(card).toContainText('Fixture Contact');
  await expect(card).toContainText('555-0100');
  await expect(card).toContainText('Armed schedule');
  await expect(card.locator('.cos-board-missing').first()).toBeVisible();
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_site_immix.png'});
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_contacts.png'});
  await app.locator('.cos-board-overlay').click({position: {x: 420, y: 30}});
  await expect(card).toHaveCount(0);
  const dot = app.locator('.cos-board-dot[data-dot=red]');
  await expect(dot).toBeAttached();
  await dot.evaluate(node => node.dispatchEvent(new MouseEvent('click', {bubbles: true})));
  await expect(card).toBeVisible();
  await expect.poll(() => app.locator('body').evaluate(() => history.state?.cosFieldMapView?.zoom || 0)).toBeGreaterThanOrEqual(14);
  await expect(app.locator('.cos-compact-group-sheet')).toHaveCount(0);
});

test('the map fills 1600x900 without a page scroll', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1600, height: 900});
  const {app} = await mountFleet(page, true, {field: prepared(), fleetBoard: true});
  await expect(app.locator('.cos-board')).toBeVisible();
  const canvas = await app.locator('.cos-fleet-map-canvas').boundingBox();
  expect(canvas.height).toBeGreaterThan(500);
  await expect.poll(() => fits(app)).toEqual({html: true, body: true, y: 0});
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1600x900.png'});
});

test('Problems above 0 is red and 0 is not', async ({page, browser}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const alarm = await mountFleet(page, true, {field: prepared(), fleetBoard: true});
  const hot = alarm.app.locator('[data-board-box=problems]');
  await expect(hot.locator('strong')).not.toHaveText('0');
  await expect.poll(() => hot.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(42, 20, 24)');
  const clearPage = await browser.newPage();
  await clearPage.setViewportSize({width: 1920, height: 1080});
  const clearHealth = snapshot([
    resource(1, 'Helios 1', {status: 'online'}),
    resource(2, 'Spotter 1', {status: 'online'}),
    resource(3, 'Spotter 2', {status: 'online'}),
    resource(4, 'Sniper 44', {scope: 'shop', status: 'online'}),
  ]);
  const calm = await mountFleet(clearPage, true, {field: prepared(), health: clearHealth, fleetBoard: true});
  const cool = calm.app.locator('[data-board-box=problems]');
  await expect(cool.locator('strong')).toHaveText('0');
  await expect(cool).toHaveClass(/is-clear/);
  expect(await cool.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgb(42, 20, 24)');
  await clearPage.close();
});

test('failure warnings stay visible on the board', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const {app} = await mountFleet(page, true, {failHealth: true, fleetBoard: true});
  await expect(app.getByText('Health update unavailable')).toBeVisible();
  const retired = ['.cos-fleet-heading','.cos-fleet-tabs','.cos-source-alerts','.cos-source-strip','.cos-mhelp-connection-alert','.cos-fleet-tab-summary','.cos-phone-board-info','.cos-fleet-vision-toggle','div.cos-board-search','.cos-fleet-unit-panel','.cos-fleet-map-legend','.cos-fleet-camera-total','.cos-fleet-source-details','.cos-fleet-map-footnote','.cos-equipment-totals'];
  for (const selector of retired) await expect(app.locator(selector)).toHaveCount(0);
  await expect(app.locator('[data-board-box=units] strong')).not.toContainText('0');
});

test('fleetStage=0 renders the reviewed main board', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const {app} = await mountFleet(page, false);
  await page.locator('iframe').evaluate(frame => { frame.src = '/?fleetStage=0#fleet-dashboard'; });
  await expect(app.locator('.cos-fleet-stat-field strong')).toBeVisible();
  await expect(app.locator('.cos-stage')).toHaveCount(0);
  await expect(app.locator('.cos-fleet-unit-panel')).toBeVisible();
});

const origin = 'http://127.0.0.1:4173';
test('the TV board does not accept interaction and a late read is Unknown', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/operations-host.css"><style>body{margin:0}#cosOperationsMount{height:100dvh}</style></head><body><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=>"owner",getEffectiveRole:()=>"owner",getSession:()=>({user:{id:"fixture-owner"}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:"fixture-owner"},access_token:"synthetic-owner-session"}}})}}};</script><script type="module" src="/operations-host.js"></script></body></html>`;
  const freshAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const lateAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const unit = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', unitNumber: 'North Yard', modelName: 'SNIPER', status: 'installed', placement: 'FIELD', site: 'Synthetic yard', address: '100 Synthetic Rd', latitude: 29.98, longitude: -95.31, locationVerification: 'owner_verified', locationVerifiedAt: freshAt, gpsRecordedAt: freshAt};
  const down = {...unit, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', unitNumber: 'South Yard', latitude: 30.05, longitude: -95.2};
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      if (url.pathname === '/tv-stage') return route.fulfill({contentType: 'text/html', body: harness});
      if (url.pathname === '/operations-host.js') return route.fulfill({contentType: 'application/javascript', body: await readFile(new URL('../../operations-host.js', import.meta.url), 'utf8')});
      if (url.pathname === '/field-map-display-host.js') return route.fulfill({contentType: 'application/javascript', body: await readFile(new URL('../../field-map-display-host.js', import.meta.url), 'utf8')});
      if (url.pathname === '/operations-host.css') return route.fulfill({contentType: 'text/css', body: await readFile(new URL('../../operations-host.css', import.meta.url), 'utf8')});
      if (url.pathname.startsWith('/operations/dist/')) return route.fulfill({path: dist + url.pathname.slice('/operations/dist/'.length)});
      return route.continue();
    }
    if (!url.href.endsWith('/functions/v1/cos-operations-pages')) return route.abort('blockedbyclient');
    const headers = {'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST, OPTIONS'};
    if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
    const request = route.request().postDataJSON();
    if (request.method !== 'GET') return route.fulfill({status: 403, headers, json: {error: 'Display cannot write'}});
    const late = url.searchParams.get('late') === '1' || page.url().includes('late=1');
    const time = late ? lateAt : freshAt;
    const path = request.path;
    if (path === '/api/tv-board/settings') return route.fulfill({headers, json: {sections: ['map'], revision: 1, updatedAt: time, rotationSeconds: 60}});
    if (path === '/api/daily-board') return route.fulfill({headers, json: {jobs: [], tasks: [], readiness: [], asOf: time}});
    if (path === '/api/field-map') return route.fulfill({headers, json: {items: [unit, down], summary: {fieldUnits: 2, mappedUnits: 2, unitGps: 2, missingGps: 0}, generatedAt: time, savedBoardReadAt: time}});
    if (path === '/api/routers') return route.fulfill({headers, json: {items: [], generatedAt: time, source: 'camera_health', gpsAvailable: false}});
    if (path === '/api/camera-health/summary-v3') return route.fulfill({headers, json: snapshot([
      resource(1, 'North Yard', {evidence: {...resource(1).evidence, observedAt: time, lastOnlineAt: time}}),
      withStatus(resource(2, 'South Yard'), 'offline', time),
    ])});
    if (path === '/api/session') return route.fulfill({headers, json: {authorized: true, legacyOwner: true, role: 'Owner', name: 'Fixture Owner', productionOwnerUserId: '11111111-1111-4111-8111-111111111111', features: {fleetAccess: true}}});
    return route.fulfill({headers, json: {items: []}});
  });
  await page.goto('/tv-stage?tvBoard=1&fleetBoard=1');
  const frame = page.frameLocator('#cosOperationsFrame');
  await expect(frame.locator('.cos-board[data-board-mode=wall]')).toBeVisible();
  await expect(frame.locator('.cos-board-search')).toHaveCount(0);
  const problems = frame.locator('[data-board-box=problems]');
  await expect(problems).toHaveAttribute('aria-disabled', 'true');
  const problemCount = (await problems.locator('strong').innerText()).trim();
  if (problemCount === '0') await expect(problems).toHaveAttribute('data-problem-tone', 'clear');
  const problemBg = await problems.evaluate(node => getComputedStyle(node).backgroundColor);
  if (problemCount === '0') expect(problemBg).not.toBe('rgb(42, 20, 24)');
  const tvBoxes = await frame.locator('[data-board-box]').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return {x: box.x, y: box.y, width: box.width, height: box.height}; }));
  await expect(frame.locator('.cos-board-note')).toHaveCount(0);
  const tvLegend = await frame.locator('.cos-board-legend').boundingBox();
  const hits = (a, b) => a.x < b.x + b.width - 1 && a.x + a.width - 1 > b.x && a.y < b.y + b.height - 1 && a.y + a.height - 1 > b.y;
  for (const box of tvBoxes) expect(hits(box, tvLegend)).toBe(false);
  await frame.locator('.cos-board-dot').first().click({force: true});
  await expect(frame.locator('.cos-board-card')).toHaveCount(0);
  await expect.poll(() => fits(frame)).toEqual({html: true, body: true, y: 0});
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_tv.png'});
  await page.goto('/tv-stage?tvBoard=1&fleetBoard=1&late=1');
  await expect(frame.locator('.cos-board-banner')).toBeVisible();
  await expect(frame.locator('[data-board-box=problems]')).toHaveAttribute('data-problem-tone', 'unknown');
  await expect(frame.locator('[data-board-box=problems] strong')).toHaveText('?');
  await expect(frame.locator('[data-board-box=units] strong')).toHaveText('—');
  await expect(frame.locator('[data-board-box=units]')).not.toContainText('0');
  const staleBg = await frame.locator('[data-board-box=problems]').evaluate(node => getComputedStyle(node).backgroundColor);
  expect(staleBg).not.toBe('rgb(42, 20, 24)');
  expect(await frame.locator('.cos-board').innerText()).not.toMatch(/\bDown\b/);
  await expect(frame.locator('.cos-board-dot[data-dot=grey]').first()).toBeVisible();
  await expect(frame.locator('.cos-board-card')).toHaveCount(0);
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_tv_stale.png'});
});

test('a desktop late read keeps problems closed', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop-1440');
  await page.setViewportSize({width: 1920, height: 1080});
  const late = new Date(Date.parse(fresh) - 40 * 60 * 1000).toISOString();
  const health = snapshot([
    resource(1, 'Helios 1', {evidence: {...resource(1).evidence, observedAt: fresh, lastOnlineAt: fresh}}),
    withStatus(resource(2, 'Spotter 1'), 'offline', fresh),
  ]);
  health.refreshedAt = fresh;
  const lateField = prepared();
  lateField.savedBoardReadAt = late;
  const {app} = await mountFleet(page, true, {field: lateField, health, fleetBoard: true});
  await expect(app.locator('.cos-board-banner')).toBeVisible();
  await expect(app.locator('[data-board-box=units] strong')).toHaveText('—');
  await expect(app.locator('[data-board-box=problems]')).toHaveAttribute('aria-disabled', 'true');
  await expect(app.locator('.cos-board-card')).toHaveCount(0);
  await page.screenshot({path: '/opt/cursor/artifacts/fleet_board_1920_stale.png'});
});
