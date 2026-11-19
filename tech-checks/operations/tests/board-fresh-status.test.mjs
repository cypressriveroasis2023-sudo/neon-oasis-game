import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_AUTO_REFRESH_MS, observationRefreshDue} from '../src/refreshCadence.ts';
import {CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';
import {applyBoardFreshStatus, boardUnitStatus} from '../src/boardFreshStatus.ts';

const now = Date.parse('2026-11-19T15:00:00.000Z');
const fresh = new Date(now - 5 * 60 * 1000).toISOString();
const stale = new Date(now - 3 * 60 * 60 * 1000).toISOString();

const reading = (unit, status, observedAt) => ({
  id: unit, name: unit, unit, type: 'ipc', activationState: 'active', scope: 'shop', status: 'review',
  evidence: {kind: 'provider', source: 'Star4Live', resource: 'camera', active: true, status, observedAt, lastOnlineAt: observedAt},
});

test('a fresh camera reading replaces Unknown and a stale one does not become Offline', () => {
  const rows = [
    {name: 'Sniper 12', placement: 'field', cameraState: 'unknown', review: [], camera: {state: 'unknown'}},
    {name: 'Sniper 13', placement: 'field', cameraState: 'unknown', review: []},
    {name: 'Sniper 14', placement: 'shop', cameraState: 'unknown', review: []},
  ];
  const next = applyBoardFreshStatus(rows, [
    reading('Sniper 12', 'online', fresh),
    reading('Sniper 13', 'offline', stale),
  ], null, now);
  assert.equal(next[0].cameraState, 'online');
  assert.equal(next[0].camera.state, 'online');
  assert.equal(next[1].cameraState, 'unknown');
  assert.equal(next[2].cameraState, 'unknown');
});

test('an Avigilon unit with no live reading uses a fresh Watchful status and stays unlabeled as Online', () => {
  const snapshotAt = new Date(now - 60_000).toISOString();
  const freshWatchful = boardUnitStatus({
    unitName: 'Sniper 20', placement: 'field', readings: [],
    watchful: {canonicalUnitKey: 'SNIPER|20', status: 'up', snapshotAt}, now,
  });
  assert.equal(freshWatchful.state, 'unknown');
  assert.equal(freshWatchful.label, 'Up via Watchful');
  assert.equal(freshWatchful.viaWatchful, true);
  const staleWatchful = boardUnitStatus({
    unitName: 'CAM V 3', placement: 'field', readings: [],
    watchful: {canonicalUnitKey: 'CAMV|3', status: 'down', snapshotAt: new Date(now - 27 * 60 * 60 * 1000).toISOString()}, now,
  });
  assert.equal(staleWatchful.label, 'Unknown');
  assert.equal(staleWatchful.viaWatchful, false);
  const shop = boardUnitStatus({unitName: 'Sniper 20', placement: 'shop', readings: [reading('Sniper 20', 'online', fresh)], now});
  assert.equal(shop.label, 'In Shop');
  assert.equal(shop.state, 'in_shop');
});

test('a missing or stale snapshot is Unknown and a Shop unit is never down', () => {
  const missing = boardUnitStatus({unitName: 'Sniper 20', placement: 'field', readings: [], watchful: null, now});
  assert.equal(missing.label, 'Unknown');
  assert.notEqual(missing.state, 'offline');
  const stale = boardUnitStatus({
    unitName: 'Sniper 20', placement: 'field', readings: [],
    watchful: {canonicalUnitKey: 'SNIPER|20', status: 'down', snapshotAt: new Date(now - 27 * 60 * 60 * 1000).toISOString()},
    now,
  });
  assert.equal(stale.label, 'Unknown');
  assert.notEqual(stale.state, 'offline');
  const shop = boardUnitStatus({
    unitName: 'Sniper 20', placement: 'shop',
    readings: [reading('Sniper 20', 'offline', fresh)],
    watchful: {canonicalUnitKey: 'SNIPER|20', status: 'down', snapshotAt: fresh},
    now,
  });
  assert.equal(shop.label, 'In Shop');
  assert.equal(shop.state, 'in_shop');
  assert.notEqual(shop.state, 'offline');
});

test('a reading that would expire before the 10-minute cadence requests a saved read without widening freshness', () => {
  assert.equal(CAMERA_AUTO_REFRESH_MS, 10 * 60 * 1000);
  assert.equal(CAMERA_FRESH_MS, 20 * 60 * 1000);
  const observed = now - 12 * 60 * 1000;
  const lastRead = now;
  assert.equal(observationRefreshDue(observed, lastRead, now, false), false);
  const almostDue = observed + CAMERA_FRESH_MS - 60 * 1000;
  assert.equal(observationRefreshDue(observed, lastRead, almostDue, false), true);
  assert.equal(observationRefreshDue(observed, lastRead, almostDue, true), false);
  assert.equal(observationRefreshDue(now - 5 * 60 * 1000, now, now, false), false);
  assert.equal(observationRefreshDue(now - 30 * 60 * 1000, now, now, false), false);
});
