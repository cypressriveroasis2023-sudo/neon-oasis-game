import { test, expect } from '@playwright/test';
import { openWorkspace } from './navigation-helper.mjs';

const origin = process.env.COS_MAP_TEST_ORIGIN || 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const stamp = '2026-10-06T16:00:00Z';
// This full-sized fleet exists only in intercepted fixtures. No live reads or writes.
const units = Array.from({ length: 815 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, unitNumber: `FIELD-FIX-${String(index + 1).padStart(3, '0')}`,
  modelName: 'Fixture camera', status: 'field', currentLocationType: 'field',
  site: `Fixture installation ${index + 1}`, address: `${index + 1} Fixture St, Houston, TX`,
  latitude: index < 3 ? 29.70 + index * 0.1 : null, longitude: index < 3 ? -95.40 + index * 0.1 : null,
  hasUnitGps: false, readOnly: true, coordinateSource: index < 3 ? 'import' : null,
  recordSource: 'Synthetic tracker', sourceVerifiedAt: stamp, locationVerification:index<3?'owner_verified':null, gpsRecordedAt:index<3?stamp:null, locationVerifiedAt:index<3?stamp:null,
}));
async function mount(page) {
  const requests = [];
  const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d6e8df"/><path d="M0 64H256M0 192H256M64 0V256M192 0V256" stroke="#fff" stroke-width="12"/><text x="16" y="125" font-size="14" fill="#446957">Synthetic map tile</text></svg>';
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === origin + '/field-map-viewport-fixture') return route.fulfill({ contentType: 'text/html', body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0;display:block}</style><iframe src="/"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>` });
    if (url.startsWith(origin + '/')) return route.continue();
    if (/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(url)) return route.fulfill({ contentType: 'image/svg+xml', body: tile });
    if (url !== edge) return route.abort('blockedbyclient');
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const request = route.request().postDataJSON(); requests.push(request); expect(request.method).toBe('GET');
    const data = request.path === '/api/session' ? { authorized: true, name: 'Fixture owner', role: 'Owner' }
      : request.path === '/api/field-map' ? { items: units, summary: { fieldUnits: 815, mappedUnits: 3, unitGps: 0, missingGps: 812 }, generatedAt: stamp }
      : request.path === '/api/routers' ? { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: stamp }
      : request.path === '/api/camera-health/summary-v3' ? { totalDevices: 0, online: 0, offline: 0, review: 0, fieldDevices: 0, shopRoot: 0, healthRows: 0, refreshedAt: stamp, rows: [] }
      : request.path === '/api/daily-board' ? { jobs: [], tasks: [], readiness: [], asOf: stamp } : { items: [] };
    return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('/field-map-viewport-fixture');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('region', { name: 'VISION dashboard' })).toBeVisible();
  await openWorkspace(frame, 'Field Map');
  await expect(frame.locator('.field-map-list > button')).toHaveCount(815);
  return { frame, requests };
}
async function bounded(frame) {
  const size = await frame.locator('.field-map-layout').evaluate(layout => {
    const list = layout.querySelector('.field-map-list'), map = layout.querySelector('.field-map-center'), detail = layout.querySelector('.field-map-detail');
    return { mapHeight: map.getBoundingClientRect().height, listHeight: list.clientHeight, listContent: list.scrollHeight, detailHeight: detail.getBoundingClientRect().height, width: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(size.mapHeight).toBeGreaterThanOrEqual(400);
  expect(size.mapHeight).toBeLessThanOrEqual(760);
  expect(size.listHeight).toBeLessThanOrEqual(760);
  expect(size.detailHeight).toBeLessThanOrEqual(760);
  expect(size.documentWidth).toBeLessThanOrEqual(size.width + 1);
  return size;
}
test('large field fleet keeps map bounded through scrolling, filters, selection, and navigation', async ({ page }, testInfo) => {
  const { frame, requests } = await mount(page);
  const initial = await bounded(frame);
  expect(initial.listContent).toBeGreaterThan(initial.listHeight * 10);
  const map = frame.locator('.field-map-center');
  await map.scrollIntoViewIfNeeded();
  const before = await map.boundingBox();
  await frame.locator('.field-map-list').evaluate(list => { list.scrollTop = list.scrollHeight; });
  expect((await map.boundingBox()).y).toBeCloseTo(before.y, 0);
  await frame.locator('.field-map-list > button').last().click();
  await expect(frame.locator('.field-map-detail h2')).toHaveText('FIELD-FIX-815');
  await page.keyboard.press('Shift+Tab');
  await expect(frame.locator('.field-map-list > button').nth(813)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(frame.locator('.field-map-detail h2')).toHaveText('FIELD-FIX-814');
  await expect(frame.locator('.field-map-list > button').nth(813)).toBeInViewport();
  await bounded(frame);
  await frame.getByLabel('Search field units').fill('FIELD-FIX-001');
  await expect(frame.locator('.field-map-list > button')).toHaveCount(1);
  await frame.locator('.field-map-list > button').click();
  await expect(frame.locator('.field-map-detail h2')).toHaveText('FIELD-FIX-001');
  await frame.getByRole('button', { name: 'Show all verified pins', exact: true }).click();
  await map.scrollIntoViewIfNeeded();
  await expect(frame.locator('.leaflet-marker-icon')).toHaveCount(1);
  await expect.poll(async () => frame.locator('.leaflet-marker-icon').evaluate(marker => {
    const pin = marker.getBoundingClientRect(), canvas = marker.closest('.field-map-canvas').getBoundingClientRect();
    return pin.x >= canvas.x && pin.right <= canvas.right && pin.y >= canvas.y && pin.bottom <= canvas.bottom;
  })).toBe(true);
  expect((await bounded(frame)).mapHeight).toBeCloseTo(initial.mapHeight, 0);
  await page.screenshot({ path: testInfo.outputPath('field-map-selected.png') });
  await frame.getByLabel('Search field units').fill('no-matching-fixture');
  await expect(frame.locator('.field-map-empty')).toContainText('No units match');
  expect((await bounded(frame)).mapHeight).toBeCloseTo(initial.mapHeight, 0);
  await frame.getByLabel('Search field units').fill('');
  await expect(frame.locator('.field-map-list > button')).toHaveCount(815);
  await frame.getByRole('button', { name: 'Show all verified pins', exact: true }).click();
  await map.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('field-map-815-units.png') });
  await openWorkspace(frame, 'Today');
  await openWorkspace(frame, 'Field Map');
  await bounded(frame);
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});
test('field map responds to narrow windows and repeated resizing without a fleet-sized canvas', async ({ page }) => {
  const { frame, requests } = await mount(page);
  await frame.getByLabel('Search field units').fill('FIELD-FIX-001');
  await frame.locator('.field-map-list > button').click();
  for (const [width, height] of [[2048, 900], [1440, 900], [1366, 768], [1280, 576], [1220, 800], [1201, 800], [1200, 800], [1024, 576], [701, 800], [700, 800], [390, 844], [320, 568], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await bounded(frame);
    await expect.poll(async () => frame.locator('.leaflet-marker-icon').evaluate(marker => {
      const pin = marker.getBoundingClientRect(), canvas = marker.closest('.field-map-canvas').getBoundingClientRect();
      return pin.x >= canvas.x && pin.right <= canvas.right && pin.y >= canvas.y && pin.bottom <= canvas.bottom;
    })).toBe(true);
  }
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});
