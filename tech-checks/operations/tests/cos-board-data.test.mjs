import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFeedCensus, cameraFeedClock, fleetCountsFromCameraFeed} from '../src/sharedFleetCounts.ts';
import {boardData, boardMhelp, boardTally} from '../src/cosBoard/boardData.ts';
import {boardEditState, handFixRequest} from '../src/cosBoard/boardEdit.ts';

const now = Date.parse('2026-11-18T13:10:00Z');
const at = minutes => new Date(now - minutes * 60 * 1000).toISOString();
const fresh = at(5), stale = at(180);

const unit = (name, extra = {}) => ({
  unit: name, placement: 'FIELD', site: 'Fixture yard', siteNamePending: false, state: 'GREEN',
  cameras: 1, online: 1, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: fresh,
  source: 'star4live', ...extra,
});
const cameras = (name, ...statuses) => statuses.map((status, index) => ({name: `${name} / Cam ${index + 1}`, status, atSite: true}));

const feed = [
  unit('SPOTTER 001', {cameras: 2, online: 2, cameraList: cameras('SPOTTER 001', 'online', 'online')}),
  unit('SPOTTER 002', {state: 'YELLOW', cameras: 2, online: 1, offline: 1, cameraList: cameras('SPOTTER 002', 'online', 'offline')}),
  unit('SPOTTER 003', {state: 'RED', online: 0, offline: 1, cameraList: cameras('SPOTTER 003', 'offline')}),
  // An offline reading that is three hours old is Unknown, never Down.
  unit('SPOTTER 004', {state: 'RED', online: 0, offline: 1, observedAt: stale, cameraList: cameras('SPOTTER 004', 'offline')}),
  unit('SPOTTER 005', {state: 'UNKNOWN', online: 0, unknown: 1, observedAt: null}),
  // A spare sitting in the shop is not an outage at the site.
  unit('HELIOS 006', {cameras: 2, online: 1, offline: 1, cameraList: [{name: 'HELIOS 006 / Cam 1', status: 'online', atSite: true}, {name: 'HELIOS 006 / Spare', status: 'offline', atSite: false}]}),
  unit('RANGER 007', {cameras: 2, online: 1, offline: 1, cameraList: [{name: 'RANGER 007 / Cam 1', status: 'online', atSite: true}, {name: 'RANGER 007 / Old', status: 'offline', atSite: true, removed: true}]}),
  unit('SNIPER 008', {placement: 'SHOP', site: null, state: 'RED', online: 0, offline: 1, source: 'ip_check', publicIp: '203.0.113.8'}),
  unit('SNIPER 009', {placement: 'SHOP', site: null, onlineInShop: true, source: 'ip_check'}),
  unit('SNIPER 010', {placement: 'SHOP', site: null, doNotUse: true, source: 'ip_check'}),
  unit('SNIPER 011', {doNotUse: true, source: 'ip_check'}),
  unit('RII-012', {state: 'UNKNOWN', cameras: 2, online: 0, unknown: 2, observedAt: stale, source: 'reconeyez'}),
  unit('SNIPER 013', {state: 'RED', online: 0, offline: 1, source: 'ip_check'}),
];

function board(input = feed, extra = {}) {
  const census = cameraFeedCensus(input, extra.recorders || [], now);
  return boardData({feed: input, census, now: cameraFeedClock(input, now), ...extra});
}

test('every board tile is a slice of the shared count', () => {
  const counts = fleetCountsFromCameraFeed(feed, [], now);
  const data = board();
  const tally = boardTally(data.units);
  assert.deepEqual(tally, {up: 3, issues: 1, down: 2, unknown: 3, shop: 2, shopOnline: 1, excluded: 2});
  assert.equal(tally.up, counts.units.online);
  assert.equal(tally.issues + tally.down, counts.units.offline);
  assert.equal(tally.unknown, counts.units.unknown);
  assert.equal(tally.shop, counts.inShopUnits);
  assert.equal(tally.excluded, counts.doNotUseUnits + counts.exceptionUnits);
  assert.equal(data.units.length, feed.length);
});

