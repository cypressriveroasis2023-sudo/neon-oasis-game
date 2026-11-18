import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const board=readFileSync(new URL('../src/FleetDashboard.tsx',import.meta.url),'utf8');
const held=/const heldHealth=\(live:number\|undefined,retained:number\|undefined\)=>\s*([^;]+);/.exec(board)[1];

// Mirror of the rule in FleetDashboard, exercised directly.
const heldHealth=(unavailable,live,retained)=>unavailable?(retained??'—'):(live??retained??'—');

test('with no connection evidence, the retained reading stands', () => {
 assert.equal(heldHealth(true,0,78),78);
 assert.equal(heldHealth(true,0,4),4);
});

test('a derived zero never reaches the board while evidence is missing', () => {
 // 0 online reads as a total outage. It is the one value that must not leak.
 assert.notEqual(heldHealth(true,0,78),0);
});

test('with nothing retained it shows an em dash, not zero', () => {
 assert.equal(heldHealth(true,0,undefined),'—');
});

test('a real zero is shown when the evidence did answer', () => {
 // A genuine zero is a measurement and must still come through.
 assert.equal(heldHealth(false,0,78),0);
});

test('a live count wins over the retained one when evidence answered', () => {
 assert.equal(heldHealth(false,91,78),91);
});

test('the rule in the source matches the rule tested here', () => {
 assert.match(held,/healthUnavailable\?\(retained\?\?'—'\):\(live\?\?retained\?\?'—'\)/);
 assert.match(board,/const healthUnavailable=!connectionSourceReady;/);
});

test('the board says the connection check did not answer', () => {
 assert.match(board,/healthUnavailable&&<p role='status'/);
 assert.match(board,/connection check did not answer/);
 // The standing rule: a router is not the cameras.
 assert.match(board,/not proof the cameras are down/);
});

test('online and offline are held; unverified is not', () => {
 for(const field of ['online','offline'])
  assert.match(board,new RegExp(field+':heldHealth\\('),field+' bypasses the hold');
 // With no evidence every field unit really is unknown. That count is the
 // honest answer, so holding it back would replace a fact with a gap.
 assert.match(board,/unknown:sharedCounts\.units\.unknown/);
 assert.doesNotMatch(board,/unknown:heldHealth\(/);
});
