import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {countUnits} from '../shared/starUnitStatus.ts';
import {
  SHOP_CAMERA_RULE, SHOP_CAMERA_PLACE_LABEL, SHOP_CAMERA_ONLINE_LABEL, MHELP_TEST_SITE_FLAG,
  SHOP_CAMERA_RULE_PROVENANCE, decideShopCameras, decideShopCamera, rollbackShopCameraRule,
  isWatchfulTestProject, cameraMhelpPlacements, shopCameraInput, applyShopCameraView,
  inShopLabel, shopDoNotUseLine, exceptionLine,
} from '../shared/shopCameraStatus.ts';

const rule = SHOP_CAMERA_RULE;
const customer = (over = {}) => ({
  unit: 'SPOTTER 880', placement: 'FIELD', state: 'RED', site: 'Fixture Yard',
  mhelpPlacement: 'FIELD', watchful: {projectName: 'Fixture Yard', archived: false, armed: true, immix: true},
  ...over,
});
const shopUnit = (over = {}) => ({
  unit: 'CAMV 090', placement: 'FIELD', state: 'RED', site: 'Fixture Yard',
  mhelpPlacement: 'SHOP', watchful: {projectName: 'Fixture Yard', archived: false, armed: true, immix: true},
  ...over,
});
const warehouseUnit = () => shopUnit({unit: 'CAMV 091', mhelpPlacement: 'WAREHOUSE', state: 'UNKNOWN'});
const testSite = (over = {}) => ({
  unit: 'SS010', placement: 'FIELD', state: 'UNKNOWN', site: 'Test 1',
  mhelpPlacement: null, watchful: {projectName: 'Test 1', archived: false, armed: true, immix: true},
  ...over,
});
const flagged = (over = {}) => testSite({
  unit: 'SNIPER 015', state: 'RED', mhelpPlacement: 'FIELD',
  watchful: {projectName: 'test 1', archived: false, armed: true, immix: true},
  ...over,
});

test('shop and warehouse units show ONLINE In shop in their own count', () => {
  const report = decideShopCameras([customer(), shopUnit(), warehouseUnit()], rule);
  for (const unit of ['CAMV 090', 'CAMV 091']) {
    const row = report.byUnit.get(unit);
    assert.equal(row.inShop, true);
    assert.equal(row.statusLabel, SHOP_CAMERA_ONLINE_LABEL);
    assert.equal(row.placeLabel, SHOP_CAMERA_PLACE_LABEL);
    assert.equal(row.state, 'GREEN');
    assert.equal(row.placement, 'SHOP');
    assert.notEqual(row.telemetryState, 'GREEN');
    assert.equal(row.counted.field, false);
    assert.equal(row.counted.armed, false);
    assert.equal(row.counted.immix, false);
  }
  assert.equal(report.figures.inShop, 2);
  assert.equal(report.figures.field, 1);
  assert.equal(report.figures.fieldRed, 1);
  assert.equal(report.figures.armed, 1);
  assert.equal(report.figures.immix, 1);
});

test('a Watchful test-site unit shows ONLINE In shop and stays out of field, armed, and Immix', () => {
  const before = decideShopCameras([customer()], rule);
  const after = decideShopCameras([customer(), testSite()], rule);
  const row = after.byUnit.get('SS010');
  assert.equal(row.inShop, true);
  assert.equal(row.statusLabel, 'ONLINE');
  assert.equal(row.placeLabel, 'In shop');
  assert.equal(row.state, 'GREEN');
  assert.equal(row.telemetryState, 'UNKNOWN');
  assert.equal(row.counted.field, false);
  assert.equal(row.counted.armed, false);
  assert.equal(row.counted.immix, false);
  assert.equal(after.figures.field, before.figures.field);
  assert.equal(after.figures.fieldRed, before.figures.fieldRed);
  assert.equal(after.figures.fieldGreen, before.figures.fieldGreen);
  assert.equal(after.figures.armed, before.figures.armed);
  assert.equal(after.figures.immix, before.figures.immix);
  assert.equal(after.figures.inShop, before.figures.inShop + 1);
  const viewed = applyShopCameraView([{unit: 'SS010', placement: 'FIELD', state: 'UNKNOWN', online: 0, offline: 0, unknown: 1}], after);
  assert.equal(countUnits(viewed).field.units, 0);
  assert.equal(countUnits(viewed).shop.units, 1);
});