test('a shop unit is never down and an old reading is Unknown', () => {
  const byName = Object.fromEntries(board().units.map(row => [row.k, row]));
  assert.equal(byName['SNIPER 008'].pl, 'shop');
  assert.equal(byName['SNIPER 008'].so, false);
  assert.equal(byName['SNIPER 009'].so, true);
  assert.equal(byName['SPOTTER 004'].vd, 'unknown');
  assert.equal(byName['SPOTTER 005'].vd, 'unknown');
  assert.equal(byName['RII-012'].vd, 'unknown');
  assert.equal(byName['HELIOS 006'].vd, 'up');
  assert.equal(byName['HELIOS 006'].bad, '');
  assert.equal(byName['RANGER 007'].vd, 'up');
  assert.equal(byName['SPOTTER 002'].bad, 'SPOTTER 002 / Cam 2');
  assert.deepEqual([byName['SPOTTER 002'].on, byName['SPOTTER 002'].off, byName['SPOTTER 002'].n], [1, 1, 2]);
  assert.equal(byName['SNIPER 010'].x, true);
  assert.equal(byName['SNIPER 011'].x, true);
  assert.equal(byName['SNIPER 011'].fl, 'x');
  assert.deepEqual([byName['SPOTTER 001'].s, byName['SNIPER 013'].s, byName['RII-012'].s], ['v', 'a', 'r']);
});

test('the unit page lists each camera and says when one is not at the site', () => {
  const data = board();
  assert.deepEqual(data.cameras['HELIOS 006'].map(camera => [camera.name, camera.st, camera.type]), [
    ['HELIOS 006 / Cam 1', 1, ''], ['HELIOS 006 / Spare', 0, 'In the shop, not at the site'],
  ]);
  assert.deepEqual(data.cameras['RANGER 007'][1], {name: 'RANGER 007 / Old', type: 'Taken off this unit by hand', model: '', fw: '', st: null, lo: 0});
  assert.equal(data.cameras['SPOTTER 004'][0].st, null);
  assert.equal(data.cameras['SNIPER 008'], undefined);
});

test('an exact recorder reading fills a unit the feed could not read, on the board and in the count alike', () => {
  const recorders = [{name: 'spotter 005', state: 'offline', observedAt: fresh}];
  const counts = fleetCountsFromCameraFeed(feed, recorders, now);
  const data = board(feed, {recorders});
  const tally = boardTally(data.units);
  assert.equal(data.units.find(row => row.k === 'SPOTTER 005').vd, 'down');
  assert.equal(tally.issues + tally.down, counts.units.offline);
  assert.equal(tally.unknown, counts.units.unknown);
});

test('the camera feed is judged against its own newest reading, not an older saved board', () => {
  const newer = new Date(now + 2 * 60 * 1000).toISOString();
  const live = [unit('SPOTTER 001', {observedAt: newer}), unit('SPOTTER 003', {state: 'RED', online: 0, offline: 1, observedAt: newer})];
  assert.equal(cameraFeedClock(live, now, now + 5 * 60 * 1000), Date.parse(newer));
  assert.equal(cameraFeedClock(live, now + 10 * 60 * 1000, now + 15 * 60 * 1000), now + 10 * 60 * 1000);
  assert.equal(cameraFeedClock(null, now), now);
  // A stamp ahead of this device's clock is not trusted.
  assert.equal(cameraFeedClock(live, now, now + 60 * 1000), now);
  assert.deepEqual(fleetCountsFromCameraFeed(live, [], now).units, {online: 1, offline: 1, unknown: 0});
  const tally = boardTally(board(live).units);
  assert.deepEqual([tally.up, tally.down, tally.unknown], [1, 1, 0]);
  // The newest reading moves the clock for every unit, so a reading already old stays Unknown.
  const mixed = [...live, unit('SPOTTER 004', {state: 'RED', online: 0, offline: 1, observedAt: stale})];
  assert.deepEqual(fleetCountsFromCameraFeed(mixed, [], now).units, {online: 1, offline: 1, unknown: 1});
});

