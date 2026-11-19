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
  assert.throws(() => loadWatchfulExport('unit,site,group,status,cameras_up,cameras_down\n203.0.113.10,Fixture Site,Avigilon,up,1,0\n', at), /IP address/);
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
});
