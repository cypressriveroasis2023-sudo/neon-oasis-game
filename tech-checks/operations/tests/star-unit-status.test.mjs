import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The projection is TypeScript shared by the route and the page. Compile it once
// with the repo's own TypeScript, then exercise the compiled module.
const dir = mkdtempSync(join(tmpdir(), 'star-unit-status-'));
execFileSync('npx', ['tsc', 'operations/shared/starUnitStatus.ts', '--target', 'es2022', '--module', 'es2022', '--outDir', dir], {cwd: process.cwd(), stdio: 'pipe'});
writeFileSync(join(dir, 'package.json'), JSON.stringify({type: 'module'}));
const {projectUnitCameraStatus, cameraStatus, cameraPlacement, applyFeedFreshness, applyHandEdits} = await import(join(dir, 'starUnitStatus.js'));

const camera = (over = {}) => ({
  device_name: 'SS001_1', unit_key: 'SOLARSPOTTER 001', organization: 'root',
  vigilant_status: 'Online', activation_state: 'active', source_last_seen_at: '2026-11-12T20:00:00Z',
  public_ip: '38.246.0.1', ...over,
});

test('a camera is online only when the provider says online', () => {
  assert.equal(cameraStatus(camera({vigilant_status: 'Online'})), 'online');
  assert.equal(cameraStatus(camera({vigilant_status: 'Offline'})), 'offline');
  for (const value of [null, '', 'unknown', 'Review', undefined]) {
    assert.equal(cameraStatus(camera({vigilant_status: value})), 'unknown', String(value));
  }
});

test('root and shop are the shop; a customer name is the field', () => {
  assert.equal(cameraPlacement(camera({organization: 'root'})), 'SHOP');
  assert.equal(cameraPlacement(camera({organization: ' ROOT '})), 'SHOP');
  assert.equal(cameraPlacement(camera({organization: 'shop'})), 'SHOP');
  assert.equal(cameraPlacement(camera({organization: null})), 'SHOP');
  assert.equal(cameraPlacement(camera({organization: 'ERock - Hyperion'})), 'FIELD');
});

test('four cameras on one unit are one line, green when all are up', () => {
  const report = projectUnitCameraStatus([1, 2, 3, 4].map(n => camera({
    device_name: 'SS006_' + n, unit_key: 'SOLARSPOTTER 006', organization: 'ERock - Hyperion',
  })));
  assert.equal(report.units.length, 1);
  const unit = report.units[0];
  assert.equal(unit.cameras, 4);
  assert.equal(unit.online, 4);
  assert.equal(unit.state, 'GREEN');
  assert.equal(unit.placement, 'FIELD');
  assert.equal(unit.site, 'ERock - Hyperion');
  assert.deepEqual(unit.down, []);
  assert.deepEqual(report.counts.field, {units: 1, green: 1, yellow: 0, red: 0, unknown: 0, camerasDown: 0});
});

test('some cameras down is yellow and names which ones', () => {
  const report = projectUnitCameraStatus([
    camera({device_name: 'SP306_1', unit_key: 'SPOTTER 306', organization: 'Evergen Equity - Chair King'}),
    camera({device_name: 'SP306_2', unit_key: 'SPOTTER 306', organization: 'Evergen Equity - Chair King', vigilant_status: 'Offline'}),
  ]);
  const unit = report.units[0];
  assert.equal(unit.state, 'YELLOW');
  assert.equal(unit.online, 1);
  assert.equal(unit.offline, 1);
  assert.deepEqual(unit.down, [{name: 'SP306_2', status: 'offline'}]);
  assert.equal(report.counts.field.camerasDown, 1);
});

test('all cameras offline at a site is red', () => {
  const report = projectUnitCameraStatus([1, 2].map(n => camera({
    device_name: 'SP264_' + n, unit_key: 'SPOTTER 264', organization: 'TX Morrow Holzworth', vigilant_status: 'Offline',
  })));
  assert.equal(report.units[0].state, 'RED');
  assert.equal(report.counts.field.red, 1);
});

test('a missing check is unknown, never offline', () => {
  const report = projectUnitCameraStatus([
    camera({device_name: 'R014_1', unit_key: 'RANGER 014', organization: 'Bristol Friendswood', vigilant_status: null}),
    camera({device_name: 'R014_2', unit_key: 'RANGER 014', organization: 'Bristol Friendswood', vigilant_status: ''}),
  ]);
  const unit = report.units[0];
  assert.equal(unit.state, 'UNKNOWN');
  assert.equal(unit.offline, 0);
  assert.equal(unit.unknown, 2);
  assert.equal(report.counts.field.red, 0);
  assert.equal(report.counts.field.unknown, 1);
  assert.deepEqual(unit.down.map(c => c.status), ['unknown', 'unknown']);
});

