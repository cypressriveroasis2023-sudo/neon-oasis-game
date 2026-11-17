import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCameraUnit } from '../src/fieldCameraHealth.ts';
import { routerSnapshot, readRouterSnapshot } from '../../supabase/functions/cos-operations-pages/routers.ts';
import {
  cameraHealthUnitKey, routerJoinKey, boardRouterStatus, displayedRouterStatus, joinUnitRouter, deviceDoNotUse,
  annotateSavedBoard, presentRouterPage, ROUTER_BOARD_FRESH_MS,
} from '../../supabase/functions/cos-operations-pages/routerBoardJoin.mjs';

const now = Date.parse('2026-11-17T21:00:00Z');
const fresh = new Date(now - 60 * 1000).toISOString();
const stale = new Date(now - ROUTER_BOARD_FRESH_MS - 1000).toISOString();
const router = (patch) => ({ id: 1, unit_key: 'SNIPER 148', inhand_serial: 'SERIAL-148', current_status: 'online', last_checked_at: fresh, ...patch });

test('camera health key normalization is reused for both solar spellings', () => {
  for (const name of ['SOLAR SPOTTER 019', 'SOLARSPOTTER 019', 'solar  spotter   019']) {
    assert.equal(cameraHealthUnitKey(name), canonicalCameraUnit(name));
    assert.equal(routerJoinKey(name), 'canon:' + canonicalCameraUnit(name));
  }
  assert.equal(routerJoinKey('SOLAR SPOTTER 019'), routerJoinKey('SOLARSPOTTER 019'));
  assert.notEqual(routerJoinKey('SOLARSPOTTER 019'), routerJoinKey('SOLARSPOTTER 020'));
  assert.notEqual(routerJoinKey('SPOTTER 019'), routerJoinKey('SOLARSPOTTER 019'));
  assert.equal(routerJoinKey('SS001'), routerJoinKey('ss001'));
  assert.notEqual(routerJoinKey('SS001'), routerJoinKey('SS004'));
  for (const legacy of ['SS001', 'SS004', 'SS034', 'SS035', 'SS254']) {
    assert.equal(cameraHealthUnitKey(legacy), null);
    assert.equal(routerJoinKey(legacy), 'name:' + legacy.toLowerCase());
  }
});

test('exact match, a missing row, and a stale row never become Offline', () => {
  const online = joinUnitRouter({ unitKey: 'SNIPER 148', routers: [router()], now });
  assert.equal(online.status, 'Online');
  assert.equal(online.outage, false);
  const missing = joinUnitRouter({ unitKey: 'SNIPER 999', routers: [router()], now });
  assert.equal(missing.status, 'Unknown (no feed)');
  assert.equal(missing.outage, false);
  assert.notEqual(missing.status, 'Offline');
  const old = joinUnitRouter({ unitKey: 'SNIPER 148', routers: [router({ current_status: 'offline', last_checked_at: stale })], now });
  assert.equal(old.status, 'Unknown');
  assert.equal(old.outage, false);
  const down = joinUnitRouter({ unitKey: 'SNIPER 148', routers: [router({ current_status: 'offline' })], now });
  assert.equal(down.status, 'Offline');
  assert.equal(down.outage, true);
  const shop = joinUnitRouter({ unitKey: 'SNIPER 148', placement: 'shop', routers: [router({ current_status: 'offline' })], now });
  assert.equal(shop.status, 'Offline');
  assert.equal(shop.outage, false);
});

test('router_type is optional and prior_inhand_serial is never a live join', () => {
  const noColumn = boardRouterStatus({ inhand_serial: 'SERIAL-1', current_status: 'online', last_checked_at: fresh }, now);
  assert.equal(noColumn.status, 'Online');
  const nullType = boardRouterStatus({ router_type: null, inhand_serial: '', current_status: 'offline', last_checked_at: fresh }, now);
  assert.equal(nullType.status, 'Unknown (no feed)');
  const mofi = boardRouterStatus({ router_type: 'mofi', inhand_serial: '', prior_inhand_serial: 'OLD-322', router_serial: 'NEW-322', current_status: 'offline', last_checked_at: fresh }, now);
  assert.equal(mofi.status, 'Unknown (no feed)');
  assert.equal(mofi.outage, false);
  const cradle = boardRouterStatus({ router_type: 'cradlepoint', inhand_serial: 'X', current_status: 'offline', last_checked_at: fresh }, now);
  assert.equal(cradle.status, 'Unknown (no feed)');
  const unknown = boardRouterStatus({ router_type: 'unknown', inhand_serial: 'X', current_status: 'online', last_checked_at: fresh }, now);
  assert.equal(unknown.status, 'Unknown');
  const joined = joinUnitRouter({
    unitKey: 'SNIPER 100',
    routers: [router({ unit_key: 'OTHER 100', inhand_serial: '', router_serial: '', prior_inhand_serial: 'OLD-322' })],
    devices: [{ id: 1, unit_key: 'SNIPER 100', device_serial: 'OLD-322' }],
    now,
  });
  assert.equal(joined.matched, false);
  assert.equal(joined.status, 'Unknown (no feed)');
  const bySerial = joinUnitRouter({
    unitKey: 'SNIPER 100',
    routers: [router({ unit_key: 'UNRELATED', inhand_serial: '', router_serial: 'LIVE-100', current_status: 'online' })],
    devices: [{ id: 2, unit_key: 'SNIPER 100', device_serial: 'LIVE-100' }],
    now,
  });
  assert.equal(bySerial.matched, true);
  assert.equal(bySerial.status, 'Unknown (no feed)');
  const byInhand = joinUnitRouter({
    unitKey: 'SNIPER 100',
    routers: [router({ unit_key: 'UNRELATED', inhand_serial: 'LIVE-100', current_status: 'online' })],
    devices: [{ id: 3, unit_key: 'SNIPER 100', device_serial: 'LIVE-100' }],
    now,
  });
  assert.equal(byInhand.matched, true);
  assert.equal(byInhand.status, 'Online');
});

