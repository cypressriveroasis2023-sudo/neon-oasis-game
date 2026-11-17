import test from 'node:test';
import assert from 'node:assert/strict';
import {cosPowerVerdict, EMPTY_POWER_SETTINGS, powerSamples, preferSharedSettings, readPowerAlarmSettings, readSharedPowerAlarmSettings, settingsFromShared, writePowerAlarmSettings, writeSharedPowerAlarmSettings} from '../src/cosPowerAlarms.ts';
import access from '../../supabase/functions/cos-power-alarm-settings/access.ts';
const {powerAlarmActor} = access;

const NOW = Date.parse('2026-11-16T22:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('unset thresholds say unset and never invent a number', () => {
  const verdict = cosPowerVerdict({
    now: NOW,
    settings: EMPTY_POWER_SETTINGS,
    voltage: {value: 19, observedAt: ago(60 * 1000)},
    soc: {value: 10, observedAt: ago(60 * 1000)},
    newestObservedAt: ago(60 * 1000),
    victronLowVoltage: {value: 0, observedAt: ago(60 * 1000)},
  });
  assert.equal(verdict.voltage, 'unset');
  assert.equal(verdict.soc, 'unset');
  assert.equal(verdict.silent, 'unset');
  assert.equal(JSON.stringify(EMPTY_POWER_SETTINGS).includes('24'), false);
  assert.equal(EMPTY_POWER_SETTINGS.lowVoltageV, null);
  assert.equal(EMPTY_POWER_SETTINGS.lowSocPercent, null);
  assert.equal(EMPTY_POWER_SETTINGS.silentHours, null);
});

test('a fresh reading under the owner threshold is a COS alarm', () => {
  const verdict = cosPowerVerdict({
    now: NOW,
    settings: {lowVoltageV: 22, lowSocPercent: 30, silentHours: 6},
    voltage: {value: 19.4, observedAt: ago(2 * 60 * 1000)},
    soc: {value: 46, observedAt: ago(2 * 60 * 1000)},
    newestObservedAt: ago(2 * 60 * 1000),
    victronLowVoltage: {value: 0, observedAt: ago(2 * 60 * 1000)},
  });
  assert.equal(verdict.voltage, 'alarm');
  assert.equal(verdict.soc, 'clear');
  assert.equal(verdict.silent, 'clear');
  assert.equal(verdict.victronLowVoltage, 'clear');
});

test('a stale voltage is unknown, not an alarm, even under the threshold', () => {
  const verdict = cosPowerVerdict({
    now: NOW,
    settings: {lowVoltageV: 22, lowSocPercent: 30, silentHours: null},
    voltage: {value: 12, observedAt: ago(46 * 60 * 1000)},
    soc: {value: 10, observedAt: ago(46 * 60 * 1000)},
  });
  assert.equal(verdict.voltage, 'unknown');
  assert.equal(verdict.soc, 'unknown');
  assert.equal(verdict.silent, 'unset');
});

test('power silent only when the owner set a window and the newest reading is older', () => {
  const quiet = cosPowerVerdict({
    now: NOW,
    settings: {lowVoltageV: null, lowSocPercent: null, silentHours: 4},
    newestObservedAt: ago(5 * 60 * 60 * 1000),
  });
  const speaking = cosPowerVerdict({
    now: NOW,
    settings: {lowVoltageV: null, lowSocPercent: null, silentHours: 6},
    newestObservedAt: ago(2 * 60 * 60 * 1000),
  });
  assert.equal(quiet.silent, 'alarm');
  assert.equal(speaking.silent, 'clear');
});

test('Victron alarm state stays separate from the COS voltage check', () => {
  const verdict = cosPowerVerdict({
    now: NOW,
    settings: {lowVoltageV: 18, lowSocPercent: null, silentHours: null},
    voltage: {value: 24, observedAt: ago(60 * 1000)},
    victronLowVoltage: {value: 2, observedAt: ago(60 * 1000)},
  });
  assert.equal(verdict.voltage, 'clear');
  assert.equal(verdict.victronLowVoltage, 'alarm');
});

