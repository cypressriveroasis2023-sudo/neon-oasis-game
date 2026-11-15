import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraTimestamp, powerTimestamp, CAMERA_FRESH_MS, POWER_FRESH_MS} from '../src/cameraEvidence.ts';

const NOW = Date.parse('2026-11-14T20:41:00Z');
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();

// Victron is polled every 15 minutes and its observations are already several
// minutes old on arrival. On 14 November the nine field Helios reported ages of
// 19 to 26 minutes, all of them healthy, and seven read "Unverified". These are
// those ages rounded to whole minutes, so the one that sat at 20 and a fraction
// lands exactly on the camera boundary here and counts as fresh; six fail
// instead of seven. The point is unchanged - most of a healthy fleet was being
// called unverified - and the boundary itself is pinned below.
const FIELD_HELIOS_AGES = [19, 19, 20, 21, 22, 23, 25, 25, 26];

test('a healthy Helios is not called unverified for arriving on its own schedule', () => {
  const byCamera = FIELD_HELIOS_AGES.filter(m => cameraTimestamp(ago(m), NOW).fresh).length;
  const byPower = FIELD_HELIOS_AGES.filter(m => powerTimestamp(ago(m), NOW).fresh).length;
  assert.equal(byCamera, 3, 'the camera window is what produced the Unverified cards');
  assert.equal(byPower, FIELD_HELIOS_AGES.length, 'every healthy field Helios counts as a current reading');
});

test('each window is exact at its own boundary', () => {
  assert.equal(cameraTimestamp(ago(20), NOW).fresh, true, '20 minutes is still a current camera check');
  assert.equal(cameraTimestamp(ago(20.1), NOW).fresh, false, 'a moment past 20 is not');
  assert.equal(powerTimestamp(ago(45), NOW).fresh, true, '45 minutes is still a current power reading');
  assert.equal(powerTimestamp(ago(45.1), NOW).fresh, false, 'a moment past 45 is not');
});

test('the power window is wider than the camera window, and the camera window is untouched', () => {
  assert.equal(CAMERA_FRESH_MS, 20 * 60 * 1000);
  assert.equal(POWER_FRESH_MS, 45 * 60 * 1000);
  assert.ok(POWER_FRESH_MS > CAMERA_FRESH_MS);
});

// Wider is not the same as blind. A feed that has stopped still says so.
test('a feed that has genuinely stopped is still not current', () => {
  for (const minutes of [46, 90, 60 * 24, 60 * 24 * 37]) {
    assert.equal(powerTimestamp(ago(minutes), NOW).fresh, false, minutes + ' minutes back');
  }
  // HELIOS 008 has been silent since 8 October.
  assert.equal(powerTimestamp('2026-10-08T16:20:39Z', NOW).fresh, false);
});

test('the two readings agree on what the timestamp is, and only on whether it is current', () => {
  for (const minutes of [1, 19, 21, 44, 46, 500]) {
    const camera = cameraTimestamp(ago(minutes), NOW);
    const power = powerTimestamp(ago(minutes), NOW);
    assert.equal(power.at, camera.at, minutes + ' minutes: same instant');
  }
});

test('nonsense is refused by both, with no timestamp invented', () => {
  for (const value of [null, undefined, '', 'yesterday', 42, {}, '2026-13-01T00:00:00Z', '2026-11-14T25:00:00Z']) {
    assert.deepEqual(powerTimestamp(value, NOW), {at: null, fresh: false}, JSON.stringify(value));
  }
});

test('a reading from the future is refused rather than treated as current', () => {
  assert.deepEqual(powerTimestamp(new Date(NOW + 60_000).toISOString(), NOW), {at: null, fresh: false});
});
