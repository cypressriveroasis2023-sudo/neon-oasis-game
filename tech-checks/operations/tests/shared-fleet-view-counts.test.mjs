import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cosPowerVerdict} from '../src/cosPowerAlarms.ts';
import {batteryAlarmPower, fleetProblems, technicianTodos} from '../src/technicianTodos.ts';
import {
  cameraStatusCounts, equipmentTotalsCounts, fleetDashboardCounts, isSniper4100, phoneLandingCounts,
  selectFleetCounts, tvFleetCounts,
} from '../src/sharedFleetCounts.ts';

const now = Date.parse('2026-11-20T12:42:00Z');
const fresh = new Date(now - 5 * 60 * 1000).toISOString();
const stale = new Date(now - 3 * 60 * 60 * 1000).toISOString();

const unit = (name, placement, cameras, extra = {}) => ({
  name, placement, cameras, newestOnlineAt: null, unverifiedReason: null, ...extra,
});
const offline = observedAt => [{state: 'offline', observedAt}];
const online = observedAt => [{state: 'online', observedAt}];

const fixture = [
  unit('Spotter 1', 'field', online(fresh)),
  unit('Spotter 2', 'field', offline(fresh)),
  unit('Spotter 3', 'field', offline(stale)),
  unit('Sniper 44', 'shop', offline(fresh)),
  unit('CAMV 090', 'shop', offline(fresh), {doNotUse: true}),
  unit('Sniper 318', 'field', offline(fresh), {doNotUse: true}),
  unit('Quiet', 'unknown', online(fresh)),
  unit('Sniper 4-100', 'shop', offline(fresh)),
];

const problems = fleetProblems({
  cameras: [
    {unit: 'Spotter 2', placement: 'FIELD', state: 'RED', offline: 1},
    {unit: 'Sniper 44', placement: 'SHOP', state: 'RED', offline: 1},
  ],
  routers: [{unit: 'Spotter 2', placement: 'FIELD', routerOffline: true, routerObservedAt: now - 60 * 1000, cameraOnlineAt: null}],
  addresses: [{unit: 'Camv 4', productId: 'p1', placement: 'FIELD'}],
  power: [{unit: 'Helios 8', placement: 'FIELD', verdict: {voltage: 'alarm', soc: 'clear', silent: 'alarm', victronLowVoltage: 'clear'}}],
});

function views(units, list = problems) {
  return {
    fleet: fleetDashboardCounts(units, now, list),
    camera: cameraStatusCounts(units, now, list),
    tv: tvFleetCounts(units, now, list),
    phone: phoneLandingCounts(units, now, list),
    equipment: equipmentTotalsCounts(units, now, list),
  };
}

test('one synthetic fixture gives identical numbers on every view', () => {
  const seen = views(fixture);
  const names = Object.keys(seen);
  for (const name of names) assert.deepEqual(seen[name], seen.fleet, name);
  assert.deepEqual(seen.fleet.units, {online: 1, offline: 1, unknown: 2});
  assert.equal(seen.fleet.problemCount, seen.fleet.problems.length);
  assert.equal(seen.fleet.problems.length, 4);
  assert.deepEqual(seen.fleet.problems.map(problem => problem.kind), ['camera_offline', 'router_offline', 'battery_alarm', 'mhelp_address']);
});

test('cameras is never a dash on one view and a number on another', () => {
  const present = Object.values(views(fixture)).map(view => view.cameras);
  assert.ok(present.every(cameras => cameras && typeof cameras.online === 'number'));
  assert.deepEqual(present[0], {online: 1, offline: 1, unknown: 2});
  for (const cameras of present) assert.deepEqual(cameras, present[0]);
  const missing = Object.values(views(null)).map(view => view.cameras === null ? '—' : String(view.cameras.online));
  assert.deepEqual(missing, ['—', '—', '—', '—', '—']);
});

test('a shop row is never Down, including Sniper 4-100', () => {
  assert.equal(isSniper4100('Sniper 4-100'), true);
  const counts = selectFleetCounts(fixture, now);
  assert.equal(counts.units.offline, 1);
  assert.equal(counts.inShopUnits, 2);
  assert.equal(counts.cameras.offline, 1);
  const shopSniper = selectFleetCounts([unit('Sniper 4-100', 'shop', offline(fresh))], now);
  assert.deepEqual(shopSniper.units, {online: 0, offline: 0, unknown: 0});
  assert.equal(shopSniper.inShopUnits, 1);
  assert.equal(shopSniper.cameras.offline, 0);
  const fieldSniper = selectFleetCounts([unit('Sniper 4-100', 'field', offline(fresh))], now);
  assert.deepEqual(fieldSniper.units, {online: 0, offline: 1, unknown: 0});
  const staleSniper = selectFleetCounts([unit('Sniper 4-100', 'field', offline(stale))], now);
  assert.deepEqual(staleSniper.units, {online: 0, offline: 0, unknown: 1});
});

test('in shop and DO NOT USE are excluded, and the Sniper 318 exception holds', () => {
  const counts = selectFleetCounts(fixture, now);
  assert.equal(counts.inShopUnits, 2);
  assert.equal(counts.doNotUseUnits, 1);
  assert.equal(counts.exceptionUnits, 1);
  assert.equal(counts.units.online + counts.units.offline + counts.units.unknown, 4);
  const named = selectFleetCounts([
    unit('Sniper 318', 'field', offline(fresh), {doNotUse: true}),
    unit('Spotter 1', 'field', online(fresh)),
  ], now);
  assert.equal(named.exceptionUnits, 1);
  assert.equal(named.doNotUseUnits, 0);
  assert.equal(named.inShopUnits, 0);
  assert.deepEqual(named.units, {online: 1, offline: 0, unknown: 0});
  assert.equal(named.cameras.offline, 0);
});

