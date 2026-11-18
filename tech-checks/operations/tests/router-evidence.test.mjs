import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routerEvidenceByUnit,routerEvidenceFor} from '../src/routerEvidence.ts';

const now=Date.parse('2026-11-15T20:00:00Z');
const fresh='2026-11-15T19:55:00Z', old='2026-11-10T19:55:00Z';
const row=(unitKey,probeStatus,checkedAt=fresh)=>({id:unitKey,unitKey,name:unitKey,model:'',
 port:null,protocol:null,probeStatus,checkedAt,lastRecoveredAt:null,
 reportedStatus:'',reportedAt:null,reportedSource:'',savedLatencyMs:null,match:'exact_name',
 candidateUnit:null,gps:null});
const unit=u=>({unit:u});

test('a reachable router is linked and answering', () => {
 const i=routerEvidenceByUnit({items:[row('SNIPER 302','online')]},now);
 assert.deepEqual(routerEvidenceFor(unit('SNIPER 302'),i),{linked:true,reachable:true});
});

test('a unit with no router reads unlinked, not failed', () => {
 const i=routerEvidenceByUnit({items:[]},now);
 assert.deepEqual(routerEvidenceFor(unit('SNIPER 302'),i),{linked:false});
});

test('a stale check is Not checked, never a failure', () => {
 const i=routerEvidenceByUnit({items:[row('SNIPER 302','online',old)]},now);
 const e=routerEvidenceFor(unit('SNIPER 302'),i);
 assert.equal(e.linked,true);
 assert.equal(e.reachable,undefined);
});

test('an unreachable router is recorded as unreachable', () => {
 const i=routerEvidenceByUnit({items:[row('SNIPER 302','offline')]},now);
 assert.equal(routerEvidenceFor(unit('SNIPER 302'),i).reachable,false);
});

test('one unit never picks up another unit\'s router', () => {
 const i=routerEvidenceByUnit({items:[row('SNIPER 302','online')]},now);
 assert.deepEqual(routerEvidenceFor(unit('SNIPER 303'),i),{linked:false});
});

test('an unreachable router is not hidden by a reachable sibling', () => {
 const i=routerEvidenceByUnit({items:[row('SNIPER 302','online'),row('SNIPER 302','offline')]},now);
 assert.equal(routerEvidenceFor(unit('SNIPER 302'),i).reachable,false);
});

test('a missing or malformed router feed yields no evidence at all', () => {
 for(const bad of [null,undefined,{},{items:'nope'}]){
  const i=routerEvidenceByUnit(bad,now);
  assert.equal(i.size,0);
  assert.deepEqual(routerEvidenceFor(unit('SNIPER 302'),i),{linked:false});
 }
});

test('a future-dated check is not treated as current', () => {
 const i=routerEvidenceByUnit({items:[row('SNIPER 302','online','2026-12-01T00:00:00Z')]},now);
 assert.equal(routerEvidenceFor(unit('SNIPER 302'),i).reachable,undefined);
});
