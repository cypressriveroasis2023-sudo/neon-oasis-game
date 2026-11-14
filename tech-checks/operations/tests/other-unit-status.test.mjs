import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectIpCheckUnits, projectReconUnits, mergeUnitSources} from '../shared/otherUnitStatus.ts';
import {applyHandEdits, countUnits} from '../shared/starUnitStatus.ts';

const NOW = Date.parse('2026-11-13T21:40:00Z');
const sniper = (over = {}) => ({id: 1, device_name: 'Sniper 004', unit_key: 'SNIPER 004', organization: 'TRACKER FIELD',
  source: '2026_unit_tracker', activation_state: 'active', public_ip: '203.0.113.4', ...over});
const check = (over = {}) => ({camera_device_id: 1, overall_status: 'online', checked_at: '2026-11-13T21:30:00Z', ...over});
const detector = (over = {}) => ({id: 10, device_name: 'CAM 1', unit_key: 'RII010 - Site', organization: 'RII010 - Site',
  source: 'reconeyez', activation_state: 'active', source_last_seen_at: '2026-11-13T18:00:00Z', ...over});
const reconFeed = {syncedAt: '2026-11-13T21:39:00Z', status: 'ok', enabled: true};

test('an Avigilon unit is one line: up on a fresh answer, down on a fresh failure', () => {
  const [up] = projectIpCheckUnits([sniper()], [check()], NOW);
  assert.deepEqual([up.unit, up.state, up.cameras, up.online, up.source, up.placement, up.site], ['SNIPER 004', 'GREEN', 1, 1, 'ip_check', 'FIELD', null]);
  assert.deepEqual(up.down, []);
  const [down] = projectIpCheckUnits([sniper()], [check({overall_status: 'offline'})], NOW);
  assert.equal(down.state, 'RED');
});

test('an old, missing or half-finished check is Not verified, never down and never up', () => {
  for (const health of [[], [check({checked_at: '2026-11-03T20:40:00Z'})], [check({checked_at: null})], [check({overall_status: 'verifying'})],
    [check({overall_status: 'offline', checked_at: '2026-11-12T19:00:00Z'})], null]) {
    const [unit] = projectIpCheckUnits([sniper()], health, NOW);
    assert.equal(unit.state, 'UNKNOWN', JSON.stringify(health));
    assert.equal(unit.online + unit.offline, 0);
  }
});

test('a unit with no IP on file is Not verified even if a check row says online', () => {
  const [unit] = projectIpCheckUnits([sniper({public_ip: null})], [check()], NOW);
  assert.equal(unit.state, 'UNKNOWN');
  assert.equal(unit.down[0].name, 'No IP on file');
});

test('root is the shop; an answering shop unit is online in the shop, not a field unit', () => {
  const [unit] = projectIpCheckUnits([sniper({organization: 'root'})], [check()], NOW);
  assert.deepEqual([unit.placement, unit.onlineInShop, unit.site], ['SHOP', true, null]);
  const [named] = projectIpCheckUnits([sniper({organization: 'AT&T Key st'})], [check()], NOW);
  assert.deepEqual([named.placement, named.site], ['FIELD', 'AT&T Key st']);
});

test('deactivated devices, other sources and repeats of a unit are left out', () => {
  const units = projectIpCheckUnits([sniper(), sniper({id: 2}), sniper({id: 3, unit_key: 'SNIPER 009', activation_state: 'deactivated'}),
    detector()], [check()], NOW);
  assert.deepEqual(units.map(u => u.unit), ['SNIPER 004']);
});

test('a Recon II unit groups its detectors and names the ones not reporting', () => {
  const [unit] = projectReconUnits([detector(), detector({id: 11, device_name: 'CAM 2'}), detector({id: 12, device_name: 'CAM 3'})],
    [check({camera_device_id: 10}), check({camera_device_id: 11, overall_status: 'offline', checked_at: '2026-10-09T13:00:00Z'})], reconFeed, NOW);
  assert.deepEqual([unit.cameras, unit.online, unit.offline, unknownOf(unit), unit.state, unit.source], [3, 1, 1, 1, 'YELLOW', 'reconeyez']);
  assert.deepEqual(unit.down.map(c => c.name + ':' + c.status), ['CAM 2:offline', 'CAM 3:unknown']);
  assert.equal(unit.site, null, 'the unit label already names the site');
});
const unknownOf = unit => unit.unknown;