test('hand edits, a typed address and the reading time reach the board', () => {
  const by = (name, minutes, extra = {}) => ({by: name, role: 'it', at: at(minutes), reason: null, providerValue: null, providerAgrees: false, ...extra});
  const edited = unit('SPOTTER 020', {
    displayName: 'Spotter 20 East', publicIp: '203.0.113.20', site: 'New site', productId: '2345678',
    providerPlacement: 'SHOP', providerSite: null, providerPublicIp: '198.51.100.7',
    address: ' 100 Main  St, Houston TX ', addressRevision: '11111111-2222-4333-8444-555555555555',
    handEdits: {
      placement: {value: 'FIELD', ...by('Teddy', 30, {providerValue: 'SHOP'})},
      public_ip: {value: '203.0.113.20', ...by('Victor', 10, {providerValue: '198.51.100.7', reason: 'new SIM'})},
      name: {value: 'Spotter 20 East', ...by('', 20, {at: null})},
      site: {value: 'New site', ...by('Teddy', 30)},
    },
    location: {latitude: 29.76, longitude: -95.36, matchedAddress: '100 MAIN ST, HOUSTON, TX, 77002', source: 'hand'},
  });
  const other = unit('SNIPER 021', {source: 'ip_check', observedAt: at(2), handEdits: {placement: {value: 'FIELD', ...by('James', 5, {role: 'owner'})}}});
  const data = board([edited, other]);
  const row = data.units[0];
  assert.equal(row.nm, 'Spotter 20 East');
  assert.deepEqual(row.he.sort(), ['ip', 'name', 'place', 'site']);
  assert.deepEqual(row.hp, [29.76, -95.36]);
  assert.equal(row.ad, '100 MAIN ST, HOUSTON, TX, 77002');
  assert.equal(row.pid, '2345678');
  // What the provider says stays beside what a person set by hand.
  assert.deepEqual([row.pl, row.st, row.ip], ['field', 'New site', '203.0.113.20']);
  assert.deepEqual([row.fp, row.fst, row.fip], ['shop', '', '198.51.100.7']);
  assert.deepEqual([data.units[1].fp, data.units[1].fst, data.units[1].fip], ['field', 'Fixture yard', '']);
  // The address form opens with the address exactly as typed, and the next edit names its revision.
  assert.deepEqual([row.ta, row.ar], ['100 Main  St, Houston TX', '11111111-2222-4333-8444-555555555555']);
  assert.deepEqual([data.units[1].ta, data.units[1].ar], ['', null]);
  // Each hand edit in force carries who made it and when, newest first. A record with no time sorts last.
  assert.deepEqual(row.hx.map(edit => [edit.f, edit.b, edit.by, edit.at, edit.why]), [
    ['ip', '203.0.113.20', 'Victor', Date.parse(at(10)), 'new SIM'],
    ['place', 'FIELD', 'Teddy', Date.parse(at(30)), ''],
    ['site', 'New site', 'Teddy', Date.parse(at(30)), ''],
    ['name', 'Spotter 20 East', 'Unknown', 0, ''],
  ]);
  assert.deepEqual(data.changes.map(edit => [edit.k, edit.f, edit.by]), [
    ['SNIPER 021', 'place', 'James'], ['SPOTTER 020', 'ip', 'Victor'], ['SPOTTER 020', 'place', 'Teddy'], ['SPOTTER 020', 'site', 'Teddy'], ['SPOTTER 020', 'name', 'Unknown'],
  ]);
  assert.equal(data.changes[1].nm, 'Spotter 20 East');
  assert.deepEqual(board().changes, []);
  // The headline reading time is Star4Live's own, not a newer IP check.
  assert.equal(data.meta.v, Math.round(Date.parse(fresh) / 1000));
  assert.equal(data.meta.gen, Math.round(now / 1000));
});

test('a router reading is reference only: an old one is Unknown, never Offline', () => {
  const router = (unitKey, probeStatus, checkedAt, extra = {}) => ({
    id: unitKey + checkedAt, unitKey, name: unitKey, model: 'IR615', publicIp: null, unitIp: null, port: null, protocol: null,
    probeStatus, checkedAt, lastRecoveredAt: null, reportedStatus: 'Unknown', reportedAt: null, reportedSource: 'Unspecified import',
    savedLatencyMs: null, match: 'exact_name', candidateUnit: null, gps: null, ...extra,
  });
  const routers = [
    router('spotter 001', 'offline', at(10)),
    router('SPOTTER 001', 'online', at(40)),
    router('SPOTTER 003', 'offline', at(120), {reportedStatus: 'Offline', reportedAt: at(8)}),
  ];
  const byName = Object.fromEntries(board(feed, {routers}).units.map(row => [row.k, row]));
  assert.deepEqual([byName['SPOTTER 001'].rs, byName['SPOTTER 001'].rm], ['of', 'IR615']);
  assert.deepEqual([byName['SPOTTER 003'].rs, byName['SPOTTER 003'].rr], ['un', 'of']);
  assert.deepEqual([byName['SPOTTER 002'].rs, byName['SPOTTER 002'].rr, byName['SPOTTER 002'].ri], ['', '', '']);
  // Until Fleet has read the routers the board says so, instead of saying a unit has none.
  assert.equal(board(feed, {routers}).meta.rl, true);
  assert.equal(board(feed, {routers: null}).meta.rl, false);
  assert.equal(board(feed).meta.rl, false);
});

