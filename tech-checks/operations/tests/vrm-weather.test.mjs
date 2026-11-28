import test from 'node:test';
import assert from 'node:assert/strict';
import {zipAreaSpot, heliosSpots, readSunForecast, parseDaily, sunOutlook, cloudyWarning, outlookLine, isGray} from '../src/vrmWeather.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';
import {canonicalCameraUnit} from '../src/fieldCameraHealth.ts';

const local = (day, hour) => new Date(2026, 10, day, hour).getTime();
const days = (...spec) => spec.map(([date, mj, cloud]) => ({date, mj, cloud}));
const sky = days(['2026-11-25', 12, 20], ['2026-11-26', 3.1, 95], ['2026-11-27', 4.2, 90], ['2026-11-28', 11, 30]);

test('only Field Helios units with real coordinates get a spot, rounded to about 1 km', () => {
  const spots = heliosSpots([
    {unitNumber: 'HELIOS 001', placement: 'field', latitude: '29.761234', longitude: -95.369876},
    {unitNumber: 'HELIOS 002', placement: 'shop', latitude: 29.7, longitude: -95.3},
    {unitNumber: 'HELIOS 003', placement: 'field', latitude: null, longitude: null},
    {unitNumber: 'HELIOS 004', placement: 'field', latitude: 0, longitude: 0},
    {unitNumber: 'SS058', placement: 'field', latitude: 30, longitude: -97},
    {unitNumber: 'HELIOS 005', placement: 'field', latitude: 30, longitude: -97},
    {unitNumber: 'HELIOS 005', placement: 'field', latitude: 31, longitude: -98},
  ]);
  assert.deepEqual([...spots.keys()], [...heliosSpots([{unitNumber: 'HELIOS 001', placement: 'field', latitude: 1, longitude: 1}]).keys()]);
  assert.deepEqual([...spots.values()], [{lat: 29.76, lon: -95.37}]);
});

test('gray day = under 7 MJ/m² of sun; cloud cover only counts when there is no sunlight figure', () => {
  assert.equal(isGray({date: 'x', mj: 6.9, cloud: 10}), true);
  assert.equal(isGray({date: 'x', mj: 14.8, cloud: 96}), false);   // thin high cloud, full sun: the live Houston case
  assert.equal(isGray({date: 'x', mj: 5.8, cloud: 93}), true);
  assert.equal(isGray({date: 'x', mj: null, cloud: 85}), true);
  assert.equal(isGray({date: 'x', mj: null, cloud: 60}), false);
});

test('the outlook is today and tomorrow in the morning, tomorrow and the next day after 3 PM', () => {
  assert.deepEqual(sunOutlook(sky, local(25, 8)).map(d => [d.label, d.gray]), [['Today', false], ['Tomorrow', true]]);
  const late = sunOutlook(sky, local(25, 18));
  assert.deepEqual(late.map(d => [d.label, d.gray]), [['Tomorrow', true], ['Friday', true]]);
  assert.equal(outlookLine(late), '☁ Tomorrow · ☁ Friday');
});

test('warn only when gray days meet a battery that is already down', () => {
  const late = sunOutlook(sky, local(25, 18)), morning = sunOutlook(sky, local(25, 8));
  assert.equal(cloudyWarning(late, 79), 'Cloudy days ahead · tomorrow and Friday look gray, battery 79%');
  assert.equal(cloudyWarning(late, 92), null);
  assert.equal(cloudyWarning(morning, 70), null);           // today is sunny
  assert.equal(cloudyWarning(sunOutlook(days(['2026-11-26', 3, 95], ['2026-11-27', 12, 10]), local(25, 18)), 55), 'Cloudy day ahead · tomorrow looks gray, battery 55%');
  assert.equal(cloudyWarning(late, null), null);
});

test('one batched request for all sites; failure means no weather, never a guess', async () => {
  const spots = new Map([['A', {lat: 29.76, lon: -95.37}], ['B', {lat: 30.27, lon: -97.74}], ['C', {lat: 29.76, lon: -95.37}]]);
  let url = '';
  const daily = d => ({daily: {time: ['2026-11-25', '2026-11-26'], shortwave_radiation_sum: [d, 3], cloud_cover_mean: [10, 95]}});
  const ok = async u => { url = u; return {ok: true, json: async () => [daily(12), daily(8)]}; };
  const map = await readSunForecast(spots, ok);
  assert.match(url, /latitude=29\.76,30\.27&longitude=-95\.37,-97\.74&daily=shortwave_radiation_sum,cloud_cover_mean/);
  assert.equal(map.get('A')[0].mj, 12); assert.equal(map.get('B')[0].mj, 8); assert.equal(map.get('C')[0].mj, 12);
  assert.equal(await readSunForecast(spots, async () => ({ok: false})), null);
  assert.equal(await readSunForecast(spots, async () => { throw new Error('offline'); }), null);
  assert.equal(await readSunForecast(spots, async () => ({ok: true, json: async () => [daily(1)]})), null);
  assert.deepEqual(parseDaily({nope: 1}), null);
});