test('field totals for a customer unit stay on the Watchful mirror', () => {
  const alone = decideShopCamera(customer(), rule);
  const beside = decideShopCameras([customer(), shopUnit(), testSite(), flagged()], rule).byUnit.get('SPOTTER 880');
  assert.deepEqual(beside, alone);
  assert.equal(beside.state, 'RED');
  assert.equal(beside.placement, 'FIELD');
  assert.equal(beside.statusLabel, null);
  assert.equal(beside.counted.field, true);
  assert.equal(beside.counted.armed, true);
  assert.equal(beside.counted.immix, true);
});

test('mHelp Field on a Watchful test project stays Field and is flagged', () => {
  const row = decideShopCamera(flagged(), rule);
  assert.equal(row.inShop, false);
  assert.equal(row.placement, 'FIELD');
  assert.equal(row.state, 'RED');
  assert.equal(row.flag, MHELP_TEST_SITE_FLAG);
  assert.equal(row.counted.field, true);
  assert.equal(row.counted.inShop, false);
  assert.equal(row.statusLabel, null);
});

test('test-project matching is case-insensitive and does not guess other names', () => {
  assert.equal(isWatchfulTestProject('Test 1', rule), true);
  assert.equal(isWatchfulTestProject('TEST 1', rule), true);
  assert.equal(isWatchfulTestProject('  test 1  ', rule), true);
  assert.equal(isWatchfulTestProject('Test 2', rule), true);
  assert.equal(isWatchfulTestProject('test   12', rule), true);
  for (const name of ['Fixture Yard', 'Latest', 'Contest 1', 'Testing', 'Test', '']) {
    assert.equal(isWatchfulTestProject(name, rule), false, name);
  }
  const upper = decideShopCamera(testSite({watchful: {projectName: 'TeSt 1', archived: false}}), rule);
  assert.equal(upper.inShop, true);
  const missed = decideShopCamera(testSite({site: 'Testing', watchful: {projectName: 'Testing', archived: false}}), rule);
  assert.equal(missed.inShop, false);
  assert.equal(missed.placement, 'FIELD');
});

test('an archived Watchful project counts as not in Watchful', () => {
  const archived = testSite({watchful: {projectName: 'Test 1', archived: true, armed: true, immix: true}});
  const row = decideShopCamera(archived, rule);
  assert.equal(row.inWatchful, false);
  assert.equal(row.inShop, false);
  assert.equal(row.flag, null);
  assert.equal(row.placement, 'FIELD');
  assert.equal(row.counted.armed, false);
  assert.equal(row.counted.immix, false);
  const listed = decideShopCamera(testSite({watchful: null, site: 'Test 1'}), {...rule, archivedProjectNames: ['test 1']});
  assert.equal(listed.inWatchful, false);
  assert.equal(listed.inShop, false);
});

test('rule-off control leaves shop and test-site units on the mirror', () => {
  const inputs = [customer(), shopUnit(), warehouseUnit(), testSite(), flagged()];
  const off = decideShopCameras(inputs, {...rule, enabled: false});
  assert.equal(off.figures.inShop, 0);
  assert.equal(off.decisions.every(row => row.flag === null && row.statusLabel === null), true);
  assert.equal(off.byUnit.get('CAMV 090').placement, 'FIELD');
  assert.equal(off.byUnit.get('CAMV 090').state, 'RED');
  assert.equal(off.byUnit.get('SS010').state, 'UNKNOWN');
  assert.equal(off.byUnit.get('SS010').counted.field, true);
  assert.equal(off.figures.field, inputs.length);
});

