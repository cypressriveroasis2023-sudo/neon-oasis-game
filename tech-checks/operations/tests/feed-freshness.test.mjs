import test from 'node:test';
import assert from 'node:assert/strict';
import {ageFeed, allFeedsUnknown, FEED_UNKNOWN_MS, lastKnownLine, presentValue, updatesDelayedLine} from '../src/feedFreshness.ts';
import {buildExactProductConnections, readExactProductConnections, SOURCE_FRESH_MS} from '../src/exactProductConnection.ts';
import {cosPowerVerdict} from '../src/cosPowerAlarms.ts';
import {technicianTodos} from '../src/technicianTodos.ts';
import {completedBoard} from '../durable-board/project.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

const NOW = Date.parse('2026-11-19T23:36:00Z');
const at = (ms) => new Date(NOW - ms).toISOString();
const pm = Date.parse('2026-11-19T23:36:00Z');

test('every feed is Unknown after 20 minutes, including the tracker', () => {
  assert.equal(FEED_UNKNOWN_MS, 20 * 60 * 1000);
  assert.equal(SOURCE_FRESH_MS, 20 * 60 * 1000);
  assert.equal(ageFeed(at(20 * 60 * 1000), NOW, 'tracker').state, 'fresh');
  assert.equal(ageFeed(at(20 * 60 * 1000 + 1), NOW, 'tracker').state, 'unknown');
  assert.equal(ageFeed(at(20 * 60 * 1000 + 1), NOW, 'tracker').reason, 'stale');
  assert.equal(ageFeed(null, NOW, 'mhelp').reason, 'missing');
  assert.equal(ageFeed(new Date(NOW + 5 * 60 * 1000).toISOString(), NOW, 'cameras').reason, 'future');
  assert.notEqual(ageFeed(at(21 * 60 * 1000), NOW).state, 'offline');
});

test('mHelp failed and fresh cameras: no placement-derived value appears without its stale marker', () => {
  const mhelp = {readAt: at(3 * 60 * 60 * 1000)};
  const cameras = {readAt: at(2 * 60 * 1000)};
  const units = presentValue('186 / 196', '186 / 196', [mhelp], NOW);
  const fieldCameras = presentValue('702 / 731', '702 / 731', [mhelp, cameras], NOW);
  const fieldTotal = presentValue('196', '196', [mhelp], NOW);
  const shop = presentValue('40', '40', [mhelp], NOW);
  const tag = presentValue('Field', 'Field', [mhelp], NOW);
  const pins = presentValue('pins', 'pins', [mhelp], NOW);
  for (const shown of [units, fieldCameras, fieldTotal, shop, tag, pins]) {
    assert.equal(shown.stale, true);
    assert.equal(shown.text, '?');
    assert.match(shown.note, /^Last known .+ · as of /);
  }
  assert.match(updatesDelayedLine('mhelp', mhelp.readAt ? Date.parse(mhelp.readAt) : null), /^Updates delayed · unit list from /);
  const liveCamera = presentValue('2 / 4', '2 / 4', [cameras], NOW);
  assert.equal(liveCamera.stale, false);
  assert.equal(liveCamera.text, '2 / 4');
  assert.equal(liveCamera.note, null);
});

test('a tracker older than 20 minutes is Unknown and is not a live connection', () => {
  const f = fieldProductFixture();
  const aged = structuredClone(f.connections);
  aged.trackerVerifiedAt = new Date(f.now - 21 * 60 * 1000).toISOString();
  const ids = f.upload.records.filter(row => row.placement === 'FIELD').map(row => row.productId);
  const map = readExactProductConnections(aged, f.upload.sourceSha256, ids, f.now);
  assert.ok(map);
  assert.ok([...map.values()].every(row => row.status === 'unknown'));
  assert.equal(readExactProductConnections({...aged, trackerVerifiedAt: new Date(f.now - 31 * 60 * 1000).toISOString()}, f.upload.sourceSha256, ids, f.now), null);
  const kept = readExactProductConnections({...aged, trackerVerifiedAt: new Date(f.now - 31 * 60 * 1000).toISOString()}, f.upload.sourceSha256, ids, f.now, 'lastGood');
  assert.ok(kept);
  assert.ok([...kept.values()].every(row => row.status === 'unknown'));
});

test('mHelp failed and fresh connections: camera, router and battery stay live', () => {
  const mhelp = at(4 * 60 * 60 * 1000);
  const camera = at(3 * 60 * 1000);
  const router = at(4 * 60 * 1000);
  const battery = at(5 * 60 * 1000);
  assert.equal(ageFeed(mhelp, NOW, 'mhelp').state, 'unknown');
  assert.equal(ageFeed(camera, NOW, 'cameras').state, 'fresh');
  assert.equal(ageFeed(router, NOW, 'routers').state, 'fresh');
  assert.equal(ageFeed(battery, NOW, 'victron').state, 'fresh');
  assert.equal(presentValue('Online', 'Online', [{readAt: camera}], NOW).text, 'Online');
  assert.equal(presentValue('Router down', 'Router down', [{readAt: router}], NOW).stale, false);
  assert.equal(presentValue('82%', '82%', [{readAt: battery}], NOW).text, '82%');
  assert.equal(presentValue('186 / 196', '186 / 196', [{readAt: mhelp}, {readAt: camera}], NOW).text, '?');
});

