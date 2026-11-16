import {test} from 'node:test';
import assert from 'node:assert/strict';
import {needsYouRows} from '../src/fleetNeedsYou.ts';

const unit=(u,state,extra={})=>({unit:u,displayName:u,placement:'FIELD',site:'Bristol',
 state,cameras:1,online:0,offline:state==='RED'?1:0,unknown:0,down:[],onlineInShop:false,...extra});

test('a unit with every camera up never asks for attention', () => {
 const {rows,total}=needsYouRows([unit('SNIPER 302','GREEN')]);
 assert.deepEqual(rows,[]);
 assert.equal(total,0);
});

test('worst first: down, then partly down, then not verified', () => {
 const {rows}=needsYouRows([
  unit('A','UNKNOWN'),unit('B','YELLOW',{cameras:5,offline:1}),unit('C','RED')]);
 assert.deepEqual(rows.map(r=>r.unit),['C','B','A']);
 assert.deepEqual(rows.map(r=>r.tone),['down','partial','unchecked']);
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

test('a failed check reads Not verified, never as an outage', () => {
 const {rows}=needsYouRows([unit('HELIOS 008','UNKNOWN')]);
 assert.equal(rows[0].tone,'unchecked');
 assert.equal(rows[0].detail,'not verified');
 assert.ok(!/down|offline/i.test(rows[0].detail));
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
