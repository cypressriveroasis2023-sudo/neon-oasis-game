import test from 'node:test';
import assert from 'node:assert/strict';
import {loudSourceAlerts, sourceHealth} from '../src/sourceAttention.ts';

const NOW = Date.parse('2026-11-16T22:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a rejected mHelp token names the source, the last success, and reconnect', () => {
  const alerts = loudSourceAlerts({
    now: NOW,
    mhelp: {authState: 'reconnect_required', lastSuccess: ago(6 * 60 * 60 * 1000), live: true},
  });
  const auth = alerts.find(row => row.id === 'mhelp_auth');
  assert.equal(auth.state, 'reconnect_required');
  assert.equal(auth.source, 'mHelpDesk authorization');
  assert.equal(auth.since, ago(6 * 60 * 60 * 1000));
  assert.match(auth.action, /Reconnect mHelpDesk/);
  assert.doesNotMatch(auth.action, /outage/i);
  assert.equal(alerts.some(row => /offline|outage/i.test(row.source)), false);
});

test('a stale inventory is named and is not called an outage', () => {
  const alerts = loudSourceAlerts({
    now: NOW,
    mhelp: {authState: 'verified', lastSuccess: ago(50 * 60 * 1000), live: true, reportedStale: true},
  });
  const inventory = alerts.find(row => row.id === 'mhelp_inventory');
  assert.equal(inventory.state, 'stale');
  assert.equal(inventory.since, ago(50 * 60 * 1000));
  assert.match(inventory.action, /not an outage/);
});

test('a fresh verified source stays off the banner', () => {
  const alerts = loudSourceAlerts({
    now: NOW,
    mhelp: {authState: 'verified', lastSuccess: ago(10 * 60 * 1000), live: true},
    connections: {state: 'ready', boardCheckedAt: NOW - 5 * 60 * 1000},
    star: {fresh: true, syncedAt: ago(5 * 60 * 1000), status: 'ok'},
    victron: {errorCode: null, lastAttemptAt: ago(5 * 60 * 1000)},
    tracker: {verifiedAt: ago(5 * 60 * 1000)},
  });
  assert.deepEqual(alerts, []);
});

test('unknown stays unknown and is not labeled offline', () => {
  const alerts = loudSourceAlerts({now: NOW, star: {fresh: null, syncedAt: null, status: null}});
  const star = alerts.find(row => row.id === 'star4live');
  assert.equal(star.state, 'unknown');
  assert.match(star.action, /Unknown, not offline/);
  assert.equal(alerts.some(row => row.state === 'failed' && row.id === 'star4live'), false);
});

test('a failed connection census names the census and refuses a camera outage', () => {
  const alerts = loudSourceAlerts({now: NOW, connections: {state: 'error', boardCheckedAt: NOW - 60 * 60 * 1000}});
  const census = alerts.find(row => row.id === 'connections');
  assert.equal(census.state, 'failed');
  assert.match(census.action, /not a camera outage/);
});

test('the strip shows every source, including one this view does not read', () => {
  const rows = sourceHealth({now: NOW, mhelp: {authState: 'verified', lastSuccess: ago(5 * 60 * 1000), live: true}});
  assert.deepEqual(rows.map(row => row.id), ['mhelp_auth', 'mhelp_inventory', 'connections', 'star4live', 'victron', 'tracker']);
  assert.equal(rows.find(row => row.id === 'star4live').state, 'absent');
  assert.equal(loudSourceAlerts({now: NOW, mhelp: {authState: 'verified', lastSuccess: ago(5 * 60 * 1000), live: true}}).some(row => row.state === 'absent'), false);
});