test('Needs attention: "Cloudy days ahead" for a Field unit already down, nothing for a full one', () => {
  const now = local(25, 18);
  const m = v => ({metric: 'battery_soc', value: v, unit: '%', source: 'system', instance: 0, observedAt: new Date(now - 60000).toISOString()});
  const units = [1, 2].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null}));
  const rows = [{installationId: 1, name: 'HELIOS 001', lastAttemptAt: null, errorCode: null, measurements: [m(72)]},
    {installationId: 2, name: 'HELIOS 002', lastAttemptAt: null, errorCode: null, measurements: [m(96)]}];
  const inventory = ['HELIOS 001', 'HELIOS 002'].map(unitNumber => ({unitNumber, placement: 'FIELD'}));
  const o = sunOutlook(sky, now);
  const weather = new Map([[canonicalCameraUnit('HELIOS 001'), o], [canonicalCameraUnit('HELIOS 002'), o]]);
  const list = victronNeedsAttention(units, rows, inventory, now, null, null, weather);
  assert.deepEqual(list.map(i => [i.name, i.kind, i.line]), [['HELIOS 001', 'cloudy', 'Cloudy days ahead · tomorrow and Friday look gray, battery 72%']]);
});

test('no map point: aim at the ZIP area of the mHelp address (the right town is enough for sun)', () => {
  assert.deepEqual(zipAreaSpot('123 Example Rd, Houston, TX, 77078'), {lat: 29.8, lon: -95.4});
  assert.deepEqual(zipAreaSpot('9 Example Ln, Katy, TX 77493-1234'), {lat: 29.5, lon: -95.9});
  assert.equal(zipAreaSpot('12345 Example St, Houston'), null);      // a street number is not a ZIP
  assert.equal(zipAreaSpot('PO Box 77078'), null);
  assert.equal(zipAreaSpot('1 Example St, Nowhere, TX 00012'), null); // no such ZIP area
  assert.equal(zipAreaSpot(null), null);
  const spots = heliosSpots([
    {unitNumber: 'HELIOS 001', placement: 'field', latitude: null, longitude: null, address: '123 Example Rd, Houston, TX, 77078'},
    {unitNumber: 'HELIOS 009', placement: 'field', latitude: null, longitude: null, address: null, mhelpLocation: {address: '5 Example Dr, Willis, TX, 77378'}},
    {unitNumber: 'HELIOS 003', placement: 'field', latitude: 29.94, longitude: -95.33, address: '1 Example Way, Houston, TX, 77032'},
    {unitNumber: 'HELIOS 014', placement: 'shop', latitude: null, longitude: null, address: '2 Example Ct, Houston, TX, 77084'},
    {unitNumber: 'HELIOS 010', placement: 'field', latitude: null, longitude: null, address: null},
  ]);
  assert.deepEqual([...spots.values()], [{lat: 29.8, lon: -95.4}, {lat: 30.3, lon: -95.4}, {lat: 29.94, lon: -95.33}]);
});

test('the live forecast shape parses: three sites, MJ/m² and cloud %', () => {
  const live = {latitude: 29.79513, longitude: -95.4152, daily_units: {shortwave_radiation_sum: 'MJ/m²', cloud_cover_mean: '%'},
    daily: {time: ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'], shortwave_radiation_sum: [15.32, 15.67, 14.78, 5.80], cloud_cover_mean: [7, 39, 96, 93]}};
  const d = parseDaily(live);
  assert.deepEqual(d.map(isGray), [false, false, false, true]);
  assert.deepEqual(sunOutlook(d, local(26, 18)).map(x => [x.label, x.gray]), [['Tomorrow', false], ['Saturday', true]]);
});

import {darkSpell, fleetSky, harvestWh, sayDay} from '../src/vrmWeather.ts';
test('panel harvest: sunlight MJ/m² → about what a 420 W DD3 kit makes', () => {
  assert.equal(harvestWh(12), 980);   // a clear November day ≈ 1 kWh (the fleet made 0.77–0.92 kWh while full by noon)
  assert.equal(harvestWh(3), 245);    // a gray day ≈ a quarter of that
  assert.equal(harvestWh(null), null);
});
test('dark spell: three dark days from 82% at 0.79 kWh a day runs a DD3 under 20%; lighter gray or sun does not', () => {
  const day = (label, mj) => ({date: label, label, mj, cloud: null, gray: mj < 7});
  const gray = [day('Tomorrow', 2), day('Monday', 2), day('Tuesday', 2)];
  assert.equal(darkSpell([day('Tomorrow', 3), day('Monday', 3), day('Tuesday', 3.5)], 2772 * 0.82, 793, 2772), null);   // ~25% at worst: no warning
  const r = darkSpell(gray, 2772 * 0.82, 793, 2772);
  assert.ok(r && r.low < 20 && r.grayDays === 3, JSON.stringify(r));
  assert.equal(r.by, 'Tuesday'); assert.equal(sayDay(r.by), 'Tue morning'); assert.equal(sayDay('Tomorrow'), 'tomorrow morning');
  assert.equal(darkSpell([day('Tomorrow', 12), day('Monday', 12)], 2772 * 0.5, 793, 2772), null);   // no gray day
  assert.equal(darkSpell([day('Tomorrow', 3), day('Monday', 12)], 2772 * 0.9, 793, 2772), null);   // one gray day from 90% is fine
  assert.equal(darkSpell([], 1000, 793, 2772), null);
});
test('fleet sky: the middle forecast across units for each day', () => {
  const now = new Date(2026, 10, 28, 9).getTime();
  const d = (mj) => [['2026-11-28', mj[0]], ['2026-11-29', mj[1]]].map(([date, m]) => ({date, mj: m, cloud: 50}));
  const sky = new Map([['A', d([12, 3])], ['B', d([10, 4])], ['C', d([2, 5])]]);
  assert.deepEqual(fleetSky(sky, ['A', 'B', 'C'], now, 2).map(x => [x.label, x.mj, x.gray]), [['Today', 10, false], ['Tomorrow', 4, true]]);
  assert.deepEqual(fleetSky(sky, [], now), []);
});
