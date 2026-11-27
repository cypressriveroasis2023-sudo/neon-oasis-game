import test from 'node:test';
import assert from 'node:assert/strict';
import {cautiousCharge, chargeAgreement, chargeReadings, primaryCharge, unitTileSummary} from '../src/vrmReadOnlyModel.ts';
import {tonightBasis, tonightForecast, tonightHeadline} from '../src/vrmHistory.ts';
import {victronNeedsAttention} from '../src/victronAttention.ts';

const now = Date.parse('2026-11-27T18:00:00Z');
const at = minutesAgo => new Date(now - minutesAgo * 60000).toISOString();
const soc = (value, source, instance, minutesAgo = 2) => ({metric: 'battery_soc', value, unit: '%', source, instance, observedAt: at(minutesAgo)});
const row = measurements => ({installationId: 1, name: 'HELIOS 001', lastAttemptAt: at(1), errorCode: null, measurements});
const charges = (...m) => chargeReadings(row(m), now);

test('monitors within one point of each other agree, and the system reading leads', () => {
  const a = chargeAgreement(charges(soc(89, 'battery', 278), soc(89, 'battery', 512), soc(89, 'system', 0)), now);
  assert.equal(a.agree, true); assert.equal(a.spread, 0);
  assert.deepEqual([a.lead.source, a.lead.instance, a.lead.value], ['system', 0, 89]);
  // Real fleet shape: 94.5 / 94 / 94.
  assert.equal(chargeAgreement(charges(soc(94.5, 'battery', 278), soc(94, 'battery', 512), soc(94, 'system', 0)), now).agree, true);
  assert.equal(chargeAgreement(charges(soc(95, 'battery', 278), soc(94, 'system', 0)), now).agree, true);   // exactly one point
});

test('monitors that differ stay separate, with the size of the gap', () => {
  // Real fleet shape: HELIOS 010 read 76.7 / 95 / 95.
  const a = chargeAgreement(charges(soc(76.7, 'battery', 278), soc(95, 'battery', 512), soc(95, 'system', 0)), now);
  assert.equal(a.agree, false); assert.ok(Math.abs(a.spread - 18.3) < 1e-9);
  // More than 10 points apart: the page goes by the lowest current monitor.
  assert.equal(a.cautious, true); assert.deepEqual([a.lead.source, a.lead.instance, a.lead.value], ['battery', 278, 76.7]);
  const b = chargeAgreement(charges(soc(92.2, 'battery', 278), soc(91, 'system', 0)), now);   // 1.2 points
  assert.equal(b.agree, false); assert.equal(b.cautious, false); assert.deepEqual([b.lead.source, b.lead.value], ['system', 91]);
});

test('a current reading and a stale one never count as agreeing, even on the same number', () => {
  const a = chargeAgreement(charges(soc(89, 'battery', 278, 120), soc(89, 'system', 0)), now);
  assert.equal(a.agree, false);
  assert.deepEqual([a.lead.source, a.lead.value], ['system', 89]);
  // All stale and equal: they agree about the last thing they said.
  assert.equal(chargeAgreement(charges(soc(89, 'battery', 278, 120), soc(89, 'system', 0, 120)), now).agree, true);
});

test('one source is neither agreement nor disagreement; none gives no lead', () => {
  assert.deepEqual(chargeAgreement(charges(soc(70, 'system', 0)), now), {lead: charges(soc(70, 'system', 0))[0], spread: 0, agree: false, cautious: false});
  assert.deepEqual(chargeAgreement([], now), {lead: undefined, spread: 0, agree: false, cautious: false});
});

test('the lead reading is the one the tile shows: current first, system first, else the lowest', () => {
  const noSystem = charges(soc(80, 'battery', 278), soc(72, 'battery', 512));
  assert.equal(primaryCharge(noSystem, now).value, 72);
  // A stale system reading does not outrank a current monitor.
  const staleSystem = charges(soc(60, 'system', 0, 120), soc(85, 'battery', 278));
  assert.deepEqual([primaryCharge(staleSystem, now).source, primaryCharge(staleSystem, now).value], ['battery', 85]);
  const unit = {installationId: 1, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null};
  for (const m of [[soc(94.5, 'battery', 278), soc(94, 'battery', 512), soc(94, 'system', 0)], [soc(80, 'battery', 278), soc(72, 'battery', 512)], [soc(60, 'system', 0, 120), soc(85, 'battery', 278)]]) {
    assert.equal(unitTileSummary(unit, [row(m)], now).soc.value, primaryCharge(chargeReadings(row(m), now), now).value);
    assert.equal(unitTileSummary(unit, [row(m)], now).socGap, 0);
  }
});

