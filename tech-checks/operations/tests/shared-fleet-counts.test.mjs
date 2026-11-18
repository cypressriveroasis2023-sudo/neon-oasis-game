import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraState} from '../src/cameraEvidence.ts';
import {technicianTodos} from '../src/technicianTodos.ts';
import {
  aboutHeadline, applyExactRecorderLinks, cameraStatusHeadline, censusFromCameraUnits, censusFromCommandProducts, censusFromDashboardRows,
  exactEquipmentLinks, fleetCountsFromCameraFeed, inventoryUnverifiedBreakdown, mapHeadline, routerOfflineFact, selectFleetCounts,
} from '../src/sharedFleetCounts.ts';

const now = Date.parse('2026-11-18T13:10:00Z');
const fresh = new Date(now - 5 * 60 * 1000).toISOString();
const stale = new Date(now - 3 * 60 * 60 * 1000).toISOString();

const unit = (name, placement, cameras, reason = null) => ({
  name, placement, cameras, newestOnlineAt: null, unverifiedReason: reason,
});

test('camera status, the map and about this board read one selector', () => {
  const census = [
    unit('Sniper 168', 'field', [{state: 'offline', observedAt: fresh}, {state: 'offline', observedAt: fresh}]),
    unit('Sniper 227', 'field', [{state: 'online', observedAt: fresh}, {state: 'unknown', observedAt: fresh}]),
    unit('Spotter 239', 'field', [{state: 'online', observedAt: fresh}]),
    unit('Sniper 44', 'shop', [{state: 'offline', observedAt: fresh}]),
    unit('Helios 8', 'field', [{state: 'offline', observedAt: stale}]),
  ];
  const camera = cameraStatusHeadline(census, now);
  const map = mapHeadline(census, now);
  const about = aboutHeadline(census, now);
  assert.deepEqual(camera, map);
  assert.deepEqual(map, about);
  assert.deepEqual(camera.units, {online: 1, offline: 1, unknown: 2});
  assert.deepEqual(camera.cameras, {online: 2, offline: 2, unknown: 2});
  assert.equal(selectFleetCounts(census, now).inShopUnits, 1);
});

test('a stale camera stays unverified before the inventory census stamps a fresh time', () => {
  const evidence = {kind: 'provider', source: 'Star4Live', resource: 'camera', active: true, status: 'offline', observedAt: stale, lastOnlineAt: null};
  const row = {id: '1', name: 'Quiet', unit: 'Sniper 1', type: 'ipc', activationState: 'ACTIVE', status: 'offline', evidence};
  assert.equal(cameraState(row, now), 'verifying');
  const freshRow = {...row, evidence: {...evidence, observedAt: fresh, status: 'online'}};
  assert.equal(cameraState(freshRow, now), 'online');
  const staleProducts = selectFleetCounts(censusFromCommandProducts([
    {productId: '1001', unitNumber: 'Sniper 1', status: 'unverified'},
  ], now), now);
  assert.deepEqual(staleProducts.units, {online: 0, offline: 0, unknown: 1});
  assert.equal(staleProducts.cameras.offline, 0);
});

test('field product inventory counts go through the same selector', () => {
  const items = [
    {productId: '1001', unitNumber: 'Sniper 1', status: 'online'},
    {productId: '1002', unitNumber: 'Sniper 2', status: 'offline'},
    {productId: '1003', unitNumber: 'Sniper 3', status: 'unverified'},
    {productId: '1004', unitNumber: 'Stand 4', status: 'not_applicable'},
    {productId: '1005', unitNumber: '', status: 'unverified'},
  ];
  const snapshot = selectFleetCounts(censusFromCommandProducts(items, now), now);
  assert.deepEqual(snapshot.units, {online: 1, offline: 1, unknown: 2});
  assert.deepEqual(mapHeadline(censusFromCommandProducts(items, now), now).units, snapshot.units);
  assert.equal(snapshot.inShopUnits, 0);
});

test('a shop unit adds nothing and a stale miss stays unknown', () => {
  const snapshot = selectFleetCounts([
    unit('Shop bench', 'shop', [{state: 'offline', observedAt: fresh}, {state: 'online', observedAt: fresh}]),
    unit('Quiet', 'field', [{state: 'offline', observedAt: stale}]),
  ], now);
  assert.deepEqual(snapshot.cameras, {online: 0, offline: 0, unknown: 1});
  assert.deepEqual(snapshot.units, {online: 0, offline: 0, unknown: 1});
  assert.equal(snapshot.unverified.stale_reading, 1);
  assert.equal(snapshot.inShopUnits, 1);
});