test('unknown placement is Unknown, never field online', () => {
  const counts = selectFleetCounts([unit('Quiet', 'unknown', online(fresh))], now);
  assert.deepEqual(counts.units, {online: 0, offline: 0, unknown: 1});
  assert.equal(counts.cameras.online, 0);
  assert.equal(counts.cameras.offline, 0);
  assert.equal(counts.cameras.unknown, 1);
});

test('the Problems count equals the list length', () => {
  const counts = fleetDashboardCounts(fixture, now, problems);
  assert.equal(counts.problemCount, counts.problems.length);
  assert.equal(counts.problems.length, problems.length);
  assert.equal(counts.problems.some(problem => problem.kind === 'mhelp_address'), true);
  assert.equal(counts.problems.some(problem => problem.kind === 'power_silent'), false);
  assert.equal(counts.problems.some(problem => problem.kind === 'sim_cancel'), false);
});

test('a missing Victron feed raises no power Problem', () => {
  const verdict = cosPowerVerdict({
    now,
    settings: {lowVoltageV: 12, lowSocPercent: 20, silentHours: 1},
    newestObservedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(verdict.silent, 'alarm');
  const direct = technicianTodos({power: [{unit: 'Helios 8', placement: 'FIELD', verdict}]});
  assert.equal(direct.some(problem => problem.kind === 'power_silent'), true);
  const missing = fleetProblems({power: [{unit: 'Helios 8', placement: 'FIELD', verdict}], victronFeedFresh: false});
  assert.deepEqual(missing, []);
  const ungated = fleetProblems({power: [{unit: 'Helios 8', placement: 'FIELD', verdict}], victronFeedFresh: true});
  assert.equal(ungated.some(problem => problem.kind === 'power_silent'), false);
  assert.equal(ungated.some(problem => problem.kind === 'battery_alarm'), false);
});

test('a stalled or old Victron read raises no power Problem', () => {
  const old = new Date(now - 5 * 60 * 60 * 1000).toISOString();
  const settings = {lowVoltageV: 12, lowSocPercent: 20, silentHours: 1};
  const units = [{unit: 'HELIOS 001', placement: 'FIELD'}];
  const payload = {
    items: [{name: 'HELIOS 001', installationId: 1001}],
    power: [{name: 'HELIOS 001', installationId: 1001, errorCode: null, lastAttemptAt: old, measurements: [
      {metric: 'battery_voltage', unit: 'V', value: 10, instance: 512, source: 'battery', observedAt: old},
      {metric: 'battery_soc', unit: '%', value: 10, instance: 512, source: 'battery', observedAt: old},
    ]}],
  };
  const stalled = batteryAlarmPower(units, payload, now, settings, false);
  assert.deepEqual(stalled, []);
  assert.equal(fleetProblems({power: stalled, victronFeedFresh: false}).some(problem => problem.kind === 'power_silent' || problem.kind === 'battery_alarm'), false);
  const aged = batteryAlarmPower(units, payload, now, settings, true);
  assert.equal(aged.some(row => row.verdict.silent === 'alarm'), true);
  const listed = fleetProblems({power: aged, victronFeedFresh: true});
  assert.equal(listed.some(problem => problem.kind === 'power_silent' || problem.kind === 'battery_alarm'), false);
});

test('the five screens call the shared count', () => {
  const fleet = readFileSync(new URL('../src/FleetDashboard.tsx', import.meta.url), 'utf8');
  const camera = readFileSync(new URL('../src/FleetCameraStatus.tsx', import.meta.url), 'utf8');
  const tv = readFileSync(new URL('../src/TvFleetView.tsx', import.meta.url), 'utf8');
  const equipment = readFileSync(new URL('../src/FleetEquipmentTotals.tsx', import.meta.url), 'utf8');
  assert.match(fleet, /fleetDashboardCounts\(/);
  assert.match(fleet, /todos=\{sharedCounts\.problems\}/);
  assert.match(camera, /fleetCounts\?fleetCounts\.problems/);
  assert.match(camera, /fleetProblems\(/);
  assert.match(tv, /tvFleetCounts\(/);
  assert.match(equipment, /agreedCounts\.units\.online/);
});

test('a battery alarm stays and power_silent stays out while cleanup stays', () => {
  const alarm = {voltage: 'alarm', soc: 'clear', silent: 'alarm', victronLowVoltage: 'clear'};
  const list = fleetProblems({
    power: [{unit: 'Helios 8', placement: 'FIELD', verdict: alarm}],
    addresses: [{unit: 'Camv 4', productId: 'p1', placement: 'FIELD'}],
    simCancels: [{unit: 'Camv 9', productId: 'sim-1'}],
    victronFeedFresh: true,
  });
  const snapshot = selectFleetCounts([unit('Helios 8', 'field', online(fresh))], now, list);
  assert.deepEqual(snapshot.problems.map(problem => problem.kind), ['battery_alarm', 'sim_cancel', 'mhelp_address']);
  assert.equal(snapshot.problems.length, 3);
});
