import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IN_SHOP_COLOR, IN_SHOP_LABEL} from '../src/sharedFleetCounts.ts';
import {SNIPER_4100_FLAG, STALE_MHELP_REASON, MONITORED_COUNT_PATHS, countForPath, presentedImmixStatus, presentedWatchfulStatus, selectSharedMonitoredCount} from '../src/watchfulMonitoredCounts.ts';
import {formatObservedCt} from '../src/watchfulObservation.ts';

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
  for (let i = 0; i < 15; i++) add(1, 0, 'up');
  for (const down of [3, 3, 3, 3, 3, 3, 3, 2]) add(1, down, 'down');
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
  const extraSites = [
    'Fixture Site 01',
    'Fixture Immix North',
    'Fixture Immix South',
    ...Array.from({length: 21}, () => 'Fixture Plain Yard'),
    'Fixture Site 02',
    'Fixture Plain Yard',
  ];
  for (let i = 1; i <= 26; i++) mhelp.push({
    name: `Spotter ${i}`,
    placement: 'FIELD',
    cosStatus: 'unknown',
    siteName: extraSites[i - 1],
    stale: i >= 25,
  });
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
  assert.equal(count.downUnits, 8);
  assert.equal(count.notInWatchful.length, 24);
  assert.equal(count.needsCheck.length, 2);
  assert.equal(count.monitoredOnImmix.length, 0);
  assert.equal(count.statusMismatches.length, 3);
  assert.equal(count.inShop, 1);
  assert.equal(count.shopReview[0].flag, 'Watchful says at site, mHelp says Shop');
  assert.equal(count.inShopLabel, IN_SHOP_LABEL);
  assert.equal(count.inShopColor, IN_SHOP_COLOR);
  assert.equal(count.inShopColor, '#64748b');
  assert.equal(count.notInWatchful.some(unit => /test|901/i.test(unit.name)), false);
  const siteUnits = count.siteRows.reduce((sum, row) => sum + row.units, 0);
  const siteUp = count.siteRows.reduce((sum, row) => sum + row.camerasUp, 0);
  const siteDown = count.siteRows.reduce((sum, row) => sum + row.camerasDown, 0);
  assert.equal(siteUnits, 169);
  assert.equal(count.siteRows.length, 92);
  assert.equal(siteUp, 465);
  assert.equal(siteDown, 23);
  assert.equal(siteUp + siteDown, count.cameras.total);
});

test('freshness uses the oldest observation, not the fetch or the newest row', () => {
  const older = new Date(now - 21 * 60 * 1000).toISOString();
  const newer = new Date(now - 60 * 1000).toISOString();
  const stale = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'down', camerasUp: 1, camerasDown: 1, snapshotAt: older},
      {unitName: 'Sniper 2', canonicalUnitKey: 'SNIPER|2', siteName: 'Fixture Site 02', status: 'up', camerasUp: 2, camerasDown: 0, snapshotAt: newer},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 2', placement: 'FIELD'},
      {name: 'Sniper 3 test', placement: 'FIELD'},
      {name: 'Sniper 4', placement: 'SHOP'},
      {name: 'Sniper 5', placement: 'FIELD', doNotUse: true},
    ],
    now,
  });
  assert.equal(stale.fresh, false);
  assert.equal(stale.oldestObservedAt, older);
  assert.notEqual(stale.oldestObservedAt, newer);
  assert.equal(stale.downUnits, null);
  assert.equal(stale.siteRows.length, 0);
  const fresh = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 2, camerasDown: 0, snapshotAt: new Date(now - 10 * 60 * 1000).toISOString()},
      {unitName: 'Sniper 4', canonicalUnitKey: 'SNIPER|4', siteName: 'Fixture Site 01', status: 'down', camerasUp: 0, camerasDown: 9, snapshotAt: newer},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 4', placement: 'SHOP'},
    ],
    now,
  });
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.oldestObservedAt, new Date(now - 10 * 60 * 1000).toISOString());
  assert.equal(fresh.units, 1);
  assert.equal(fresh.cameras.down, 0);
  assert.equal(fresh.siteRows.reduce((sum, row) => sum + row.camerasDown, 0), 0);
  assert.equal(fresh.inShop, 1);
});

