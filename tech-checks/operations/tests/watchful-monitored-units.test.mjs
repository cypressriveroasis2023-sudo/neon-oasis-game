import test from 'node:test';
import assert from 'node:assert/strict';
import {watchfulCanonicalUnitKey} from '../src/watchfulUnitKey.ts';
import {loadWatchfulExport, stripWatchfulIp, WatchfulLoadError} from '../src/watchfulMonitoredLoad.ts';

const at = '2026-11-19T15:00:00.000Z';

test('Watchful and mHelp names pair one to one, and speakers are not units', () => {
  assert.equal(watchfulCanonicalUnitKey('SS 101'), 'SPOTTER|101');
  assert.equal(watchfulCanonicalUnitKey('SS_NVR 101'), 'SPOTTER|101');
  assert.equal(watchfulCanonicalUnitKey('Solar Spotter 101'), 'SPOTTER|101');
  assert.equal(watchfulCanonicalUnitKey('Solarspotter 101'), 'SPOTTER|101');
  assert.equal(watchfulCanonicalUnitKey('Spotter 101 SOLAR COMPATIBLE'), 'SPOTTER|101');
  assert.equal(watchfulCanonicalUnitKey('Spotter 101 Yard SOLAR COMPATIBLE'), 'SPOTTER|101');
  assert.equal(watchfulCanonicalUnitKey('SS 054'), 'SOLARSPOTTER|54');
  assert.equal(watchfulCanonicalUnitKey('Solar Spotter 054'), 'SOLARSPOTTER|54');
  assert.equal(watchfulCanonicalUnitKey('Spotter 054'), 'UNIVIEW|54');
  assert.equal(watchfulCanonicalUnitKey('RANGER 029 .2'), 'RANGER|29');
  assert.equal(watchfulCanonicalUnitKey('Ranger 029.2'), 'RANGER|29');
  assert.equal(watchfulCanonicalUnitKey('Helios 8 CAM 1'), 'HELIOS|8');
  assert.equal(watchfulCanonicalUnitKey('Sniper 168 CAM 2'), 'SNIPER|168');
  assert.equal(watchfulCanonicalUnitKey('IP Speaker 4'), null);
});

test('the loader rejects an IP or serial column and strips an IP in a cell', () => {
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down,public_ip\nSniper 1,Fixture Site,Avigilon,up,1,0,203.0.113.9\n', at), WatchfulLoadError);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down,device_serial\nSniper 1,Fixture Site,Avigilon,up,1,0,ABC\n', at), WatchfulLoadError);
  const stripped = stripWatchfulIp('Fixture Site 203.0.113.10 gate');
  assert.equal(stripped.text, 'Fixture Site gate');
  assert.equal(stripped.stripped, true);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\n203.0.113.10,Fixture Site,Avigilon,up,1,0\n', at), /IP or MAC address/);
});

test('the loader strips or rejects IPv6 and MAC addresses the same way as IPv4', () => {
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down,ipv6\nSniper 1,Fixture Site,Avigilon,up,1,0,2001:db8::1\n', at), WatchfulLoadError);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down,mac_address\nSniper 1,Fixture Site,Avigilon,up,1,0,aa:bb:cc:dd:ee:ff\n', at), WatchfulLoadError);
  const ipv6 = stripWatchfulIp('Fixture Site 2001:db8::10 gate');
  assert.equal(ipv6.text, 'Fixture Site gate');
  assert.equal(ipv6.stripped, true);
  const mac = stripWatchfulIp('Fixture Site AA-BB-CC-DD-EE-FF gate');
  assert.equal(mac.text, 'Fixture Site gate');
  assert.equal(mac.stripped, true);
  assert.equal(stripWatchfulIp('2001:db8::1').onlyIp, true);
  assert.equal(stripWatchfulIp('aa:bb:cc:dd:ee:ff').onlyIp, true);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\n2001:db8::1,Fixture Site,Avigilon,up,1,0\n', at), /IP or MAC address/);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\naa:bb:cc:dd:ee:ff,Fixture Site,Avigilon,up,1,0\n', at), /IP or MAC address/);
  const dotted = stripWatchfulIp('Fixture Site aabb.ccdd.eeff gate');
  assert.equal(dotted.text, 'Fixture Site gate');
  assert.equal(dotted.stripped, true);
  assert.equal(stripWatchfulIp('aabb.ccdd.eeff').onlyIp, true);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\naabb.ccdd.eeff,Fixture Site,Avigilon,up,1,0\n', at), /IP or MAC address/);
  const serial = stripWatchfulIp('Fixture Site serial AB12CD34EF56 gate');
  assert.equal(serial.text, 'Fixture Site gate');
  assert.equal(stripWatchfulIp('AB12CD34EF56').onlyIp, true);
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\nAB12CD34EF56,Fixture Site,Avigilon,up,1,0\n', at), /serial/);
  const missingTime = loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\nSniper 3,Fixture Site,Avigilon,up,1,0\n', at);
  assert.equal(missingTime.snapshotAt, null);
  assert.equal(missingTime.units[0].snapshotAt, null);
  const kept = loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down,seen_at\nSniper 2,Fixture Site,Avigilon,up,1,0,2026-11-19T14:00:00Z\n', at);
  assert.equal(kept.units[0].canonicalUnitKey, 'SNIPER|2');
});

test('duplicate camera rows collapse to one unit and the latest reading wins', () => {
  const csv = [
    'unit,site,group,status,cameras_up,cameras_down,seen_at',
    'Ranger 029.1,Fixture Site A,Other,down,1,0,2026-11-19T14:00:00Z',
    'Ranger 029.2,Fixture Site A,Other,up,1,0,2026-11-19T14:05:00Z',
    'Ranger 029.1,Fixture Site B,Other,up,1,0,2026-11-19T14:10:00Z',
    'IP Speaker 2,Fixture Site A,Other,down,0,1,2026-11-19T14:10:00Z',
    'Sniper 4,Fixture Site A,Avigilon,up,2,0,2026-11-19T13:00:00Z',
    'Sniper 4,Fixture Site A,Avigilon,down,1,1,2026-11-19T14:20:00Z',
  ].join('\n');
  const loaded = loadWatchfulExport(csv, at);
  assert.equal(loaded.droppedSpeakers, 1);
  const ranger = loaded.units.find(unit => unit.canonicalUnitKey === 'RANGER|29');
  assert.equal(ranger.status, 'up');
  assert.equal(ranger.camerasUp, 2);
  assert.equal(ranger.camerasDown, 0);
  assert.equal(ranger.siteName, 'Fixture Site B');
  const sniper = loaded.units.find(unit => unit.canonicalUnitKey === 'SNIPER|4');
  assert.equal(sniper.status, 'down');
  assert.equal(sniper.camerasUp, 1);
  assert.equal(sniper.camerasDown, 1);
  assert.equal(loaded.units.length, 2);
  assert.equal(loaded.oldestObservedAt, '2026-11-19T14:05:00.000Z');
  assert.equal(loaded.snapshotAt, loaded.oldestObservedAt);
  assert.notEqual(loaded.snapshotAt, '2026-11-19T14:20:00.000Z');
  assert.equal(loaded.fetchedAt, at);
  assert.equal(loaded.units.every(unit => unit.snapshotAt === loaded.oldestObservedAt), true);
});
