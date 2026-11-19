import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {countUnits} from '../shared/starUnitStatus.ts';
import {shopCameraCensusFixture} from './fixtures/shop-camera-census.mjs';
import {
  SHOP_CAMERA_RULE, SHOP_CAMERA_PLACE_LABEL, SHOP_CAMERA_ONLINE_LABEL, MHELP_TEST_SITE_FLAG,
  SHOP_CAMERA_RULE_PROVENANCE, decideShopCameras, decideShopCamera, rollbackShopCameraRule,
  isWatchfulTestProjectKey, configuredWatchfulTestProjectKey, missingWatchfulTestProjectIds,
  cameraMhelpPlacements, shopCameraInput, applyShopCameraView,
  inShopLabel, shopDoNotUseLine, exceptionLine, watchfulTestSiteNameWarning,
  validateWatchfulTestProjects, cameraStatusBoard, productIdForDevices,
} from '../shared/shopCameraStatus.ts';
import CameraStatusBoardView from '../src/CameraStatusBoardView.tsx';
import {projectUnitCameraStatus} from '../shared/starUnitStatus.ts';
import {GROUPS, groupedUnits} from '../src/cameraStatusFilters.ts';

const rule = SHOP_CAMERA_RULE;
const TEST1 = configuredWatchfulTestProjectKey('Test 1');
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
const testProject = (key, name, over = {}) => ({projectKey: key, projectName: name, archived: false, armed: true, immix: true, ...over});
const testSite = (over = {}) => ({
  unit: 'SS010', placement: 'FIELD', state: 'UNKNOWN', site: 'Test 1',
  mhelpPlacement: null, watchful: testProject(TEST1, 'Test 1'),
  ...over,
});
const flagged = (over = {}) => testSite({
  unit: 'SNIPER 015', state: 'RED', mhelpPlacement: 'FIELD',
  watchful: testProject(TEST1, 'Test 1'),
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

test('a test site matches only its project key, and a lookalike name is a warning', () => {
  assert.equal(isWatchfulTestProjectKey(TEST1, rule), true);
  assert.equal(isWatchfulTestProjectKey('Test 1', rule), false);
  assert.equal(isWatchfulTestProjectKey('TEST 1', rule), false);
  assert.equal(isWatchfulTestProjectKey('Test 2', rule), false);
  assert.equal(isWatchfulTestProjectKey('test   12', rule), false);
  assert.notEqual(TEST1, TEST1.toUpperCase());
  assert.equal(isWatchfulTestProjectKey(TEST1.toUpperCase(), rule), false);
  const byKey = decideShopCamera(testSite({watchful: testProject(TEST1, 'TeSt 1')}), rule);
  assert.equal(byKey.inShop, true);
  assert.deepEqual(byKey.warnings, []);
  const byName = decideShopCamera(testSite({
    watchful: {projectKey: 'unknown-watchful-project', projectName: 'Test 1', archived: false},
  }), rule);
  assert.equal(byName.inShop, false);
  assert.equal(byName.placement, 'FIELD');
  assert.equal(byName.flag, null);
  assert.deepEqual(byName.warnings, [watchfulTestSiteNameWarning('Test 1')]);
  const quiet = decideShopCamera(testSite({site: 'Testing', watchful: {projectKey: null, projectName: 'Testing', archived: false}}), rule);
  assert.equal(quiet.inShop, false);
  assert.deepEqual(quiet.warnings, []);
});

test('an archived Watchful project counts as not in Watchful', () => {
  const archived = testSite({watchful: testProject(TEST1, 'Test 1', {archived: true})});
  const row = decideShopCamera(archived, rule);
  assert.equal(row.inWatchful, false);
  assert.equal(row.inShop, false);
  assert.equal(row.flag, null);
  assert.equal(row.placement, 'FIELD');
  assert.equal(row.counted.armed, false);
  assert.equal(row.counted.immix, false);
  const listed = decideShopCamera(testSite(), {...rule, archivedProjectKeys: [TEST1]});
  assert.equal(listed.inWatchful, false);
  assert.equal(listed.inShop, false);
  assert.deepEqual(listed.warnings, []);
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
  const inputs = [customer(), shopUnit(), testSite(), flagged(), testSite({unit: 'SS011', watchful: testProject(TEST1, 'Test 1', {archived: true})})];
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
  // Rule change, Felix review of #458 at 808d6ba3.
  // Old assertion: a unit name was the key, so placements.get('SS010') === 'WAREHOUSE'.
  // New assertion: the name is not a key. Product id is the key.
  // placementStatus is used when placement is empty. There is no mHelp serial field.
  const placements = cameraMhelpPlacements([
    {unitNumber: 'SS010', productId: '1001', placement: 'warehouse'},
    {unitNumber: 'CAMV 090', productId: '1002', placementStatus: 'Shop'},
    {unitNumber: 'SNIPER 015', productId: '1003', placement: 'field'},
    {unitNumber: 'SPOTTER 880', placement: 'yard'},
    {unitNumber: 'Spotter 196 HD', productId: '196', placement: 'SHOP'},
  ]);
  assert.equal(placements.byProductId.has('SS010'), false);
  assert.equal(placements.byProductId.get('1001').placement, 'WAREHOUSE');
  assert.equal(placements.byProductId.get('1002').placement, 'SHOP');
  assert.equal(placements.byProductId.get('1003').placement, 'FIELD');
  assert.equal(placements.byProductId.has('SPOTTER 880'), false);
  const byProduct = shopCameraInput({unit: 'SS010', placement: 'FIELD', state: 'RED', site: 'Fixture Yard', productId: '1001'}, placements);
  assert.equal(byProduct.mhelpPlacement, 'WAREHOUSE');
  assert.equal(decideShopCamera(byProduct, rule).inShop, true);
  const byName = shopCameraInput({unit: 'SS010', placement: 'FIELD', state: 'RED', site: 'Fixture Yard'}, placements);
  assert.equal(byName.mhelpPlacement, null);
  const productWins = shopCameraInput({unit: 'Spotter 196 HD', placement: 'FIELD', state: 'UNKNOWN', productId: '196'}, placements);
  assert.equal(productWins.mhelpPlacement, 'SHOP');
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
  const source = readFileSync(new URL('../src/FleetCameraStatus.tsx', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/CameraStatusBoardView.tsx', import.meta.url), 'utf8')
    + readFileSync(new URL('../shared/shopCameraStatus.ts', import.meta.url), 'utf8');
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
  // Rule change, Felix review of #458 at 808d6ba3. Old flag text had no comma.
  // Old: 'mHelp Field disagrees with Watchful test site'
  // New: 'mHelp Field, disagrees with Watchful test site'
  assert.notEqual('mHelp Field disagrees with Watchful test site', 'mHelp Field, disagrees with Watchful test site');
  assert.equal(shrunk.byUnit.get('RSU 200').flag, 'mHelp Field, disagrees with Watchful test site');
  assert.equal(shrunk.byUnit.get('RSU 200').counted.field, true);
  assert.equal(inShopLabel(shrunk.byUnit.get('SS010').tags), 'In shop · RSU');
  assert.equal(shrunk.figures.doNotUse, 0);
  assert.equal(shrunk.figures.exceptions, 0);
  assert.equal(shrunk.figures.inShop, 2);
  assert.deepEqual(rule.doNotUseUnits, []);
  assert.deepEqual(rule.exceptionUnits, []);
  assert.deepEqual(rule.unitTags, {});
});

test('the Watchful test-project file uses the reviewed project ids', () => {
  assert.deepEqual(missingWatchfulTestProjectIds(), []);
  assert.equal(configuredWatchfulTestProjectKey('Test 1'), 'af1cb626-711e-47a9-8da4-2b2ff6ed4ef1');
  assert.equal(configuredWatchfulTestProjectKey('Helios Test Sites'), 'b1666d31-0998-4081-be61-f710c0f0f527');
  assert.equal(configuredWatchfulTestProjectKey('RII-025 Shop'), '3cab6752-e5ca-4be1-bf59-e5830142c53d');
  assert.equal(configuredWatchfulTestProjectKey('Solar Spotter Test'), '34f316c0-5ab5-4c57-8615-3f6c5fcbe4a2');
  assert.equal(configuredWatchfulTestProjectKey('Spotter Test Site'), 'aed522ac-9d63-4b7b-869d-318fbf2ce588');
  assert.equal(configuredWatchfulTestProjectKey('Sniper Test Site'), '2e8ae5be-3a9a-4a45-887a-505d3facd832');
  const file = JSON.parse(readFileSync(new URL('../shared/watchful-test-projects.json', import.meta.url), 'utf8'));
  assert.equal(file.projects.every(project => project.idStatus === 'known' && !Object.hasOwn(project, 'placeholderKey')), true);
  assert.match(file.archived, /inferred, not confirmed/);
  const source = readFileSync(new URL('../shared/shopCameraStatus.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /testProjectPattern|test\\s\+\\d\+|testProjectNames/);
});

test('mHelp Shop status alone puts a unit In shop', () => {
  const row = decideShopCamera(shopUnit({
    watchful: {projectKey: 'customer-project-only', projectName: 'Fixture Yard', archived: false},
  }), rule);
  assert.equal(row.category, 'inShop');
  assert.equal(row.statusLabel, 'ONLINE');
  assert.equal(isWatchfulTestProjectKey('customer-project-only', rule), false);
  assert.deepEqual(row.warnings, []);
});

test('a Helios 017-style unit stays Field when mHelp says Field and the project is a test site', () => {
  const row = decideShopCamera({
    unit: 'HELIOS 017', placement: 'FIELD', state: 'RED', site: 'Helios Test Sites',
    mhelpPlacement: 'FIELD',
    watchful: testProject(configuredWatchfulTestProjectKey('Helios Test Sites'), 'Helios Test Sites'),
  }, rule);
  assert.equal(row.inShop, false);
  assert.equal(row.placement, 'FIELD');
  assert.equal(row.state, 'RED');
  assert.equal(row.flag, MHELP_TEST_SITE_FLAG);
  assert.equal(row.counted.field, true);
  assert.equal(row.counted.inShop, false);
  assert.equal(row.counted.armed, true);
  assert.equal(row.counted.immix, true);
  assert.equal(configuredWatchfulTestProjectKey('Helios Test Sites'), 'b1666d31-0998-4081-be61-f710c0f0f527');
  assert.deepEqual(row.warnings, []);
});

test('a unit on the Spotter Test Site project is In shop', () => {
  const row = decideShopCamera({
    unit: 'SPOTTER 196', placement: 'FIELD', state: 'UNKNOWN', site: 'Spotter Test Site',
    mhelpPlacement: null,
    tags: ['no telemetry'],
    watchful: testProject(configuredWatchfulTestProjectKey('Spotter Test Site'), 'Spotter Test Site', {armed: false, immix: false}),
  }, rule);
  assert.equal(row.category, 'inShop');
  assert.equal(row.statusLabel, 'ONLINE');
  assert.equal(row.placeLabel, 'In shop');
  assert.equal(inShopLabel(row.tags), 'In shop · no telemetry');
  assert.equal(row.counted.field, false);
  assert.equal(row.counted.armed, false);
  assert.equal(row.counted.immix, false);
  assert.equal(configuredWatchfulTestProjectKey('Spotter Test Site'), 'aed522ac-9d63-4b7b-869d-318fbf2ce588');
  assert.deepEqual(row.warnings, []);
});

test('an unnamed device with 0 cameras on a test project stays unclassified and is not counted', () => {
  const testKey = configuredWatchfulTestProjectKey('Test 1');
  const unnamed = {
    unit: '', deviceKey: 'synthetic-unnamed-1', unnamed: true, cameras: 0,
    placement: 'FIELD', state: 'UNKNOWN', site: 'Test 1', mhelpPlacement: 'SHOP',
    watchful: testProject(testKey, 'Test 1'),
  };
  const row = decideShopCamera(unnamed, rule);
  assert.equal(row.category, 'unclassified');
  assert.equal(row.inShop, false);
  assert.equal(row.flag, null);
  assert.equal(row.statusLabel, null);
  assert.deepEqual(row.counted, {field: false, armed: false, immix: false, inShop: false, doNotUse: false, exception: false});
  const namedWithNoCameras = {
    unit: 'FIXTURE NAMED 1', placement: 'FIELD', state: 'UNKNOWN', cameras: 0,
    mhelpPlacement: null, watchful: testProject(testKey, 'Test 1', {armed: false, immix: false}),
  };
  const before = decideShopCameras([customer()], rule);
  const after = decideShopCameras([customer(), unnamed, namedWithNoCameras], rule);
  assert.equal(after.byUnit.get('SYNTHETIC-UNNAMED-1').category, 'unclassified');
  assert.equal(after.byUnit.get('FIXTURE NAMED 1').category, 'inShop');
  assert.equal(after.figures.field, before.figures.field);
  assert.equal(after.figures.inShop, before.figures.inShop + 1);
  assert.equal(after.figures.armed, before.figures.armed);
  assert.equal(after.figures.immix, before.figures.immix);
  assert.equal(after.figures.doNotUse, 0);
  assert.equal(after.figures.exceptions, 0);
  const viewed = applyShopCameraView([unnamed, namedWithNoCameras], after);
  assert.deepEqual(viewed.map(item => item.unit), ['FIXTURE NAMED 1']);
});

test('the census fixture keeps 323 In shop, 56 DO NOT USE, 1 exception, and the same field totals', () => {
  const fixture = shopCameraCensusFixture(rule.testProjectKeys);
  assert.equal(fixture.contract, 'COS_SHOP_CAMERA_CENSUS_FIXTURE_V1');
  assert.deepEqual(fixture.expected, {inShop: 323, doNotUse: 56, exceptions: 1});
  const before = decideShopCameras(fixture.field, rule);
  const after = decideShopCameras(fixture.units, rule);
  assert.equal(after.figures.inShop, 323);
  assert.equal(after.figures.doNotUse, 56);
  assert.equal(after.figures.exceptions, 1);
  assert.equal(after.figures.field, before.figures.field);
  assert.equal(after.figures.fieldGreen, before.figures.fieldGreen);
  assert.equal(after.figures.fieldRed, before.figures.fieldRed);
  assert.equal(after.figures.fieldYellow, before.figures.fieldYellow);
  assert.equal(after.figures.fieldUnknown, before.figures.fieldUnknown);
  assert.equal(after.figures.armed, before.figures.armed);
  assert.equal(after.figures.immix, before.figures.immix);
  assert.equal(after.warnings.length, 0);
});

test('a feed row keeps the Watchful project id and does not match mHelp by name', () => {
  const projected = projectUnitCameraStatus([{
    id: 55, device_name: 'SS010 cam', unit_key: 'SS010', organization: 'Test 1',
    vigilant_status: 'Online', star_organization_id: '283838',
  }]);
  const unit = projected.units[0];
  assert.equal(unit.watchfulProjectKey, undefined);
  assert.equal(String(unit.star_organization_id ?? ''), '');
  assert.deepEqual(unit.deviceIds, ['55']);
  const index = cameraMhelpPlacements([{unitNumber: 'SS010', productId: '5010', placementStatus: 'SHOP', uploadLifecycle: 'DO_NOT_USE'}]);
  const named = shopCameraInput({unit: 'SS010', placement: 'FIELD', state: 'GREEN'}, index);
  assert.equal(named.mhelpPlacement, null);
  const linked = shopCameraInput({
    unit: 'SS010', placement: 'FIELD', state: 'GREEN',
    productId: productIdForDevices(unit.deviceIds, [{productId: '5010', resourceId: '55'}]),
  }, index);
  assert.equal(linked.mhelpPlacement, 'SHOP');
  assert.equal(linked.doNotUse, true);
});

test('Helios 014 with listed cameras is not tagged no telemetry', () => {
  const key = configuredWatchfulTestProjectKey('Helios Test Sites');
  const row = decideShopCamera({
    unit: 'HELIOS 014', placement: 'FIELD', state: 'GREEN', cameras: 4,
    tags: ['no telemetry', 'RSU'],
    watchful: testProject(key, 'Helios Test Sites', {armed: false, immix: false}),
  }, rule);
  assert.equal(row.inShop, true);
  assert.equal(row.tags.includes('no telemetry'), false);
  assert.equal(inShopLabel(row.tags), 'In shop · RSU');
});

test('Helios 017 stays Field, is flagged once, and its cameras are not counted twice', () => {
  const key = configuredWatchfulTestProjectKey('Helios Test Sites');
  const helios = {
    unit: 'HELIOS 017', placement: 'FIELD', state: 'RED', cameras: 4, mhelpPlacement: 'FIELD',
    watchful: testProject(key, 'Helios Test Sites'),
  };
  const report = decideShopCameras([customer(), helios], rule);
  const row = report.byUnit.get('HELIOS 017');
  assert.equal(row.flag, 'mHelp Field, disagrees with Watchful test site');
  assert.equal(row.placement, 'FIELD');
  assert.equal(row.counted.field, true);
  assert.equal(row.counted.inShop, false);
  const viewed = applyShopCameraView([
    {unit: 'SPOTTER 880', placement: 'FIELD', state: 'RED', cameras: 2},
    {unit: 'HELIOS 017', placement: 'FIELD', state: 'RED', cameras: 4},
  ], report);
  assert.equal(viewed.filter(item => item.unit === 'HELIOS 017').length, 1);
  assert.equal(viewed.find(item => item.unit === 'HELIOS 017').placement, 'FIELD');
  assert.equal(viewed.reduce((total, item) => total + item.cameras, 0), 6);
  assert.equal(countUnits(viewed).shop.units, 0);
  assert.equal(countUnits(viewed).field.units, 2);
});

test('armed, immix, DO NOT USE and exceptions are dropped when the rows do not carry them', () => {
  const report = decideShopCameras([testSite({watchful: testProject(TEST1, 'Test 1', {armed: undefined, immix: undefined})})], rule);
  assert.equal(report.sources.armed, false);
  assert.equal(report.sources.immix, false);
  assert.equal(report.sources.doNotUse, false);
  assert.equal(report.sources.exceptions, false);
  const board = cameraStatusBoard(
    [{unit: 'SS010', placement: 'FIELD', state: 'UNKNOWN'}],
    rule,
    {units: {online: 1, offline: 0, unknown: 0}, cameras: {online: 1, offline: 0, unknown: 0}},
    [testSite({watchful: testProject(TEST1, 'Test 1', {armed: undefined, immix: undefined})})],
  );
  assert.equal(board.shop.armed, null);
  assert.equal(board.shop.immix, null);
  assert.equal(board.shop.doNotUse, null);
  assert.equal(board.shop.exceptions, null);
  assert.deepEqual(board.lines, []);
});

test('the Watchful test-project config fails closed', () => {
  const known = {label: 'Test 1', id: TEST1, idStatus: 'known'};
  assert.equal(validateWatchfulTestProjects({contract: 'COS_WATCHFUL_TEST_PROJECTS_V1', projects: [known]}).length, 1);
  for (const file of [
    {contract: 'OTHER', projects: [known]},
    {contract: 'COS_WATCHFUL_TEST_PROJECTS_V1', projects: []},
    {contract: 'COS_WATCHFUL_TEST_PROJECTS_V1', projects: [{label: 'Test 1'}]},
    {contract: 'COS_WATCHFUL_TEST_PROJECTS_V1', projects: [{label: 'Test 1', id: TEST1, idStatus: 'known', placeholderKey: 'MISSING_WATCHFUL_ID:Test 1'}]},
    {contract: 'COS_WATCHFUL_TEST_PROJECTS_V1', projects: [known, {...known, label: 'Copy'}]},
    {contract: 'COS_WATCHFUL_TEST_PROJECTS_V1', projects: [{label: 'Test 1', id: 'not-a-uuid', idStatus: 'known'}]},
  ]) assert.throws(() => validateWatchfulTestProjects(file));
  assert.throws(() => validateWatchfulTestProjects({
    contract: 'COS_WATCHFUL_TEST_PROJECTS_V1',
    projects: [{label: 'Test 1', id: null, idStatus: 'missing', placeholderKey: 'MISSING_WATCHFUL_ID:Test 1'}],
  }));
  assert.equal(validateWatchfulTestProjects({
    contract: 'COS_WATCHFUL_TEST_PROJECTS_V1',
    projects: [{label: 'Test 1', id: null, idStatus: 'missing', placeholderKey: 'MISSING_WATCHFUL_ID:Test 1'}],
  }, {allowPlaceholders: true}).length, 1);
});

test('rule-off render matches the main camera status board', () => {
  const units = [
    {unit: 'SPOTTER 880', placement: 'FIELD', state: 'RED', cameras: 1},
    {unit: 'SS010', placement: 'FIELD', state: 'UNKNOWN', cameras: 1, productId: '5010', watchfulProjectKey: TEST1},
  ];
  const counts = {units: {online: 3, offline: 1, unknown: 2}, cameras: {online: 4, offline: 1, unknown: 0}};
  const inputs = units.map(unit => shopCameraInput(unit));
  const main = {
    headline: counts,
    groups: ['field', 'attention', 'shop-online', 'shop'].map(id => ({id, count: groupedUnits(units, id, '').length})),
    attention: ['SPOTTER 880', 'SS010'],
    lines: [],
    shop: null,
    names: units.map(unit => unit.unit),
  };
  const off = cameraStatusBoard(units, rollbackShopCameraRule(), counts, inputs);
  assert.deepEqual({
    headline: off.headline,
    groups: off.groups.map(group => ({id: group.id, count: group.count})),
    attention: off.attention,
    lines: off.lines,
    shop: off.shop,
    names: off.units.map(unit => unit.unit),
  }, main);
  const on = cameraStatusBoard(units, rule, counts, [
    shopCameraInput({...units[0], mhelpPlacement: 'FIELD', watchfulArmed: true, watchfulImmix: true, watchfulProjectKey: 'customer'}),
    shopCameraInput({...units[1], productId: '5010', watchfulProjectKey: TEST1}),
  ]);
  assert.notDeepEqual(on.groups, off.groups);
  assert.equal(on.shop.inShop > 0, true);
  const mainBoard = {
    headline: counts,
    groups: GROUPS.map(group => ({id: group.id, label: group.label, count: groupedUnits(units, group.id, '').length})),
    attention: ['SPOTTER 880', 'SS010'],
    lines: [],
    shop: null,
    units,
  };
  const markup = board => renderToStaticMarkup(React.createElement(CameraStatusBoardView, {board, detail: true}));
  assert.equal(markup(off), markup(mainBoard));
  assert.equal(markup(off).includes('Shop, DO NOT USE'), false);
  assert.equal(markup(off).includes('Exceptions'), false);
  assert.equal(markup(off).includes('>3<'), true);
  assert.notEqual(markup(on), markup(mainBoard));
});

test('search does not match a public IP', () => {
  const units = [{unit: 'SPOTTER 880', placement: 'FIELD', state: 'RED', site: 'Fixture Yard', publicIp: '203.0.113.50', address: ''}];
  assert.deepEqual(groupedUnits(units, 'field', '203.0.113.50'), []);
  assert.deepEqual(groupedUnits(units, 'field', 'fixture yard').map(unit => unit.unit), ['SPOTTER 880']);
});
