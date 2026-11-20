import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import UpdatesDelayedLine from '../src/UpdatesDelayedLine.tsx';
import FleetUnitHealth from '../src/FleetUnitHealth.tsx';
import FleetVictronSummary from '../src/FleetVictronSummary.tsx';
import {stalePinClass} from '../src/fleetStalePins.ts';
import {ageFeed, allFeedsUnknown, dashboardFeedAges, FEED_UNKNOWN_MS, fleetStatCount, presentValue, updatesDelayedLine, worstFeed} from '../src/feedFreshness.ts';
import {buildExactProductConnections, readExactProductConnections, SOURCE_FRESH_MS} from '../src/exactProductConnection.ts';
import {cosPowerVerdict} from '../src/cosPowerAlarms.ts';
import {technicianTodos} from '../src/technicianTodos.ts';
import {completedBoard} from '../durable-board/project.ts';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';
import {gateDashboardPower} from '../src/fleetPowerGate.ts';
import {INHAND_LIVE_STATUS_SOURCE} from '../src/inhandRouterStatus.ts';
import {buildFleetCommandCenter} from '../src/fleetCommandCenterModel.ts';
import FleetBatterySummary from '../src/FleetBatterySummary.tsx';
import FleetCountReadout from '../src/FleetCountReadout.tsx';
import VrmReadOnlyDashboard from '../src/VrmReadOnlyDashboard.tsx';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';

const dashboardRows = (units, health, routers, vrm, now) => gateDashboardPower(fleetDashboardRows(units, health, routers, vrm, now), vrm?.sync, now);
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

test('a missing camera time is Unknown, and a stale tracker still fails closed', () => {
  const project = readFileSync(new URL('../durable-board/project.ts', import.meta.url), 'utf8');
  assert.match(project, /feedStamp\('cameras',health\?\.refreshedAt,at\)/);
  assert.equal(project.includes('refreshedAt ??'), false);
  const f = fieldProductFixture();
  const missing = ageFeed(undefined, f.now, 'cameras');
  assert.equal(missing.state, 'unknown');
  assert.equal(missing.reason, 'missing');
  const health = structuredClone(f.health);
  delete health.refreshedAt;
  assert.throws(() => completedBoard(health, f.field, f.connections, null, f.now), /incomplete summary/);
  const connections = structuredClone(f.connections);
  connections.trackerVerifiedAt = new Date(f.now - 40 * 60 * 1000).toISOString();
  assert.throws(() => completedBoard(f.health, f.field, connections, null, f.now), /connection_source_incomplete/);
  assert.throws(() => completedBoard(f.health, f.field, {...f.connections, sourceSha256: 'b'.repeat(64)}, null, f.now), /connection_source_incomplete/);
});

