import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredWatchfulTestProjectKey, decideShopCameras, liveFeedShopRows, LIVE_CAMERA_FEED_HAS_WATCHFUL_PROJECT_UUID, cameraStatusBoard, SHOP_CAMERA_RULE} from '../shared/shopCameraStatus.ts';

// A unit as /api/unit-camera-status returns it. No product id, no Watchful UUID, no device serial.
const camera = (unit, over = {}) => ({
  unit,
  placement: 'FIELD',
  site: null,
  siteNamePending: false,
  state: 'RED',
  cameras: 1,
  online: 0,
  offline: 1,
  unknown: 0,
  down: [{name: unit + ' cam', status: 'offline'}],
  cameraList: [{name: unit + ' cam', status: 'offline', atSite: true}],
  onlineInShop: false,
  publicIp: null,
  observedAt: '2026-11-19T18:00:00Z',
  star_organization_id: '283838',
  ...over,
});

// An mHelp upload record as the field map already stores it.
const record = (productId, unitNumber, placement, uploadLifecycle, over = {}) => ({
  productId,
  unitNumber,
  sourceUnitNumber: unitNumber,
  placement,
  uploadLifecycle,
  category: 'Synthetic',
  binding: {state: 'linked', unitIds: [], candidateUnitIds: [], placementHeld: false, matchMethod: null, reason: null},
  ...over,
});

