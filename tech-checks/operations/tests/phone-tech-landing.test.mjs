import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {phoneBoardCounts, phoneTechnicianTodos} from '../src/phoneTechLanding.ts';

const now = Date.parse('2026-10-06T18:00:00Z');
const windowMs = 20 * 60 * 1000;
const saved = {checkedAt: now - 2 * 60 * 60 * 1000, field: 20, shop: 9, online: 7, offline: 1, unverified: 3};

test('a saved reading paints immediately and stays labeled not current', () => {
  const counts = phoneBoardCounts({now, windowMs, saved, live: null, shop: saved.shop});
  assert.deepEqual([counts.up, counts.down, counts.unknown], [7, 1, 3]);
  assert.equal(counts.stale, true);
  assert.match(counts.note, /not current\./);
  assert.equal(counts.down, 1);
});

test('shop is not added to down and unknown is not folded into offline', () => {
  const counts = phoneBoardCounts({
    now, windowMs, saved: null, shop: 9,
    live: {online: 4, offline: 1, unknown: 2, checkedAt: now - 60 * 1000},
  });
  assert.deepEqual([counts.up, counts.down, counts.unknown], [4, 1, 2]);
  assert.equal(counts.stale, false);
  assert.doesNotMatch(counts.note, /not current/);
});

test('a stale live board falls back to the saved reading', () => {
  const counts = phoneBoardCounts({
    now, windowMs, saved, shop: 9,
    live: {online: 4, offline: 1, unknown: 2, checkedAt: now - windowMs - 1},
  });
  assert.deepEqual([counts.up, counts.down, counts.unknown], [7, 1, 3]);
  assert.equal(counts.stale, true);
});

test('unknown and shop units are not technician jobs', () => {
  const todos = phoneTechnicianTodos([
    {name: 'Spotter 1', placement: 'field', cameraState: 'offline'},
    {name: 'Spotter 2', placement: 'field', cameraState: 'unknown'},
    {name: 'Sniper 44', placement: 'shop', cameraState: 'offline'},
  ]);
  assert.deepEqual(todos.map(todo => todo.unit), ['Spotter 1']);
});

test('the phone landing lazy-loads the map, briefing and camera status', () => {
  const fleet = readFileSync(new URL('../src/FleetDashboard.tsx', import.meta.url), 'utf8');
  assert.match(fleet, /lazy\(\(\) => import\('\.\/FleetDashboardMap'\)\)/);
  assert.match(fleet, /lazy\(\(\) => import\('\.\/FleetVisionBriefing'\)\)/);
  assert.match(fleet, /lazy\(\(\) => import\('\.\/FleetCameraStatus'\)\)/);
  assert.match(fleet, /About this board/);
  assert.match(fleet, /This board is inventory, not live health\./);
  assert.match(fleet, /boardVisible&&!failed&&!durableWaiting|boardVisible&&!durableWaiting/);
});
