import test from 'node:test';
import assert from 'node:assert/strict';
import {IN_SHOP_COLOR, IN_SHOP_LABEL} from '../src/sharedFleetCounts.ts';
import {MONITORED_COUNT_PATHS, countForPath, selectSharedMonitoredCount} from '../src/watchfulMonitoredCounts.ts';

const now = Date.parse('2026-11-19T15:00:00Z');
const snapshotAt = new Date(now - 60_000).toISOString();

function reviewedDay() {
  const snapshot = [];
  const mhelp = [];
  let n = 1;
  const add = (camerasUp, camerasDown, cosStatus) => {
    const name = `Sniper ${n}`;
    const key = `SNIPER|${n}`;
    snapshot.push({
      unitName: name,
      canonicalUnitKey: key,
      siteName: `Fixture Site ${String((n % 92) + 1).padStart(2, '0')}`,
      status: camerasDown ? 'down' : 'up',
      camerasUp,
      camerasDown,
      snapshotAt,
    });
    mhelp.push({name, placement: 'FIELD', cosStatus});
    n += 1;
  };
  for (let i = 0; i < 145; i++) add(3, 0, i < 3 ? 'down' : 'up');
  add(7, 0, 'up');
  for (let i = 0; i < 23; i++) add(1, 1, 'down');
  snapshot.push({
    unitName: 'Solar Spotter 054',
    canonicalUnitKey: 'SOLARSPOTTER|54',
    siteName: 'Fixture Site 01',
    status: 'down',
    camerasUp: 0,
    camerasDown: 2,
    snapshotAt,
  });
  mhelp.push({name: 'Solar Spotter 054', placement: 'SHOP', cosStatus: 'down'});
  for (let i = 1; i <= 26; i++) mhelp.push({name: `Spotter ${i}`, placement: 'FIELD', cosStatus: 'unknown'});
  mhelp.push({name: 'Sniper 900 test bench', placement: 'FIELD'});
  mhelp.push({name: 'Sniper 901', placement: 'FIELD', doNotUse: true});
  return {snapshot, mhelp};
}

test('one shared count matches the reviewed Watchful day, and every path uses it', () => {
  const {snapshot, mhelp} = reviewedDay();
  const counts = MONITORED_COUNT_PATHS.map(path => countForPath(path, {snapshot, mhelp, now}));
  for (const count of counts) assert.deepEqual(count, counts[0]);
  const count = counts[0];
  assert.equal(count.fresh, true);
  assert.equal(count.units, 169);
  assert.equal(count.sites, 92);
  assert.deepEqual(count.cameras, {up: 465, down: 23, total: 488});
  assert.equal(count.offlineUnits, 23);
  assert.equal(count.notInWatchful.length, 26);
  assert.equal(count.statusMismatches.length, 3);
  assert.equal(count.inShop, 1);
  assert.equal(count.shopReview[0].flag, 'Watchful says at site, mHelp says Shop');
  assert.equal(count.inShopLabel, IN_SHOP_LABEL);
  assert.equal(count.inShopColor, IN_SHOP_COLOR);
  assert.equal(count.inShopColor, '#64748b');
  assert.equal(count.notInWatchful.some(unit => /test|901/i.test(unit.name)), false);
});

test('a missing or stale snapshot is Unknown and does not count Offline', () => {
  const {snapshot, mhelp} = reviewedDay();
  const missing = selectSharedMonitoredCount({snapshot: null, mhelp, now});
  assert.equal(missing.fresh, false);
  assert.equal(missing.units, null);
  assert.equal(missing.cameras, null);
  assert.equal(missing.offlineUnits, null);
  assert.equal(missing.notInWatchful.length, 0);
  const stale = selectSharedMonitoredCount({
    snapshot,
    snapshotAt: new Date(now - 27 * 60 * 60 * 1000).toISOString(),
    mhelp,
    now,
  });
  assert.equal(stale.fresh, false);
  assert.equal(stale.offlineUnits, null);
});

test('a Shop unit counts 0 even when Watchful says down', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [{
      unitName: 'Solar Spotter 054',
      canonicalUnitKey: 'SOLARSPOTTER|54',
      siteName: 'Fixture Site 01',
      status: 'down',
      camerasUp: 0,
      camerasDown: 4,
      snapshotAt,
    }],
    mhelp: [{name: 'Solar Spotter 054', placement: 'SHOP', cosStatus: 'up'}],
    now,
  });
  assert.equal(count.units, 0);
  assert.deepEqual(count.cameras, {up: 0, down: 0, total: 0});
  assert.equal(count.offlineUnits, 0);
  assert.equal(count.inShop, 1);
});
