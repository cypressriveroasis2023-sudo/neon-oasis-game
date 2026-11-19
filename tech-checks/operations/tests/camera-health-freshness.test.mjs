import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_FRESH_MS, CAMERA_HEALTH_UNKNOWN, inShopHealthChip, presentedCameraHealth} from '../src/cameraEvidence.ts';

const now = Date.parse('2026-11-19T18:00:00Z');
const fresh = new Date(now - 60_000).toISOString();
const minutes21 = new Date(now - 21 * 60 * 1000).toISOString();
const september = '2026-09-30T01:00:00Z';
const future = new Date(now + 60_000).toISOString();

test('a fresh online value stays online', () => {
  const chip = presentedCameraHealth({status: 'online', observedAt: fresh}, now);
  assert.equal(chip.state, 'online');
  assert.equal(chip.label, 'ONLINE');
  assert.notEqual(chip.label, 'Unknown');
  assert.ok(now - Date.parse(fresh) <= CAMERA_FRESH_MS);
});

test('a 21-minute-old online value shows Unknown', () => {
  const chip = presentedCameraHealth({status: 'online', observedAt: minutes21}, now);
  assert.equal(chip.state, 'unknown');
  assert.equal(chip.label, 'Unknown');
  assert.equal(chip.color, CAMERA_HEALTH_UNKNOWN);
  assert.equal(chip.color, '#94a3b8');
  assert.notEqual(chip.label, 'ONLINE');
  assert.notEqual(chip.label, 'Down');
});

test('a months-old online value shows Unknown', () => {
  const chip = presentedCameraHealth({status: 'online', observedAt: september}, now);
  assert.equal(chip.state, 'unknown');
  assert.equal(chip.label, 'Unknown');
  assert.equal(chip.color, '#94a3b8');
  assert.notEqual(chip.state, 'online');
  assert.notEqual(chip.label, 'Down');
});

test('a missing observation time shows Unknown', () => {
  for (const observedAt of [null, undefined, '']) {
    const chip = presentedCameraHealth({status: 'online', observedAt}, now);
    assert.equal(chip.state, 'unknown');
    assert.equal(chip.label, 'Unknown');
    assert.equal(chip.color, '#94a3b8');
    assert.notEqual(chip.label, 'ONLINE');
    assert.notEqual(chip.label, 'Down');
  }
});

test('a future observation time shows Unknown', () => {
  const chip = presentedCameraHealth({status: 'online', observedAt: future}, now);
  assert.equal(chip.state, 'unknown');
  assert.equal(chip.label, 'Unknown');
  assert.equal(chip.color, '#94a3b8');
  assert.notEqual(chip.state, 'online');
  assert.notEqual(chip.label, 'Down');
});

test('the freshness rule can be turned off', () => {
  const chip = presentedCameraHealth({status: 'online', observedAt: minutes21}, now, false);
  assert.equal(chip.state, 'online');
  assert.equal(chip.label, 'ONLINE');
  const aged = presentedCameraHealth({status: 'offline', observedAt: september}, now, false);
  assert.equal(aged.state, 'offline');
  assert.equal(aged.label, 'Down');
});

test('an In shop unit keeps its place label while a stale health chip is Unknown', () => {
  const stale = inShopHealthChip(september, now);
  assert.equal(stale.placeLabel, 'In shop');
  assert.equal(stale.chip.label, 'Unknown');
  assert.equal(stale.chip.color, '#94a3b8');
  assert.notEqual(stale.chip.label, 'ONLINE');
  assert.notEqual(stale.chip.label, 'Down');
  const current = inShopHealthChip(fresh, now);
  assert.equal(current.placeLabel, 'In shop');
  assert.equal(current.chip.label, 'ONLINE');
  const off = inShopHealthChip(september, now, false);
  assert.equal(off.placeLabel, 'In shop');
  assert.equal(off.chip.label, 'ONLINE');
});

test('a stale offline value is Unknown and never Down', () => {
  const chip = presentedCameraHealth({status: 'offline', observedAt: minutes21}, now);
  assert.equal(chip.label, 'Unknown');
  assert.equal(chip.color, '#94a3b8');
  assert.notEqual(chip.label, 'Down');
  assert.notEqual(chip.state, 'offline');
});
