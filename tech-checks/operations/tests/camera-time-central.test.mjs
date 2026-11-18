import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraTime} from '../src/fieldCameraHealth.ts';

const later = instant => Date.parse(instant) + 60_000;

test('a known UTC instant renders as Central time with a CT label', () => {
  const winter = cameraTime('2026-11-17T18:30:00Z', later('2026-11-17T18:30:00Z'));
  assert.equal(winter, 'Nov 17, 2026, 12:30:00 PM CT');
  assert.doesNotMatch(winter, /UTC|GMT/);
});

test('the spring-forward boundary keeps the Chicago wall clock, not UTC', () => {
  const before = cameraTime('2026-03-08T07:30:00Z', later('2026-03-08T08:30:00Z'));
  const after = cameraTime('2026-03-08T08:30:00Z', later('2026-03-08T08:30:00Z'));
  assert.equal(before, 'Mar 8, 2026, 1:30:00 AM CT');
  assert.equal(after, 'Mar 8, 2026, 3:30:00 AM CT');
  assert.doesNotMatch(before + after, /UTC|GMT/);
});