test('inventory unverified reasons add up to the unverified rows', () => {
  const items = [
    {status: 'online', reason: 'Fresh'},
    {status: 'unverified', reason: 'Device link needed. The Product ID has a COS inventory association.'},
    {status: 'unverified', reason: 'The exact Product-ID TCP source is unavailable, stale or does not match the current inventory.'},
    {status: 'unverified', reason: 'Current direct connection and verified provider status disagree.'},
    {status: 'unverified', reason: 'No recorder is linked for this unit.'},
    {status: 'unverified', reason: 'No router is linked for this unit.'},
    {status: 'unverified', linked: {state: 'review'}, reason: 'Identity review'},
    {status: 'support', reason: 'Solar stand'},
  ];
  const breakdown = inventoryUnverifiedBreakdown(items);
  assert.equal(breakdown.total, 6);
  assert.equal(Object.values(breakdown.counts).reduce((sum, count) => sum + count, 0), 6);
  assert.equal(breakdown.counts.no_device_link, 1);
  assert.equal(breakdown.counts.stale_reading, 1);
  assert.equal(breakdown.counts.source_conflict, 1);
  assert.equal(breakdown.counts.no_recorder_link, 1);
  assert.equal(breakdown.counts.no_router_link, 1);
  assert.equal(breakdown.counts.identity_hold, 1);
});

test('a near-miss recorder name does not link', () => {
  const units = [
    {name: 'Sniper 168', deviceId: '16801'},
    {name: 'Sniper 4 100'},
    {name: 'Solar Spotter 239'},
  ];
  const devices = [
    {name: 'NVR SNIPER 168', deviceId: '16801', serial: 'REC-168'},
    {name: 'Sniper4 100'},
    {name: 'Sniper 1680'},
    {name: 'Spotter 239'},
  ];
  const links = exactEquipmentLinks(units, devices);
  assert.deepEqual(links.matched, []);
  assert.deepEqual(links.needsDataFix, []);
  const census = applyExactRecorderLinks([
    unit('Sniper 168', 'field', [{state: 'unknown', observedAt: null}]),
    unit('Sniper 4 100', 'field', [{state: 'unknown', observedAt: null}]),
  ], [
    {name: 'NVR SNIPER 168', deviceId: '16801', state: 'offline', observedAt: fresh},
    {name: 'Sniper4 100', state: 'offline', observedAt: fresh},
    {name: 'Sniper 1680', state: 'offline', observedAt: fresh},
  ], now);
  assert.deepEqual(selectFleetCounts(census, now).units, {online: 0, offline: 0, unknown: 2});
});

test('a recorder with no exact unit name stays unknown', () => {
  const census = applyExactRecorderLinks([
    unit('Solar Spotter 239', 'field', []),
    unit('Sniper 227', 'field', [{state: 'unknown', observedAt: null}]),
  ], [
    {name: 'Spotter 239', state: 'offline', observedAt: fresh},
    {name: 'Recorder 227', serial: 'REC-227', state: 'online', observedAt: fresh},
  ], now);
  const counts = selectFleetCounts(census, now);
  assert.equal(counts.units.offline, 0);
  assert.equal(counts.units.online, 0);
  assert.equal(counts.units.unknown, 2);
  const exact = applyExactRecorderLinks([
    unit('Sniper 168', 'field', [{state: 'unknown', observedAt: null}]),
  ], [{name: '  sniper   168  ', state: 'offline', observedAt: fresh}], now);
  assert.equal(selectFleetCounts(exact, now).units.offline, 1);
});

test('a missing camera-status feed is not replaced and a timeless offline stays unknown', () => {
  assert.equal(fleetCountsFromCameraFeed(null, [{name: 'Sniper 168', state: 'offline', observedAt: fresh}], now), null);
  const rows = censusFromDashboardRows([{name: 'Quiet', placement: 'field', cameraState: 'offline'}], now);
  assert.equal(rows[0].cameras[0].observedAt, null);
  assert.deepEqual(selectFleetCounts(rows, now).units, {online: 0, offline: 0, unknown: 1});
  const feed = fleetCountsFromCameraFeed([
    {unit: 'Sniper 168', placement: 'FIELD', site: null, siteNamePending: false, state: 'UNKNOWN', cameras: 1, online: 0, offline: 0, unknown: 1, down: [], onlineInShop: false, publicIp: null, observedAt: null},
  ], [{name: 'Sniper 168', state: 'offline', observedAt: fresh}], now);
  assert.equal(feed.units.offline, 1);
  assert.deepEqual(cameraStatusHeadline(censusFromCameraUnits([
    {unit: 'Sniper 168', placement: 'FIELD', site: null, siteNamePending: false, state: 'RED', cameras: 1, online: 0, offline: 1, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh},
  ], now), now).units, {online: 0, offline: 1, unknown: 0});
});