test('rollback restores the Watchful mirror for the same units', () => {
  const inputs = [customer(), shopUnit(), testSite(), flagged(), testSite({unit: 'SS011', watchful: {projectName: 'Test 1', archived: true}})];
  const rolled = rollbackShopCameraRule(rule);
  assert.equal(rolled.enabled, false);
  assert.equal(SHOP_CAMERA_RULE_PROVENANCE.includes('ONLINE In shop'), true);
  const afterRollback = decideShopCameras(inputs, rolled);
  const mirror = decideShopCameras(inputs, {...rule, enabled: false});
  assert.deepEqual(afterRollback.decisions, mirror.decisions);
  assert.deepEqual(afterRollback.figures, mirror.figures);
  assert.notDeepEqual(decideShopCameras(inputs, rule).figures, afterRollback.figures);
});

test('mHelp placement is read from Shop, Warehouse, and Field without guessing', () => {
  const placements = cameraMhelpPlacements([
    {unitNumber: 'SS010', placement: 'warehouse'},
    {unitNumber: 'CAMV 090', placement: 'Shop'},
    {unitNumber: 'SNIPER 015', placement: 'field'},
    {unitNumber: 'SPOTTER 880', placement: 'yard'},
  ]);
  assert.equal(placements.get('SS010'), 'WAREHOUSE');
  assert.equal(placements.get('CAMV 090'), 'SHOP');
  assert.equal(placements.get('SNIPER 015'), 'FIELD');
  assert.equal(placements.has('SPOTTER 880'), false);
  const fromMap = shopCameraInput({unit: 'SS010', placement: 'FIELD', state: 'RED', site: 'Fixture Yard'}, placements);
  assert.equal(decideShopCamera(fromMap, rule).inShop, true);
  assert.equal(decideShopCamera(fromMap, rule).telemetryState, 'RED');
});

test('an In shop unit is not Offline, red, or Unknown on the camera status view counts', () => {
  const inputs = [shopUnit({state: 'RED'}), shopUnit({unit: 'CAMV 092', state: 'UNKNOWN'}), testSite({state: 'YELLOW'})];
  const report = decideShopCameras(inputs, rule);
  assert.equal(report.decisions.every(row => row.state === 'GREEN' && row.statusLabel === 'ONLINE'), true);
  assert.equal(report.figures.fieldRed, 0);
  assert.equal(report.figures.fieldUnknown, 0);
  assert.equal(report.figures.fieldYellow, 0);
  const viewed = applyShopCameraView(inputs.map(row => ({...row, onlineInShop: false})), report);
  const counts = countUnits(viewed);
  assert.equal(counts.field.red + counts.field.yellow + counts.field.unknown, 0);
  assert.equal(counts.shop.units, 3);
});

