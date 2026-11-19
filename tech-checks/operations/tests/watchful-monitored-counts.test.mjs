import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {IN_SHOP_COLOR, IN_SHOP_LABEL} from '../src/sharedFleetCounts.ts';
import {SNIPER_4100_FLAG, TEST_MODE_REASON, MONITORED_COUNT_PATHS, countForPath, deriveSplitSiteKeys, loadImmixRows, presentedArming, presentedImmixStatus, presentedWatchfulStatus, selectSharedMonitoredCount} from '../src/watchfulMonitoredCounts.ts';
import {formatObservedCt, oldestObservationIso} from '../src/watchfulObservation.ts';
import {presentedFromWatchfulRead} from '../src/watchfulReadStatus.ts';

const now = Date.parse('2026-11-19T15:00:00Z');
const snapshotAt = new Date(now - 60_000).toISOString();

function reviewedDay() {
  const snapshot = [];
  const mhelp = [];
  let n = 1;
  const add = (camerasUp, camerasDown, cosStatus) => {
    const name = `Sniper ${n}`;
    const key = `SNIPER|${n}`;
    const recordCount = [78, 79, 92, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(n) ? 3 : 2;
    snapshot.push({
      unitName: name,
      canonicalUnitKey: key,
      siteName: n === 92 ? 'Fixture Immix Only' : `Fixture Site ${String((n % 92) + 1).padStart(2, '0')}`,
      status: camerasDown ? 'down' : 'up',
      camerasUp,
      camerasDown,
      snapshotAt,
      arming: 'Auto',
      project: 'Fixture Field Project',
      recordCount,
      link: 'linked',
      hardKey: key,
      linkBy: 'key',
    });
    mhelp.push({name, placement: 'FIELD', cosStatus, productId: String(9000 + n), arming: 'Auto', deployed: true, bucket: 'b'});
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
  const extras = [
    {name: 'Spotter 1', siteName: 'Fixture Immix North', siteKey: 'immix-key-north', productId: '9101'},
    {name: 'Spotter 2', siteName: 'Fixture Immix South', siteKey: 'immix-key-south', productId: '9102'},
    {name: 'Spotter 3', siteName: 'Fixture Immix East', siteKey: 'immix-key-east', productId: '9103'},
    {name: 'Spotter 4', siteName: 'Fixture Immix North', siteKey: null, productId: '9104'},
    {name: 'Spotter 5', siteName: 'Fixture Immix South', siteKey: null, productId: '9105'},
  ];
  for (const extra of extras) mhelp.push({...extra, placement: 'FIELD', cosStatus: 'unknown', arming: 'Auto', bucket: 'b', deployed: true});
  for (let i = 6; i <= 26; i++) mhelp.push({
    name: `Spotter ${i}`,
    placement: 'FIELD',
    cosStatus: 'unknown',
    siteName: 'Fixture Plain Yard',
    siteKey: null,
    productId: String(9100 + i),
    arming: 'Auto',
    bucket: 'b',
    deployed: true,
  });
  mhelp.push({name: 'Sniper 900 test bench', placement: 'FIELD', projectId: 'proj-test'});
  mhelp.push({name: 'Sniper 901', placement: 'FIELD', doNotUse: true});
  return {snapshot, mhelp, testProjectIds: ['proj-test']};
}

test('one shared count matches the reviewed Watchful day, and every path uses it', () => {
  const {snapshot, mhelp, testProjectIds} = reviewedDay();
  const counts = MONITORED_COUNT_PATHS.map(path => countForPath(path, {snapshot, mhelp, testProjectIds, fetchedAt: new Date(now).toISOString(), now}));
  for (const count of counts) assert.deepEqual(count, counts[0]);
  const count = counts[0];
  assert.equal(count.fresh, true);
  assert.equal(count.units, 169);
  assert.equal(count.sites, 92);
  assert.deepEqual(count.cameras, {up: 465, down: 23, total: 488});
  assert.equal(count.downUnits, 8);
  assert.equal(count.notInWatchful.length, 26);
  assert.equal(count.needsCheck.length, 0);
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

test('a fresh read keeps an old offline unit Down, and a stale read is Unknown', () => {
  const older = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
  const newer = new Date(now - 60 * 1000).toISOString();
  const freshRead = selectSharedMonitoredCount({
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
  const ruleChange = {
    test: 'freshness uses the oldest observation, not the fetch or the newest row',
    old: {fresh: false, downUnits: null, siteRows: 0},
    new: {fresh: true, downUnits: 1, siteRows: 2},
  };
  assert.equal(freshRead.fresh, ruleChange.new.fresh);
  assert.notEqual(freshRead.fresh, ruleChange.old.fresh);
  assert.equal(freshRead.oldestObservedAt, older);
  assert.notEqual(freshRead.oldestObservedAt, newer);
  assert.equal(freshRead.downUnits, ruleChange.new.downUnits);
  assert.equal(freshRead.siteRows.length, ruleChange.new.siteRows);
  assert.equal(presentedFromWatchfulRead({readAt: new Date(now).toISOString(), watchfulStatus: 'offline', lastConnection: older, now}), 'Down');
  const staleRead = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt: newer},
    ],
    fetchedAt: new Date(now - 21 * 60 * 1000).toISOString(),
    mhelp: [{name: 'Sniper 1', placement: 'FIELD'}],
    now,
  });
  assert.equal(staleRead.fresh, false);
  assert.equal(staleRead.downUnits, null);
  assert.equal(presentedFromWatchfulRead({readAt: new Date(now - 21 * 60 * 1000).toISOString(), watchfulStatus: 'offline', lastConnection: newer, now}), 'Unknown');
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
    fetchedAt: new Date(now).toISOString(),
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
    fetchedAt: new Date(now).toISOString(),
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
    immixKeys: ['immix-key-mixed', 'immix-key-yard'],
    mhelp: [
      {name: 'Sniper 8', placement: 'FIELD', siteName: 'Fixture Mixed Yard', siteKey: 'immix-key-mixed'},
      {name: 'Sniper 9', placement: 'FIELD', siteName: 'Fixture Mixed Yard', siteKey: 'immix-key-mixed'},
      {name: 'Sniper 10', placement: 'FIELD', siteName: 'Fixture Immix Yard', siteKey: 'immix-key-yard'},
      {name: 'Sniper 11', placement: 'FIELD', siteName: 'Fixture Plain Yard', siteKey: 'plain-key'},
      {name: 'Sniper 12 test', placement: 'FIELD', siteName: 'Fixture Immix Yard', siteKey: 'immix-key-yard', projectId: 'proj-test'},
      {name: 'Sniper 13', placement: 'SHOP', siteName: 'Fixture Immix Yard', siteKey: 'immix-key-yard'},
      {name: 'Sniper 14', placement: 'FIELD', siteName: 'Fixture Immix Yard', siteKey: 'immix-key-yard', doNotUse: true},
    ],
    fetchedAt: new Date(now).toISOString(),
    testProjectIds: ['proj-test'],
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

const IMMIX_LOAD_CASES = {
  3: {testModeUnits: [], expectedMoved: 3},
  4: {testModeUnits: ['Sniper 92'], expectedMoved: 4},
  5: {testModeUnits: ['Sniper 92', 'Sniper 78', 'Sniper 79'], expectedMoved: 5},
};
const SIX_IMMIX_KEYS = [
  {siteKey: 'immix-key-north'},
  {siteKey: 'immix-key-south'},
  {siteKey: 'immix-key-east'},
  {siteKey: 'immix-key-only'},
  {siteKey: 'immix-key-split'},
  {siteKey: 'immix-key-spare'},
];

function arm(day, scenario) {
  const names = new Set(IMMIX_LOAD_CASES[scenario].testModeUnits);
  const siteOf = { 'Sniper 92': ['Fixture Immix Only', 'immix-key-only'], 'Sniper 78': ['Fixture Split Yard', 'immix-key-split'], 'Sniper 79': ['Fixture Test Yard', null] };
  for (const unit of day.snapshot) {
    if (!names.has(unit.unitName)) continue;
    const [siteName, siteKey] = siteOf[unit.unitName];
    unit.arming = 'TestMode';
    unit.project = 'Fixture Test Project';
    unit.siteName = siteName;
    unit.hardKey = null;
    unit.linkBy = 'recon_label';
    const row = day.mhelp.find(item => item.name === unit.unitName);
    row.arming = 'TestMode';
    row.project = 'Fixture Test Project';
    row.siteName = siteName;
    row.siteKey = siteKey;
  }
  return day;
}

function counted(day, {testModeRule = false, rows = [], previousArming} = {}) {
  const loaded = loadImmixRows(rows);
  return selectSharedMonitoredCount({
    snapshot: day.snapshot,
    mhelp: day.mhelp,
    testModeRule,
    testProjectIds: day.testProjectIds,
    fetchedAt: new Date(now).toISOString(),
    immixKeys: loaded.accepted.map(row => row.siteKey),
    previousArming,
    now,
  });
}

test('the load fixture parametrizes Test Mode units and the Immix move count', () => {
  assert.deepEqual(IMMIX_LOAD_CASES[3], {testModeUnits: [], expectedMoved: 3});
  assert.deepEqual(IMMIX_LOAD_CASES[4].testModeUnits, ['Sniper 92']);
  assert.equal(IMMIX_LOAD_CASES[4].expectedMoved, 4);
  assert.deepEqual(IMMIX_LOAD_CASES[5].testModeUnits, ['Sniper 92', 'Sniper 78', 'Sniper 79']);
  assert.equal(IMMIX_LOAD_CASES[5].expectedMoved, 5);
  const day = arm(reviewedDay(), 4);
  const unit = day.snapshot.find(item => item.unitName === 'Sniper 92');
  assert.equal(unit.hardKey, null);
  assert.equal(unit.linkBy, 'recon_label');
  assert.equal(unit.arming, 'TestMode');
});

test('Test Mode leaves the Watchful total while the Immix table is empty', () => {
  const count = counted(arm(reviewedDay(), 4), {testModeRule: true});
  assert.equal(count.units, 168);
  assert.equal(count.sites, 91);
  assert.deepEqual(count.cameras, {up: 462, down: 23, total: 485});
  assert.equal(count.upUnits, 160);
  assert.equal(count.downUnits, 8);
  assert.equal(count.records, 347);
  assert.equal(count.unlinked, 0);
  assert.equal(count.monitoredOnImmix.length, 0);
  const held = count.fieldNotMonitored.find(unit => unit.name === 'Sniper 92');
  assert.equal(held.reason, TEST_MODE_REASON);
  assert.equal(held.status, 'Field-not-monitored');
  assert.notEqual(held.status, 'Unknown');
  assert.notEqual(held.status, 'Offline');
  assert.match(count.excludedTestLines.join('\n'), /Fixture Test Project/);
  assert.match(count.excludedTestLines.join('\n'), /Test Mode/);
});

test('six key-matched Immix rows move four units and do not change the Watchful total', () => {
  const day = arm(reviewedDay(), 4);
  const before = counted(day, {testModeRule: true});
  const count = counted(day, {testModeRule: true, rows: SIX_IMMIX_KEYS});
  assert.equal(count.monitoredOnImmix.length, IMMIX_LOAD_CASES[4].expectedMoved);
  assert.deepEqual(count.monitoredOnImmix.map(unit => [unit.name, unit.productId]).sort(), [
    ['Sniper 92', '9092'],
    ['Spotter 1', '9101'],
    ['Spotter 2', '9102'],
    ['Spotter 3', '9103'],
  ]);
  const moved = count.monitoredOnImmix.find(unit => unit.name === 'Sniper 92');
  assert.equal(moved.siteKey, 'immix-key-only');
  assert.equal(moved.watchful_excluded_by, 'test_mode');
  assert.equal(count.notInWatchful.length, 23);
  assert.equal(count.notInWatchful.every(unit => unit.deployed), true);
  assert.deepEqual(count.notInWatchfulBuckets, {b: 23, d: 0});
  assert.equal(count.needsCheck.length, 0);
  assert.equal(count.units, before.units);
  assert.equal(count.sites, before.sites);
  assert.deepEqual(count.cameras, before.cameras);
  assert.deepEqual(count.notInWatchful.map(unit => unit.name).filter(name => name === 'Spotter 4' || name === 'Spotter 5'), ['Spotter 4', 'Spotter 5']);
});

test('Immix load guards keep Watchful totals and reject a row with no site key', () => {
  const day = arm(reviewedDay(), 4);
  const ruleOff = counted(day, {testModeRule: false, rows: SIX_IMMIX_KEYS});
  assert.equal(ruleOff.monitoredOnImmix.length, 3);
  assert.equal(ruleOff.notInWatchful.length, 23);
  assert.equal(ruleOff.units, 169);
  assert.equal(ruleOff.sites, 92);
  assert.deepEqual(ruleOff.cameras, {up: 465, down: 23, total: 488});
  assert.equal(ruleOff.monitoredOnImmix.some(unit => unit.name === 'Sniper 92'), false);
  const loaded = counted(day, {testModeRule: true, rows: SIX_IMMIX_KEYS});
  const nameless = loadImmixRows([...SIX_IMMIX_KEYS, {siteName: 'Fixture Immix North'}]);
  assert.equal(nameless.rejected.length, 1);
  assert.equal(nameless.accepted.length, 6);
  const unchanged = counted(day, {testModeRule: true, rows: nameless.accepted});
  assert.equal(unchanged.monitoredOnImmix.length, loaded.monitoredOnImmix.length);
  const rolled = counted(day, {testModeRule: true});
  assert.equal(rolled.units, 168);
  assert.equal(rolled.monitoredOnImmix.length, 0);
  assert.deepEqual(rolled.cameras, {up: 462, down: 23, total: 485});
  const flipped = day.snapshot.find(unit => unit.unitName === 'Sniper 92');
  const flippedRow = day.mhelp.find(unit => unit.name === 'Sniper 92');
  flipped.arming = 'Auto';
  flippedRow.arming = 'Auto';
  const returned = counted(day, {testModeRule: true, rows: SIX_IMMIX_KEYS, previousArming: {'Sniper 92': 'TestMode'}});
  assert.equal(returned.units, 169);
  assert.equal(returned.sites, 92);
  assert.deepEqual(returned.cameras, {up: 465, down: 23, total: 488});
  assert.deepEqual(returned.drift, [{name: 'Sniper 92', from: 'TestMode', to: 'Auto'}]);
});

test('a fifth Test Mode unit at a split site is Immix and the other stays unmonitored', () => {
  const count = counted(arm(reviewedDay(), 5), {testModeRule: true, rows: SIX_IMMIX_KEYS});
  assert.equal(count.units, 166);
  assert.equal(count.sites, 89);
  assert.deepEqual(count.cameras, {up: 456, down: 23, total: 479});
  assert.equal(count.upUnits, 158);
  assert.equal(count.downUnits, 8);
  assert.equal(count.monitoredOnImmix.some(unit => unit.name === 'Sniper 78'), true);
  assert.equal(count.monitoredOnImmix.some(unit => unit.name === 'Sniper 79'), false);
  assert.equal(count.fieldNotMonitored.some(unit => unit.name === 'Sniper 79'), true);
  assert.equal(count.notInWatchful.length, 23);
  assert.equal(count.monitoredOnImmix.length, IMMIX_LOAD_CASES[5].expectedMoved);
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
    fetchedAt: new Date(now).toISOString(),
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
    fetchedAt: new Date(now).toISOString(),
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

function caseFiveWithArchived() {
  const day = arm(reviewedDay(), 5);
  const archived = day.snapshot.find(unit => unit.canonicalUnitKey === 'SNIPER|80');
  const donor = day.snapshot.find(unit => unit.canonicalUnitKey === 'SNIPER|146');
  archived.camerasUp += 1;
  donor.camerasUp -= 1;
  archived.projectArchived = true;
  archived.arming = 'Disarmed';
  archived.unitName = 'Sniper 80 Paused';
  const sharedKey = day.mhelp.find(row => row.name === 'Sniper 78').siteKey;
  day.mhelp.push({
    name: 'Spotter 27',
    placement: 'FIELD',
    siteKey: sharedKey,
    productId: '9127',
    deployed: true,
    bucket: 'b',
  });
  const fresh = new Date(now - 5 * 60 * 1000).toISOString();
  for (const name of ['Spotter 1', 'Spotter 2', 'Spotter 3', 'Sniper 92']) {
    const row = day.mhelp.find(item => item.name === name);
    row.latestStatus = 'up';
    row.lastConnection = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
  }
  const down = day.mhelp.find(row => row.name === 'Sniper 78');
  down.latestStatus = 'down';
  down.lastConnection = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
  day.readAt = fresh;
  return day;
}

function unitSiteKeys(day) {
  const byKey = new Map(day.mhelp.filter(row => /^Sniper \d+$/.test(row.name)).map(row => {
    const number = Number(row.name.slice('Sniper '.length));
    return [`SNIPER|${number}`, row];
  }));
  const rows = day.snapshot.map(unit => ({siteKey: byKey.get(unit.canonicalUnitKey)?.siteKey ?? null, watchful: true}));
  const watchful = new Set(day.snapshot.map(unit => unit.canonicalUnitKey));
  for (const row of day.mhelp) {
    const sniper = /^Sniper (\d+)$/.exec(row.name);
    const key = sniper ? `SNIPER|${Number(sniper[1])}` : null;
    if (!key || !watchful.has(key)) rows.push({siteKey: row.siteKey ?? null, watchful: false});
  }
  return rows;
}

test('an archived project is not in Watchful only while that rule is on', () => {
  const day = caseFiveWithArchived();
  const off = selectSharedMonitoredCount({
    snapshot: day.snapshot, mhelp: day.mhelp, testModeRule: true, archivedRule: false,
    fetchedAt: day.readAt, testProjectIds: day.testProjectIds,
    immixKeys: loadImmixRows(SIX_IMMIX_KEYS).accepted.map(row => row.siteKey), now,
  });
  assert.equal(off.units, 166);
  assert.equal(off.sites, 89);
  assert.deepEqual(off.cameras, {up: 456, down: 23, total: 479});
  assert.equal(off.notInWatchful.length, 23);
  assert.equal(off.notArmed, 1);
  const parkedUnit = day.snapshot.find(unit => unit.canonicalUnitKey === 'SNIPER|81');
  parkedUnit.arming = 'Disarmed';
  const on = selectSharedMonitoredCount({
    snapshot: day.snapshot, mhelp: day.mhelp, testModeRule: true, archivedRule: true,
    fetchedAt: day.readAt, testProjectIds: day.testProjectIds,
    watchfulReadAt: day.readAt,
    immixKeys: loadImmixRows(SIX_IMMIX_KEYS).accepted.map(row => row.siteKey), now,
  });
  assert.equal(on.units, 165);
  assert.equal(on.sites, 88);
  assert.deepEqual(on.cameras, {up: 452, down: 23, total: 475});
  assert.equal(on.armedUnits, 164);
  assert.equal(on.armedSites, 87);
  assert.deepEqual(on.armedCameras, {up: 449, down: 23, total: 472});
  assert.equal(on.notInWatchful.length, 24);
  assert.equal(on.notArmedUnits.some(unit => unit.name === 'Sniper 81' && unit.mode === 'Disarmed'), true);
  assert.equal(on.notInWatchful.some(unit => unit.name === 'Sniper 81'), false);
  const parked = on.notInWatchful.find(unit => unit.name === 'Sniper 80 Paused');
  assert.equal(parked.deployed, true);
  assert.equal(parked.mode, 'Disarmed');
  assert.equal(presentedArming({name: parked.name, arming: 'Disarmed'}), 'Disarmed');
  assert.notEqual(parked.mode, 'Paused');
  assert.equal(on.notArmed, 2);
  assert.equal(presentedArming({name: 'Helios 9', arming: null}), 'Unknown');
  assert.notEqual(presentedArming({name: 'Helios 9'}), 'Auto');
});

test('split sites come from unit-to-site keys and the fixture has one', () => {
  const keys = deriveSplitSiteKeys(unitSiteKeys(caseFiveWithArchived()));
  assert.equal(keys.length, 1);
  const shared = caseFiveWithArchived().mhelp.find(row => row.name === 'Sniper 78').siteKey;
  assert.deepEqual(keys, [shared]);
});

test('the Immix line counts fresh up and down readings and leaves a 20-minute-old reading Unknown', () => {
  const day = caseFiveWithArchived();
  const count = selectSharedMonitoredCount({
    snapshot: day.snapshot, mhelp: day.mhelp, testModeRule: true, archivedRule: true,
    fetchedAt: day.readAt, testProjectIds: day.testProjectIds,
    immixReadAt: day.readAt,
    immixKeys: loadImmixRows(SIX_IMMIX_KEYS).accepted.map(row => row.siteKey), now,
  });
  assert.equal(count.immixUp, 4);
  assert.equal(count.immixDown, 1);
  const noImmixRead = selectSharedMonitoredCount({
    snapshot: day.snapshot, mhelp: day.mhelp, testModeRule: true, archivedRule: true,
    fetchedAt: day.readAt, testProjectIds: day.testProjectIds,
    watchfulReadAt: day.readAt,
    immixKeys: loadImmixRows(SIX_IMMIX_KEYS).accepted.map(row => row.siteKey), now,
  });
  assert.equal(noImmixRead.immixUp, 0);
  assert.equal(noImmixRead.immixDown, 0);
  assert.equal(noImmixRead.immixUnknown, noImmixRead.monitoredOnImmix.length);
  const staleRead = selectSharedMonitoredCount({
    snapshot: day.snapshot, mhelp: day.mhelp, testModeRule: true,
    fetchedAt: day.readAt, testProjectIds: day.testProjectIds,
    immixReadAt: new Date(now - 21 * 60 * 1000).toISOString(),
    immixKeys: loadImmixRows(SIX_IMMIX_KEYS).accepted.map(row => row.siteKey), now,
  });
  assert.equal(staleRead.immixUp, 0);
  assert.equal(staleRead.immixDown, 0);
  assert.equal(staleRead.immixUnknown, staleRead.monitoredOnImmix.length);
});

test('a Test Mode Watchful unit is not filed as Not in Watchful when its mHelp row has no arming', () => {
  const day = arm(reviewedDay(), 5);
  const row = day.mhelp.find(item => item.name === 'Sniper 79');
  delete row.arming;
  const count = counted(day, {testModeRule: true, rows: SIX_IMMIX_KEYS});
  assert.equal(count.notInWatchful.some(unit => unit.name === 'Sniper 79'), false);
  assert.equal(count.fieldNotMonitored.some(unit => unit.name === 'Sniper 79'), true);
});

test('stale mHelp records are reported for a check and are not Immix or pending', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [{unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt, arming: 'Auto'}],
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Spotter 40', placement: 'FIELD', stale: true, siteKey: 'immix-key-north'},
      {name: 'Spotter 41', placement: 'FIELD', stale: true},
    ],
    fetchedAt: new Date(now).toISOString(),
    immixKeys: ['immix-key-north'],
    now,
  });
  assert.equal(count.needsCheck.length, 2);
  assert.deepEqual(count.needsCheck.map(row => row.reason), ['Stale mHelp record needs a check', 'Stale mHelp record needs a check']);
  assert.equal(count.monitoredOnImmix.length, 0);
  assert.equal(count.notInWatchful.length, 0);
});

test('our Watchful read decides Down, and a unit lastConnection does not', () => {
  const read = new Date(now - 5 * 60 * 1000).toISOString();
  const oldLink = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
  const freshLink = new Date(now - 60 * 1000).toISOString();
  assert.equal(presentedFromWatchfulRead({readAt: read, watchfulStatus: 'offline', lastConnection: oldLink, now}), 'Down');
  assert.equal(presentedFromWatchfulRead({readAt: new Date(now - 21 * 60 * 1000).toISOString(), watchfulStatus: 'offline', lastConnection: freshLink, now}), 'Unknown');
  assert.equal(presentedFromWatchfulRead({readAt: null, watchfulStatus: 'down', lastConnection: freshLink, now}), 'Unknown');
  assert.equal(presentedFromWatchfulRead({readAt: read, readFailed: true, watchfulStatus: 'down', lastConnection: freshLink, now}), 'Unknown');
  assert.equal(oldestObservationIso([read, ''], now), null);
  assert.equal(oldestObservationIso([read, new Date(now + 60 * 1000).toISOString()], now), null);
});

test('a missing or null arming value is Unknown and stays out of the armed headline', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 2, camerasDown: 0, snapshotAt, arming: null},
      {unitName: 'Sniper 2', canonicalUnitKey: 'SNIPER|2', siteName: 'Fixture Site 02', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt, arming: 'Auto'},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 2', placement: 'FIELD'},
    ],
    now,
  });
  assert.equal(count.units, 2);
  assert.equal(count.armedUnits, 1);
  assert.equal(count.armedSites, 1);
  assert.deepEqual(count.armedCameras, {up: 0, down: 1, total: 1});
  assert.equal(count.notArmed, 0);
  assert.equal(presentedArming({name: 'Sniper 1', arming: null}), 'Unknown');
  assert.equal(presentedArming({name: 'Sniper 2'}), 'Unknown');
});