const inhandOffline = ['Sniper 168', 'Sniper 190', 'Sniper 227', 'Sniper 335', 'Sniper 4 100', 'Spotter 239', 'Spotter 264', 'Spotter 269', 'Spotter 302'];

test('the 7:44 router pull keeps every earlier outage and adds Spotter 269', () => {
  const pullAt = Date.parse('2026-11-18T13:44:00Z');
  const earlier = Date.parse('2026-11-18T13:10:00Z');
  const todos = technicianTodos({routers: inhandOffline.map(unit => ({
    unit, placement: 'FIELD', routerOffline: true, routerObservedAt: unit === 'Spotter 269' ? pullAt : earlier, cameraOnlineAt: null,
  }))});
  assert.deepEqual(todos.map(todo => todo.unit), inhandOffline);
  assert.ok(todos.every(todo => todo.kind === 'router_offline' && todo.group === 'offline' && todo.detail === 'Router is offline.'));
  const stillDown = routerOfflineFact({probeStatus: 'offline', checkedAt: new Date(earlier).toISOString(), reportedStatus: 'offline', reportedAt: new Date(pullAt).toISOString()}, pullAt + 60 * 1000);
  assert.equal(stillDown.offline, true);
  assert.equal(stillDown.at, pullAt);
});

test('a fresh router outage is a to-do and a strictly newer camera shows both facts', () => {
  const routerAt = now - 10 * 60 * 1000;
  const offline = routerOfflineFact({probeStatus: 'online', checkedAt: stale, reportedStatus: 'offline', reportedAt: new Date(routerAt).toISOString()}, now);
  assert.equal(offline.offline, true);
  const staleReport = routerOfflineFact({probeStatus: 'online', checkedAt: fresh, reportedStatus: 'offline', reportedAt: stale}, now);
  assert.equal(staleReport.offline, false);
  const olderCamera = technicianTodos({routers: [{unit: 'Sniper 190', placement: 'FIELD', routerOffline: true, routerObservedAt: routerAt, cameraOnlineAt: routerAt - 60 * 1000}]});
  assert.equal(olderCamera.length, 1);
  assert.equal(olderCamera[0].detail, 'Router is offline.');
  assert.equal(olderCamera[0].group, 'offline');
  const newerCamera = technicianTodos({routers: [{unit: 'Spotter 239', placement: 'FIELD', routerOffline: true, routerObservedAt: routerAt, cameraOnlineAt: routerAt + 60 * 1000}]});
  assert.match(newerCamera[0].detail, /Router is offline/);
  assert.match(newerCamera[0].detail, /newer camera reading/);
  const shop = technicianTodos({routers: [{unit: 'Sniper 44', placement: 'SHOP', routerOffline: true, routerObservedAt: routerAt, cameraOnlineAt: null}]});
  assert.deepEqual(shop, []);
  const unplaced = technicianTodos({routers: [{unit: 'Solar Spotter 023.1', routerOffline: true, routerObservedAt: routerAt, cameraOnlineAt: null}]});
  assert.deepEqual(unplaced, []);
  const unknownPlacement = technicianTodos({routers: [{unit: 'Solar Spotter 023.1', placement: 'UNKNOWN', routerOffline: true, routerObservedAt: routerAt, cameraOnlineAt: null}]});
  assert.deepEqual(unknownPlacement, []);
});

test('offline cards stay above address cleanup', () => {
  const todos = technicianTodos({
    addresses: [{unit: 'Camv 4', productId: 'p1', placement: 'FIELD'}],
    cameras: [{unit: 'Sniper 168', placement: 'FIELD', state: 'RED', offline: 2}],
  });
  assert.deepEqual(todos.map(todo => todo.group), ['offline', 'cleanup']);
  assert.equal(todos[0].unit, 'Sniper 168');
  assert.equal(todos[0].action, 'Open unit');
  assert.equal(todos[1].action, 'Check address');
});

test('camera report shop rows stay out of the headline', () => {
  const census = censusFromCameraUnits([
    {unit: 'Sniper 168', placement: 'FIELD', site: null, siteNamePending: false, state: 'RED', cameras: 2, online: 0, offline: 2, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh},
    {unit: 'Sniper 44', placement: 'SHOP', site: null, siteNamePending: false, state: 'RED', cameras: 2, online: 0, offline: 2, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh},
  ], now);
  assert.deepEqual(cameraStatusHeadline(census, now).units, {online: 0, offline: 1, unknown: 0});
  assert.equal(selectFleetCounts(census, now).inShopUnits, 1);
});