test('the mHelp list keeps stands in the count and off the board', () => {
  const upload = {
    source: 'mhelpdesk_api', lastApiReadAt: at(12), receivedAt: at(600),
    records: [
      {productId: '101', unitNumber: 'Spotter 001', category: 'Spotter', placement: 'FIELD', uploadLifecycle: 'UNFLAGGED', customer: 'Fixture Homes: Lot 4', sourceAddress: {street: '1 Example Rd', city: 'Houston', state: 'TX', zip: '77001'}},
      {productId: '102', unitNumber: 'Sniper 008 - DO NOT USE', category: 'Sniper', placement: 'SHOP', uploadLifecycle: 'DO_NOT_USE', customer: 'Shop', sourceAddress: {street: '2 Shop Rd', city: 'Houston', state: 'TX', zip: '77002'}},
      {productId: '103', unitNumber: 'Stand 14', category: 'Stand', placement: 'FIELD', uploadLifecycle: 'UNFLAGGED', customer: 'Fixture Homes'},
      {productId: '104', unitNumber: 'Helios 006', category: 'Helios Solar Tower', placement: 'FIELD', uploadLifecycle: 'MISSING', customer: 'Fixture Yard'},
    ],
  };
  const addresses = {pins: [
    {productId: '101', point: [29.7, -95.4], state: 'matched'},
    {productId: '104', point: [30.1, -97.7], state: 'address_review'},
    {productId: '102', point: [1, 1], state: 'matched'},
  ], reviews: []};
  const list = boardMhelp(upload, addresses);
  assert.deepEqual(list.meta, {at: Math.round(Date.parse(at(12)) / 1000), total: 4, field: 3, shop: 1, stands: 1, standsField: 1});
  assert.deepEqual(list.recs.map(rec => rec.id), ['104', '102', '101']);
  const byId = Object.fromEntries(list.recs.map(rec => [rec.id, rec]));
  assert.deepEqual(byId['101'], {id: '101', label: 'Spotter 001', cat: 'Spotter', flag: '', place: 'field', cust: 'Fixture Homes: Lot 4', addr: '1 Example Rd, Houston, TX 77001', lat: 29.7, lng: -95.4, pk: 'm'});
  // A shop record carries no customer, address or pin.
  assert.deepEqual([byId['102'].flag, byId['102'].place, byId['102'].cust, byId['102'].addr, byId['102'].lat, byId['102'].pk], ['D', 'shop', '', '', 0, '']);
  assert.deepEqual([byId['104'].flag, byId['104'].pk], ['M', 'r']);
  assert.equal(boardMhelp(null), null);
  assert.equal(boardMhelp({records: 'none'}), null);
  assert.equal(board(feed, {upload, addresses}).mhelp.recs.length, 3);
});

test('a hand fix is the request Camera status sends, and a doubtful save stops the next one', () => {
  const spotter = {unit: 'SPOTTER 020', addressRevision: '11111111-2222-4333-8444-555555555555'};
  assert.deepEqual(handFixRequest(spotter, {field: 'placement', value: 'SHOP'}, 'id-1'), {unitKey: 'SPOTTER 020', field: 'placement', requestId: 'id-1', value: 'SHOP'});
  assert.deepEqual(handFixRequest(spotter, {field: 'name', value: null}, 'id-2'), {unitKey: 'SPOTTER 020', field: 'name', requestId: 'id-2', action: 'clear'});
  // Only an address edit names a revision: the one it was read with, or null when no address was ever typed.
  assert.deepEqual(handFixRequest(spotter, {field: 'address', value: '1 Example Rd'}, 'id-3'), {unitKey: 'SPOTTER 020', field: 'address', requestId: 'id-3', expectedAddressRevision: '11111111-2222-4333-8444-555555555555', value: '1 Example Rd'});
  assert.deepEqual(handFixRequest({unit: 'SNIPER 021'}, {field: 'address', value: null}, 'id-4'), {unitKey: 'SNIPER 021', field: 'address', requestId: 'id-4', expectedAddressRevision: null, action: 'clear'});

  assert.deepEqual(boardEditState({canEdit: true, handEditsRead: true}, false), {can: true, why: ''});
  assert.equal(boardEditState(null, false).can, false);
  assert.equal(boardEditState({canEdit: true, handEditsRead: false}, false).can, false);
  assert.equal(boardEditState({canEdit: false, handEditsRead: true}, false).why, 'Hand fixes are for the Owner and IT.');
  // After a save that could not be confirmed, nothing more is saved until the person refreshes.
  assert.deepEqual(boardEditState({canEdit: true, handEditsRead: true}, true), {can: false, why: 'The last save could not be confirmed. Tap Refresh before making another fix.'});
});
