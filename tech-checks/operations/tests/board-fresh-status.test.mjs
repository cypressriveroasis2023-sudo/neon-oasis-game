import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAMERA_AUTO_REFRESH_MS, observationRefreshDue} from '../src/refreshCadence.ts';
import {CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';
import {applyBoardFreshStatus, boardUnitStatus, oldestWatchfulObservation, tvUpdatesDelayed, WATCHFUL_BANNER_AGE_MS, WATCHFUL_OBSERVATION_FRESH_MS, WATCHFUL_PULL_CADENCE_MS} from '../src/boardFreshStatus.ts';

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

test('Watchful follows the 20-minute observation clock and the 10-minute pull, and the TV banner uses 120 seconds or about 12 minutes', () => {
  assert.equal(WATCHFUL_OBSERVATION_FRESH_MS, 20 * 60 * 1000);
  assert.equal(CAMERA_FRESH_MS, WATCHFUL_OBSERVATION_FRESH_MS);
  assert.equal(WATCHFUL_PULL_CADENCE_MS, CAMERA_AUTO_REFRESH_MS);
  assert.equal(WATCHFUL_PULL_CADENCE_MS, 10 * 60 * 1000);
  assert.equal(WATCHFUL_BANNER_AGE_MS, 12 * 60 * 1000);
  const observed = new Date(now - 21 * 60 * 1000).toISOString();
  const fetched = new Date(now - 30 * 1000).toISOString();
  const aged = boardUnitStatus({
    unitName: 'Sniper 20', placement: 'field', readings: [],
    watchful: {canonicalUnitKey: 'SNIPER|20', status: 'up', snapshotAt: observed, fetchedAt: fetched}, now,
  });
  assert.equal(aged.label, 'Unknown');
  assert.notEqual(aged.state, 'offline');
  const recent = boardUnitStatus({
    unitName: 'Sniper 20', placement: 'field', readings: [],
    watchful: {canonicalUnitKey: 'SNIPER|20', status: 'down', snapshotAt: new Date(now - 19 * 60 * 1000).toISOString(), fetchedAt: fetched}, now,
  });
  assert.equal(recent.label, 'Down via Watchful');
  const success = now - 60 * 1000;
  assert.equal(tvUpdatesDelayed({lastSuccessAt: success, now, sameDay: true, watchfulOldestObservedAt: null}), false);
  assert.equal(tvUpdatesDelayed({lastSuccessAt: now - 121 * 1000, now, sameDay: true}), true);
  assert.equal(tvUpdatesDelayed({lastSuccessAt: success, now, sameDay: true, watchfulOldestObservedAt: new Date(now - 11 * 60 * 1000).toISOString()}), false);
  assert.equal(tvUpdatesDelayed({lastSuccessAt: success, now, sameDay: true, watchfulOldestObservedAt: new Date(now - WATCHFUL_BANNER_AGE_MS - 1000).toISOString()}), true);
  assert.equal(tvUpdatesDelayed({lastSuccessAt: null, now, watchfulOldestObservedAt: null}), false);
  const older = new Date(now - 9 * 60 * 1000).toISOString();
  const newer = new Date(now - 2 * 60 * 1000).toISOString();
  const watchful = [
    {canonicalUnitKey: 'SNIPER|1', status: 'up', snapshotAt: newer},
    {canonicalUnitKey: 'SNIPER|2', status: 'down', snapshotAt: older},
  ];
  applyBoardFreshStatus([], [], watchful, now);
  assert.equal(oldestWatchfulObservation(watchful), older);
  assert.equal(oldestWatchfulObservation(null), null);
});

test('a TV observation older than 20 minutes is grey Unknown and never red', () => {
  const html = readFileSync(new URL('../src/TvFleetView.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/tvBoardExtensions.css', import.meta.url), 'utf8');
  assert.match(html, /tv-state-unknown/);
  assert.match(html, /'Unknown'/);
  assert.match(css, /\.tv-state-unknown b\{color:#94a3b8\}/);
  assert.doesNotMatch(css, /\.tv-state-unknown b\{color:#ff5963\}/);
  const staleReading = boardUnitStatus({
    unitName: 'Sniper 3', placement: 'field', now,
    readings: [reading('Sniper 3', 'offline', new Date(now - 21 * 60 * 1000).toISOString())],
  });
  assert.equal(staleReading.state, 'unknown');
  assert.equal(staleReading.label, 'Unknown');
  assert.notEqual(staleReading.label, 'Offline');
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
