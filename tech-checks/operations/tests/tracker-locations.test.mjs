import test from 'node:test';
import assert from 'node:assert/strict';
import { onHandInventory } from '../src/visionAreas.ts';
import { parseTrackerGps, safeTrackerAddress, trackerAddressKey } from '../scripts/trackerLocationImport.mjs';
test('tracker coordinates accept decimal and DMS and reject unrelated or invalid cells', () => {
 assert.deepEqual(parseTrackerGps('(29.7,-95.4)'), {latitude:29.7,longitude:-95.4});
 assert.deepEqual(parseTrackerGps('30.5° N, 97.5° W'), {latitude:30.5,longitude:-97.5});
 assert.deepEqual(parseTrackerGps('29°30\'00.0"N 95°30\'00.0"W'), {latitude:29.5,longitude:-95.5});
 for (const value of ['19881','fixture access note','8.01.25','91,-95','0,0','29°65\'00"N 95°30\'00"W']) assert.equal(parseTrackerGps(value),null);
});
test('address matching strips site titles and excludes access notes', () => {
 assert.equal(safeTrackerAddress('1 Fixture St - GATE 0000#'), '1 Fixture St');
 assert.equal(trackerAddressKey('Fixture Apartments, 123 Main St, Houston TX'), trackerAddressKey('123 Main St, Houston, TX'));
 assert.notEqual(trackerAddressKey('123 Main St, Austin, TX'), trackerAddressKey('123 Main St, Houston, TX'));
});
test('tracker shop placement deduplicates full unit labels and respects native placement', () => {
 const item=(id,unitNumber,currentLocationType,status='available')=>({id,unitNumber,currentLocationType,status});
 const data={items:[item('1','Helios 001',null),item('2','Helios 002','site','installed'),item('3','Helios 003',null)],trackerUnits:[item('t1','HELIOS-001','shop','readiness_unverified'),item('t2','Helios 002','shop','readiness_unverified'),item('t3','Helios 004','field','field'),item('t4','HELIOS 001','shop','readiness_unverified')]};
 const inventory=onHandInventory(data);
 assert.deepEqual(inventory.units.map(row=>row.id),['t1']);assert.equal(inventory.unknown,1);assert.equal(inventory.units[0].status,'readiness_unverified');
});

