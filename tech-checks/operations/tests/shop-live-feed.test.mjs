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
    camera('RII-025', {site: 'RII-025 Shop', placement: 'FIELD', state: 'RED'}),
  ];
  const records = [
    ...shop.map((unit, index) => record(String(1000 + index), unit.unit, 'SHOP', 'UNFLAGGED')),
    record('137', 'Sniper 137', 'SHOP', 'UNFLAGGED'),
    ...dnu.map((unit, index) => record(String(2000 + index), unit.unit, 'SHOP', 'DO_NOT_USE')),
    record('175', 'Sniper 175', 'SHOP', 'DO_NOT_USE'),
    record('318', 'Sniper 318', 'FIELD', 'DO_NOT_USE'),
    record('10', 'SS010', 'FIELD', 'UNFLAGGED'),
    record('58', 'SS058', 'FIELD', 'UNFLAGGED'),
    record('196', 'Spotter 196', 'FIELD', 'UNFLAGGED'),
    record('25', 'RII-025', 'FIELD', 'UNFLAGGED'),
  ];
  const bare = liveFeedShopRows(units, {uploadInventory: {records: []}});
  const bareReport = decideShopCameras(bare.inputs, SHOP_CAMERA_RULE);
  assert.equal(bare.mhelpCoverage, 'absent');
  const bareBoard = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, bare.inputs, bare.mhelpCoverage);
  assert.equal(bareBoard.shop.inShop, null);
  assert.equal(bareBoard.shop.doNotUse, null);
  assert.equal(bareBoard.shop.exceptions, null);
  assert.equal(bareReport.byUnit.get('SNIPER 137').inShop, false);
  assert.equal(bareReport.byUnit.get('SNIPER 137').placement, 'SHOP');
  assert.equal(bareReport.byUnit.get('SNIPER 137').state, 'RED');
  const joined = liveFeedShopRows(units, {uploadInventory: {contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', records}});
  assert.equal(joined.mhelpCoverage, 'absent');
  assert.equal(joined.matched, 0);
  assert.equal(joined.inputs.every(row => row.productId == null && row.mhelpPlacement == null), true);
  const report = decideShopCameras(joined.inputs, SHOP_CAMERA_RULE);
  assert.equal(report.byUnit.get('SNIPER 318').category, 'field');
  assert.equal(report.byUnit.get('SNIPER 318').counted.field, true);
  assert.equal(report.byUnit.get('SNIPER 137').inShop, false);
  assert.equal(report.byUnit.get('SNIPER 175').category, 'field');
  for (const unit of ['SS010', 'SS058', 'SPOTTER 196', 'RII-025']) {
    const row = report.byUnit.get(unit);
    assert.equal(row.category, 'field', unit);
    assert.equal(row.inShop, false, unit);
    assert.equal(row.counted.field, true, unit);
  }
  assert.equal(joined.inputs.find(row => row.unit === 'SS010').watchful?.projectKey ?? null, null);
  assert.equal(LIVE_CAMERA_FEED_HAS_WATCHFUL_PROJECT_UUID, false);
  assert.equal(joined.inputs.some(row => row.watchful?.projectKey === '283838'), false);
  const board = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, joined.inputs, joined.mhelpCoverage);
  assert.equal(board.shop.inShop, null);
  assert.equal(board.shop.doNotUse, null);
  assert.equal(board.shop.exceptions, null);
  assert.match(board.lines.find(line => line.label === 'Shop, DO NOT USE').text, /—/);
  assert.equal(board.lines.find(line => line.label === 'Shop, DO NOT USE').text.includes('0'), false);
  assert.equal(board.shop.testSites, null);
  assert.equal(board.lines.find(line => line.label === 'Test sites').text, 'Test sites · not available');
  assert.equal(board.lines.find(line => line.label === 'Test sites').text.includes('0'), false);
});

