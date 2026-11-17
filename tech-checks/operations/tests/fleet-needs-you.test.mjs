import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {needsYouRows} from '../src/fleetNeedsYou.ts';

const unit=(u,state,extra={})=>({unit:u,displayName:u,placement:'FIELD',site:'Bristol',
 state,cameras:1,online:0,offline:state==='RED'?1:0,unknown:0,down:[],onlineInShop:false,...extra});

test('yellow with no confirmed offline camera is not cameras down', () => {
 const {rows,total,unchecked}=needsYouRows([unit('MIX','YELLOW',{cameras:4,online:2,offline:0,unknown:2})]);
 assert.deepEqual(rows,[]);
 assert.equal(total,0);
 assert.equal(unchecked,1);
});

test('a unit with every camera up never asks for attention', () => {
 const {rows,total}=needsYouRows([unit('SNIPER 302','GREEN')]);
 assert.deepEqual(rows,[]);
 assert.equal(total,0);
});

test('worst first: down, then partly down', () => {
 const {rows}=needsYouRows([
  unit('A','UNKNOWN'),unit('B','YELLOW',{cameras:5,offline:1}),unit('C','RED')]);
 assert.deepEqual(rows.map(r=>r.unit),['C','B']);
 assert.deepEqual(rows.map(r=>r.tone),['down','partial']);
});

test('more cameras out outranks fewer within the same tone', () => {
 const {rows}=needsYouRows([
  unit('ONE','YELLOW',{cameras:5,offline:1}),unit('FIVE','YELLOW',{cameras:9,offline:5})]);
 assert.deepEqual(rows.map(r=>r.unit),['FIVE','ONE']);
});

test('a shop unit is never a customer outage, however it reports', () => {
 const {rows,total}=needsYouRows([unit('SNIPER 208','RED',{placement:'SHOP'})]);
 assert.deepEqual(rows,[]);
 assert.equal(total,0);
});

test('a unit that could not be checked is counted apart, never as work', () => {
 // Counting these as attention put 37 in front of the owner when ten were
 // actually wrong. Unknown is not an outage and is not a job for anyone.
 const {rows,total,unchecked}=needsYouRows([unit('HELIOS 008','UNKNOWN')]);
 assert.deepEqual(rows,[]);
 assert.equal(total,0);
 assert.equal(unchecked,1);
});

test('the count a person reads is faults only, with unchecked beside it', () => {
 const units=[unit('C','RED'),unit('B','YELLOW',{cameras:4,offline:2}),
              ...Array.from({length:27},(_,i)=>unit('U'+i,'UNKNOWN'))];
 const {total,unchecked}=needsYouRows(units);
 assert.equal(total,2,'only real faults are counted as needing a person');
 assert.equal(unchecked,27);
});

test('unchecked units in the shop are not counted at all', () => {
 const {total,unchecked}=needsYouRows([unit('SHOPPED','UNKNOWN',{placement:'SHOP'})]);
 assert.equal(total,0);
 assert.equal(unchecked,0,'a shop unit is never a customer problem');
});

test('the card says plainly that unchecked units are not jobs', () => {
 const card=readFileSync(new URL('../src/FleetNeedsYou.tsx',import.meta.url),'utf8');
 assert.match(card,/not known to be faulty/i);
 assert.match(card,/nobody needs to drive out/i);
 // It must say so even when there is nothing wrong at all.
 const clear=card.indexOf('Nothing needs you');
 assert.ok(clear>-1&&card.indexOf('uncheckedNote',clear)>clear,'the clear state must show it too');
});

test('the detail says how many of how many are out', () => {
 const {rows}=needsYouRows([unit('STAND','YELLOW',{cameras:5,offline:2})]);
 assert.equal(rows[0].detail,'2 of 5 down');
});

test('a single-camera unit does not say all 1 cameras down', () => {
 const {rows}=needsYouRows([unit('SNIPER 302','RED',{cameras:1,offline:1})]);
 assert.equal(rows[0].detail,'camera down');
});

test('the badge counts everything even when the card shows fewer', () => {
 const many=Array.from({length:12},(_,i)=>unit('U'+i,'RED'));
 const {rows,total}=needsYouRows(many,5);
 assert.equal(rows.length,5);
 assert.equal(total,12);
});

test('a unit with no site recorded still gets a readable line', () => {
 const {rows}=needsYouRows([unit('SNIPER 302','RED',{site:'   '})]);
 assert.equal(rows[0].site,'No site recorded');
});

test('a present board keeps its last counts and labels them not current', () => {
 const source=readFileSync(new URL('../src/FleetDashboard.tsx',import.meta.url),'utf8');
 assert.match(source,/UNITS ONLINE',boardVisible&&!failed&&!durableWaiting\?headlineCounts\.online:'—'/);
 assert.match(source,/UNITS OFFLINE',boardVisible&&!failed&&!durableWaiting\?headlineCounts\.offline:'—'/);
 assert.match(source,/UNITS UNVERIFIED',boardVisible&&!durableWaiting\?headlineCounts\.unknown:'—'/);
 assert.match(source,/healthCurrent=\{boardVisible\}/);
 assert.match(source,/Last completed reading '\+boardReadingTime\+' · not current\./);
 assert.doesNotMatch(source,/savedOnly\?savedOnly\.online/);
 assert.doesNotMatch(source,/!boardVisible\|\|failed\?'—':headlineCounts\.online/);
});
