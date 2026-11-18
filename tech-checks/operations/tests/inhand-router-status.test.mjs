import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  IN_SHOP_COLOR,
  IN_SHOP_LABEL,
  INHAND_LIVE_STATUS_SOURCE,
  INHAND_ROUTER_FRESHNESS_MS,
  inhandRouterOutage,
  inhandRouterReading,
  matchRouterByExactUnitKey,
  routerLiveReading,
} from '../src/inhandRouterStatus.ts';
import {fleetDashboardRows} from '../src/fleetDashboardModel.ts';

const now = Date.parse('2026-11-18T17:45:00Z');
const fresh = new Date(now - 20 * 60 * 1000).toISOString();
const stale = new Date(now - INHAND_ROUTER_FRESHNESS_MS - 1).toISOString();
const edge = new Date(now - INHAND_ROUTER_FRESHNESS_MS).toISOString();
const live = (patch = {}) => ({
  placement: 'FIELD',
  matched: true,
  model: 'InHand IR302',
  reportedStatus: 'offline',
  reportedAt: fresh,
  statusSource: INHAND_LIVE_STATUS_SOURCE,
  ...patch,
});

test('the freshness window is one named 75 minute constant', () => {
  assert.equal(INHAND_ROUTER_FRESHNESS_MS, 75 * 60 * 1000);
  const source = readFileSync(new URL('../src/inhandRouterStatus.ts', import.meta.url), 'utf8');
  assert.equal(source.split('75 * 60 * 1000').length - 1, 1);
  assert.equal(source.includes('45 * 60 * 1000'), false);
});

test('a fresh InHand online field unit is online and raises nothing', () => {
  const reading = inhandRouterReading(live({reportedStatus: 'Online'}), now);
  assert.equal(reading.label, 'Online');
  assert.equal(reading.state, 'online');
  assert.equal(reading.outageCount, 0);
  assert.equal(reading.alert, false);
  assert.equal(reading.routerOfflineTodo, false);
});

test('a fresh InHand offline field unit is offline and can raise a field to-do', () => {
  const reading = inhandRouterReading(live(), now);
  assert.equal(reading.label, 'Offline');
  assert.equal(reading.outageCount, 1);
  assert.equal(reading.alert, true);
  assert.equal(reading.routerOfflineTodo, true);
  assert.deepEqual(inhandRouterOutage(live(), now), {offline: true, count: 1, label: 'Offline', state: 'offline'});
});

test('a stale InHand reading is Unknown and never Offline', () => {
  for (const reportedAt of [stale, null, 'nonsense', new Date(now + 1000).toISOString()]) {
    const reading = inhandRouterReading(live({reportedAt, reportedStatus: 'offline'}), now);
    assert.equal(reading.label, 'Unknown');
    assert.equal(reading.state, 'unknown');
    assert.equal(reading.outageCount, 0);
    assert.equal(reading.routerOfflineTodo, false);
    assert.notEqual(reading.label, 'Offline');
    assert.notEqual(reading.state, 'offline');
  }
  const boundary = inhandRouterReading(live({reportedAt: edge}), now);
  assert.equal(boundary.label, 'Offline');
});

test('MOFI and Cradlepoint are Unknown, never an error and never Offline', () => {
  for (const row of [
    live({routerType: 'mofi', model: 'Mofi 4500V2'}),
    live({routerType: 'MOFI', model: 'InHand IR302'}),
    live({routerType: 'cradlepoint', model: 'IBR900'}),
    live({routerType: 'CradlePoint', model: 'something else'}),
    live({model: 'Mofi 4500V2'}),
    live({model: 'Cradlepoint IBR1700'}),
  ]) {
    const reading = inhandRouterReading(row, now);
    assert.equal(reading.label, 'Unknown');
    assert.equal(reading.state, 'unknown');
    assert.equal(reading.outageCount, 0);
    assert.equal(reading.alert, false);
    assert.doesNotThrow(() => inhandRouterReading(row, now));
  }
});

test('no exact InHand match is Unknown and partial names are not a match', () => {
  const reading = inhandRouterReading(live({matched: false}), now);
  assert.equal(reading.label, 'Unknown');
  assert.equal(reading.routerOfflineTodo, false);
  const routers = [
    {unitKey: 'Helios 001', id: 'a'},
    {unitKey: 'Helios 001', id: 'b'},
  ];
  assert.equal(matchRouterByExactUnitKey('Helios 1', routers), null);
  assert.equal(matchRouterByExactUnitKey('Helios-001', [{unitKey: 'Helios 001'}]), null);
  assert.equal(matchRouterByExactUnitKey('H001', [{unitKey: 'Helios 001'}]), null);
  assert.equal(matchRouterByExactUnitKey('Helios 001', routers), null);
  assert.deepEqual(matchRouterByExactUnitKey('  HELIOS   001 ', [{unitKey: 'Helios 001', id: 'only'}]), {unitKey: 'Helios 001', id: 'only'});
});

test('an omitted match is Unknown, so a bare offline reading cannot count', () => {
  const reading = inhandRouterReading(live({matched: undefined}), now);
  assert.equal(reading.label, 'Unknown');
  assert.equal(reading.state, 'unknown');
  assert.equal(reading.outageCount, 0);
  assert.notEqual(reading.label, 'Offline');
});