test('a site or organization label is not a test site without the Watchful project id', () => {
  const labels = ['Test 1', 'Helios Test Sites', 'Spotter Test Site', 'RII-025 Shop'];
  const units = labels.map((site, index) => camera('Label only ' + (index + 1), {site, organization: site, placement: 'FIELD', state: 'RED'}));
  const withId = camera('Id only 1', {site: 'Synthetic yard', watchfulProjectKey: configuredWatchfulTestProjectKey('Test 1')});
  const unlabeled = liveFeedShopRows(units, {uploadInventory: {records: []}});
  const unlabeledReport = decideShopCameras(unlabeled.inputs, SHOP_CAMERA_RULE);
  assert.equal(unlabeledReport.figures.inShop, 0);
  assert.equal(unlabeledReport.figures.field, units.length);
  for (const row of unlabeledReport.decisions) {
    assert.equal(row.inShop, false);
    assert.equal(row.counted.field, true);
    assert.equal(row.flag, null);
  }
  const unlabeledBoard = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, unlabeled.inputs);
  assert.equal(unlabeledBoard.shop.testSites, null);
  assert.match(unlabeledBoard.lines.find(line => line.label === 'Test sites').text, /not available/);
  assert.equal(unlabeledBoard.lines.find(line => line.label === 'Test sites').text.includes('0'), false);
  const identified = liveFeedShopRows([withId, ...units], {uploadInventory: {records: []}});
  const identifiedReport = decideShopCameras(identified.inputs, SHOP_CAMERA_RULE);
  assert.equal(identifiedReport.byUnit.get('ID ONLY 1').inShop, true);
  assert.equal(identifiedReport.byUnit.get('ID ONLY 1').counted.field, false);
  assert.equal(identifiedReport.figures.field, units.length);
  const identifiedBoard = cameraStatusBoard([withId, ...units], SHOP_CAMERA_RULE, {units: null, cameras: null}, identified.inputs);
  assert.equal(identifiedBoard.shop.testSites, null);
  const everyId = liveFeedShopRows([
    camera('Counted 1', {site: 'Synthetic yard', watchfulProjectKey: configuredWatchfulTestProjectKey('Test 1')}),
    camera('Counted 2', {site: 'Test 1', watchfulProjectKey: '00000000-0000-4000-8000-000000000099'}),
  ], {uploadInventory: {records: []}});
  const everyBoard = cameraStatusBoard(everyId.inputs, SHOP_CAMERA_RULE, {units: null, cameras: null}, everyId.inputs);
  assert.equal(everyBoard.shop.testSites, 1);
  assert.equal(everyBoard.lines.find(line => line.label === 'Test sites').text, 'Test sites · 1');
  assert.equal(decideShopCameras(everyId.inputs).byUnit.get('COUNTED 2').inShop, false);
  assert.equal(decideShopCameras(everyId.inputs).byUnit.get('COUNTED 2').counted.field, true);
});

test('a partial product-id key does not report In shop, DO NOT USE, or Exceptions as a number', () => {
  const units = [
    camera('HELIOS 001', {productId: '137'}),
    camera('SOLARSPOTTER 010'),
    camera('SPOTTER 196'),
  ];
  const records = [record('137', 'Helios 001', 'SHOP', 'UNFLAGGED')];
  const joined = liveFeedShopRows(units, {uploadInventory: {records}});
  assert.equal(joined.mhelpCoverage, 'partial');
  assert.equal(joined.matched, 1);
  assert.equal(joined.inputs.find(row => row.unit === 'SOLARSPOTTER 010').mhelpPlacement, null);
  const board = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, joined.inputs, joined.mhelpCoverage);
  assert.equal(board.shop.inShop, null);
  assert.equal(board.shop.doNotUse, null);
  assert.equal(board.shop.exceptions, null);
  assert.equal(board.lines.find(line => line.label === 'Shop, DO NOT USE').text.includes('0'), false);
  assert.match(board.lines.find(line => line.label === 'Shop, DO NOT USE').text, /—/);
  assert.match(board.lines.find(line => line.label === 'Exceptions').text, /—/);
});

