import test from 'node:test';
import assert from 'node:assert/strict';
import {presentedFromWatchfulRead} from '../src/watchfulReadStatus.ts';

const now = Date.parse('2026-11-19T15:00:00Z');
const read = new Date(now - 5 * 60 * 1000).toISOString();
const oldLink = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
const freshLink = new Date(now - 60 * 1000).toISOString();

test('a fresh Watchful read mirrors offline as Down even when lastConnection is old', () => {
  assert.equal(presentedFromWatchfulRead({readAt: read, watchfulStatus: 'offline', lastConnection: oldLink, now}), 'Down');
});

test('a stale, missing, or failed Watchful read is Unknown and never Down', () => {
  assert.equal(presentedFromWatchfulRead({readAt: new Date(now - 21 * 60 * 1000).toISOString(), watchfulStatus: 'offline', lastConnection: freshLink, now}), 'Unknown');
  assert.equal(presentedFromWatchfulRead({readAt: null, watchfulStatus: 'down', lastConnection: freshLink, now}), 'Unknown');
  assert.equal(presentedFromWatchfulRead({readAt: read, readFailed: true, watchfulStatus: 'down', lastConnection: freshLink, now}), 'Unknown');
});