test('one offline and one unknown is yellow, not red', () => {
  const report = projectUnitCameraStatus([
    camera({unit_key: 'SPOTTER 400', device_name: 'SP400_1', organization: 'A Site', vigilant_status: 'Offline'}),
    camera({unit_key: 'SPOTTER 400', device_name: 'SP400_2', organization: 'A Site', vigilant_status: null}),
  ]);
  assert.equal(report.units[0].state, 'YELLOW');
});

test('a unit online in the shop is shop, not field, and never counts as offline', () => {
  const report = projectUnitCameraStatus([1, 2, 3, 4].map(n => camera({
    device_name: 'SS058_' + n, unit_key: 'SOLARSPOTTER 058', organization: 'root',
  })));
  const unit = report.units[0];
  assert.equal(unit.placement, 'SHOP');
  assert.equal(unit.site, null);
  assert.equal(unit.onlineInShop, true);
  assert.equal(unit.state, 'GREEN');
  assert.equal(report.counts.field.units, 0);
  assert.deepEqual(report.counts.shop, {units: 1, onlineInShop: 1});
});

test('a unit offline in the shop is not online in the shop and is not a field outage', () => {
  const report = projectUnitCameraStatus([1, 2, 3].map(n => camera({
    device_name: 'SolarSpotter 029_' + n, unit_key: 'SOLARSPOTTER 029', organization: 'root', vigilant_status: 'Offline',
  })));
  assert.equal(report.units[0].placement, 'SHOP');
  assert.equal(report.units[0].onlineInShop, false);
  assert.deepEqual(report.counts.shop, {units: 1, onlineInShop: 0});
  assert.equal(report.counts.field.red, 0);
});

test('one camera at a site puts the whole unit in the field', () => {
  const report = projectUnitCameraStatus([
    camera({device_name: 'H011_1', unit_key: 'HELIOS 011', organization: 'root', vigilant_status: 'Offline'}),
    camera({device_name: 'H011_2', unit_key: 'HELIOS 011', organization: 'Preload Garland'}),
  ]);
  const unit = report.units[0];
  assert.equal(unit.placement, 'FIELD');
  assert.equal(unit.site, 'Preload Garland');
  assert.equal(unit.state, 'YELLOW');
});

test('a site waiting for its name is flagged, and keeps the unit in the field', () => {
  const report = projectUnitCameraStatus([camera({
    device_name: 'SS039_1', unit_key: 'SOLARSPOTTER 039', organization: 'Star4Live site #1826680 (name pending)',
  })]);
  assert.equal(report.units[0].placement, 'FIELD');
  assert.equal(report.units[0].siteNamePending, true);
  assert.equal(projectUnitCameraStatus([camera({organization: 'ERock - Hyperion'})]).units[0].siteNamePending, false);
});

test('cameras retired in COS are left out', () => {
  const report = projectUnitCameraStatus([
    camera({device_name: 'SS006_4 (old, not in VCC)', unit_key: 'SOLARSPOTTER 006', organization: 'Blazer Bldg SW - Hartwood At Windstone', vigilant_status: 'Offline', activation_state: 'deactivated'}),
    camera({device_name: 'SS006_1', unit_key: 'SOLARSPOTTER 006', organization: 'ERock - Hyperion'}),
  ]);
  assert.equal(report.units.length, 1);
  assert.equal(report.units[0].cameras, 1);
  assert.equal(report.units[0].state, 'GREEN');
  assert.equal(report.units[0].site, 'ERock - Hyperion');
});

test('rows with no unit name are left out, and nothing invents a unit', () => {
  const report = projectUnitCameraStatus([camera({unit_key: null, device_name: ''}), camera({unit_key: '  ', device_name: null})]);
  assert.deepEqual(report.units, []);
  assert.equal(report.counts.units, 0);
  for (const value of [null, undefined, 'not a list', 42]) {
    assert.deepEqual(projectUnitCameraStatus(value).units, [], String(value));
  }
});

test('units are listed in unit order and carry the public IP and last reading', () => {
  const report = projectUnitCameraStatus([
    camera({unit_key: 'SPOTTER 12', device_name: 'SP12_1', organization: 'Site B', source_last_seen_at: '2026-11-12T19:00:00Z'}),
    camera({unit_key: 'SPOTTER 2', device_name: 'SP2_1', organization: 'Site A', public_ip: null, source_last_seen_at: '2026-11-12T21:00:00Z'}),
    camera({unit_key: 'SPOTTER 2', device_name: 'SP2_2', organization: 'Site A', public_ip: '38.246.9.9', source_last_seen_at: '2026-11-12T20:00:00Z'}),
  ]);
  assert.deepEqual(report.units.map(u => u.unit), ['SPOTTER 2', 'SPOTTER 12']);
  assert.equal(report.units[0].publicIp, '38.246.9.9');
  assert.equal(report.units[0].observedAt, '2026-11-12T21:00:00Z');
  assert.equal(report.counts.cameras, 3);
});