test('mixed-case names and a DO NOT USE suffix do not produce a confident mHelp count', () => {
  const units = [
    camera('HELIOS 001'),
    camera('SOLARSPOTTER 010'),
    camera('SPOTTER 196'),
    camera('Sniper 318'),
  ];
  const records = [
    record('11', 'Helios 001', 'SHOP', 'UNFLAGGED'),
    record('12', 'Solar Spotter 010', 'SHOP', 'UNFLAGGED'),
    record('13', 'Spotter 196HDC2', 'SHOP', 'UNFLAGGED'),
    record('14', 'Sniper 318 - DO NOT USE', 'SHOP', 'DO_NOT_USE'),
  ];
  const named = liveFeedShopRows(units, {uploadInventory: {records}});
  assert.equal(named.mhelpCoverage, 'absent');
  assert.equal(named.inputs.every(row => row.productId == null && row.mhelpPlacement == null && row.doNotUse == null), true);
  const board = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, named.inputs, named.mhelpCoverage);
  assert.equal(board.shop.inShop, null);
  assert.equal(board.shop.doNotUse, null);
  assert.equal(board.shop.exceptions, null);
  assert.match(board.lines.find(line => line.label === 'Shop, DO NOT USE').text, /—/);
  assert.equal(board.lines.find(line => line.label === 'Shop, DO NOT USE').text.includes('0'), false);
  assert.match(board.lines.find(line => line.label === 'Exceptions').text, /—/);
  assert.equal(board.lines.find(line => line.label === 'Exceptions').text.includes('0'), false);
  const none = liveFeedShopRows(units, {uploadInventory: {records: []}});
  const noneBoard = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, none.inputs, none.mhelpCoverage);
  assert.equal(none.mhelpCoverage, 'absent');
  assert.equal(noneBoard.shop.inShop, null);
  assert.equal(noneBoard.shop.doNotUse, null);
  const keyedUnits = units.map((unit, index) => ({...unit, productId: String(11 + index)}));
  const keyed = liveFeedShopRows(keyedUnits, {uploadInventory: {records}});
  assert.equal(keyed.mhelpCoverage, 'complete');
  assert.equal(keyed.inputs.find(row => row.unit === 'Sniper 318').mhelpPlacement, 'SHOP');
  assert.equal(keyed.inputs.find(row => row.unit === 'Sniper 318').doNotUse, true);
  const keyedBoard = cameraStatusBoard(keyedUnits, SHOP_CAMERA_RULE, {units: null, cameras: null}, keyed.inputs, keyed.mhelpCoverage);
  assert.equal(keyedBoard.shop.inShop, 3);
  assert.equal(keyedBoard.shop.doNotUse, 1);
  assert.equal(keyedBoard.shop.exceptions, 0);
});

test('placementStatus fills mHelp placement from the product id, not the unit name', () => {
  const units = [camera('HELIOS 001', {placement: 'FIELD', state: 'RED', productId: '175'})];
  const joined = liveFeedShopRows(units, {uploadInventory: {records: [{
    productId: '175', unitNumber: 'Sniper 175 - DO NOT USE', sourceUnitNumber: 'Sniper 175 - DO NOT USE', placementStatus: 'SHOP', uploadLifecycle: 'DO_NOT_USE',
  }]}});
  const input = joined.inputs[0];
  assert.equal(input.productId, '175');
  assert.equal(input.mhelpPlacement, 'SHOP');
  assert.equal(input.doNotUse, true);
  const row = decideShopCameras(joined.inputs).byUnit.get('HELIOS 001');
  assert.equal(row.category, 'doNotUse');
  assert.equal(row.inShop, false);
  assert.notEqual(row.state, 'GREEN');
  const board = cameraStatusBoard(units, SHOP_CAMERA_RULE, {units: null, cameras: null}, joined.inputs, joined.mhelpCoverage);
  assert.equal(board.shop.inShop, 0);
  assert.equal(board.shop.doNotUse, 1);
});