test('both solar spellings join one unit and different numbers do not', () => {
  const units = [
    { id: 'unit-19', unit_number: 'SOLAR SPOTTER 019' },
    { id: 'unit-20', unit_number: 'SOLARSPOTTER 020' },
    { id: 'ss1', unit_number: 'SS001' },
    { id: 'ss4', unit_number: 'SS004' },
  ];
  const devices = [{ id: 148, unit_key: 'SNIPER 148', device_serial: 'CAM-148', do_not_use: null }];
  const rows = [
    router({ id: 19, unit_key: 'SOLARSPOTTER 019', inhand_serial: 'S19' }),
    router({ id: 20, unit_key: 'SOLAR SPOTTER 020', inhand_serial: 'S20' }),
    router({ id: 1, unit_key: 'SS001', inhand_serial: 'A' }),
    router({ id: 4, unit_key: 'SS004', inhand_serial: 'B' }),
    router({ id: 148, unit_key: 'SNIPER 148', inhand_serial: 'CAM-148' }),
  ];
  const snap = routerSnapshot(rows, units, new Date(now), devices);
  const byKey = Object.fromEntries(snap.items.map((item) => [item.unitKey, item]));
  assert.equal(byKey['SOLARSPOTTER 019'].match, 'exact_name');
  assert.equal(byKey['SOLARSPOTTER 019'].candidateUnit.id, 'unit-19');
  assert.equal(byKey['SOLAR SPOTTER 020'].candidateUnit.id, 'unit-20');
  assert.notEqual(byKey['SOLARSPOTTER 019'].candidateUnit.id, byKey['SOLAR SPOTTER 020'].candidateUnit.id);
  assert.equal(byKey.SS001.candidateUnit.id, 'ss1');
  assert.equal(byKey.SS004.candidateUnit.id, 'ss4');
  assert.equal(byKey['SNIPER 148'].candidateUnit.id, 'camera-device:148');
  assert.equal(readRouterSnapshot(snap).items.length, rows.length);
});

test('do not use is a badge only and null means false', () => {
  assert.equal(deviceDoNotUse({}), false);
  assert.equal(deviceDoNotUse({ do_not_use: null }), false);
  assert.equal(deviceDoNotUse({ do_not_use: true }), true);
  const devices = [{ id: 609, unit_key: 'SNIPER 318', device_serial: 'X', do_not_use: true }];
  const snap = routerSnapshot([router({ id: 318, unit_key: 'Sniper 318', inhand_serial: 'X' })], [{ id: 'u318', unit_number: 'SNIPER 318' }], new Date(now), devices);
  assert.equal(snap.items[0].doNotUse, true);
  assert.equal(snap.items[0].match, 'exact_name');
  const board = annotateSavedBoard({
    contract: 'COS_SAVED_FLEET_BOARD_V1',
    units: [{ productId: '1', unitNumber: 'SNIPER 318', status: 'online' }, { productId: '2', unitNumber: 'SNIPER 148', status: 'offline' }],
  }, { routers: [router()], devices }, now);
  assert.equal(board.units.length, 2);
  assert.equal(board.units[0].doNotUse, true);
  assert.equal(board.units[0].status, 'online');
  assert.equal(board.units[1].doNotUse, false);
  assert.equal(JSON.stringify(board).includes('prior_inhand_serial'), false);
  assert.equal(JSON.stringify(board).includes('publicIp'), false);
});

test('a saved Online label older than 3 hours displays as Unknown', () => {
  assert.equal(displayedRouterStatus('Online', fresh, now), 'Online');
  assert.equal(displayedRouterStatus('Offline', stale, now), 'Unknown');
  assert.equal(displayedRouterStatus('Unknown (no feed)', stale, now), 'Unknown (no feed)');
  assert.equal(displayedRouterStatus('Online', null, now), 'Unknown');
});

test('owner and IT keep router addresses and everyone else does not', () => {
  const raw = [router({ router_public_ip: '203.0.113.10', unit_ip: '203.0.113.11' })];
  const units = [{ id: 'u', unit_number: 'SNIPER 148' }];
  const snap = routerSnapshot(raw, units, new Date(now), []);
  for (const role of ['owner', 'it']) {
    const page = presentRouterPage(snap, raw, [], role, now);
    assert.equal(page.items[0].publicIp, '203.0.113.10');
  }
  for (const role of ['service', 'anon', 'signed-out', 'hidden']) {
    const page = presentRouterPage(snap, raw, [], role, now);
    assert.equal(page.items[0].publicIp, null);
    assert.equal(page.items[0].unitIp, null);
    assert.equal(JSON.stringify(page).includes('203.0.113'), false);
  }
});
