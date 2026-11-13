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