test('live-shaped rows use upload product ids and lifecycles without injecting keys', () => {
  const shop = Array.from({length: 322}, (_, index) => camera('FIXTURE SHOP ' + (index + 1), {placement: 'SHOP', state: 'RED', site: null}));
  const dnu = Array.from({length: 55}, (_, index) => camera('FIXTURE DNU ' + (index + 1), {placement: 'SHOP', state: 'RED', site: null}));
  const units = [
    ...shop,
    camera('Sniper 137', {placement: 'SHOP', state: 'RED', site: null}),
    ...dnu,
    camera('Sniper 175', {placement: 'SHOP', state: 'RED', site: null}),
    camera('Sniper 318', {placement: 'FIELD', state: 'RED', site: 'Synthetic yard'}),
    camera('SS010', {site: 'Test 1', state: 'UNKNOWN', online: 0, offline: 0, unknown: 1}),
    camera('SS058', {site: 'Helios Test Sites', state: 'GREEN', online: 1, offline: 0}),
    camera('Spotter 196', {site: 'Spotter Test Site'}),
    camera('RII-025', {site: 'RII-025 Shop', placement: 'SHOP', state: 'RED'}),
  ];
  const records = [
    ...shop.map((unit, index) => record(String(1000 + index), unit.unit, 'SHOP', 'UNFLAGGED')),
    record('137', 'Sniper 137', 'SHOP', 'UNFLAGGED'),
    ...dnu.map((unit, index) => record(String(2000 + index), unit.unit, 'SHOP', 'DO_NOT_USE')),
    record('175', 'Sniper 175', 'SHOP', 'DO_NOT_USE'),
    record('318', 'Sniper 318', 'FIELD', 'DO_NOT_USE'),
    record('10', 'SS010', 'SHOP', 'UNFLAGGED'),
    record('58', 'SS058', 'SHOP', 'UNFLAGGED'),
    record('196', 'Spotter 196', 'SHOP', 'UNFLAGGED'),
    record('25', 'RII-025', 'SHOP', 'UNFLAGGED'),
  ];
  const bare = liveFeedShopRows(units, {uploadInventory: {records: []}});
  const bareReport = decideShopCameras(bare.inputs, SHOP_CAMERA_RULE);
  assert.equal(bare.mhelpCoverage, 'absent');
  assert.equal(bareReport.figures.doNotUse, 0);
  assert.equal(bareReport.byUnit.get('SNIPER 137').inShop, false);
  assert.equal(bareReport.byUnit.get('SNIPER 137').placement, 'SHOP');
  assert.equal(bareReport.byUnit.get('SNIPER 137').state, 'RED');
  const joined = liveFeedShopRows(units, {uploadInventory: {contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', records}});
  assert.equal(joined.mhelpCoverage, 'complete');
  assert.equal(joined.inputs.find(row => row.unit === 'Sniper 175').productId, '175');
  assert.equal(joined.inputs.every(row => row.productId), true);
  const report = decideShopCameras(joined.inputs, SHOP_CAMERA_RULE);
  assert.equal(report.figures.inShop, 323 + 4);
  assert.equal(report.figures.doNotUse, 56);
  assert.equal(report.figures.exceptions, 1);
  assert.equal(report.byUnit.get('SNIPER 318').category, 'exception');
  assert.equal(report.byUnit.get('SNIPER 318').counted.field, false);
  assert.equal(report.byUnit.get('SNIPER 137').category, 'inShop');
  assert.equal(report.byUnit.get('SNIPER 137').state, 'GREEN');
  assert.notEqual(report.byUnit.get('SNIPER 137').state, 'RED');
  assert.equal(report.byUnit.get('SNIPER 175').category, 'doNotUse');
  for (const unit of ['SS010', 'SS058', 'SPOTTER 196', 'RII-025']) {
    const row = report.byUnit.get(unit);
    assert.equal(row.category, 'inShop', unit);
    assert.equal(row.counted.field, false, unit);
    assert.equal(row.counted.armed, false, unit);
    assert.equal(row.counted.immix, false, unit);
  }
  assert.equal(report.byUnit.get('SS010').inShop, true);
  assert.equal(joined.inputs.find(row => row.unit === 'SS010').watchful.projectKey, configuredWatchfulTestProjectKey('Test 1'));
  assert.equal(joined.inputs.find(row => row.unit === 'SS058').watchful.projectKey, configuredWatchfulTestProjectKey('Helios Test Sites'));
  assert.equal(joined.inputs.find(row => row.unit === 'Spotter 196').watchful.projectKey, configuredWatchfulTestProjectKey('Spotter Test Site'));
  assert.equal(joined.inputs.find(row => row.unit === 'RII-025').watchful.projectKey, configuredWatchfulTestProjectKey('RII-025 Shop'));
  assert.equal(LIVE_CAMERA_FEED_HAS_WATCHFUL_PROJECT_UUID, false);
  assert.equal(joined.inputs.some(row => row.watchful?.projectKey === '283838'), false);
});

test('a partial mHelp match does not report DO NOT USE 0', () => {
  const units = [
    camera('Sniper 137', {placement: 'SHOP'}),
    camera('Sniper 175', {placement: 'SHOP'}),
    camera('Sniper 318'),
  ];
  const records = [record('137', 'Sniper 137', 'SHOP', 'UNFLAGGED')];
  const joined = liveFeedShopRows(units, {uploadInventory: {records}});
  assert.equal(joined.mhelpCoverage, 'partial');
  assert.equal(joined.matched, 1);
  const board = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, joined.inputs, joined.mhelpCoverage);
  assert.equal(board.shop.doNotUse, null);
  assert.equal(board.shop.exceptions, null);
  assert.equal(board.lines.find(line => line.label === 'Shop, DO NOT USE').text.includes('0'), false);
  assert.match(board.lines.find(line => line.label === 'Shop, DO NOT USE').text, /—/);
  assert.match(board.lines.find(line => line.label === 'Exceptions').text, /—/);
});

test('placementStatus fills mHelp placement and uploadLifecycle fills DO NOT USE', () => {
  const units = [camera('Sniper 175', {placement: 'SHOP', state: 'RED'})];
  const joined = liveFeedShopRows(units, {uploadInventory: {records: [{
    productId: '175', unitNumber: 'Sniper 175', sourceUnitNumber: 'Sniper 175', placementStatus: 'SHOP', uploadLifecycle: 'DO_NOT_USE',
  }]}});
  const input = joined.inputs[0];
  assert.equal(input.productId, '175');
  assert.equal(input.mhelpPlacement, 'SHOP');
  assert.equal(input.doNotUse, true);
  const row = decideShopCameras(joined.inputs).byUnit.get('SNIPER 175');
  assert.equal(row.category, 'doNotUse');
  assert.equal(row.inShop, false);
  assert.notEqual(row.state, 'GREEN');
});
