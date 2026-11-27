import test from 'node:test';
import assert from 'node:assert/strict';
import {chargeAgreement, secondMonitorLow, chargeReadings, primaryCharge, unitTileSummary} from '../src/vrmReadOnlyModel.ts';
import {systemLead, tonightBasis, tonightForecast, tonightHeadline} from '../src/vrmHistory.ts';
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
  // More than 10 points apart: the page still goes by the system reading; the low monitor is flagged.
  assert.equal(a.monitorLow, true); assert.deepEqual([a.lead.source, a.lead.value], ['system', 95]);
  const b = chargeAgreement(charges(soc(92.2, 'battery', 278), soc(91, 'system', 0)), now);   // 1.2 points
  assert.equal(b.agree, false); assert.equal(b.monitorLow, false); assert.deepEqual([b.lead.source, b.lead.value], ['system', 91]);
});

test('a current reading and a stale one never count as agreeing, even on the same number', () => {
  const a = chargeAgreement(charges(soc(89, 'battery', 278, 120), soc(89, 'system', 0)), now);
  assert.equal(a.agree, false);
  assert.deepEqual([a.lead.source, a.lead.value], ['system', 89]);
  // All stale and equal: they agree about the last thing they said.
  assert.equal(chargeAgreement(charges(soc(89, 'battery', 278, 120), soc(89, 'system', 0, 120)), now).agree, true);
});

test('one source is neither agreement nor disagreement; none gives no lead', () => {
  assert.deepEqual(chargeAgreement(charges(soc(70, 'system', 0)), now), {lead: charges(soc(70, 'system', 0))[0], spread: 0, agree: false, monitorLow: false});
  assert.deepEqual(chargeAgreement([], now), {lead: undefined, spread: 0, agree: false, monitorLow: false});
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
    assert.equal(unitTileSummary(unit, [row(m)], now).monitorLow, undefined);
  }
});

// The system number is the one to believe (four days of saved readings). A second monitor far below it is flagged.
test('more than 10 points apart: the tile keeps the system number and flags the low monitor', () => {
  const m = secondMonitorLow(charges(soc(76.7, 'battery', 278), soc(95, 'battery', 512), soc(95, 'system', 0)), now);
  assert.equal(m.low.value, 76.7); assert.equal(m.system.value, 95); assert.ok(m.gap > 18);
  const unit = {installationId: 1, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null};
  const tile = unitTileSummary(unit, [row([soc(76.7, 'battery', 278), soc(95, 'battery', 512), soc(95, 'system', 0)])], now);
  assert.equal(tile.soc.value, 95); assert.equal(tile.monitorLow.value, 76.7);
});

test('10 points or less, a stale monitor, or one source: nothing is flagged', () => {
  for (const m of [[soc(86, 'battery', 278), soc(95, 'system', 0)], [soc(40, 'battery', 278, 120), soc(95, 'system', 0)], [soc(95, 'system', 0)]])
    assert.equal(secondMonitorLow(charges(...m), now).low, undefined);
  assert.equal(secondMonitorLow([], now).gap, 0);
});

// HELIOS 004 on Nov 27 (real shape): 87% at dawn, system jumps to 100% around 8 AM while only ~60 W goes in,
// then keeps taking 100-250 W for hours, then tapers to nothing by noon.
const morning = () => {
  const base = Math.round(new Date(2026, 10, 27, 6, 0).getTime() / 1000), pts = [];
  const add = (min, soc, w) => pts.push([base + min * 60, soc, Math.max(0, w), w]);
  for (let m = 0; m <= 100; m += 10) add(m, 87, -26);          // 6:00–7:40 dark
  add(110, 87, 40); add(120, 100, 61);                         // the jump at ~8 AM
  for (let m = 130; m <= 240; m += 10) add(m, 100, 150);       // still filling hard until 10 AM
  for (let m = 250; m <= 300; m += 10) add(m, 100, 60);        // tapering
  for (let m = 310; m <= 400; m += 10) add(m, 100, 0);         // full, taking nothing
  return {pts, base};
};