test('a Reconeyez feed that is missing, failed, disabled or old makes every Recon unit Not verified', () => {
  for (const feed of [null, {...reconFeed, status: 'error'}, {...reconFeed, enabled: false}, {...reconFeed, syncedAt: '2026-11-13T19:00:00Z'}]) {
    const [unit] = projectReconUnits([detector()], [check({camera_device_id: 10})], feed, NOW);
    assert.equal(unit.state, 'UNKNOWN', JSON.stringify(feed));
  }
});

test('a Recon unit labelled shop, not in use or stolen is never a field outage', () => {
  for (const label of ['RII028 - Shop', 'RII024 - Not in use', 'Stolen from RII-022 on 04/10/2026']) {
    const [unit] = projectReconUnits([detector({unit_key: label, organization: 'RII-028 EZ Bel - Covel Rd'})],
      [check({camera_device_id: 10, overall_status: 'offline'})], reconFeed, NOW);
    assert.equal(unit.placement, 'SHOP', label);
  }
});

test('merging keeps the Star4Live line for a unit both sources list, and counts every unit once', () => {
  const star = [{unit: 'SNIPER 004', placement: 'FIELD', site: 'A', siteNamePending: false, state: 'GREEN', cameras: 4, online: 4, offline: 0,
    unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: null}];
  const merged = mergeUnitSources(star, projectIpCheckUnits([sniper(), sniper({id: 5, unit_key: 'CAMV 002'})], [check(), check({camera_device_id: 5})], NOW));
  assert.deepEqual(merged.map(u => u.unit + ':' + u.source), ['CAMV 002:ip_check', 'SNIPER 004:star4live']);
  assert.equal(countUnits(merged).field.units, 2);
});

test('a hand edit moves an Avigilon unit to the shop without touching its reading', () => {
  const units = projectIpCheckUnits([sniper()], [check()], NOW);
  const edited = applyHandEdits({contract: 'COS_STAR_UNIT_STATUS_V1', units, counts: countUnits(units)},
    [{unit_key: 'sniper 004', field: 'placement', action: 'set', value: 'SHOP', actor_name: 'James', actor_role: 'owner'}]);
  assert.deepEqual([edited.units[0].placement, edited.units[0].state, edited.units[0].onlineInShop, edited.units[0].source], ['SHOP', 'GREEN', true, 'ip_check']);
});

// Camera status and the Fleet map draw the same places: a unit with no typed
// address falls back to the address already on the unit list, marked as unconfirmed.
import {unitPins, savedAddressByUnit} from '../src/unitStatusPins.ts';

const fieldUnit = (unit, over = {}) => ({unit, placement: 'FIELD', site: 'A site', siteNamePending: false, state: 'GREEN',
  cameras: 1, online: 1, offline: 0, unknown: 0, down: [], onlineInShop: false, publicIp: null, observedAt: null, ...over});
const savedPin = (unitNumber, point = [29.76, -95.37], address = '1 Main St, Houston, TX 77002') => ({unitNumber, address, point});

test('a typed address wins over the address already on the unit list', () => {
  const units = [fieldUnit('SPOTTER 306', {address: '9500 Katy Fwy', location: {latitude: 29.78, longitude: -95.53, matchedAddress: null, source: 'hand'}})];
  const {pins, handPins, savedPins} = unitPins(units, [savedPin('Spotter 306')]);
  assert.deepEqual([pins.length, pins[0].source, pins[0].latitude, handPins, savedPins], [1, 'hand', 29.78, 1, 0]);
});

test('a unit with no typed address takes the saved one, matched on the unit name', () => {
  const {pins, handPins, savedPins, withoutPin} = unitPins([fieldUnit('SPOTTER 306'), fieldUnit('SPOTTER 999')], [savedPin('Spotter 306')]);
  assert.deepEqual(pins.map(p => [p.unit, p.source, p.address]), [['SPOTTER 306', 'saved', '1 Main St, Houston, TX 77002']]);
  assert.deepEqual([handPins, savedPins, withoutPin], [0, 1, 1]);
});

