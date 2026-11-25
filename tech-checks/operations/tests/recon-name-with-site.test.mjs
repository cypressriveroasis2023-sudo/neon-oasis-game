// Reconeyez names a detector after where it stands, so a Recon key almost never
// ends at its number. Before this, all 38 Recon records failed canonicalCameraUnit
// and every Recon on the board read "No site on record" at Unknown.
//
// The guarantee this file holds is narrow, and it is the reason the change was
// safe to make against a parser whose whole point is strictness:
//   1. every name that parsed before parses to exactly the same thing
//   2. only the Recon families may carry a site
//   3. the site must follow a separator, so a bare trailing word can never be
//      read as part of a Spotter or Sniper unit number
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCameraUnit} from '../src/fieldCameraHealth.ts';

test('a Recon keeps its identity when the name carries a site', () => {
  // Real keys, as Reconeyez writes them. Taken from camera_devices on 2026-11-25.
  const cases = [
    ['RII005 - Newmark/Gembler', 'RECON2|5'],
    ['RII010 - ArcosaAggregate_ConroeNorth', 'RECON2|10'],
    ['RII022 - CityZen_1317HawthorneSt', 'RECON2|22'],
    ['RII029 - AGI Richey Business Park', 'RECON2|29'],
    ['RII-024 GVP Rise Loop 410', 'RECON2|24'],   // space, no dash
    ['RII-025 Shop', 'RECON2|25'],                 // space, no dash
    ['RII017 -Shop', 'RECON2|17'],                 // no space after the dash
    ['RII035 - SHOP', 'RECON2|35'],
    ['RII-034 - EZ Bel Construction', 'RECON2|34'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(canonicalCameraUnit(name), expected, name);
  }
});

test('a site on the end never invents a unit for any other family', () => {
  // The whole risk of loosening the parser. A Spotter or Sniper name must still
  // end at its number, so no site text can be read as one of these units.
  for (const name of [
    'SPOTTER 12 Industrial Park',
    'SPOTTER 12 - Industrial Park',
    'SNIPER 201 - AT&T Key St',
    'SNIPER 2 348 - OCH-BSC-SI VANTAGE',
    'SOLAR SPOTTER 006 - ERock Hyperion',
    'HELIOS 005 - Preload Garland',
    'RANGER 020 - AAA Storage Huffmeister',
    'CAM V 011 - somewhere',
  ]) {
    assert.equal(canonicalCameraUnit(name), null, name);
  }
});

test('names that are not units stay not units', () => {
  // Every other unparsed key in camera_devices on 2026-11-25. None may become a
  // unit, and in particular a sentence that merely mentions a unit must not.
  for (const name of [
    'Stolen from RII-022 on 04/10/2026',   // mentions RII-022; must not become it
    'RII-007-junk',                        // a glued-on suffix is not a site
    'RII005-Newmark',                      // same: no space before the dash
    'RII022-',                             // trailing separator, no site
    'Shop Equipment',
    'AI BOX',
    'Boob Camera 1',
    'PS40_4',
    'RandomFB21',
    '1400 test',
    'Sniper Alibi 243',
    'SPOTTER NVR 305',
    'SS023.1',
  ]) {
    assert.equal(canonicalCameraUnit(name), null, name);
  }
});

test('the anchored forms are untouched', () => {
  // The two original patterns run first and are unchanged, so a name that parsed
  // before parses identically. These are the cases the old pins already covered.
  const cases = [
    ['SNIPER 201', 'SNIPER|201'],        // not SNIPER2|01
    ['SNIPER 2 348', 'SNIPER2|348'],
    ['SNIPER 4 100', 'SNIPER4|100'],
    ['RECON II 022', 'RECON2|22'],
    ['RECON 011', 'RECON|11'],
    ['RII022', 'RECON2|22'],
    ['SOLAR SPOTTER 013', 'SOLARSPOTTER|13'],
    ['SPOTTER 028.1', 'SPOTTER|28.1'],
    ['CAM V 011', 'CAMV|11'],
    ['SPOTTER 000', null],               // a zero tag is still not a unit
  ];
  for (const [name, expected] of cases) {
    assert.equal(canonicalCameraUnit(name), expected, name);
  }
});