test('the camera status main view does not add an IP field or a job or inventory card', () => {
  const source = readFileSync(new URL('../src/FleetCameraStatus.tsx', import.meta.url), 'utf8');
  assert.match(source, /Camera monitoring figures/);
  assert.match(source, /inShopLabel/);
  assert.match(source, /shopDoNotUseLine/);
  assert.match(source, /exceptionLine/);
  assert.match(source, /SHOP_CAMERA_ONLINE_LABEL/);
  assert.doesNotMatch(source, /unit\.publicIp\?unit\.publicIp/);
  assert.doesNotMatch(source, /Find a unit, site or IP/);
  assert.doesNotMatch(source, /job-card|inventory-card|Work order/);
  const css = readFileSync(new URL('../src/fleetCameraStatus.css', import.meta.url), 'utf8');
  assert.match(css, /\.cos-camera-monitor-figures\{display:flex/);
  assert.match(css, /\.cos-camera-category-line\{margin:0/);
  assert.doesNotMatch(css, /job-card|inventory-card/);
});

test('this change does not touch the live board pin or the 401 and 403 gates', () => {
  const repo = fileURLToPath(new URL('../../..', import.meta.url));
  const boardPath = 'tech-checks/supabase/functions/cos-operations-pages/savedFleetBoard.mjs';
  const head = execFileSync('git', ['rev-parse', 'HEAD:' + boardPath], {cwd: repo, encoding: 'utf8'}).trim();
  const work = execFileSync('git', ['hash-object', boardPath], {cwd: repo, encoding: 'utf8'}).trim();
  assert.equal(work, head);
  const pin = readFileSync(new URL('./business-screens-410.test.mjs', import.meta.url), 'utf8');
  assert.match(pin, /f93b82b3c9aee80bb7921617fb1cca50ad72758dcd0a86d29e578cc796f2957a/);
  const handler = readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts', import.meta.url), 'utf8');
  assert.match(handler, /Sign in to Tech Check to continue\.', 401\)/);
  assert.match(handler, /An active COS account is required\.', 403\)/);
  const shop = readFileSync(new URL('../shared/shopCameraStatus.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(shop, /savedFleetBoard|fail\(|status:\s*401|status:\s*403/);
});

const splitLists = {
  ...rule,
  doNotUseUnits: ['CAMV 090', 'RSU 200'],
  exceptionUnits: ['HELIOS 404'],
  unitTags: {SS010: ['RSU', 'no telemetry'], 'CAMV 090': ['RSU']},
};

test('an In shop unit shows ONLINE, its own count, and tags beside the In shop label', () => {
  const report = decideShopCameras([
    customer(),
    testSite({tags: ['RSU', 'no telemetry']}),
    shopUnit({unit: 'CAMV 092', state: 'RED', tags: ['no telemetry']}),
  ], rule);
  const site = report.byUnit.get('SS010');
  const shop = report.byUnit.get('CAMV 092');
  assert.equal(site.category, 'inShop');
  assert.equal(site.statusLabel, 'ONLINE');
  assert.equal(site.state, 'GREEN');
  assert.equal(inShopLabel(site.tags), 'In shop · no telemetry · RSU');
  assert.equal(inShopLabel(shop.tags), 'In shop · no telemetry');
  assert.equal(report.figures.inShop, 2);
  assert.equal(report.figures.field, 1);
  assert.equal(report.figures.doNotUse, 0);
  assert.equal(report.figures.exceptions, 0);
  assert.doesNotMatch(inShopLabel(site.tags), /Offline|Unknown|red/i);
});

test('Shop, DO NOT USE is its own line, not online, and outside the In shop count', () => {
  const report = decideShopCameras([
    shopUnit({state: 'GREEN'}),
    warehouseUnit(),
    customer(),
  ], splitLists);
  const held = report.byUnit.get('CAMV 090');
  assert.equal(held.category, 'doNotUse');
  assert.equal(held.inShop, false);
  assert.equal(held.statusLabel, null);
  assert.notEqual(held.state, 'GREEN');
  assert.equal(held.telemetryState, 'GREEN');
  assert.equal(held.counted.inShop, false);
  assert.equal(held.counted.field, false);
  assert.equal(held.counted.armed, false);
  assert.equal(held.counted.immix, false);
  assert.equal(report.figures.doNotUse, 1);
  assert.equal(report.figures.inShop, 1);
  const line = shopDoNotUseLine(report.decisions.filter(row => row.category === 'doNotUse').map(row => row.unit));
  assert.match(line, /^Shop, DO NOT USE · 1 · CAMV 090\. Not online\./);
  assert.doesNotMatch(line, /ONLINE/);
  const viewed = applyShopCameraView([
    {unit: 'CAMV 090', placement: 'FIELD', state: 'GREEN'},
    {unit: 'CAMV 091', placement: 'FIELD', state: 'UNKNOWN'},
    {unit: 'SPOTTER 880', placement: 'FIELD', state: 'RED'},
  ], report);
  assert.deepEqual(viewed.map(row => row.unit), ['CAMV 091', 'SPOTTER 880']);
  assert.equal(countUnits(viewed).shop.units, 1);
  assert.equal(countUnits(viewed).field.units, 1);
});

test('a DO NOT USE unit mHelp places Field is an exception and is out of every total', () => {
  const report = decideShopCameras([
    customer(),
    testSite(),
    shopUnit(),
    flagged({unit: 'RSU 200'}),
    {unit: 'HELIOS 404', placement: 'FIELD', state: 'GREEN', site: 'Fixture Yard', mhelpPlacement: 'FIELD', watchful: {projectName: 'Fixture Yard', archived: false, armed: true, immix: true}},
  ], splitLists);
  const fromField = report.byUnit.get('RSU 200');
  const listed = report.byUnit.get('HELIOS 404');
  for (const row of [fromField, listed]) {
    assert.equal(row.category, 'exception');
    assert.equal(row.statusLabel, null);
    assert.equal(row.inShop, false);
    assert.deepEqual(row.counted, {field: false, armed: false, immix: false, inShop: false, doNotUse: false, exception: true});
  }
  assert.equal(report.figures.exceptions, 2);
  assert.equal(report.figures.field, 1);
  assert.equal(report.figures.inShop, 1);
  assert.equal(report.figures.doNotUse, 1);
  assert.equal(report.figures.armed, 1);
  assert.equal(report.figures.immix, 1);
  const line = exceptionLine(['RSU 200', 'HELIOS 404']);
  assert.equal(line, 'Exceptions · 2 · RSU 200, HELIOS 404. Not in any total.');
  const viewed = applyShopCameraView(report.decisions.map(row => ({unit: row.unit, placement: row.placement, state: row.state})), report);
  assert.equal(viewed.some(row => row.unit === 'RSU 200' || row.unit === 'HELIOS 404' || row.unit === 'CAMV 090'), false);
});

test('a unit record marked DO NOT USE follows the same lines without a coded name list', () => {
  const shopRecord = shopCameraInput({unit: 'CAMV 093', placement: 'SHOP', state: 'GREEN', site: null, lifecycle: 'DO_NOT_USE', mhelpPlacement: 'SHOP'});
  const shopLine = decideShopCamera(shopRecord, rule);
  assert.equal(shopLine.category, 'doNotUse');
  assert.equal(shopLine.statusLabel, null);
  assert.equal(shopLine.counted.inShop, false);
  const fieldRecord = shopCameraInput({unit: 'CAMV 094', placement: 'FIELD', state: 'RED', site: 'Fixture Yard', lifecycle: 'DO NOT USE', mhelpPlacement: 'FIELD', tags: ['RSU']});
  const exception = decideShopCamera(fieldRecord, rule);
  assert.equal(exception.category, 'exception');
  assert.equal(exception.counted.field, false);
  assert.equal(exception.counted.inShop, false);
  assert.equal(exception.counted.doNotUse, false);
  assert.equal(exception.counted.armed, false);
  assert.equal(exception.counted.immix, false);
  assert.equal(exception.statusLabel, null);
  assert.equal(exception.placeLabel, null);
});

test('shortening the lists moves units off those lines without a different rule', () => {
  const full = decideShopCameras([
    shopUnit(),
    testSite(),
    flagged({unit: 'RSU 200'}),
  ], splitLists);
  const shorter = {
    ...splitLists,
    doNotUseUnits: [],
    exceptionUnits: [],
    unitTags: {SS010: ['RSU']},
  };
  const shrunk = decideShopCameras([
    shopUnit(),
    testSite(),
    flagged({unit: 'RSU 200'}),
  ], shorter);
  assert.equal(full.byUnit.get('CAMV 090').category, 'doNotUse');
  assert.equal(full.byUnit.get('RSU 200').category, 'exception');
  assert.equal(inShopLabel(full.byUnit.get('SS010').tags), 'In shop · no telemetry · RSU');
  assert.equal(shrunk.byUnit.get('CAMV 090').category, 'inShop');
  assert.equal(shrunk.byUnit.get('CAMV 090').statusLabel, 'ONLINE');
  assert.equal(shrunk.byUnit.get('RSU 200').category, 'field');
  assert.equal(shrunk.byUnit.get('RSU 200').flag, 'mHelp Field disagrees with Watchful test site');
  assert.equal(shrunk.byUnit.get('RSU 200').counted.field, true);
  assert.equal(inShopLabel(shrunk.byUnit.get('SS010').tags), 'In shop · RSU');
  assert.equal(shrunk.figures.doNotUse, 0);
  assert.equal(shrunk.figures.exceptions, 0);
  assert.equal(shrunk.figures.inShop, 2);
  assert.deepEqual(rule.doNotUseUnits, []);
  assert.deepEqual(rule.exceptionUnits, []);
  assert.deepEqual(rule.unitTags, {});
});