test('the report is stamped with its contract', () => {
  assert.equal(projectUnitCameraStatus([]).contract, 'COS_STAR_UNIT_STATUS_V1');
});

const freshFeed = {syncedAt: '2026-11-12T22:18:00Z', status: 'ok', enabled: true};
const atSync = Date.parse('2026-11-12T22:20:00Z');
const fieldUnit = () => projectUnitCameraStatus([
  camera({unit_key: 'SPOTTER 306', device_name: 'SP306_1', organization: 'A Site'}),
  camera({unit_key: 'SOLARSPOTTER 058', device_name: 'SS058_1', organization: 'root'}),
]);

test('a fresh sync keeps the readings and stamps the feed', () => {
  const report = applyFeedFreshness(fieldUnit(), freshFeed, atSync);
  assert.equal(report.feed.fresh, true);
  assert.equal(report.feed.provider, 'star4live');
  assert.equal(report.feed.syncedAt, '2026-11-12T22:18:00Z');
  assert.equal(report.counts.field.green, 1);
  assert.equal(report.counts.shop.onlineInShop, 1);
});

test('a stale, failed, disabled or missing sync makes every unit unknown', () => {
  const cases = [
    ['stale', freshFeed, Date.parse('2026-11-12T23:30:00Z')],
    ['failed', {...freshFeed, status: 'error'}, atSync],
    ['disabled', {...freshFeed, enabled: false}, atSync],
    ['missing time', {...freshFeed, syncedAt: null}, atSync],
    ['no feed row', null, atSync],
  ];
  for (const [name, feed, now] of cases) {
    const report = applyFeedFreshness(fieldUnit(), feed, now);
    assert.equal(report.feed.fresh, false, name);
    assert.deepEqual(report.units.map(u => u.state), ['SOLARSPOTTER 058', 'SPOTTER 306'].map(() => 'UNKNOWN'), name);
    assert.deepEqual(report.counts.field, {units: 1, green: 0, yellow: 0, red: 0, unknown: 1, camerasDown: 0}, name);
    assert.deepEqual(report.counts.shop, {units: 1, onlineInShop: 0}, name);
    assert.equal(report.units.every(u => u.online === 0 && u.offline === 0 && u.unknown === u.cameras), true, name);
  }
});

test('a stale feed never reports an outage, and shop units stay in the shop', () => {
  const report = applyFeedFreshness(projectUnitCameraStatus([
    camera({unit_key: 'SPOTTER 264', device_name: 'SP264_1', organization: 'TX Morrow Holzworth', vigilant_status: 'Offline'}),
  ]), null, atSync);
  assert.equal(report.units[0].state, 'UNKNOWN');
  assert.equal(report.units[0].offline, 0);
  assert.equal(report.counts.field.red, 0);
  assert.equal(report.units[0].placement, 'FIELD');
});

test('a clock a little ahead of the sync is still fresh', () => {
  assert.equal(applyFeedFreshness(fieldUnit(), freshFeed, Date.parse('2026-11-12T22:17:30Z')).feed.fresh, true);
  assert.equal(applyFeedFreshness(fieldUnit(), freshFeed, Date.parse('2026-11-12T22:00:00Z')).feed.fresh, false);
});

const handEdit = (over = {}) => ({unit_key: 'SOLARSPOTTER 029', field: 'site', action: 'set', value: 'ERock - Hyperion',
  provider_value: 'root', actor_name: 'James Martin', actor_role: 'owner', reason: 'Moved by hand',
  created_at: '2026-11-12T22:40:00Z', ...over});
const shopUnit = () => projectUnitCameraStatus([1, 2, 3].map(n => camera({
  device_name: 'SolarSpotter 029_' + n, unit_key: 'SOLARSPOTTER 029', organization: 'root', vigilant_status: 'Offline'})));

test('a hand edit can move a unit from the shop to a site', () => {
  const report = applyHandEdits(shopUnit(), [handEdit({field: 'placement', value: 'FIELD', provider_value: 'SHOP'}), handEdit()]);
  const unit = report.units[0];
  assert.equal(unit.placement, 'FIELD');
  assert.equal(unit.site, 'ERock - Hyperion');
  assert.equal(unit.providerPlacement, 'SHOP');
  assert.equal(unit.providerSite, null);
  assert.equal(unit.handEdits.site.by, 'James Martin');
  assert.equal(unit.handEdits.site.role, 'owner');
  assert.equal(unit.handEdits.placement.providerAgrees, false);
  assert.deepEqual(report.counts.field, {units: 1, green: 0, yellow: 0, red: 1, unknown: 0, camerasDown: 3});
  assert.deepEqual(report.counts.shop, {units: 0, onlineInShop: 0});
});