test('a future observation stamp makes the snapshot Unknown instead of Down', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt},
      {unitName: 'Sniper 2', canonicalUnitKey: 'SNIPER|2', siteName: 'Fixture Site 02', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt: new Date(now + 5 * 60 * 1000).toISOString()},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 2', placement: 'FIELD'},
    ],
    now,
  });
  assert.equal(count.fresh, false);
  assert.equal(count.oldestObservedAt, null);
  assert.equal(count.downUnits, null);
  assert.equal(count.units, null);
});

test('a snapshot with no our-read time is Unknown even when Watchful timestamps are fresh', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [{unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt}],
    mhelp: [{name: 'Sniper 1', placement: 'FIELD', arming: 'Auto'}],
    now,
  });
  assert.equal(count.fresh, false);
  assert.equal(count.units, null);
  assert.equal(count.downUnits, null);
  assert.equal(count.armedUnits, null);
});

test('Test Mode stays out of the armed headline even when the test-mode flag is off', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt, arming: 'TestMode'},
      {unitName: 'Sniper 2', canonicalUnitKey: 'SNIPER|2', siteName: 'Fixture Site 02', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt, arming: 'Auto'},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 2', placement: 'FIELD'},
    ],
    now,
  });
  assert.equal(count.units, 2);
  assert.equal(count.armedUnits, 1);
});

