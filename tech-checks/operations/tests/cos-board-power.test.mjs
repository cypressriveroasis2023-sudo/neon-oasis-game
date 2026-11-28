import test from 'node:test';
import assert from 'node:assert/strict';
import {boardPowerByUnit, boardPowerFor} from '../src/cosBoard/boardPower.ts';
import {boardData} from '../src/cosBoard/boardData.ts';
import {cameraFeedCensus, cameraFeedClock} from '../src/sharedFleetCounts.ts';

const now = Date.parse('2026-11-24T15:00:00Z');
const at = minutes => new Date(now - minutes * 60000).toISOString();
const item = (id, name, extra = {}) => ({installationId: id, name, portalUrl: `https://vrm.victronenergy.com/installation/${id}/dashboard`, embedUrl: null, ...extra});
const m = (metric, value, unit, observedAt, source = 'system', instance = 0) => ({metric, value, unit, source, instance, observedAt});
const fleet = {
  items: [item(1, 'HELIOS 001'), item(2, 'HELIOS 002'), item(3, 'HELIOS 003'), item(4, 'HELIOS 004', {available: false}), item(5, 'HELIOS 005'), item(6, 'HELIOS 005'), item(7, 'Shop bench')],
  sync: null,
  power: [
    {installationId: 1, name: 'HELIOS 001', lastAttemptAt: at(1), errorCode: null, measurements: [m('battery_soc', 86.4, '%', at(2)), m('solar_power', 380, 'W', at(2)), m('battery_voltage', 26.31, 'V', at(2))]},
    // Two separate battery monitors and no system reading: the lowest one, never the average.
    {installationId: 2, name: 'HELIOS 002', lastAttemptAt: at(1), errorCode: null, measurements: [m('battery_soc', 90, '%', at(2), 'battery', 278), m('battery_soc', 15, '%', at(2), 'battery', 512)]},
    {installationId: 3, name: 'HELIOS 003', lastAttemptAt: at(1), errorCode: null, measurements: [m('battery_soc', 70, '%', at(50))]},
    {installationId: 5, name: 'HELIOS 005', lastAttemptAt: at(1), errorCode: null, measurements: [m('battery_soc', 99, '%', at(2))]},
    {installationId: 6, name: 'HELIOS 005', lastAttemptAt: at(1), errorCode: null, measurements: [m('battery_soc', 5, '%', at(2))]},
  ],
};

test('Victron power matches a Helios by exact number and never averages batteries', () => {
  const power = boardPowerByUnit(fleet, now);
  assert.deepEqual(boardPowerFor(power, 'Helios 001'), {b: 86, w: 380, v: 26.3, t: Math.round(Date.parse(at(2)) / 1000), q: 'good', ls: Math.round(Date.parse(at(2)) / 1000)});
  assert.equal(boardPowerFor(power, 'HELIOS 002').b, 15);
  assert.equal(boardPowerFor(power, 'HELIOS 002').q, 'low');
  // A 50-minute-old reading is not called current (cutoff 45).
  assert.equal(boardPowerFor(power, 'HELIOS 003').q, 'stale');
  assert.equal(boardPowerFor(power, 'HELIOS 004').q, 'off');
  // Two installations named HELIOS 005: no guess.
  assert.equal(boardPowerFor(power, 'HELIOS 005'), undefined);
  assert.equal(boardPowerFor(power, 'SPOTTER 001'), undefined);
  assert.equal(power.size, 4);
});

test('bad or missing Victron data leaves the board without power, not with invented readings', () => {
  assert.equal(boardPowerByUnit(null, now).size, 0);
  assert.equal(boardPowerByUnit({items: 'nope'}, now).size, 0);
});

test('the board carries power on the matching Helios unit only', () => {
  const unit = name => ({unit: name, placement: 'FIELD', site: 'Yard', siteNamePending: false, state: 'GREEN', cameras: 3, online: 3, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: at(5), source: 'star4live'});
  const feed = [unit('HELIOS 001'), unit('SPOTTER 009')];
  const census = cameraFeedCensus(feed, [], now);
  const data = boardData({feed, census, now: cameraFeedClock(feed, now), power: boardPowerByUnit(fleet, now)});
  assert.equal(data.units[0].pw.b, 86);
  assert.equal('pw' in data.units[1], false);
  // Power never changes the camera verdict.
  assert.equal(data.units[0].vd, boardData({feed, census, now: cameraFeedClock(feed, now)}).units[0].vd);
});

test('Board power carries days without sun and battery health, from saved nights first', () => {
  const S = Math.round(now / 1000), points = [];
  for (let t = S - 40 * 3600; t <= S - 120; t += 1800) { const h = new Date(t * 1000).getHours(), dark = h < 6 || h >= 19, sun = h >= 10 && h < 16;
    points.push([t, 86, sun ? 300 : 0, dark ? -36 : sun ? 271 : -30]); }
  const power = boardPowerByUnit(fleet, now, new Map([[1, points]]), null, null, new Map([[1, [['2026-11-22', 3010], ['2026-11-23', 2990]]]]));
  const p = boardPowerFor(power, 'HELIOS 001');
  assert.ok(p.ds && p.ds.f > 3 && p.ds.f < 4 && p.ds.n < p.ds.f, JSON.stringify(p.ds));
  assert.deepEqual(p.bh, {l: '100%+', k: 3, n: 2, w: false});
  const worn = boardPowerFor(boardPowerByUnit(fleet, now, null, null, null, new Map([[1, [['2026-11-22', 2000], ['2026-11-23', 2050]]]])), 'HELIOS 001');
  assert.deepEqual(worn.bh, {l: '74%', k: 2.1, n: 2, w: true});
  assert.equal(worn.ds, undefined);   // no history, no estimate
});
