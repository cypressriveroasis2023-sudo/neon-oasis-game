import test from 'node:test';
import assert from 'node:assert/strict';
import {chargeAgreement, chargeReadings, primaryCharge, unitTileSummary} from '../src/vrmReadOnlyModel.ts';

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
  assert.deepEqual([a.lead.source, a.lead.value], ['system', 95]);
  assert.equal(chargeAgreement(charges(soc(92.2, 'battery', 278), soc(91, 'system', 0)), now).agree, false);   // 1.2 points
});

test('a current reading and a stale one never count as agreeing, even on the same number', () => {
  const a = chargeAgreement(charges(soc(89, 'battery', 278, 120), soc(89, 'system', 0)), now);
  assert.equal(a.agree, false);
  assert.deepEqual([a.lead.source, a.lead.value], ['system', 89]);
  // All stale and equal: they agree about the last thing they said.
  assert.equal(chargeAgreement(charges(soc(89, 'battery', 278, 120), soc(89, 'system', 0, 120)), now).agree, true);
});

test('one source is neither agreement nor disagreement; none gives no lead', () => {
  assert.deepEqual(chargeAgreement(charges(soc(70, 'system', 0)), now), {lead: charges(soc(70, 'system', 0))[0], spread: 0, agree: false});
  assert.deepEqual(chargeAgreement([], now), {lead: undefined, spread: 0, agree: false});
});

test('the lead reading is the one the tile shows: current first, system first, else the lowest', () => {
  const noSystem = charges(soc(80, 'battery', 278), soc(72, 'battery', 512));
  assert.equal(primaryCharge(noSystem, now).value, 72);
  // A stale system reading does not outrank a current monitor.
  const staleSystem = charges(soc(60, 'system', 0, 120), soc(85, 'battery', 278));
  assert.deepEqual([primaryCharge(staleSystem, now).source, primaryCharge(staleSystem, now).value], ['battery', 85]);
  const unit = {installationId: 1, name: 'HELIOS 001', portalUrl: 'https://vrm.victronenergy.com/installation/1/dashboard', embedUrl: null};
  for (const m of [[soc(76.7, 'battery', 278), soc(95, 'battery', 512), soc(95, 'system', 0)], [soc(80, 'battery', 278), soc(72, 'battery', 512)], [soc(60, 'system', 0, 120), soc(85, 'battery', 278)]]) {
    assert.equal(unitTileSummary(unit, [row(m)], now).soc.value, primaryCharge(chargeReadings(row(m), now), now).value);
  }
});
