import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {presentedCameraState} from '../src/sharedFleetCounts.ts';
import {CAMERA_FRESH_MS, RECON_FRESH_MS} from '../src/cameraEvidence.ts';

const NOW = Date.parse('2026-11-25T04:00:00Z');
const agoMs = ms => new Date(NOW - ms).toISOString();

test('a polled camera is still judged by the polled window', () => {
  // Nothing about Snipers or CAM Vs changes: they are checked on a clock every 15 minutes.
  assert.equal(presentedCameraState({state: 'online', observedAt: agoMs(10 * 60 * 1000)}, NOW), 'online');
  assert.equal(presentedCameraState({state: 'online', observedAt: agoMs(CAMERA_FRESH_MS + 1)}, NOW), 'unknown');
  assert.equal(presentedCameraState({state: 'offline', observedAt: agoMs(5 * 60 * 1000)}, NOW), 'offline');
});

test('a quiet Reconeyez unit is not called Unknown just for being quiet', () => {
  // The real case from the field: Recon II 010 and 029 last spoke about two hours ago and are healthy.
  const twoHours = {state: 'online', observedAt: agoMs(2 * 60 * 60 * 1000)};
  assert.equal(presentedCameraState(twoHours, NOW), 'unknown', 'the polled window calls it Unknown');
  assert.equal(presentedCameraState(twoHours, NOW, RECON_FRESH_MS), 'online', 'its own window reads it as it is');
});

test('the wider window still goes Unknown, and never invents an Online', () => {
  // Past its own window it is Unknown again. A longer window must not mean "assume it is fine".
  assert.equal(presentedCameraState({state: 'online', observedAt: agoMs(RECON_FRESH_MS + 1)}, NOW, RECON_FRESH_MS), 'unknown');
  // No reading at all stays Unknown however wide the window.
  assert.equal(presentedCameraState({state: 'online', observedAt: null}, NOW, RECON_FRESH_MS), 'unknown');
  assert.equal(presentedCameraState({state: 'unknown', observedAt: agoMs(60 * 1000)}, NOW, RECON_FRESH_MS), 'unknown');
  // A fresh confirmed miss is still Offline, not softened into Unknown by the wider window.
  assert.equal(presentedCameraState({state: 'offline', observedAt: agoMs(2 * 60 * 60 * 1000)}, NOW, RECON_FRESH_MS), 'offline');
  // A reading stamped in the future is not evidence of anything.
  assert.equal(presentedCameraState({state: 'online', observedAt: new Date(NOW + 60 * 1000).toISOString()}, NOW, RECON_FRESH_MS), 'unknown');
});

test('only the Reconeyez feed gets the event window', () => {
  const source = readFileSync(new URL('../src/cosBoard/boardData.ts', import.meta.url), 'utf8');
  assert.match(source, /feed\.source === 'reconeyez' \? RECON_FRESH_MS : CAMERA_FRESH_MS/);
  // The verdict, the camera list and the not-online list must all use the same window, or the card
  // would disagree with its own tiles.
  assert.equal(source.split('freshWindow(feed)').length - 1, 3);
});