test('power 20 to 45 minutes old is Unknown on Helios, Recon II, the Victron count and the battery alarm', () => {
  const now = Date.parse('2026-11-03T17:00:00Z');
  const old = new Date(now - 30 * 60 * 1000).toISOString();
  const recent = new Date(now - 2 * 60 * 1000).toISOString();
  const unit = {id: '00000000-0000-4000-8000-000000000001', unitNumber: 'Helios 1', modelName: 'Helios', placement: 'FIELD', status: 'field'};
  const installation = {installationId: 1001, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1001/dashboard', embedUrl: null, sharingEnabled: true, lastSeenAt: old};
  const power = {installationId: 1001, name: 'HELIOS 001', errorCode: null, lastAttemptAt: recent, measurements: [
    {metric: 'battery_soc', value: 76, unit: '%', observedAt: old, source: 'battery', instance: 0},
    {metric: 'low_voltage_alarm', value: 1, unit: 'state', observedAt: old, source: 'battery', instance: 0},
  ]};
  const sync = {state: 'current', lastAttemptAt: recent, lastSuccessAt: old, error: null};
  const stale = dashboardRows([unit], null, [], {items: [installation], power: [power], sync}, now)[0];
  assert.equal(stale.batteryState, 'unknown');
  assert.equal(stale.batteryPercent, null);
  const html = renderToStaticMarkup(React.createElement(FleetBatterySummary, {row: stale, now}));
  assert.equal(html.includes('battery alarm'), false);
  const livePower = {...power, measurements: [{metric: 'battery_soc', value: 76, unit: '%', observedAt: recent, source: 'battery', instance: 0}]};
  const live = dashboardRows([unit], null, [], {items: [installation], power: [livePower], sync: {...sync, lastSuccessAt: recent}}, now)[0];
  assert.equal(live.batteryState, 'online');
  const alarmRow = dashboardRows([unit], null, [], {items: [installation], power: [{...power, measurements: [{metric: 'low_voltage_alarm', value: 1, unit: 'state', observedAt: recent, source: 'battery', instance: 0}, {metric: 'battery_soc', value: 76, unit: '%', observedAt: recent, source: 'battery', instance: 0}]}], sync: {...sync, lastSuccessAt: recent}}, now)[0];
  assert.match(renderToStaticMarkup(React.createElement(FleetBatterySummary, {row: alarmRow, now})), /battery alarm/);
  const recon = {id: '00000000-0000-4000-8000-000000000002', unitNumber: 'Recon II 5', modelName: 'Recon II', placement: 'FIELD', status: 'field'};
  const reconRow = dashboardRows([recon], null, [], null, now)[0];
  assert.equal(reconRow.batteryState === 'online' || reconRow.batteryState === 'offline', false);
  const reconLate = gateDashboardPower([{family: 'RECON2', power: null, camera: {identity: 'matched', rows: [{name: 'cam', evidence: {source: 'Reconeyez'}, batteryEvidence: {percent: 80, percentObservedAt: old, status: 'normal', statusObservedAt: old}}]}, batteryState: 'online', batteryPercent: 80, batteryReadings: [], batteryReadIssue: null}], null, now)[0];
  assert.equal(reconLate.batteryState, 'unknown');
  assert.equal(reconLate.batteryPercent, null);
  const dash = readFileSync(new URL('../src/FleetDashboard.tsx', import.meta.url), 'utf8');
  assert.match(dash, /gateDashboardPower\(fleetDashboardRows\(/);
  const uid = '11111111-1111-1111-1111-111111111111';
  const upload = {contract: 'COS_MHELP_UPLOAD_INVENTORY_V1', countBasis: 'mhelp_product_records_not_unique_physical_units', source: 'owner_supplied_mhelp_export', sourceSha256: 'b'.repeat(64), receivedAt: recent, summary: {totalRecords: 1, fieldRecords: 1, shopRecords: 0, unflaggedFieldRecords: 1, doNotUseRecords: 0, missingRecords: 0}, records: [{productId: '2000003', recordId: 'mhelp_product:2000003', unitNumber: 'Helios 003', category: 'Helios', placement: 'FIELD', customer: 'Customer', uploadLifecycle: 'UNFLAGGED', sourceAddress: {street: '1 Example Road', city: 'Houston', state: 'TX', zip: '77001'}}]};
  const saved = {total: 1, items: [{productId: '2000003', unitNumber: 'Helios 003', state: 'unverified', reason: 'Verified synthetic observation', unitId: uid, recordId: null}]};
  const vrm = {items: [{name: 'Helios 003', installationId: 1000099, portalUrl: 'https://vrm.victronenergy.com/installation/1000099/dashboard', embedUrl: null}], sync: {state: 'current', lastAttemptAt: recent, lastSuccessAt: old, nextSyncAt: null, error: null, scheduleActive: true, connectionConfigured: true}};
  const rows = [{id: uid, power: {installationId: 1000099, name: 'Helios 003', errorCode: null, lastAttemptAt: recent, measurements: [{metric: 'battery_soc', value: 80, unit: '%', source: 'battery', instance: 0, observedAt: old}]}}];
  const center = buildFleetCommandCenter(upload, saved, true, rows, null, vrm, now, recent);
  assert.equal(center?.panels.find(panel => panel.key === 'victron')?.counts?.online, 0);
});

test('the connection endpoint keeps the fail-closed guard and does not publish a last-good list', () => {
  const source = readFileSync(new URL('../../supabase/functions/cos-operations-pages/index.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('lastGood'), false);
  assert.equal(source.includes('POSITIVE_INFINITY'), false);
  assert.match(source, /if\(!evaluated\)fail\('Current exact Product-ID\/endpoint evidence could not be verified\.',503\)/);
  const board = readFileSync(new URL('../durable-board/project.ts', import.meta.url), 'utf8');
  assert.equal(board.includes('lastGood'), false);
  assert.match(board, /connection_source_incomplete/);
});

test('all feeds stale is Unknown on the dashboard helpers, and routers and power still move while mHelp is down', () => {
  const reads = [
    ageFeed(at(50 * 60 * 1000), NOW, 'mhelp'),
    ageFeed(at(50 * 60 * 1000), NOW, 'tracker'),
    ageFeed(at(50 * 60 * 1000), NOW, 'cameras'),
    ageFeed(at(50 * 60 * 1000), NOW, 'routers'),
    ageFeed(at(50 * 60 * 1000), NOW, 'victron'),
  ];
  assert.equal(worstFeed(reads).state, 'unknown');
  assert.equal(allFeedsUnknown(reads.map(read => ({readAt: read.readAt})), NOW), true);
  for (const quick of ['online', 'offline', 'unknown']) {
    const shown = presentValue('4', '4', reads, NOW);
    assert.equal(shown.text, '?', quick);
    assert.match(shown.note, /as of /);
  }
  assert.match(updatesDelayedLine('mhelp', reads[0].readAt), /^Updates delayed · unit list from /);
  const atNow = Date.parse('2026-10-06T18:00:00Z');
  const seen = new Date(atNow - 2 * 60 * 1000).toISOString();
  const unit = {id: '00000000-0000-4000-8000-000000000001', unitNumber: 'Helios 1', modelName: 'Helios', placement: 'FIELD', currentLocationType: 'field', status: 'field'};
  const router = {id: 'r1', name: 'Helios 1', model: 'InHand IR302', match: 'exact_name', candidateUnit: {id: unit.id, unitNumber: unit.unitNumber}, reportedStatus: 'online', reportedAt: seen, reportedSource: INHAND_LIVE_STATUS_SOURCE};
  const installation = {installationId: 1001, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1001/dashboard', embedUrl: null};
  const power = {installationId: 1001, name: 'HELIOS 001', errorCode: null, lastAttemptAt: seen, measurements: [{metric: 'battery_soc', value: 80, unit: '%', observedAt: seen, source: 'battery', instance: 0}]};
  const row = dashboardRows([unit], null, [router], {items: [installation], power: [power], sync: {state: 'current', lastSuccessAt: seen, error: null}}, atNow)[0];
  assert.equal(row.routerState, 'online');
  assert.equal(row.batteryState, 'online');
  const placement = presentValue('7', '7', [{readAt: at(3 * 60 * 60 * 1000)}], NOW);
  assert.equal(placement.text, '?');
  assert.throws(() => completedBoard(fieldProductFixture().health, fieldProductFixture().field, {...fieldProductFixture().connections, trackerVerifiedAt: new Date(fieldProductFixture().now - 40 * 60 * 1000).toISOString()}, null, fieldProductFixture().now), /connection_source_incomplete/);
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
});

test('the dashboard gate is fresh at 20:00 and Unknown one millisecond later', () => {
  const now = Date.parse('2026-11-03T17:00:00.000Z');
  const edge = new Date(now - 20 * 60 * 1000).toISOString();
  const over = new Date(now - 20 * 60 * 1000 - 1).toISOString();
  const sync = {state: 'current', lastSuccessAt: new Date(now).toISOString(), lastAttemptAt: new Date(now).toISOString(), error: null};
  const row = observedAt => ({family: 'HELIOS', power: {measurements: [{metric: 'battery_soc', value: 80, unit: '%', observedAt, source: 'battery', instance: 0}]}, batteryState: 'online', batteryPercent: 80, batteryReadings: [], batteryReadIssue: null});
  assert.equal(gateDashboardPower([row(edge)], sync, now)[0].batteryState, 'online');
  assert.equal(gateDashboardPower([row(over)], sync, now)[0].batteryState, 'unknown');
  const attemptOnly = {state: 'current', lastSuccessAt: over, lastAttemptAt: new Date(now).toISOString(), error: null};
  assert.equal(gateDashboardPower([row(edge)], attemptOnly, now)[0].batteryState, 'unknown');
});

test('all stale shows Unknown through fleetStatCount and FleetCountReadout', () => {
  const now = Date.parse('2026-11-03T17:00:00.000Z');
  const old = now - 21 * 60 * 1000;
  const ages = dashboardFeedAges(old, true, new Date(old).toISOString(), true, now);
  for (const quick of ['online', 'offline', 'unknown']) assert.equal(fleetStatCount(quick, 4, ages, now, false), '?', quick);
  const html = renderToStaticMarkup(React.createElement(FleetCountReadout, {units: {online: 4, offline: 1, unknown: 2}, cameras: {online: 1, offline: 0, unknown: 0}, placementReadAt: old}));
  assert.match(html, />\?<\/b>/);
  assert.match(html, /as of /);
});

test('a missing camera time and a missing unit list are Unknown on the dashboard path', () => {
  const now = Date.parse('2026-11-03T17:00:00.000Z');
  const ages = dashboardFeedAges(null, false, undefined, true, now);
  assert.equal(ages.find(age => age.id === 'cameras').reason, 'missing');
  assert.equal(ages.find(age => age.id === 'cameras').state, 'unknown');
  assert.equal(ages.find(age => age.id === 'mhelp').reason, 'missing');
  assert.equal(fleetStatCount('field', 7, ages, now, true), '?');
  assert.equal(fleetStatCount('shop', 1, ages, now, true), '?');
  assert.equal(fleetStatCount('total', 8, ages, now, true), '?');
  assert.equal(fleetStatCount('online', 1, ages, now, false), 1);
});

test('the Victron VRM page is fresh at 20:00 and stale one millisecond later', () => {
  const now = Date.parse('2026-11-03T17:00:00.000Z');
  const unit = {installationId: 1001, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1001/dashboard', embedUrl: null};
  const reading = observedAt => ({installationId: 1001, name: 'HELIOS 001', errorCode: null, lastAttemptAt: new Date(now).toISOString(), measurements: [{metric: 'battery_soc', value: 70, unit: '%', observedAt, instance: 0, source: 'battery'}]});
  const edge = new Date(now - 20 * 60 * 1000).toISOString();
  const over = new Date(now - 20 * 60 * 1000 - 1).toISOString();
  const freshHtml = renderToStaticMarkup(React.createElement(VrmReadOnlyDashboard, {unit, rows: [reading(edge)], now}));
  assert.match(freshHtml, /Readings older than 20 minutes are marked stale/);
  assert.equal(freshHtml.includes('>Stale<') || freshHtml.includes('Stale ·'), false);
  assert.match(freshHtml, /Recent saved readings/);
  const staleHtml = renderToStaticMarkup(React.createElement(VrmReadOnlyDashboard, {unit, rows: [reading(over)], now}));
  assert.match(staleHtml, /Stale ·/);
  assert.match(staleHtml, /Saved readings · some are stale/);
  assert.match(staleHtml, /Last telemetry check:/);
});

test('a stale unit list greys the map pins and renders the delayed line', () => {
  const now = Date.parse('2026-11-03T17:00:00.000Z');
  const old = now - 46 * 60 * 1000;
  const line = renderToStaticMarkup(React.createElement(UpdatesDelayedLine, {line: updatesDelayedLine('mhelp', old)}));
  assert.match(line, /Updates delayed · unit list from /);
  assert.equal(renderToStaticMarkup(React.createElement(UpdatesDelayedLine, {line: null})), '');
  const ages = dashboardFeedAges(old, true, new Date(now).toISOString(), true, now);
  assert.equal(fleetStatCount('online', 4, ages, now, false), '?');
  const staleMap = renderToStaticMarkup(React.createElement('div', {className: 'cos-fleet-map-panel'+stalePinClass(true)}));
  assert.match(staleMap, /cos-pins-stale/);
  assert.equal(renderToStaticMarkup(React.createElement('div', {className: 'cos-fleet-map-panel'+stalePinClass(false)})).includes('cos-pins-stale'), false);
  const mapSource = readFileSync(new URL('../src/FleetDashboardMap.tsx', import.meta.url), 'utf8');
  assert.match(mapSource, /stalePinClass\(pinsStale\)/);
  assert.match(readFileSync(new URL('../src/FleetDashboard.tsx', import.meta.url), 'utf8'), /pinsStale=\{placementStale\}/);
  const css = readFileSync(new URL('../src/fleetStalePins.css', import.meta.url), 'utf8');
  assert.match(css, /\.cos-pins-stale \.leaflet-marker-icon,\.cos-pins-stale \.cos-dashboard-marker\{filter:grayscale\(1\);opacity:\.72\}/);
});

test('unit health and Victron Recent go stale at 20 minutes', () => {
  const now = Date.parse('2026-11-03T17:00:00.000Z');
  const edge = new Date(now - 20 * 60 * 1000).toISOString();
  const over = new Date(now - 20 * 60 * 1000 - 1).toISOString();
  const unit = {id: '00000000-0000-4000-8000-000000000001', unitNumber: 'Helios 1', modelName: 'Helios', placement: 'FIELD', status: 'field'};
  const installation = {installationId: 1001, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1001/dashboard', embedUrl: null};
  const powerFor = observedAt => ({items: [installation], power: [{installationId: 1001, name: 'HELIOS 001', errorCode: null, lastAttemptAt: new Date(now).toISOString(), measurements: [{metric: 'solar_power', value: 10, unit: 'W', observedAt, source: 'system', instance: 0}]}], sync: {state: 'current', lastSuccessAt: new Date(now).toISOString(), error: null}});
  const health = row => renderToStaticMarkup(React.createElement(FleetUnitHealth, {row, now}));
  const victron = row => renderToStaticMarkup(React.createElement(FleetVictronSummary, {row, now}));
  const freshRow = fleetDashboardRows([unit], null, [], powerFor(edge), now)[0];
  const staleRow = fleetDashboardRows([unit], null, [], powerFor(over), now)[0];
  assert.match(health(freshRow), /Recent observation/);
  assert.match(health(staleRow), /Stale \/ unverified/);
  assert.equal(health(staleRow).includes('Recent observation'), false);
  assert.match(victron(freshRow), /· Recent ·/);
  assert.match(victron(staleRow), /Stale \/ unverified/);
});