test('a missing or stale snapshot is Unknown and does not count Offline', () => {
  const {snapshot, mhelp} = reviewedDay();
  const missing = selectSharedMonitoredCount({snapshot: null, mhelp, now});
  assert.equal(missing.fresh, false);
  assert.equal(missing.units, null);
  assert.equal(missing.cameras, null);
  assert.equal(missing.downUnits, null);
  assert.equal(missing.notInWatchful.length, 0);
  const stale = selectSharedMonitoredCount({
    snapshot,
    snapshotAt: new Date(now - 27 * 60 * 60 * 1000).toISOString(),
    mhelp,
    now,
  });
  assert.equal(stale.fresh, false);
  assert.equal(stale.downUnits, null);
});

test('a reader shows Unknown without a fresh snapshot and never shows a Shop unit as down', () => {
  assert.equal(presentedWatchfulStatus({snapshotFresh: false, mhelpPlacement: 'FIELD', unitStatus: 'down'}), 'Unknown');
  assert.equal(presentedWatchfulStatus({snapshotFresh: true, mhelpPlacement: 'FIELD', unitStatus: null}), 'Unknown');
  assert.equal(presentedWatchfulStatus({snapshotFresh: true, mhelpPlacement: 'SHOP', unitStatus: 'down'}), 'In Shop');
  assert.notEqual(presentedWatchfulStatus({snapshotFresh: true, mhelpPlacement: 'SHOP', unitStatus: 'down'}), 'down');
  assert.equal(presentedWatchfulStatus({snapshotFresh: true, mhelpPlacement: 'FIELD', unitStatus: 'down'}), 'down');
  const {snapshot, mhelp} = reviewedDay();
  const stale = selectSharedMonitoredCount({snapshot, snapshotAt: new Date(now - 27 * 60 * 60 * 1000).toISOString(), mhelp, now});
  assert.equal(stale.fresh, false);
  assert.equal(stale.downUnits, null);
  const shop = selectSharedMonitoredCount({
    snapshot: [{unitName: 'Solar Spotter 054', canonicalUnitKey: 'SOLARSPOTTER|54', siteName: 'Fixture Site 01', status: 'down', camerasUp: 0, camerasDown: 4, snapshotAt}],
    mhelp: [{name: 'Solar Spotter 054', placement: 'SHOP', cosStatus: 'down'}],
    now,
  });
  assert.equal(shop.downUnits, 0);
  assert.equal(shop.inShop, 1);
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
  assert.equal(count.downUnits, 0);
  assert.equal(count.inShop, 1);
});

test('Immix-site units leave Not in Watchful and are not counted as Watchful units', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [{
      unitName: 'Sniper 8',
      canonicalUnitKey: 'SNIPER|8',
      siteName: 'Fixture Mixed Yard',
      status: 'up',
      camerasUp: 2,
      camerasDown: 0,
      snapshotAt,
    }],
    immixSites: ['Fixture Immix Yard', 'Fixture Mixed Yard'],
    mhelp: [
      {name: 'Sniper 8', placement: 'FIELD', siteName: 'Fixture Mixed Yard'},
      {name: 'Sniper 9', placement: 'FIELD', siteName: 'Fixture Mixed Yard'},
      {name: 'Sniper 10', placement: 'FIELD', siteName: 'Fixture Immix Yard'},
      {name: 'Sniper 11', placement: 'FIELD', siteName: 'Fixture Plain Yard'},
      {name: 'Sniper 12 test', placement: 'FIELD', siteName: 'Fixture Immix Yard'},
      {name: 'Sniper 13', placement: 'SHOP', siteName: 'Fixture Immix Yard'},
      {name: 'Sniper 14', placement: 'FIELD', siteName: 'Fixture Immix Yard', doNotUse: true},
    ],
    now,
  });
  assert.equal(count.units, 1);
  assert.deepEqual(count.cameras, {up: 2, down: 0, total: 2});
  assert.deepEqual(count.monitoredOnImmix.map(unit => unit.name), ['Sniper 9', 'Sniper 10']);
  assert.deepEqual(count.notInWatchful.map(unit => unit.name), ['Sniper 11']);
  for (const unit of count.monitoredOnImmix) {
    assert.equal(unit.source, 'immix');
    assert.equal(unit.groupLabel, 'Monitored on Immix');
    assert.equal(unit.status, 'unknown');
    assert.equal(presentedImmixStatus(unit).statusLabel, 'Unknown');
    assert.equal(unit.statusLabel, 'Unknown');
    assert.notEqual(unit.status, 'up');
    assert.notEqual(unit.status, 'down');
  }
});