test('a shop unit never takes a saved field address', () => {
  const {pins} = unitPins([fieldUnit('SPOTTER 306', {placement: 'SHOP', site: null})], [savedPin('Spotter 306')]);
  assert.deepEqual(pins, []);
});

test('two saved addresses under one unit name place nothing, and a bad point is refused', () => {
  assert.equal(savedAddressByUnit([savedPin('Spotter 306'), savedPin('SPOTTER 306', [30, -95])]).size, 0);
  for (const point of [[0, 0], [91, -95], [29.7, 181], ['29.7', '-95.4'], [NaN, -95], null])
    assert.equal(savedAddressByUnit([{unitNumber: 'Spotter 306', address: 'x', point}]).size, 0, JSON.stringify(point));
});

test('an Avigilon or Recon unit uses a saved address the same way a Star4Live unit does', () => {
  const units = [fieldUnit('SNIPER 004', {source: 'ip_check'}), fieldUnit('RII010 - Arcosa', {source: 'reconeyez'})];
  const {pins} = unitPins(units, [savedPin('Sniper 004')]);
  assert.deepEqual(pins.map(p => p.unit + ':' + p.source), ['SNIPER 004:saved']);
});

test('the map legend tells apart placed, saved-but-not-placed, and no address at all', () => {
  const units = [
    fieldUnit('SPOTTER 1', {address: '1 Main St', location: {latitude: 29.7, longitude: -95.4, matchedAddress: null, source: 'hand'}}),
    fieldUnit('SPOTTER 2', {address: '2 Lee Rd'}),            // saved, the service could not place it
    fieldUnit('SPOTTER 3', {address: '   '}),                  // nothing usable typed
    fieldUnit('SPOTTER 4'),                                    // nothing entered
    fieldUnit('SPOTTER 5', {placement: 'SHOP', site: null}),   // shop units are not on this map
  ];
  const {pins, fieldUnits, withoutPin, addressNoPin, noAddress} = unitPins(units, []);
  assert.deepEqual([pins.length, fieldUnits, withoutPin, addressNoPin, noAddress], [1, 4, 3, 1, 2]);
});

test('a unit placed from the saved address is not counted as missing an address', () => {
  const {withoutPin, addressNoPin, noAddress, savedPins} = unitPins([fieldUnit('SPOTTER 306')], [savedPin('Spotter 306')]);
  assert.deepEqual([withoutPin, addressNoPin, noAddress, savedPins], [0, 0, 0, 1]);
});

// Clicking a count tile must show exactly the units that tile counts.
import {groupedUnits} from '../src/cameraStatusFilters.ts';

test('each count tile filters the list to exactly the units it counts', () => {
  const units = [
    fieldUnit('A'), fieldUnit('B', {state: 'YELLOW', online: 1, offline: 1, cameras: 2}),
    fieldUnit('C', {state: 'RED', online: 0, offline: 1}), fieldUnit('D', {state: 'UNKNOWN', online: 0, unknown: 1}),
    fieldUnit('E', {placement: 'SHOP', site: null, onlineInShop: true}),
    fieldUnit('F', {placement: 'SHOP', site: null, state: 'RED', online: 0, offline: 1}),
  ];
  const counts = countUnits(units);
  assert.deepEqual(groupedUnits(units, 'field', '', 'GREEN').map(u => u.unit), ['A']);
  assert.equal(groupedUnits(units, 'field', '', 'GREEN').length, counts.field.green);
  assert.deepEqual(groupedUnits(units, 'field', '', 'YELLOW').map(u => u.unit), ['B']);
  assert.deepEqual(groupedUnits(units, 'field', '', 'RED').map(u => u.unit), ['C']);
  assert.deepEqual(groupedUnits(units, 'field', '', 'UNKNOWN').map(u => u.unit), ['D']);
  assert.deepEqual(groupedUnits(units, 'field', '').map(u => u.unit), ['A', 'B', 'C', 'D']);
  assert.deepEqual(groupedUnits(units, 'shop-online', '').map(u => u.unit), ['E']);
  assert.equal(groupedUnits(units, 'shop-online', '').length, counts.shop.onlineInShop);
});

