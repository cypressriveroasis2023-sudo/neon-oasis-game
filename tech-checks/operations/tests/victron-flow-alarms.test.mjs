import test from 'node:test';
import assert from 'node:assert/strict';
import {powerFlow, victronAlarms, lastConnected, unitTileSummary} from '../src/vrmReadOnlyModel.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';

const now = Date.parse('2026-11-24T22:00:00Z');
const at = min => new Date(now - min * 60000).toISOString();
const m = (metric, value, unit, age = 2, source = 'system', instance = 0) => ({metric, value, unit, source, instance, observedAt: at(age)});
const row = (measurements, id = 1, name = 'HELIOS 001') => ({installationId: id, name, lastAttemptAt: at(1), errorCode: null, measurements});
const unit = (id = 1, name = 'HELIOS 001', extra = {}) => ({installationId: id, name, portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null, ...extra});

test('charging and draining come from a current battery power reading', () => {
  assert.deepEqual(powerFlow(row([m('battery_power', 203, 'W'), m('battery_current', 8.8, 'A')]), now), {state: 'charging', watts: 203, amps: 8.8});
  assert.equal(powerFlow(row([m('battery_power', -37, 'W')]), now).state, 'draining');
  assert.equal(powerFlow(row([m('battery_power', 2, 'W')]), now).state, 'idle');
  // No power reading: battery current decides.
  assert.equal(powerFlow(row([m('battery_current', -1.3, 'A', 2, 'battery', 278)]), now).state, 'draining');
  // A reading over 45 minutes old says nothing about right now.
  assert.equal(powerFlow(row([m('battery_power', -37, 'W', 50)]), now), undefined);
});

test("Victron's own alarms: 0 is quiet, 1 a warning, 2 an alarm, stale ones ignored", () => {
  assert.deepEqual(victronAlarms(row([m('low_voltage_alarm', 0, 'state', 2, 'battery')]), now), []);
  assert.deepEqual(victronAlarms(row([m('low_voltage_alarm', 1, 'state', 2, 'battery'), m('low_voltage_alarm', 2, 'state', 2, 'battery', 512), m('high_voltage_alarm', 1, 'state', 2, 'battery')]), now),
    [{kind: 'Low voltage', level: 2}, {kind: 'High voltage', level: 1}]);
  assert.deepEqual(victronAlarms(row([m('low_soc_alarm', 2, 'state', 60, 'battery')]), now), []);
});

test('an alarm turns a healthy-looking tile red, a warning turns it amber', () => {
  const alarm = unitTileSummary(unit(), [row([m('battery_soc', 80, '%'), m('low_voltage_alarm', 2, 'state', 2, 'battery')])], now);
  assert.equal(alarm.tone, 'low');
  const warn = unitTileSummary(unit(), [row([m('battery_soc', 80, '%'), m('low_soc_alarm', 1, 'state', 2, 'battery')])], now);
  assert.equal(warn.tone, 'fair');
});

test('last connected is the newest reading, or the sync last-seen time', () => {
  assert.equal(lastConnected(unit(), row([m('battery_soc', 80, '%', 20 * 1440), m('solar_power', 0, 'W', 19 * 1440)])), at(19 * 1440));
  assert.equal(lastConnected(unit(1, 'HELIOS 001', {lastSeenAt: at(30)}), undefined), at(30));
  assert.equal(lastConnected(unit(), undefined), undefined);
});

test('Needs attention lists a Victron alarm first and says when stale units last connected', () => {
  const units = [unit(1, 'HELIOS 001'), unit(2, 'HELIOS 002'), unit(3, 'HELIOS 003')];
  const rows = [row([m('battery_soc', 15, '%')], 1, 'HELIOS 001'), row([m('battery_soc', 90, '%'), m('low_voltage_alarm', 2, 'state', 2, 'battery')], 2, 'HELIOS 002'), row([m('battery_soc', 90, '%', 20 * 1440)], 3, 'HELIOS 003')];
  const inventory = ['HELIOS 001', 'HELIOS 002', 'HELIOS 003'].map(unitNumber => ({unitNumber, placement: 'FIELD'}));
  const list = victronNeedsAttention(units, rows, inventory, now);
  assert.deepEqual(list.map(item => [item.name, item.kind]), [['HELIOS 002', 'alarm'], ['HELIOS 001', 'low'], ['HELIOS 003', 'unknown']]);
  assert.match(list[0].line, /Victron alarm · Low voltage · 90%/);
  assert.match(list[2].line, /last connected/);
});
