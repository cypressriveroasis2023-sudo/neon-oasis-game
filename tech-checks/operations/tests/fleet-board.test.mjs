import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardProblems, boardSearch, buildBoard, problemTone} from '../src/fleetBoard.ts';
import {cameraMarks, publicCameraLabel, readIsStale} from '../src/fleetCameraStatusRead.ts';
import {CAMERA_FRESH_MS} from '../src/cameraEvidence.ts';

const now = Date.parse('2026-11-19T17:48:00Z');
const fresh = new Date(now - 5 * 60 * 1000).toISOString();
const stale = new Date(now - 21 * 60 * 1000).toISOString();
const unit = (patch) => ({
  id: patch.id, name: patch.name, site: patch.site || 'Synthetic yard', placement: 'field',
  cameras: patch.cameras || [{name: 'Synthetic camera', state: patch.state || 'up', observedAt: fresh}],
  observedAt: fresh, support: false, point: [29.7, -95.4], estimate: true,
  immix: false, inWatchful: null, arming: null, ...patch,
});

test('the camera status read stays free of addresses and 7-digit keys', () => {
  assert.equal(publicCameraLabel('10.1.1.1'), null);
  assert.equal(publicCameraLabel('1234567'), null);
  assert.equal(publicCameraLabel('Synthetic camera'), 'Synthetic camera');
  assert.equal(readIsStale(null, now), true);
  assert.equal(readIsStale(new Date(now + 60_000).toISOString(), now), true);
  assert.equal(readIsStale(stale, now), true);
  assert.equal(readIsStale(fresh, now), false);
  assert.equal(CAMERA_FRESH_MS, 20 * 60 * 1000);
  const marks = cameraMarks([{
    id: 'cam', name: '10.4.4.4', unit: 'Synthetic', type: 'IPC', activationState: 'active', status: 'online',
    evidence: {kind: 'provider', source: 'Star4Live', resource: 'camera', active: true, status: 'online', observedAt: fresh, lastOnlineAt: fresh},
  }], now);
  assert.equal(marks[0].name, 'Camera');
  assert.equal(marks[0].state, 'up');
});

test('field and shop counts use selectFleetCounts and shop is not a problem', () => {
  const view = buildBoard([
    unit({id: 'up', name: 'Field up', state: 'up'}),
    unit({id: 'down', name: 'Field down', state: 'down', cameras: [{name: 'Cam', state: 'down', observedAt: fresh}]}),
    unit({id: 'shop', name: 'Bench', placement: 'shop', state: 'down', cameras: [{name: 'Cam', state: 'down', observedAt: fresh}]}),
    unit({id: 'loose', name: 'Loose', placement: 'unknown', state: 'down'}),
  ], null, fresh, now);
  assert.equal(view.unitsOnline.up, 1);
  assert.equal(view.unitsOnline.total, 2);
  assert.equal(view.inShop, 1);
  assert.equal(view.problems.map(item => item.unit).join(','), 'Field down');
  assert.equal(view.sitesArmed.up, null);
  assert.equal(view.immixSites, null);
  assert.equal(view.notArmedToday, null);
  assert.equal(view.problems.some(item => item.what === 'Down'), false);
});

test('a schedule disarm is not a problem and a shared count fills armed and Immix', () => {
  const problems = boardProblems([
    unit({id: 'off', name: 'Night yard', arming: 'Disarmed', inWatchful: true, scheduleDisarmed: true, state: 'up'}),
    unit({id: 'hold', name: 'Open yard', arming: 'Disarmed', inWatchful: true, scheduleDisarmed: false, state: 'up'}),
  ], now);
  assert.deepEqual(problems.map(item => item.unit), []);
  const disarmed = buildBoard([
    unit({id: 'off', name: 'Night yard', arming: 'Disarmed', scheduleDisarmed: true}),
    unit({id: 'hold', name: 'Open yard', arming: 'Disarmed'}),
    unit({id: 'pause', name: 'Paused yard', arming: 'Paused'}),
  ], null, fresh, now);
  assert.equal(disarmed.problems.length, 0);
  assert.equal(disarmed.notArmedToday, 3);
  const view = buildBoard([unit({id: 'up', name: 'Field up'})], {
    fresh: true, units: 4, sites: 3, armedSites: 2, armedUnits: 2,
    cameras: {up: 5, down: 1, total: 6}, notInWatchful: [], immixUp: 1, immixDown: 0, immixUnknown: 0,
    monitoredOnImmix: [{name: 'Gate'}], inShop: 9,
  }, fresh, now);
  assert.equal(view.sitesArmed.up, 2);
  assert.equal(view.sitesArmed.total, 3);
  assert.equal(view.immixSites, 1);
  assert.equal(view.stale, false);
});