test('missing feed data is Unknown and never Offline', () => {
  for (const row of [
    live({reportedStatus: null}),
    live({reportedStatus: ''}),
    live({reportedStatus: 'pending'}),
    live({statusSource: 'InHand portal export 2026-11-17'}),
    live({statusSource: 'inhand live pull'}),
    live({statusSource: null}),
    {},
  ]) {
    const reading = inhandRouterReading(row, now);
    assert.equal(reading.label, 'Unknown');
    assert.equal(reading.state, 'unknown');
    assert.notEqual(reading.label, 'Offline');
  }
});

test('a shop unit shows In Shop, counts 0, and raises no alert', () => {
  for (const placement of ['shop', 'SHOP', 'root']) {
    const reading = inhandRouterReading(live({placement, reportedStatus: 'offline', routerType: 'mofi'}), now);
    assert.equal(reading.label, IN_SHOP_LABEL);
    assert.equal(reading.color, IN_SHOP_COLOR);
    assert.equal(reading.color, '#64748b');
    assert.equal(reading.outageCount, 0);
    assert.equal(reading.alert, false);
    assert.equal(reading.routerOfflineTodo, false);
    assert.equal(inhandRouterOutage(live({placement}), now).count, 0);
  }
  const unmatchedShop = inhandRouterReading(live({placement: 'shop', matched: false}), now);
  assert.equal(unmatchedShop.label, 'In Shop');
  assert.equal(unmatchedShop.outageCount, 0);
});

test('a router-offline to-do requires placement FIELD', () => {
  assert.equal(inhandRouterReading(live({placement: 'FIELD'}), now).routerOfflineTodo, true);
  assert.equal(inhandRouterReading(live({placement: 'field'}), now).routerOfflineTodo, true);
  for (const placement of ['unknown', 'INACTIVE', 'SHOP', '', 'fields', null]) {
    const reading = inhandRouterReading(live({placement}), now);
    assert.equal(reading.routerOfflineTodo, false, String(placement));
    assert.equal(reading.outageCount, 0, String(placement));
    assert.equal(reading.alert, false, String(placement));
  }
  const inactive = inhandRouterReading(live({placement: 'INACTIVE'}), now);
  assert.equal(inactive.label, 'Offline');
  assert.equal(inactive.routerOfflineTodo, false);
});

test('the fleet board uses the same reading for a linked unit', () => {
  const at = Date.parse('2026-10-06T18:00:00Z');
  const seen = new Date(at - 5 * 60 * 1000).toISOString();
  const unit = {id: '00000000-0000-4000-8000-000000000001', unitNumber: 'Helios 1', modelName: 'Helios', placement: 'FIELD', currentLocationType: 'field', status: 'field'};
  const shop = {id: '00000000-0000-4000-8000-000000000002', unitNumber: 'Sniper 9', modelName: 'Snipers', placement: 'SHOP', currentLocationType: 'shop', status: 'available'};
  const router = {
    id: 'r1', name: 'Helios 1', model: 'InHand IR302', match: 'exact_name',
    candidateUnit: {id: unit.id, unitNumber: unit.unitNumber},
    reportedStatus: 'offline', reportedAt: seen, reportedSource: INHAND_LIVE_STATUS_SOURCE,
  };
  const rows = fleetDashboardRows([unit, shop], null, [router], null, at);
  assert.equal(rows[0].routerLabel, 'Offline');
  assert.equal(rows[0].routerOfflineTodo, true);
  assert.equal(rows[0].routerOutageCount, 1);
  assert.equal(rows[1].routerLabel, 'In Shop');
  assert.equal(rows[1].routerColor, '#64748b');
  assert.equal(rows[1].routerOutageCount, 0);
  assert.equal(rows[1].routerOfflineTodo, false);
  const mofi = fleetDashboardRows([unit], null, [{...router, model: 'Mofi 4500V2', routerType: 'mofi'}], null, at)[0];
  assert.equal(mofi.routerLabel, 'Unknown');
  assert.equal(mofi.routerState, 'unknown');
});

test('the Routers page shows Unknown unless the unit key and placement both resolve', () => {
  const row = (patch = {}) => ({
    id: 'r', unitKey: 'Helios 001', name: 'Helios 001', model: 'InHand IR302',
    reportedStatus: 'offline', reportedAt: fresh, reportedSource: INHAND_LIVE_STATUS_SOURCE,
    match: 'exact_name', candidateUnit: {id: 'unit', unitNumber: 'Helios 001'}, gps: null,
    ...patch,
  });
  assert.equal(routerLiveReading(row(), 'FIELD', now).label, 'Offline');
  assert.equal(routerLiveReading(row(), 'shop', now).label, 'In Shop');
  assert.equal(routerLiveReading(row(), 'SHOP', now).outageCount, 0);
  for (const placement of [null, undefined, '', 'unknown', 'INACTIVE']) {
    const reading = routerLiveReading(row(), placement, now);
    assert.equal(reading.label, 'Unknown', String(placement));
    assert.notEqual(reading.label, 'Offline', String(placement));
    assert.equal(reading.outageCount, 0);
  }
  assert.equal(routerLiveReading(row({match: 'ambiguous', candidateUnit: null}), 'FIELD', now).label, 'Unknown');
  assert.equal(routerLiveReading(row({match: 'unmatched', candidateUnit: null}), 'FIELD', now).label, 'Unknown');
  assert.equal(routerLiveReading(row({match: 'ambiguous', candidateUnit: null}), null, now).label, 'Unknown');
});

test('the router status module does not carry network or SIM identifiers', () => {
  const blob = readFileSync(new URL('../src/inhandRouterStatus.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(blob, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  assert.equal(blob.includes('IMSI'), false);
  assert.equal(blob.includes('ICCID'), false);
  assert.equal(blob.includes('IMEI'), false);
});
