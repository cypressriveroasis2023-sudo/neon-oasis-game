// Full-page synthetic fixtures. Every external request is blocked or fulfilled locally.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { snapshot, resource } from './fixtures/camera-evidence-fixtures.mjs';
const repo = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const origin = process.env.COS_MAP_TEST_ORIGIN || 'http://127.0.0.1:4173';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const now = '2026-10-06T18:00:00Z',
  fresh = '2026-10-06T17:55:00Z';
const base = {
  status: 'installed',
  currentLocationType: 'site',
  address: '100 Synthetic Road',
  site: 'Synthetic site',
  customer: 'Synthetic customer',
  latitude: 29.76,
  longitude: -95.37,
  locationVerification: 'owner_verified',
  gpsRecordedAt: fresh,
  locationVerifiedAt: fresh,
  coordinateSource: 'site',
  hasUnitGps: true
};
const defaultUnits = [{
  ...base,
  id: ids[0],
  unitNumber: 'Ranger 022',
  modelName: 'Ranger'
}, {
  ...base,
  id: ids[1],
  unitNumber: 'Recon II 022',
  modelName: 'Recon 2',
  latitude: 29.8
}, {
  ...base,
  id: ids[2],
  unitNumber: 'Sniper 2 022',
  modelName: 'SNIPERS',
  latitude: 31
}];
async function mount(page, label, units = defaultUnits, {
  restored, placementReviews=[], storedShop=false
} = {}) {
  const state = {
    units,
    requests: [],
    writes: []
  };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({
    time: new Date(now)
  });
  if (restored) await page.addInitScript(value => {
    if (parent !== window) history.replaceState({
      ...history.state,
      cosFieldMapView: value
    }, '');
  }, restored);
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin === origin) {
      if (u.pathname === '/fixture') return route.fulfill({
        contentType: 'text/html',
        body: `<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/#field-map?unitLabel=${encodeURIComponent(label)}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`
      });
      const path = resolve(repo, u.pathname === '/' ? 'index.html' : '.' + decodeURIComponent(u.pathname));
      if (path.startsWith(repo + '/') && existsSync(path)) return route.fulfill({
        path,
        contentType: {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.jpg': 'image/jpeg'
        }[extname(path)] || 'application/octet-stream'
      });
      return route.abort();
    }
    if (/^https:\/\/[abc]\.tile\.openstreetmap\.org\//.test(u.href)) return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#34495b"/></svg>'
    });
    if (!u.href.endsWith('/functions/v1/cos-operations-pages')) return route.abort('blockedbyclient');
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type'
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({
      status: 204,
      headers
    });
    const request = route.request().postDataJSON();
    state.requests.push(request);
    if (request.method !== 'GET') {
      state.writes.push(request);
      return route.fulfill({
        status: 400,
        headers,
        body: '{}'
      });
    }
    const data = request.path === '/api/session' ? {
      authorized: true,
      name: 'Synthetic Owner',
      role: 'Owner',
      features: {
        fieldLocationVerification: true
      }
    } : request.path === '/api/field-map' ? {
      placementReviews,
      items: state.units,
      summary: {
        fieldUnits: state.units.length,
        mappedUnits: state.units.length,
        unitGps: state.units.length,
        missingGps: 0
      },
      generatedAt: now
    } : request.path === '/api/camera-health/summary-v3' ? snapshot([...state.units.map((u, i) => resource(i + 1, u.unitNumber)),...(storedShop?[resource(999,'Sniper 312',{scope:'shop',activationState:'deactivated',organization:'ROOT',evidence:{...resource(999).evidence,active:false}})]:[])]) : request.path === '/api/routers' ? {
      items: [],
      source: 'camera_health',
      gpsAvailable: false,
      generatedAt: now
    } : request.path === '/api/daily-board' ? {
      jobs: [],
      tasks: [],
      readiness: [],
      asOf: now
    } : {
      items: []
    };
    return route.fulfill({
      headers,
      contentType: 'application/json',
      body: JSON.stringify(data)
    });
  });
  await page.goto(origin + '/fixture');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('.field-map-workspace')).toBeVisible();
  await expect(frame.getByLabel('Search field units')).toHaveValue(label === 'RII-022' ? 'Recon II 022' : label);
  return {
    state,
    frame,
    errors
  };
}
const cases = [['Exact native alias chooses same family/unit and one pin', async page => {
  const {
    frame,
    state,
    errors
  } = await mount(page, 'RII-022');
  await expect(frame.locator('.field-map-detail h2')).toHaveText('Recon II 022');
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
  await expect(frame.locator('.field-pin-label')).toContainText('Recon II 022');
  expect(state.writes).toHaveLength(0);
  expect(errors).toEqual([]);
}], ['Unknown or shop label never picks unrelated field unit', async page => {
  const {
    frame,
    state
  } = await mount(page, 'RANGER 999');
  await expect(frame.locator('.field-map-detail h2')).toHaveCount(0);
  await expect(frame.locator('.cos-field-pin')).toHaveCount(0);
  await expect(frame.locator('.toast')).toContainText('not currently in the field map');
  expect(state.writes).toHaveLength(0);
}], ['Canonical alias collision never selects a first pin', async page => {
  const units = [{
    ...defaultUnits[0],
    unitNumber: 'Ranger 22'
  }, {
    ...defaultUnits[1],
    unitNumber: 'RANGER-022'
  }];
  const {
    frame,
    state
  } = await mount(page, 'RANGER 022', units);
  await expect(frame.locator('.field-map-detail h2')).toHaveCount(0);
  await expect(frame.locator('.toast')).toContainText('conflicting field records');
  expect(state.writes).toHaveLength(0);
}], ['Back and Forward from native same-unit health preserve label match', async page => {
  const {
    frame,
    state
  } = await mount(page, 'RII-022');
  await frame.locator('.cos-field-pin').click();
  await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Recon II 022');
  await frame.getByRole('button', {
    name: 'Back to Field Map',
    exact: true
  }).click();
  await expect(frame.locator('.field-map-detail h2')).toHaveText('Recon II 022');
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
  await frame.locator('body').evaluate(() => history.forward());
  await expect(frame.locator('.camera-unit-detail h3')).toHaveText('Recon II 022');
  expect(state.writes).toHaveLength(0);
}], ['Explicit deep link clears stale nearby filter that hides target pin', async page => {
  const {
    frame
  } = await mount(page, 'RII-022', defaultUnits, {
    restored: {
      status: 'installed',
      health: 'offline',
      search: 'Ranger',
      selectedId: ids[0],
      nearbyId: ids[2],
      radius: 5
    }
  });
  await expect(frame.locator('.field-map-detail h2')).toHaveText('Recon II 022');
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
}], ['Different label route resets old health filter', async page => {
  const {
    frame
  } = await mount(page, 'RII-022');
  await frame.getByLabel('Field health filter').selectOption('offline');
  await frame.locator('body').evaluate(() => location.hash = '#field-map?unitLabel=Ranger%20022');
  await expect(frame.locator('.field-map-detail h2')).toHaveText('Ranger 022');
  await expect(frame.locator('.cos-field-pin')).toHaveCount(1);
}]];
for (const width of [390, 1440]) for (const [name, run] of cases) test('Field-map deep link ' + width + ': ' + name, async ({
  page
}) => {
  await page.setViewportSize({
    width,
    height: 900
  });
  await run(page);
});

test('held placement records remain visible and searchable without invented pins',async({page})=>{const {frame}=await mount(page,'Sniper 312',defaultUnits,{placementReviews:[{unitNumber:'Sniper 312',reason:'Two inventory identities need review.',placementAuditId:'123'}]});const review=frame.getByRole('region',{name:'Placement records needing review'});await expect(review).toContainText('Sniper 312');await expect(review).toContainText('Two inventory identities');await expect(review.getByRole('link',{name:'Open Camera Health'})).toHaveAttribute('href','../../camera-health.html?q=Sniper%20312');await expect(frame.locator('.cos-field-pin')).toHaveCount(0);});

test('one deactivated Shop record does not turn healthy field units gray',async({page})=>{const {frame}=await mount(page,'Ranger 022',defaultUnits,{storedShop:true});await expect(frame.locator('.cos-field-pin')).toHaveCount(1);await expect(frame.locator('.cos-field-pin')).toHaveAttribute('data-health','online');await expect(frame.locator('.field-map-workspace')).not.toContainText('Camera Health unavailable');await expect(frame.locator('.field-map-detail')).toContainText(/online/i);});
