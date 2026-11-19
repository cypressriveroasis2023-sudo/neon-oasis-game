import {test, expect} from '@playwright/test';
import {mountFleet, fresh} from './fleet-dashboard-fixtures.mjs';
import {openFleetView} from './fleet-view-navigation-helper.mjs';
import {countUnits} from '../shared/starUnitStatus.ts';
import {configuredWatchfulTestProjectKey} from '../shared/shopCameraStatus.ts';

const test1 = configuredWatchfulTestProjectKey('Test 1');

const line = (unit, over = {}) => ({
  unit, placement: 'FIELD', site: 'Fixture Yard', siteNamePending: false, state: 'RED',
  cameras: 1, online: 0, offline: 1, unknown: 0, down: [{name: unit + ' cam', status: 'offline'}],
  onlineInShop: false, publicIp: '203.0.113.50', observedAt: fresh,
  cameraList: [{name: unit + ' cam', status: 'offline', atSite: true}],
  ...over,
});
const units = [
  line('SPOTTER 880', {state: 'RED', mhelpPlacement: 'FIELD'}),
  line('SS010', {site: 'Test 1', watchfulProjectKey: test1, state: 'UNKNOWN', online: 0, offline: 0, unknown: 1, down: [{name: 'SS010 cam', status: 'unknown'}], tags: ['no telemetry']}),
  line('CAMV 090', {mhelpPlacement: 'SHOP', tags: ['RSU', 'no telemetry']}),
  line('CAMV 093', {mhelpPlacement: 'SHOP', lifecycle: 'DO_NOT_USE', state: 'GREEN', online: 1, offline: 0, down: []}),
  line('RSU 200', {site: 'test 1', watchfulProjectKey: test1, mhelpPlacement: 'FIELD', lifecycle: 'DO NOT USE'}),
];
const report = {
  contract: 'COS_STAR_UNIT_STATUS_V1', units, counts: countUnits(units),
  feed: {provider: 'star4live', syncedAt: fresh, status: 'ok', enabled: true, fresh: true, ageMs: 1000},
  handEditsRead: true, otherSourcesRead: true, canEdit: false, refreshedAt: fresh, source: 'Star4Live',
};

test('camera status splits In shop, Shop DO NOT USE, and exceptions', async ({page}, info) => {
  const {app} = await mountFleet(page);
  const cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS'};
  await page.route('**/functions/v1/cos-unit-camera-status', route => route.request().method() === 'OPTIONS'
    ? route.fulfill({status: 204, headers: cors})
    : route.fulfill({status: 200, headers: cors, json: report}));
  await openFleetView(app, 'Camera status');
  const view = app.locator('.cos-camera-status');
  await expect(view.getByLabel('Camera monitoring figures')).toContainText('Field');
  await expect(view.getByLabel('Camera monitoring figures')).toContainText('In shop');
  const figures = view.getByLabel('Camera monitoring figures');
  await expect(figures).toContainText('Field 1');
  // Rule change, Felix review of #458 at e8f9c9fa blocker C.
  // SS010 carries only a Watchful project id, so that id does not key mHelp.
  // Old: 'In shop 2', 'Shop, DO NOT USE 1', 'Exceptions 1'
  // Old lines: 'Shop, DO NOT USE · 1 · CAMV 093. Not online.' and 'Exceptions · 1 · RSU 200. Not in any total.'
  await expect(figures).toContainText('In shop —');
  await expect(figures).not.toContainText('In shop 0');
  await expect(figures).toContainText('Shop, DO NOT USE —');
  await expect(figures).toContainText('Exceptions —');
  const rows = view.locator('.cos-camera-status-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.filter({hasText: 'SPOTTER 880'})).toContainText('All cameras down');
  await expect(view.getByLabel('Shop, DO NOT USE')).toContainText('Shop, DO NOT USE · —');
  await expect(view.getByLabel('Exceptions')).toContainText('Exceptions · —');
  await app.locator('.cos-camera-about > summary').click();
  await app.getByRole('button', {name: /^In the shop/}).first().click();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({hasText: 'SS010'})).toContainText('ONLINE');
  // Rule change, Felix review of #458 at 808d6ba3: a listed camera is not "no telemetry".
  // Old: 'In shop · no telemetry'
  await expect(rows.filter({hasText: 'SS010'})).toContainText('In shop');
  await expect(rows.filter({hasText: 'SS010'})).not.toContainText('no telemetry');
  await expect(rows.filter({hasText: 'CAMV 090'})).toContainText('ONLINE');
  // Old: 'In shop · no telemetry · RSU'
  await expect(rows.filter({hasText: 'CAMV 090'})).toContainText('In shop · RSU');
  await expect(rows.filter({hasText: 'CAMV 090'})).not.toContainText('no telemetry');
  await expect(view).not.toContainText('203.0.113.50');
  await expect(view.locator('.job-card, .inventory-card')).toHaveCount(0);
  await page.screenshot({path: info.outputPath('shop-camera-status-main.png'), fullPage: true});
});