test('the armed headline ignores Disarmed and Paused, and a missing arming is Unknown rather than zero', () => {
  const parked = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt, arming: 'Auto'},
      {unitName: 'Sniper 2', canonicalUnitKey: 'SNIPER|2', siteName: 'Fixture Site 02', status: 'down', camerasUp: 0, camerasDown: 2, snapshotAt, arming: 'Paused'},
      {unitName: 'Sniper 3', canonicalUnitKey: 'SNIPER|3', siteName: 'Fixture Site 03', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt, arming: 'Disarmed'},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 2', placement: 'FIELD'},
      {name: 'Sniper 3', placement: 'FIELD'},
    ],
    now,
  });
  assert.equal(parked.armedUnits, 1);
  assert.equal(parked.notArmed, 2);
  assert.equal(parked.downUnits, 0);
  const missing = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt},
      {unitName: 'Sniper 2', canonicalUnitKey: 'SNIPER|2', siteName: 'Fixture Site 02', status: 'down', camerasUp: 0, camerasDown: 1, snapshotAt},
    ],
    fetchedAt: new Date(now).toISOString(),
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD'},
      {name: 'Sniper 2', placement: 'FIELD'},
    ],
    now,
  });
  assert.equal(missing.units, 2);
  assert.equal(missing.armedUnits, null);
});