const SIX_IMMIX_SITES = [
  'Fixture Site 01',
  'Fixture Site 02',
  'Fixture Immix North',
  'Fixture Immix South',
  'Fixture Immix East',
  'Fixture Immix West',
];

test('marking six synthetic Immix sites moves three units and leaves the Watchful totals', () => {
  const {snapshot, mhelp} = reviewedDay();
  const count = selectSharedMonitoredCount({snapshot, mhelp, immixSites: SIX_IMMIX_SITES, now});
  assert.equal(SIX_IMMIX_SITES.length, 6);
  assert.equal(count.units, 169);
  assert.equal(count.downUnits, 8);
  assert.deepEqual(count.cameras, {up: 465, down: 23, total: 488});
  assert.equal(count.sites, 92);
  assert.equal(count.monitoredOnImmix.length, 3);
  assert.equal(count.notInWatchful.length, 21);
  assert.notEqual(count.notInWatchful.length, 0);
  assert.equal(count.needsCheck.length, 2);
  assert.deepEqual(count.needsCheck.map(row => row.reason), [STALE_MHELP_REASON, STALE_MHELP_REASON]);
  assert.equal(count.monitoredOnImmix.some(unit => count.needsCheck.some(row => row.name === unit.name)), false);
  assert.equal(count.notInWatchful.some(unit => count.needsCheck.some(row => row.name === unit.name)), false);
  assert.equal(count.monitoredOnImmix.every(unit => unit.statusLabel === 'Unknown'), true);
});

test('a Watchful unit with no Field match or two Field matches is an exception', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 30', canonicalUnitKey: 'SNIPER|30', siteName: 'Fixture Site 01', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt},
      {unitName: 'Sniper 31', canonicalUnitKey: 'SNIPER|31', siteName: 'Fixture Site 02', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt},
    ],
    mhelp: [
      {name: 'Sniper 31', placement: 'FIELD'},
      {name: 'Sniper 31 CAM 1', placement: 'FIELD'},
    ],
    now,
  });
  assert.equal(count.units, 0);
  assert.deepEqual(count.matchExceptions.map(row => row.reason), [
    'Watchful unit has no mHelp Field match',
    'Watchful unit has 2 mHelp Field matches',
  ]);
});

test('Sniper 4-100 stays counted down and carries the amber flag', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [{
      unitName: 'Sniper 4-100',
      canonicalUnitKey: 'SNIPER4|100',
      siteName: 'Fixture Site 04',
      status: 'down',
      camerasUp: 0,
      camerasDown: 1,
      snapshotAt,
    }],
    mhelp: [{name: 'Sniper 4-100', placement: 'FIELD', siteName: 'Fixture Site 04'}],
    now,
  });
  assert.equal(count.units, 1);
  assert.equal(count.downUnits, 1);
  assert.equal(count.cameras.down, 1);
  assert.deepEqual(count.amberFlags, [{name: 'Sniper 4-100', flag: SNIPER_4100_FLAG}]);
  assert.equal(count.inShop, 0);
});

test('the observed stamp is an hour and minute in Central time', () => {
  assert.equal(formatObservedCt('2026-11-19T15:00:00Z'), '9:00 AM CT');
});

test('the camera health render function parses', () => {
  const html = readFileSync(new URL('../../camera-health.html', import.meta.url), 'utf8');
  const start = html.indexOf('function sharedMonitoredField()');
  const end = html.indexOf('function renderUnits()');
  assert.ok(start > 0 && end > start);
  new Function(html.slice(start, end));
});
