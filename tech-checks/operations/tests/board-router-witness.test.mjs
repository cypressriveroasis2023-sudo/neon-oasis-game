// The router as a second witness for a Sniper or CAM V whose own check has gone quiet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFeedCensus} from '../src/sharedFleetCounts.ts';
import {boardData, routerWitness, ROUTER_WITNESS_SOURCE, ROUTER_WITNESS_FRESH_MS, ROUTER_WITNESS_MAX_GAP_MS} from '../src/cosBoard/boardData.ts';
import {projectIpCheckUnits} from '../shared/otherUnitStatus.ts';

const now = Date.parse('2026-11-26T21:10:00Z');
const at = minutes => new Date(now - minutes * 60 * 1000).toISOString();
const sec = iso => Math.round(Date.parse(iso) / 1000);

// The feed line the board is given for a field Sniper, built by the real projector
// from a device row and its saved check, so these tests follow what it actually sends.
const sniper = (name, check, extra = {}) => projectIpCheckUnits(
  [{id: 1, source: '2026_unit_tracker', unit_key: name, device_name: name, public_ip: '203.0.113.20', organization: 'Fixture Site', activation_state: 'active', ...extra}],
  check ? [{camera_device_id: 1, ...check}] : [], now)[0];
const said = (status, minutesAgo, more = {}) => ({overall_status: status, checked_at: at(minutesAgo), confirmed_outage: false, consecutive_failures: status === 'online' ? 0 : 1, ...more});
const router = (unitKey, reportedStatus, minutesAgo, more = {}) => ({
  id: 'r-' + unitKey + (more.n || ''), unitKey, name: unitKey, model: 'IR615', publicIp: null, unitIp: null, port: null, protocol: null,
  probeStatus: 'unknown', checkedAt: null, lastRecoveredAt: null,
  reportedStatus, reportedAt: minutesAgo === null ? null : at(minutesAgo), reportedSource: ROUTER_WITNESS_SOURCE,
  savedLatencyMs: null, match: 'exact_name', candidateUnit: null, gps: null, ...more,
});
const board = (feed, routers) => boardData({feed, census: cameraFeedCensus(feed, [], now), now, routers}).units;

test('the feed carries what the check last found, whatever its age, and it is never a status', () => {
  const quiet = sniper('SNIPER 301', said('online', 200));
  assert.equal(quiet.state, 'UNKNOWN');
  assert.deepEqual(quiet.directCheck, {status: 'online', at: at(200), confirmed: false});
  const current = sniper('SNIPER 301', said('online', 5));
  assert.equal(current.state, 'GREEN');
  assert.deepEqual(current.directCheck, {status: 'online', at: at(5), confirmed: false});
  assert.deepEqual(sniper('SNIPER 301', said('offline', 90, {confirmed_outage: true, consecutive_failures: 3})).directCheck, {status: 'offline', at: at(90), confirmed: true});
  assert.equal('directCheck' in sniper('SNIPER 301', null), false);
  assert.equal('directCheck' in sniper('SNIPER 301', {overall_status: 'unknown', checked_at: at(5)}), false);
  assert.equal('directCheck' in sniper('SNIPER 301', {overall_status: 'online', checked_at: 'not a time'}), false);
});

test('a current check always wins: the router is not consulted', () => {
  for (const [check, verdict] of [[said('online', 5), 'up'], [said('offline', 5, {confirmed_outage: true, consecutive_failures: 3}), 'down']]) {
    for (const reported of ['online', 'offline']) {
      const [u] = board([sniper('SNIPER 301', check)], [router('SNIPER 301', reported, 2)]);
      assert.equal(u.vd, verdict); assert.equal(u.w, undefined); assert.equal(u.t, sec(check.checked_at));
    }
  }
});

test('the check last said Online and has gone quiet; the router reports online: Up, shown as the router\'s report', () => {
  for (const quietFor of [25, 60, 215, 355]) {
    const feed = [sniper('SNIPER 301', said('online', quietFor))];
    assert.equal(board(feed, [])[0].vd, 'unknown', 'without a router it is Not verified');
    const [u] = board(feed, [router('SNIPER 301', 'online', 8)]);
    assert.equal(u.vd, 'up'); assert.equal(u.on, 1); assert.equal(u.off, 0); assert.equal(u.n, 1);
    assert.equal(u.w, 'r'); assert.equal(u.t, sec(at(8))); assert.equal(u.wt, sec(at(quietFor)));
    assert.equal(u.bad, '');
  }
});

test('the check last confirmed an outage and has gone quiet; the router reports offline: Down', () => {
  const feed = [sniper('SNIPER 168', said('offline', 90, {confirmed_outage: true, consecutive_failures: 3}))];
  assert.equal(board(feed, [])[0].vd, 'unknown');
  const [u] = board(feed, [router('SNIPER 168', 'offline', 8)]);
  assert.equal(u.vd, 'down'); assert.equal(u.off, 1); assert.equal(u.on, 0); assert.equal(u.w, 'r');
  assert.equal(u.bad, 'Avigilon check');
});

