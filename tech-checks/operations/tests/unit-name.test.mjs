import assert from 'node:assert/strict';
import test from 'node:test';
import {readUnitName, readUnitNameOrProblem, sameUnit} from '../shared/unitName.ts';

const key = name => { const read = readUnitName(name); return read && read.key; };
const problem = name => readUnitNameOrProblem(name).problem;

// Every spelling below was read from equipment_master, the 2027 Unit Tracker or
// the mHelp list on 2026-11-24. None of them is invented.

test('the sensor model after the number does not make a second unit', () => {
  assert.equal(key('Spotter 236HDC2'), 'SPOTTER|236');
  assert.equal(key('SPOTTER 236'), 'SPOTTER|236');
  assert.equal(key('Spotter 183HDC2'), key('SPOTTER 183'));
  assert.equal(readUnitName('Spotter 236HDC2').model, 'HDC2');
});

test('the mast size before or after the number does not make a second unit', () => {
  // equipment_master and the tracker write the size first; mHelp writes it last,
  // or leaves it out. All of these are Solar Stand 1.
  assert.equal(key('Solar Stand 72 001'), 'SOLARSTAND|1');
  assert.equal(key('Solar Stand 001'), 'SOLARSTAND|1');
  assert.equal(key('Solar Pole 001 72'), 'SOLARPOLE|1');
  assert.equal(key('Solar Pole 72 003'), 'SOLARPOLE|3');
  assert.equal(key('Solar Skid 144 001'), 'SOLARSKID|1');
});

test('a mast size is only ignored for the families that use one', () => {
  // A Spotter numbered 72 keeps its number.
  assert.equal(key('Spotter 072'), 'SPOTTER|72');
  assert.equal(key('Sniper 144'), 'SNIPER|144');
});

test('case, spacing, dashes and leading zeros never make a second unit', () => {
  assert.equal(key('Recon II 001'), key('RECON II 005') && 'RECON2|1');
  assert.equal(key('RECON II 005'), 'RECON2|5');
  assert.equal(key('Sniper 2-344'), 'SNIPER2|344');
  assert.equal(key('SNIPER 2 344'), 'SNIPER2|344');
  assert.equal(key('Sniper 4-100'), 'SNIPER4|100');
  assert.equal(key('SOLARSPOTTER 010'), key('Solar Spotter 010'));
});

test('the short Recon spellings read as the same families', () => {
  // camera_devices writes RII and RI where the other systems write Recon II and Recon.
  assert.equal(key('RII024'), 'RECON2|24');
  assert.equal(key('RII-034'), 'RECON2|34');
  // Site text carrying its own digits makes the unit number unclear, so it is held.
  assert.equal(problem('RII022 - CityZen_1317HawthorneSt'), 'ambiguous_number');
});

test('Recon and Recon II are different families and never merge', () => {
  assert.equal(key('Recon 142'), 'RECON|142');
  assert.equal(key('Recon II 142'), 'RECON2|142');
  assert.notEqual(key('Recon 142'), key('Recon II 142'));
});

test('a trailing note is not part of the name', () => {
  assert.equal(key('Sniper 024 - DO NOT USE'), 'SNIPER|24');
  assert.equal(key('Solar Stand 018 MISSING'), 'SOLARSTAND|18');
  assert.equal(key('SNIPER 317 ES'), 'SNIPER|317');
  assert.equal(key('Solar Pole 002 72 (Hybrid solar stand)'), 'SOLARPOLE|2');
});

test('a decimal is its own unit, not the whole number', () => {
  assert.equal(key('Solar Spotter 023.1'), 'SOLARSPOTTER|23.1');
  assert.notEqual(key('Solar Spotter 023.1'), key('Solar Spotter 023'));
  assert.equal(key('Spotter 028.1HDC4S'), 'SPOTTER|28.1');
});

test('a name with two possible unit numbers is held, never guessed', () => {
  // Live on 2026-11-24. 013 and 074 are both candidates and the name does not say which.
  assert.equal(readUnitName('Solar Pole 013 72 (Hybrid solar stand) 074'), null);
  assert.equal(problem('Solar Pole 013 72 (Hybrid solar stand) 074'), 'ambiguous_number');
});

test('a name with no family or no number is held', () => {
  assert.equal(problem('Solar Stand'), 'no_number');
  assert.equal(problem('Fixture Homes yard'), 'no_family');
  assert.equal(problem(''), 'not_a_string');
  assert.equal(problem(null), 'not_a_string');
  assert.equal(problem(12), 'not_a_string');
});

test('sameUnit answers the question the three systems keep disagreeing about', () => {
  assert.equal(sameUnit('Solar Stand 72 001', 'Solar Stand 001'), true);
  assert.equal(sameUnit('SPOTTER 236', 'Spotter 236HDC2'), true);
  assert.equal(sameUnit('Recon 142', 'Recon II 142'), false);
  assert.equal(sameUnit('Solar Pole 013 72 (Hybrid solar stand) 074', 'Solar Pole 013'), false);
});

test('RSU and CAM V stay their own families here', () => {
  // mhelpUnitIdentity folds RSU into CAMV. This reader does not: COS holds both
  // names and whether they are one unit is a question for a person.
  assert.equal(key('RSU 001'), 'RSU|1');
  assert.equal(key('CAMV 001'), 'CAMV|1');
  assert.notEqual(key('RSU 001'), key('CAMV 001'));
});

test('a sensor model written as its own word is still a model', () => {
  // mHelp writes the model attached, spaced, double-spaced or dashed.
  assert.equal(key('Spotter 199 HDC4'), 'SPOTTER|199');
  assert.equal(key('Spotter 222   HDC2'), 'SPOTTER|222');
  assert.equal(key('Spotter 225 - HDC2'), 'SPOTTER|225');
  assert.equal(key('Spotter 302  -  HDC4'), 'SPOTTER|302');
  assert.equal(key('Solar Spotter 015 HDC2'), 'SOLARSPOTTER|15');
  assert.equal(key('Spotter 274 HDC2S - SOLAR COMPATIBLE'), 'SPOTTER|274');
  assert.equal(key('Spotter 028.1 HDC4S - SOLAR COMPATIBLE'), 'SPOTTER|28.1');
});

test('a number that matches the family size is the unit when it is the only one', () => {
  // "SOLAR STAND 072" is Solar Stand 72, not a mast size with no unit.
  assert.equal(key('SOLAR STAND 072'), 'SOLARSTAND|72');
  assert.equal(key('Solar Stand 72 001'), 'SOLARSTAND|1');
});

test('SS Hybrid keeps its family name', () => {
  assert.equal(key('SS Hybrid 252'), 'SSHYBRID|252');
  assert.equal(key('SS Hybrid 298'), 'SSHYBRID|298');
});

test('a number split by a stray space reads as one number', () => {
  assert.equal(key('RANGER 029 .2'), 'RANGER|29.2');
});