test('stored settings keep nulls and reject a blank form instead of filling a default', () => {
  const store = new Map();
  const storage = {getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  assert.deepEqual(readPowerAlarmSettings(storage), EMPTY_POWER_SETTINGS);
  writePowerAlarmSettings(storage, {lowVoltageV: 23.5, lowSocPercent: null, silentHours: 8});
  assert.deepEqual(readPowerAlarmSettings(storage), {lowVoltageV: 23.5, lowSocPercent: null, silentHours: 8});
});

test('a failed shared read keeps the browser cache, and an explicit unset replaces it', () => {
  const cache = {lowVoltageV: 23, lowSocPercent: 40, silentHours: 8};
  assert.deepEqual(preferSharedSettings(undefined, cache), cache);
  const unset = settingsFromShared({lowVoltageV: null, lowSocPercent: null, silentHours: null});
  assert.deepEqual(preferSharedSettings(unset, cache), EMPTY_POWER_SETTINGS);
  assert.equal(JSON.stringify(unset).includes('24'), false);
});

test('the shared write sends nulls and does not cache a rejected save', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, body: JSON.parse(init.body)});
    return {ok: false, status: 403, json: async () => ({error: 'denied'})};
  };
  const saved = await writeSharedPowerAlarmSettings('token', {lowVoltageV: null, lowSocPercent: 15, silentHours: null}, fetcher);
  assert.equal(saved, undefined);
  assert.equal(calls[0].body.lowVoltageV, null);
  assert.equal(calls[0].body.lowSocPercent, 15);
  assert.equal(calls[0].body.action, 'write');
  const store = new Map();
  const storage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)};
  writePowerAlarmSettings(storage, {lowVoltageV: 21, lowSocPercent: null, silentHours: null});
  assert.deepEqual(readPowerAlarmSettings(storage).lowVoltageV, 21);
});

test('a shared read of an empty row does not invent a threshold', async () => {
  const fetcher = async () => ({ok: true, json: async () => ({lowVoltageV: null, lowSocPercent: null, silentHours: null, canWrite: true})});
  assert.deepEqual(await readSharedPowerAlarmSettings('token', fetcher), EMPTY_POWER_SETTINGS);
});

test('only the owner and verified IT links can write shared thresholds', () => {
  assert.equal(powerAlarmActor({id: 'e4abc521-1ef3-45a6-9829-b87faff78210', role: 'owner', active: true}).canWrite, true);
  assert.equal(powerAlarmActor({id: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', role: 'it', active: true}).canWrite, true);
  assert.equal(powerAlarmActor({id: '78e54fbd-c2db-4d18-8e3d-a9740adcf285', role: 'service', active: true}).canWrite, false);
  assert.equal(powerAlarmActor({id: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', role: 'service', active: true}), null);
  assert.equal(powerAlarmActor({id: '4f7044b5-86b6-411f-8898-39bb64b4ddbc', role: 'it', active: false}), null);
  assert.equal(powerAlarmActor({id: '00000000-0000-4000-8000-000000000000', role: 'it', active: true}), null);
});

test('samples keep the newest voltage, charge, and Victron state bit', () => {
  const samples = powerSamples([
    {metric: 'battery_voltage', value: 20, unit: 'V', observedAt: ago(10 * 60 * 1000)},
    {metric: 'battery_voltage', value: 23, unit: 'V', observedAt: ago(60 * 1000)},
    {metric: 'battery_soc', value: 40, unit: '%', observedAt: ago(60 * 1000)},
    {metric: 'low_voltage_alarm', value: 1, unit: 'state', observedAt: ago(60 * 1000)},
  ]);
  assert.equal(samples.voltage.value, 23);
  assert.equal(samples.soc.value, 40);
  assert.equal(samples.victronLowVoltage.value, 1);
});
