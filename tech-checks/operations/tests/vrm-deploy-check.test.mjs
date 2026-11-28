import test from 'node:test';
import assert from 'node:assert/strict';
import {daylightHours, deployCheck, deployStart, newlyDeployed} from '../src/vrmDeployCheck.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';

const H = 3600, local = (d, h, m = 0) => Math.round(new Date(2026, 10, d, h, m).getTime() / 1000);
const run = (from, to, f) => { const pts = []; for (let t = from; t <= to; t += 1800) pts.push(f(t)); return pts; };
const day = t => { const h = new Date(t * 1000).getHours(); return h >= 9 && h < 16; };
const healthy = t => [t, day(t) ? 98 : 80, day(t) ? 300 : 0, day(t) ? 200 : -30];

test('a run of readings after 6+ hours off is a fresh start; a steady unit is not', () => {
  const fleetStart = local(25, 0);
  assert.equal(deployStart(run(local(25, 0), local(27, 12), healthy), fleetStart), null);
  const moved = [[local(10, 9), 90, 0, 0], ...run(local(27, 8), local(27, 12), healthy)];   // old Shop seed point, then on at site
  assert.equal(deployStart(moved, fleetStart), local(27, 8));
  assert.equal(deployStart(run(local(26, 14), local(27, 12), healthy), fleetStart), local(26, 14));  // first reading well after the rest
  assert.equal(deployStart(run(local(25, 2), local(27, 12), healthy), fleetStart), null);           // same start as the rest
  assert.equal(deployStart([], fleetStart), null);
});

test('several units "starting" in the same hour is a sync outage, not deploys; Shop units are skipped', () => {
  const history = new Map([[1, run(local(25, 0), local(27, 12), healthy)]]);
  for (let id = 2; id <= 6; id++) history.set(id, [...run(local(25, 0), local(26, 0), healthy), ...run(local(27, 8), local(27, 12), healthy)]);
  const units = [1, 2, 3, 4, 5, 6].map(id => ({installationId: id, name: 'HELIOS 00' + id}));
  assert.deepEqual(newlyDeployed(units, history, () => true), []);
  history.set(7, [[local(10, 9), 90, 0, 0], ...run(local(27, 9), local(27, 12), healthy)]);
  units.push({installationId: 7, name: 'HELIOS 007'});
  assert.deepEqual(newlyDeployed(units, history, () => true).map(u => u.name), ['HELIOS 007']);
  assert.deepEqual(newlyDeployed(units, history, name => name !== 'HELIOS 007'), []);
});

test('daylight hours count 9 AM to 4 PM only', () => {
  assert.equal(daylightHours(local(27, 6), local(27, 11)), 2);
  assert.equal(daylightHours(local(26, 15), local(27, 10)), 2);
  assert.equal(daylightHours(local(27, 17), local(27, 23)), 0);
});

const mpptOk = now => ({observedAt: now / 1000 - 300, yieldToday: 0.5, yieldYesterday: null, peakToday: 300, peakYesterday: null, panelVolts: 38, errorCode: 0});

test('a good setup: waits for what has not happened yet, then passes everything', () => {
  const since = local(27, 7), early = local(27, 8) * 1000;
  const a = deployCheck({installationId: 1, name: 'HELIOS 012', since, fresh: true, hasBattery: true, points: run(since, local(27, 8), healthy), mppt: mpptOk(early)}, early);
  assert.deepEqual(a.checks.map(c => c.state), ['ok', 'ok', 'ok', 'wait', 'wait', 'wait']);
  assert.equal(a.failed.length, 0); assert.equal(a.done, false);
  const later = local(28, 10) * 1000;
  const b = deployCheck({installationId: 1, name: 'HELIOS 012', since, fresh: true, hasBattery: true, points: run(since, local(28, 10), healthy), mppt: mpptOk(later)}, later);
  assert.deepEqual(b.checks.map(c => [c.label, c.state]), [['Reporting to Victron', 'ok'], ['Battery reading', 'ok'], ['Solar charger', 'ok'], ['Panels producing', 'ok'], ['Charged to full', 'ok'], ['First night', 'ok']]);
  assert.equal(b.done, true);
});

test('panels not wired: no solar after daylight, battery never fills, first night drops low', () => {
  const since = local(27, 7), now = local(28, 8) * 1000;
  let soc = 70; const points = run(since, local(28, 8), t => [t, (soc = Math.max(5, soc - 1.2)), 0, -30]);
  const d = deployCheck({installationId: 1, name: 'HELIOS 012', since, fresh: true, hasBattery: true, points, mppt: {...mpptOk(now), panelVolts: 2, errorCode: 0}}, now);
  assert.deepEqual(d.failed.map(c => c.label), ['Panels producing', 'Charged to full', 'First night']);
  assert.match(d.failed[0].note, /^nothing in 7 h of daylight$/);
});

test('Needs attention lists a failed setup near the top, even when the unit has other lines', () => {
  const now = Date.parse('2026-11-27T18:00:00Z'), at = m => new Date(now - m * 60000).toISOString();
  const units = [{installationId: 12, name: 'HELIOS 012', portalUrl: 'https://vrm.victronenergy.com/installation/12/dashboard', embedUrl: null}];
  const rows = [{installationId: 12, name: 'HELIOS 012', lastAttemptAt: at(1), errorCode: null, measurements: [{metric: 'battery_soc', value: 15, unit: '%', source: 'system', instance: 0, observedAt: at(2)}]}];
  const deploys = [{installationId: 12, name: 'HELIOS 012', since: now / 1000 - 6 * H, checks: [], done: false,
    failed: [{label: 'Panels producing', state: 'fail', note: 'nothing in 4 h of daylight'}, {label: 'Solar charger', state: 'fail', note: 'not seen'}]}];
  const list = victronNeedsAttention(units, rows, [{unitNumber: 'HELIOS 012', placement: 'FIELD'}], now, null, null, null, null, deploys);
  assert.deepEqual(list.map(i => [i.kind, i.line]), [
    ['deploy', 'Just set up · panels producing (nothing in 4 h of daylight), solar charger (not seen)'],
    ['low', 'Low battery · 15%']]);
});

import {cloudyReserve} from '../src/vrmHistory.ts';
test('If the sun stopped: days to 20% at the unit\'s own night draw', () => {
  const now = new Date(2026, 10, 28, 0, 30).getTime(), N = now / 1000, pts = [];
  for (let t = N - 30 * 3600; t <= N; t += 1800) { const h = new Date(t * 1000).getHours(), night = h < 7 || h >= 18; pts.push([t, 91, night ? 0 : 300, night ? -36 : 150]); }
  const r = cloudyReserve(pts, now);
  assert.deepEqual(r, {days: 2.4, watts: 36, soc: 91});          // 36 W × 24 h = 864 Wh ≈ 29%/day; 71 points to 20%
  assert.equal(cloudyReserve(pts.slice(0, -4), now), null);       // last reading too old
  assert.equal(cloudyReserve(pts.map(p => [p[0], p[1], 300, 150]), now), null);   // never seen discharging at night
  assert.equal(cloudyReserve([], now), null);
});