test('a state filter never reaches past its group, and still searches', () => {
  const units = [fieldUnit('SPOTTER 1', {site: 'Acme yard'}), fieldUnit('SPOTTER 2', {placement: 'SHOP', site: null})];
  assert.deepEqual(groupedUnits(units, 'shop', '', 'GREEN').map(u => u.unit), ['SPOTTER 2']);
  assert.deepEqual(groupedUnits(units, 'field', 'acme', 'GREEN').map(u => u.unit), ['SPOTTER 1']);
  assert.deepEqual(groupedUnits(units, 'field', 'nothing', 'GREEN'), []);
});

// Avigilon covers Sniper, Sniper 2, Sniper 4 and CAM V; Recon II is its own;
// the rest of the camera units are Alibi.
import {familyOf, FAMILY_LABEL, unitName} from '../src/cameraStatusFilters.ts';

test('Sniper, Sniper 2, Sniper 4 and CAM V are all Avigilon, whichever system reported them', () => {
  for (const name of ['SNIPER 004', 'Sniper 2-1234', 'SNIPER 2 15', 'Sniper 4 7', 'CAMV 002', 'CAM V 002', 'SNIPER 240']) {
    for (const source of ['ip_check', 'star4live', 'reconeyez']) {
      assert.equal(familyOf(fieldUnit(name, {source})), 'avigilon', name + ' from ' + source);
    }
  }
  assert.equal(FAMILY_LABEL.avigilon, 'Avigilon');
});

test('Recon II is Recon, and the other camera units are Alibi', () => {
  assert.equal(familyOf(fieldUnit('Recon II 12')), 'recon');
  for (const name of ['SPOTTER 306', 'SOLARSPOTTER 029', 'HELIOS 001', 'RANGER 029.1']) {
    assert.equal(familyOf(fieldUnit(name, {source: 'star4live'})), 'alibi', name);
  }
  assert.deepEqual([FAMILY_LABEL.recon, FAMILY_LABEL.alibi], ['Recon II', 'Alibi']);
});

test('a name nothing can parse falls back to the system that reported the unit', () => {
  // "Sniper Alibi 243" is what Star4Live calls four Alibi recorders.
  assert.equal(familyOf(fieldUnit('Sniper Alibi 243', {source: 'star4live'})), 'alibi');
  assert.equal(familyOf(fieldUnit('RII010 - Arcosa', {source: 'reconeyez'})), 'recon');
  assert.equal(familyOf(fieldUnit('No name anyone parses', {source: 'ip_check'})), 'avigilon');
  assert.equal(familyOf(fieldUnit('No name anyone parses')), 'alibi');
});

test('the list can be searched by what kind of equipment a unit is', () => {
  const units = [fieldUnit('SNIPER 004', {source: 'ip_check'}), fieldUnit('SPOTTER 306'), fieldUnit('Recon II 12', {source: 'reconeyez'})];
  assert.deepEqual(groupedUnits(units, 'field', 'avigilon').map(u => u.unit), ['SNIPER 004']);
  assert.deepEqual(groupedUnits(units, 'field', 'recon').map(u => u.unit), ['Recon II 12']);
  assert.deepEqual(groupedUnits(units, 'field', 'alibi').map(u => u.unit), ['SPOTTER 306']);
});

test('a corrected name decides what a unit is called and which family it is in', () => {
  const recorder = fieldUnit('Sniper Alibi 243', {placement: 'SHOP', site: null, source: 'star4live'});
  assert.deepEqual([unitName(recorder), familyOf(recorder)], ['Sniper Alibi 243', 'alibi']);
  const renamed = {...recorder, displayName: 'Sniper 243'};
  assert.deepEqual([unitName(renamed), familyOf(renamed)], ['Sniper 243', 'avigilon']);
  // The unit's own key never moves, so its history and edits still find it.
  assert.equal(renamed.unit, 'Sniper Alibi 243');
});

test('the list finds a unit by the name a person gave it and by the provider name', () => {
  const units = [{...fieldUnit('Sniper Alibi 243'), displayName: 'Sniper 243'}, fieldUnit('SPOTTER 306')];
  assert.deepEqual(groupedUnits(units, 'field', 'sniper 243').map(u => u.unit), ['Sniper Alibi 243']);
  assert.deepEqual(groupedUnits(units, 'field', 'alibi 243').map(u => u.unit), ['Sniper Alibi 243']);
  assert.deepEqual(groupedUnits(units, 'field', 'avigilon').map(u => u.unit), ['Sniper Alibi 243']);
});