test('a hand edit never changes whether a camera is online', () => {
  const before = projectUnitCameraStatus([camera({unit_key: 'SPOTTER 306', device_name: 'SP306_1', organization: 'A Site', vigilant_status: 'Offline'})]);
  const after = applyHandEdits(before, [handEdit({unit_key: 'SPOTTER 306', field: 'placement', value: 'SHOP'})]);
  const unit = after.units[0];
  assert.equal(unit.state, 'RED');
  assert.equal(unit.online, 0);
  assert.equal(unit.offline, 1);
  assert.equal(unit.onlineInShop, false);
  assert.equal(unit.placement, 'SHOP');
  assert.equal(after.counts.field.red, 0, 'a unit moved to the shop is no longer a field outage');
});

test('moving a unit back to the shop drops its site', () => {
  const field = projectUnitCameraStatus([camera({unit_key: 'SPOTTER 306', device_name: 'SP306_1', organization: 'A Site'})]);
  const report = applyHandEdits(field, [handEdit({unit_key: 'SPOTTER 306', field: 'placement', value: 'SHOP'})]);
  assert.equal(report.units[0].site, null);
  assert.equal(report.units[0].providerSite, 'A Site');
  assert.equal(report.units[0].onlineInShop, true);
});

test('a hand edit can name a site Star4Live has not named, and clears the pending flag', () => {
  const pending = projectUnitCameraStatus([camera({unit_key: 'SOLARSPOTTER 039', device_name: 'SS039_1', organization: 'Star4Live site #1826680 (name pending)'})]);
  assert.equal(pending.units[0].siteNamePending, true);
  const report = applyHandEdits(pending, [handEdit({unit_key: 'SOLARSPOTTER 039', value: 'EMJ Triangle Construction - HEB Aledo'})]);
  assert.equal(report.units[0].site, 'EMJ Triangle Construction - HEB Aledo');
  assert.equal(report.units[0].siteNamePending, false);
});

test('a hand edit can correct the public IP', () => {
  const report = applyHandEdits(shopUnit(), [handEdit({field: 'public_ip', value: '38.246.195.93', provider_value: '166.203.205.83'})]);
  assert.equal(report.units[0].publicIp, '38.246.195.93');
  assert.equal(report.units[0].providerPublicIp, '38.246.0.1');
  assert.equal(report.units[0].handEdits.public_ip.providerValue, '38.246.0.1');
});

test('the board says when Star4Live has caught up with a hand edit', () => {
  const field = projectUnitCameraStatus([camera({unit_key: 'SOLARSPOTTER 006', device_name: 'SS006_1', organization: 'ERock - Hyperion'})]);
  const report = applyHandEdits(field, [handEdit({unit_key: 'SOLARSPOTTER 006', value: 'ERock - Hyperion'})]);
  assert.equal(report.units[0].handEdits.site.providerAgrees, true);
  assert.equal(report.units[0].site, 'ERock - Hyperion');
});

test('a cleared edit leaves the provider value in place', () => {
  const report = applyHandEdits(shopUnit(), [handEdit({action: 'clear', value: null})]);
  assert.equal(report.units[0].placement, 'SHOP');
  assert.equal(report.units[0].site, null);
  assert.equal(report.units[0].handEdits, undefined);
});

test('edits for other units, unknown fields and bad placements are ignored', () => {
  for (const edits of [
    [handEdit({unit_key: 'SPOTTER 999'})],
    [handEdit({field: 'vigilant_status', value: 'Online'})],
    [handEdit({field: 'placement', value: 'ROOT'})],
    [handEdit({unit_key: ''})], [handEdit({value: null})], null, undefined, 'nonsense',
  ]) {
    const report = applyHandEdits(shopUnit(), edits);
    assert.equal(report.units[0].placement, 'SHOP', JSON.stringify(edits));
    assert.equal(report.units[0].site, null, JSON.stringify(edits));
  }
});

test('the unit name on an edit is matched without case or spacing getting in the way', () => {
  const report = applyHandEdits(shopUnit(), [handEdit({unit_key: '  solarspotter 029  ', field: 'placement', value: 'FIELD'})]);
  assert.equal(report.units[0].placement, 'FIELD');
});

test('a stale feed still hides health under a hand edit, and keeps the edit', () => {
  const edited = applyHandEdits(shopUnit(), [handEdit({field: 'placement', value: 'FIELD'}), handEdit()]);
  const report = applyFeedFreshness(edited, null, atSync);
  assert.equal(report.units[0].state, 'UNKNOWN');
  assert.equal(report.units[0].offline, 0);
  assert.equal(report.units[0].placement, 'FIELD');
  assert.equal(report.units[0].site, 'ERock - Hyperion');
  assert.deepEqual(report.counts.field, {units: 1, green: 0, yellow: 0, red: 0, unknown: 1, camerasDown: 0});
});