test('when every feed is stale, everything shows Unknown', () => {
  const reads = ['mhelp', 'tracker', 'cameras', 'routers', 'victron'].map(id => ({id, readAt: at(50 * 60 * 1000)}));
  assert.equal(allFeedsUnknown(reads, NOW), true);
  for (const read of reads) {
    const shown = presentValue('12', '12', [read], NOW);
    assert.equal(shown.text, '?');
    assert.equal(ageFeed(read.readAt, NOW).state, 'unknown');
  }
});

test('power-silent fires only on a fresh Victron feed', () => {
  const settings = {lowVoltageV: null, lowSocPercent: null, silentHours: 4};
  const quiet = cosPowerVerdict({
    now: NOW,
    settings,
    newestObservedAt: at(5 * 60 * 60 * 1000),
    victronFeedReadAt: at(3 * 60 * 60 * 1000),
  });
  const fresh = cosPowerVerdict({
    now: NOW,
    settings,
    newestObservedAt: at(5 * 60 * 60 * 1000),
    victronFeedReadAt: at(2 * 60 * 1000),
  });
  const missing = cosPowerVerdict({
    now: NOW,
    settings,
    newestObservedAt: at(5 * 60 * 60 * 1000),
    victronFeedReadAt: null,
  });
  assert.equal(quiet.silent, 'unknown');
  assert.equal(fresh.silent, 'alarm');
  assert.equal(missing.silent, 'unknown');
  const alarm = {voltage: 'clear', soc: 'clear', silent: 'alarm', victronLowVoltage: 'clear'};
  const staleTodos = technicianTodos({now: NOW, power: [{unit: 'Helios 9', placement: 'FIELD', verdict: alarm, victronFeedReadAt: at(3 * 60 * 60 * 1000)}]});
  const freshTodos = technicianTodos({now: NOW, power: [{unit: 'Helios 9', placement: 'FIELD', verdict: alarm, victronFeedReadAt: at(2 * 60 * 1000)}]});
  assert.deepEqual(staleTodos.map(todo => todo.kind), []);
  assert.deepEqual(freshTodos.map(todo => todo.kind), ['power_silent']);
});

test('a late mHelp list still publishes fresh camera health and keeps the list time', () => {
  const f = fieldProductFixture();
  const map = structuredClone(f.field);
  map.uploadInventory.receivedAt = new Date(f.now - 4 * 60 * 60 * 1000).toISOString();
  const connections = structuredClone(f.connections);
  connections.trackerVerifiedAt = new Date(f.now - 40 * 60 * 1000).toISOString();
  const health = structuredClone(f.health);
  health.refreshedAt = new Date(f.now - 2 * 60 * 1000).toISOString();
  const board = completedBoard(health, map, connections, null, f.now);
  assert.equal(board.feeds.mhelp.fresh, false);
  assert.equal(board.feeds.tracker.fresh, false);
  assert.equal(board.feeds.cameras.fresh, true);
  assert.match(board.feeds.mhelp.readAt, /T/);
  assert.equal(JSON.stringify(board).includes('8.8.8.8'), false);
  assert.throws(() => completedBoard(health, map, {...connections, sourceSha256: 'b'.repeat(64)}, board, f.now), /connection_source_incomplete/);
});

test('buildExact refuses a tracker older than 20 minutes', () => {
  const now = Date.parse('2026-10-26T21:00:00Z');
  const current = new Date(now - 21 * 60 * 1000).toISOString();
  const sha = 'a'.repeat(64);
  const records = [
    {productId: '1001', placement: 'FIELD', uploadLifecycle: 'UNFLAGGED'},
    {productId: '1002', placement: 'SHOP', uploadLifecycle: 'UNFLAGGED'},
  ].map(row => ({...row, recordId: 'mhelp_product:'+row.productId, binding: {state: 'unlinked', placementHeld: false, candidateUnitIds: []}}));
  const accepted = {contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', countBasis: 'mhelp_product_records_not_unique_physical_units', sourceSha256: sha, receivedAt: current, summary: {totalRecords: 2, fieldRecords: 1, shopRecords: 1, unflaggedFieldRecords: 1, unflaggedShopRecords: 1, doNotUseRecords: 0, missingRecords: 0}, records};
  const tracker = {contract: 'COS_VERIFIED_2027_PRODUCT_IPS_V1', workbookId: '1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA', expectedMhelpSourceSha256: sha, verifiedAt: current, records: records.map(row => ({productId: row.productId, recordId: row.recordId, placement: row.placement, publicIp: null}))};
  assert.equal(buildExactProductConnections(accepted, tracker, [], now), null);
  assert.equal(pm > 0, true);
});