test('a name containing test stays monitored unless its Watchful project id is a test site', () => {
  const count = selectSharedMonitoredCount({
    snapshot: [
      {unitName: 'Sniper 1', canonicalUnitKey: 'SNIPER|1', siteName: 'Fixture Site 01', status: 'up', camerasUp: 1, camerasDown: 0, snapshotAt, arming: 'Auto', projectId: 'proj-field'},
    ],
    fetchedAt: new Date(now).toISOString(),
    testProjectIds: ['proj-test'],
    mhelp: [
      {name: 'Sniper 1', placement: 'FIELD', projectId: 'proj-field'},
      {name: 'Contest 4', placement: 'FIELD'},
      {name: 'Sniper 9', placement: 'FIELD', projectId: 'proj-test'},
    ],
    now,
  });
  assert.equal(count.units, 1);
  assert.equal(count.armedUnits, 1);
  assert.equal(count.notInWatchful.some(unit => unit.name === 'Contest 4'), true);
  assert.equal(count.notInWatchful.some(unit => unit.name === 'Sniper 9'), false);
});

test('the camera health render function parses', () => {
  const html = readFileSync(new URL('../../camera-health.html', import.meta.url), 'utf8');
  const start = html.indexOf('function sharedMonitoredField()');
  const end = html.indexOf('function renderUnits()');
  assert.ok(start > 0 && end > start);
  new Function(html.slice(start, end));
});