test('a stale read greys the board and disables problems', () => {
  const view = buildBoard([
    unit({id: 'down', name: 'Field down', observedAt: stale, cameras: [{name: 'Cam', state: 'down', observedAt: stale}]}),
  ], null, stale, now);
  assert.equal(view.stale, true);
  assert.equal(view.problems.length, 0);
  assert.equal(view.unitsOnline.up, null);
  assert.equal(view.camerasOnline.up, null);
  assert.equal(view.sites[0].dot, 'grey');
  assert.equal(view.sites[0].units[0].status, 'unknown');
});

test('a fresh camera time with an old read is Unknown, and an old camera time with a fresh read is not', () => {
  const oldRead = buildBoard([
    unit({id: 'down', name: 'Field down', state: 'down', observedAt: fresh, cameras: [{name: 'Cam', state: 'down', observedAt: fresh}]}),
  ], null, stale, now);
  assert.equal(oldRead.stale, true);
  assert.equal(oldRead.sites[0].units[0].status, 'unknown');
  assert.equal(oldRead.unitsOnline.up, null);
  assert.equal(oldRead.problems.length, 0);
  const freshRead = buildBoard([
    unit({id: 'down', name: 'Field down', state: 'down', observedAt: stale, cameras: [{name: 'Cam', state: 'down', observedAt: stale}]}),
  ], null, fresh, now);
  assert.equal(freshRead.stale, false);
  assert.equal(freshRead.sites[0].units[0].status, 'down');
  assert.equal(freshRead.problems[0].what, 'Offline');
  const failed = buildBoard([
    unit({id: 'down', name: 'Field down', state: 'down', observedAt: fresh, cameras: [{name: 'Cam', state: 'down', observedAt: fresh}]}),
  ], null, fresh, now, true);
  assert.equal(failed.stale, true);
  assert.equal(failed.sites[0].units[0].status, 'unknown');
  assert.notEqual(failed.unitsOnline.up, 0);
});

test('the dashboard hook passes our read time and the failed flag', () => {
  const source = readFileSync(new URL('../src/FleetDashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /stageRead=\{\{at:Number\.isFinite\(snapshotNow\)\?new Date\(snapshotNow\)\.toISOString\(\):null,failed:Boolean\(failed\)\}\}/);
  assert.match(source, /const boardOn=useFleetMapStage\(\)&&view==='map'/);
  assert.match(source, /\{!boardOn&&<div className='cos-fleet-heading'>/);
});

test('Problems 0 is not red', () => {
  assert.equal(problemTone(0, false), 'clear');
  assert.equal(problemTone(2, false), 'alarm');
  assert.equal(problemTone(0, true), 'unknown');
});

test('search matches site, unit, camera, and EYE text and ignores an IP', () => {
  const sites = [{
    key: 'yard', name: 'Synthetic yard', units: [{
      id: '1', name: 'Field up', placement: 'field', status: 'up', cameraDown: false,
      cameras: [{name: 'North camera', state: 'up', observedAt: fresh}],
      schedule: null, alarms: null, contacts: null, eye: 'EYE-14',
    }],
  }];
  assert.equal(boardSearch(sites, 'eye-14')[0].siteKey, 'yard');
  assert.equal(boardSearch(sites, 'north camera')[0].label, 'Synthetic yard');
  assert.deepEqual(boardSearch(sites, '10.1.1.1'), []);
});
