import test from 'node:test';
import assert from 'node:assert/strict';
import {tonightForecast, tonightHeadline, tonightSteps, isNightForecastTime} from '../src/vrmHistory.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';

const local = (day, hour, min = 0) => new Date(2026, 10, day, hour, min).getTime();
const s = ms => Math.round(ms / 1000);
// Battery readings every 15 minutes for the 2 hours before `now`, starting at `start`% and changing `perHour`.
const drain = (now, start, perHour) => Array.from({length: 9}, (_, i) => [s(now) - (8 - i) * 900, start + perHour * (i * 0.25), 0, -30]);

test('the estimate only runs from 5 PM to 7 AM', () => {
  assert.equal(isNightForecastTime(local(24, 16, 59)), false);
  assert.equal(isNightForecastTime(local(24, 17)), true);
  assert.equal(isNightForecastTime(local(25, 6, 59)), true);
  assert.equal(isNightForecastTime(local(25, 7)), false);
  assert.equal(tonightForecast(drain(local(24, 12), 80, -2), local(24, 12)), null);
});

test('a slow drain makes it to morning', () => {
  const now = local(24, 22);
  const t = tonightForecast(drain(now, 82, -2), now);
  assert.equal(t.verdict, 'ok');
  assert.equal(t.battery, 78);
  assert.ok(t.atMorning > 50 && t.atMorning < 62);
  assert.match(tonightHeadline(t), /Should make it to morning/);
  assert.deepEqual(tonightSteps(t), []);
});

test('a fast drain is "will run low" with the time it reaches 20%', () => {
  const now = local(24, 21);
  const t = tonightForecast(drain(now, 64, -8), now);
  assert.equal(t.verdict, 'low');
  // 48% now, -8%/h -> 20% in 3.5 h -> about 12:30 AM.
  const at = new Date(t.floorAt * 1000);
  assert.equal(at.getHours(), 0);
  assert.ok(at.getMinutes() >= 25 && at.getMinutes() <= 35);
  assert.match(tonightHeadline(t), /Will run low — reaches 20% around/);
  assert.equal(tonightSteps(t).length, 4);
});

test('ending between 20% and 29% at 7 AM is tight', () => {
  const now = local(24, 23);
  const t = tonightForecast(drain(now, 59, -3), now);
  assert.equal(t.verdict, 'tight');
  assert.match(tonightHeadline(t), /Tight/);
});

test('flat or rising is "holding steady"', () => {
  const now = local(24, 19);
  assert.equal(tonightForecast(drain(now, 90, 0), now).verdict, 'charging');
});

test('too few or too old readings give no estimate rather than a guess', () => {
  const now = local(24, 22);
  assert.equal(tonightForecast(drain(now, 80, -2).slice(-3), now), null);
  const old = drain(now - 90 * 60000, 80, -2);
  assert.equal(tonightForecast(old, now), null);
});

test('Needs attention lists "will run low" Field units above "getting low", and "tight" below history flags', () => {
  const now = local(24, 21);
  const m = (v) => ({metric: 'battery_soc', value: v, unit: '%', source: 'system', instance: 0, observedAt: new Date(now - 60000).toISOString()});
  const units = [1, 2, 3].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null}));
  const rows = [{installationId: 1, name: 'HELIOS 001', lastAttemptAt: null, errorCode: null, measurements: [m(48)]},
    {installationId: 2, name: 'HELIOS 002', lastAttemptAt: null, errorCode: null, measurements: [m(30)]},
    {installationId: 3, name: 'HELIOS 003', lastAttemptAt: null, errorCode: null, measurements: [m(59)]}];
  const inventory = ['HELIOS 001', 'HELIOS 002', 'HELIOS 003'].map(unitNumber => ({unitNumber, placement: 'FIELD'}));
  const tonight = new Map([[1, tonightForecast(drain(now, 64, -8), now)], [3, tonightForecast(drain(local(24, 23), 59, -3), local(24, 23))]]);
  const list = victronNeedsAttention(units, rows, inventory, now, null, tonight);
  assert.deepEqual(list.map(i => [i.name, i.kind]), [['HELIOS 001', 'tonight'], ['HELIOS 002', 'fair'], ['HELIOS 003', 'tight']]);
});