// The cautious rule: current monitors more than 10 points apart → go by the lowest.
const unit1 = {installationId: 1, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null};

test('more than 10 points apart: the lowest current monitor is the one the page goes by', () => {
  const c = cautiousCharge(charges(soc(76.7, 'battery', 278), soc(95, 'battery', 512), soc(95, 'system', 0)), now);
  assert.deepEqual([c.reading.source, c.reading.instance, c.reading.value, c.usual.value], ['battery', 278, 76.7, 95]);
  assert.ok(Math.abs(c.gap - 18.3) < 1e-9);
  const tile = unitTileSummary(unit1, [row([soc(76.7, 'battery', 278), soc(95, 'battery', 512), soc(95, 'system', 0)])], now);
  assert.equal(tile.soc.value, 76.7); assert.equal(tile.socUsual.value, 95); assert.ok(tile.socGap > 18); assert.equal(tile.tone, 'good');
  // The colour follows the lower number: 100% on the system, 18% on the other monitor is a red tile.
  assert.equal(unitTileSummary(unit1, [row([soc(18, 'battery', 278), soc(100, 'system', 0)])], now).tone, 'low');
});

test('10 points or less, a stale monitor, or a monitor that reads higher: nothing changes', () => {
  for (const m of [[soc(85, 'battery', 278), soc(95, 'system', 0)],            // exactly 10
                   [soc(40, 'battery', 278, 120), soc(95, 'system', 0)],       // the low one is stale
                   [soc(100, 'battery', 278), soc(84, 'system', 0)],           // the other monitor is higher
                   [soc(95, 'system', 0)]]) {
    const c = cautiousCharge(charges(...m), now);
    assert.equal(c.gap, 0); assert.deepEqual([c.reading.source, c.reading.value], ['system', m[m.length - 1].value]);
  }
  assert.deepEqual(cautiousCharge([], now), {reading: undefined, usual: undefined, gap: 0});
});

test('tonight\'s estimate starts from the lower level and keeps the measured rate of loss', () => {
  const night = new Date(2026, 10, 27, 22, 0).getTime(), S = Math.round(night / 1000);
  const points = []; for (let i = 8; i >= 0; i--) points.push([S - i * 900, 60 - (8 - i) * 0.5, 0, -40]);   // 60% → 56%, 2%/hr
  const plain = tonightForecast(points, night), lower = tonightForecast(points, night, 22);
  assert.equal(plain.battery, 56); assert.equal(plain.verdict, 'ok'); assert.equal(plain.lowerBy, undefined);
  assert.equal(lower.battery, 34); assert.equal(lower.ratePerHour, plain.ratePerHour); assert.equal(lower.lowerBy, 22);
  assert.equal(lower.verdict, 'low'); assert.match(tonightHeadline(lower), /reaches 20% around/);
  assert.match(tonightBasis(lower), /^Battery 34% now on the lower monitor \(the system says 56%\), losing about 2% an hour/);
  assert.doesNotMatch(tonightBasis(plain), /lower monitor/);
});

test('Needs attention: one line for every unit whose monitors disagree, and the lower number in its own alerts', () => {
  const units = [1, 2, 3, 4].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/' + id + '/dashboard', embedUrl: null}));
  const inventory = units.map(u => ({unitNumber: u.name, placement: 'FIELD'}));
  const r = (id, m) => ({installationId: id, name: 'HELIOS 00' + id, lastAttemptAt: at(1), errorCode: null, measurements: m});
  const rows = [r(1, [soc(76.7, 'battery', 278), soc(95, 'system', 0)]), r(2, [soc(15, 'battery', 278), soc(100, 'system', 0)]),
    r(3, [soc(94.5, 'battery', 278), soc(94, 'system', 0)]), r(4, [soc(80, 'system', 0)])];
  const list = victronNeedsAttention(units, rows, inventory, now);
  assert.deepEqual(list.map(i => [i.name, i.kind, i.line]), [
    ['HELIOS 002', 'low', 'Low battery · 15% on the lower monitor (system says 100%)'],
    ['2 units', 'monitors', 'Battery monitors disagree · 001, 002 · going by the lower'],
  ]);
  assert.equal(list[1].installationId, 1);
  // One unit: its own name and both numbers.
  assert.deepEqual(victronNeedsAttention(units.slice(0, 1), rows.slice(0, 1), inventory, now).map(i => [i.name, i.line]),
    [['HELIOS 001', 'Battery monitors disagree · 77% and 95% · going by the lower']]);
  // A Shop unit is never listed.
  assert.deepEqual(victronNeedsAttention(units.slice(0, 1), rows.slice(0, 1), [{unitNumber: 'HELIOS 001', placement: 'SHOP'}], now), []);
});