test('the router never overturns the check: disagreement stays Not verified', () => {
  const cases = [
    [said('online', 60), 'offline'],                                                  // check up, router down
    [said('offline', 60, {confirmed_outage: true, consecutive_failures: 3}), 'online'], // camera known down, router up
    [said('offline', 60, {consecutive_failures: 1}), 'offline'],                       // one unconfirmed miss
    [said('offline', 60, {consecutive_failures: 2}), 'offline'],                       // two misses, not confirmed
    [said('online', 60), 'Unknown'],
  ];
  for (const [check, reported] of cases) {
    const [u] = board([sniper('SNIPER 301', check)], [router('SNIPER 301', reported, 8)]);
    assert.equal(u.vd, 'unknown', JSON.stringify([check.overall_status, reported])); assert.equal(u.w, undefined);
  }
});

test('one missed check that is still current reads Not verified, router or not', () => {
  const [u] = board([sniper('SNIPER 301', said('offline', 5, {consecutive_failures: 1}))], [router('SNIPER 301', 'online', 2)]);
  assert.equal(u.vd, 'unknown'); assert.equal(u.w, undefined);
});

test('only a single, current InHand report newer than the check counts', () => {
  const feed = [sniper('SNIPER 301', said('online', 60))];
  const no = routers => { const [u] = board(feed, routers); assert.equal(u.vd, 'unknown'); assert.equal(u.w, undefined); };
  no([router('SNIPER 301', 'online', 8, {reportedSource: '2026 Unit Tracker'})]);
  no([router('SNIPER 301', 'online', 8, {reportedSource: 'InHand portal export 2026-11-17'})]);
  no([router('SNIPER 301', 'online', 46)]);                       // older than the fresh window
  no([router('SNIPER 301', 'online', 61)]);                       // not newer than the check
  no([router('SNIPER 301', 'online', -5)]);                       // dated in the future
  no([router('SNIPER 301', 'online', null)]);                     // no time
  no([router('SNIPER 301', 'online', 8), router('SNIPER 301', 'online', 9, {n: 2})]); // two routers on the name
  no([router('SNIPER 3010', 'online', 8)]);                       // another unit's router
  // COS's own probe of the router is not a witness: it rides the same checker.
  no([router('SNIPER 301', 'Unknown', 8, {probeStatus: 'online', checkedAt: at(3)})]);
  assert.equal(ROUTER_WITNESS_FRESH_MS, 45 * 60 * 1000);
});

test('a check quiet for more than six hours is Not verified whatever the router says', () => {
  const [u] = board([sniper('SNIPER 301', said('online', 365))], [router('SNIPER 301', 'online', 8)]);
  assert.equal(u.vd, 'unknown'); assert.equal(u.w, undefined);
  assert.equal(ROUTER_WITNESS_MAX_GAP_MS, 6 * 60 * 60 * 1000);
});

test('no saved check, no IP, a shop unit or another kind of unit is never spoken for', () => {
  const quietStar = {unit: 'SPOTTER 400', placement: 'FIELD', site: 'Fixture Site', siteNamePending: false, state: 'UNKNOWN', cameras: 1, online: 0, offline: 0, unknown: 1, down: [], onlineInShop: false, publicIp: '203.0.113.21', observedAt: at(60), source: 'star4live', directCheck: {status: 'online', at: at(60), confirmed: false}};
  for (const feed of [
    [sniper('SNIPER 301', null)],
    [sniper('SNIPER 301', said('online', 60), {public_ip: null})],
    [sniper('SNIPER 301', said('online', 60), {organization: 'Shop'})],
    [quietStar],
  ]) {
    const [u] = board(feed, [router(feed[0].unit, 'online', 8)]);
    assert.notEqual(u.vd, 'up'); assert.equal(u.w, undefined);
  }
  assert.equal(routerWitness(quietStar, [router('SPOTTER 400', 'online', 8)], now), null);
});

test('26 Nov: 29 Snipers quiet for hours with routers online read Up; the one really down stays Down; counts follow', () => {
  const feed = [], routers = [];
  for (let n = 1; n <= 29; n++) {
    const name = 'SNIPER ' + (300 + n);
    feed.push({...sniper(name, said('online', 195)), unit: name});
    if (n <= 18) routers.push(router(name, 'online', 3));   // 18 of them have a linked InHand router
  }
  feed.push({...sniper('SNIPER 168', said('offline', 195, {confirmed_outage: true, consecutive_failures: 3})), unit: 'SNIPER 168'});
  routers.push(router('SNIPER 168', 'offline', 3));
  const before = board(feed, []), after = board(feed, routers);
  const tally = units => units.reduce((t, u) => ({...t, [u.vd]: (t[u.vd] || 0) + 1}), {});
  assert.deepEqual(tally(before), {unknown: 30});
  assert.deepEqual(tally(after), {up: 18, unknown: 11, down: 1});
});