test('systemLead: a jump to 100% with little energy behind it reads as running ahead, then catches up as it fills', () => {
  const {pts, base} = morning(), at = min => (base + min * 60) * 1000, upTo = min => pts.filter(p => p[0] <= base + min * 60);
  assert.equal(systemLead(upTo(100), at(100)), 0);                 // dark: nothing to say
  const jumped = systemLead(upTo(120), at(120)); assert.ok(jumped >= 10 && jumped <= 13, 'right after the jump: ' + jumped);
  const mid = systemLead(upTo(180), at(180)); assert.ok(mid > 0 && mid < jumped, 'filling: ' + mid);
  assert.equal(systemLead(upTo(400), at(400)), 0);                 // full by midday
  assert.equal(systemLead([], at(0)), 0); assert.equal(systemLead(null, at(0)), 0);
});

test('systemLead: a normal climb that the energy explains reads as 0', () => {
  const base = Math.round(new Date(2026, 10, 27, 8, 0).getTime() / 1000), pts = [];
  for (let i = 0; i <= 12; i++) pts.push([base + i * 600, 80 + i, 177, 177]);   // 177 W for 10 min ≈ 1 point
  assert.equal(systemLead(pts, (base + 7200) * 1000), 0);
});

test('tonight\'s estimate starts from the energy-based level when the system number has jumped ahead', () => {
  const night = new Date(2026, 10, 27, 22, 0).getTime(), S = Math.round(night / 1000);
  const points = []; for (let i = 8; i >= 0; i--) points.push([S - i * 900, 60 - (8 - i) * 0.5, 0, -40]);   // 60% → 56%, 2%/hr
  const plain = tonightForecast(points, night), lower = tonightForecast(points, night, 22);
  assert.equal(plain.battery, 56); assert.equal(plain.verdict, 'ok'); assert.equal(plain.lowerBy, undefined);
  assert.equal(lower.battery, 34); assert.equal(lower.ratePerHour, plain.ratePerHour); assert.equal(lower.lowerBy, 22);
  assert.match(tonightBasis(lower), /^Battery about 34% now by the energy that went in \(the system says 56%, but it jumped ahead while charging\), losing about 2% an hour/);
  assert.doesNotMatch(tonightBasis(plain), /jumped ahead/);
});

test('Needs attention: alerts use the system number; low second monitors get one re-sync line', () => {
  const units = [1, 2, 3, 4].map(id => ({installationId: id, name: 'HELIOS 00' + id, portalUrl: 'https://vrm.victronenergy.com/installation/' + id + '/dashboard', embedUrl: null}));
  const inventory = units.map(u => ({unitNumber: u.name, placement: 'FIELD'}));
  const r = (id, m) => ({installationId: id, name: 'HELIOS 00' + id, lastAttemptAt: at(1), errorCode: null, measurements: m});
  const rows = [r(1, [soc(76.7, 'battery', 278), soc(95, 'system', 0)]), r(2, [soc(15, 'battery', 278), soc(100, 'system', 0)]),
    r(3, [soc(94.5, 'battery', 278), soc(94, 'system', 0)]), r(4, [soc(80, 'system', 0)])];
  const list = victronNeedsAttention(units, rows, inventory, now);
  assert.deepEqual(list.map(i => [i.name, i.kind, i.line]), [
    ['2 units', 'monitors', 'Second battery monitor reads low · 001, 002 · needs a re-sync'],
  ]);
  assert.equal(list[0].installationId, 1);
  assert.deepEqual(victronNeedsAttention(units.slice(0, 1), rows.slice(0, 1), inventory, now).map(i => [i.name, i.line]),
    [['HELIOS 001', 'Second battery monitor reads low · 77% vs 95% · needs a re-sync']]);
  assert.deepEqual(victronNeedsAttention(units.slice(0, 1), rows.slice(0, 1), [{unitNumber: 'HELIOS 001', placement: 'SHOP'}], now), []);
});
