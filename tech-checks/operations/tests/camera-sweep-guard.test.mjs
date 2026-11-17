import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 publicationForProbe,finalizePending,mergeSweepVerdict,sweepLockBusy,addressBlockKey,
 CELLULAR_PROBE_TIMEOUT_MS,SWEEP_SHARD_DEADLINE_MS,SWEEP_CRON_TIMEOUT_MS
} from '../src/cameraSweepGuard.mjs';

const bundle=readFileSync(new URL('../../docs/camera-health-sweep-endpoint-retry-20261110/source/index.ts',import.meta.url),'utf8');

/** The recorded Nov 13 10:15 CT and Nov 15 23:00 CT sweeps: 26 refusals in
 * three address blocks sized 15, 7 and 4. Blocks are synthetic labels. */
function recordedCluster(){
 const units=[];
 for(const [key,count] of [['block-a',15],['block-b',7],['block-c',4]]){
  for(let i=0;i<count;i++)units.push({klass:'refused',blockKey:key,prior:1});
 }
 return units;
}

test('Nov 13 and Nov 15 refusal clusters flip no unit and do not count as misses',()=>{
 for(const event of ['nov13','nov15']){
  const units=recordedCluster();
  const verdict=mergeSweepVerdict([{probed:units.length,failed:units.length,tallies:units.reduce((map,unit)=>{const id=unit.blockKey;map.set(id,(map.get(id)||0)+1);return map;},new Map())}].map(part=>({probed:part.probed,failed:part.failed,tallies:[...part.tallies].map(([key,count])=>({klass:'refused',key,count}))})));
  assert.equal(verdict.pattern,true,event);
  assert.equal(verdict.inconclusive,true,event);
  assert.equal(verdict.failed,26,event);
  for(const unit of units){
   const published=publicationForProbe(unit.klass,unit.prior);
   const final=published.pending?finalizePending(published.failures,true):published;
   assert.notEqual(final.status,'offline',event);
   assert.equal(final.failures,unit.prior,event);
  }
 }
});

test('more than 10 percent failed is inconclusive and does not advance a miss',()=>{
 const units=[...Array.from({length:11},()=>({klass:'miss',blockKey:'solo',prior:2})),...Array.from({length:89},()=>({klass:'online',blockKey:'solo',prior:0}))];
 const verdict=mergeSweepVerdict([{probed:100,failed:11,tallies:[{klass:'miss',key:'solo',count:11}]}]);
 assert.equal(verdict.inconclusive,true);
 assert.equal(verdict.pattern,false);
 for(const unit of units.filter(unit=>unit.klass==='miss')){
  const published=publicationForProbe('miss',unit.prior);
  const final=finalizePending(published.failures,true);
  assert.equal(final.status,'unknown');
  assert.equal(final.failures,2);
 }
});

test('a single miss stays Verifying and the third conclusive miss is Offline',()=>{
 const verdict=mergeSweepVerdict([{probed:100,failed:1,tallies:[{klass:'miss',key:'solo',count:1}]}]);
 assert.equal(verdict.inconclusive,false);
 assert.deepEqual(finalizePending(0,false),{status:'verifying',failures:1,confirmed:false});
 assert.deepEqual(finalizePending(2,false),{status:'offline',failures:3,confirmed:true});
 assert.equal(publicationForProbe('refused',2).status,'unknown');
 assert.equal(publicationForProbe('online',2).failures,0);
});

test('an overlap lock rejects a second sweep inside the cron timeout',()=>{
 const now=Date.parse('2026-11-17T20:00:00Z');
 assert.equal(sweepLockBusy('running',new Date(now-60_000).toISOString(),now),true);
 assert.equal(sweepLockBusy('running',new Date(now-SWEEP_CRON_TIMEOUT_MS).toISOString(),now),false);
 assert.equal(sweepLockBusy('partial',new Date(now-1_000).toISOString(),now),false);
});

test('cellular timeout and shard deadline stay inside the cron timeout',()=>{
 assert.equal(CELLULAR_PROBE_TIMEOUT_MS,5000);
 assert.equal(SWEEP_SHARD_DEADLINE_MS,60000);
 assert.ok(SWEEP_SHARD_DEADLINE_MS*2<SWEEP_CRON_TIMEOUT_MS);
 assert.equal(addressBlockKey('203.0.113.10'),addressBlockKey('203.0.113.20'));
 assert.notEqual(addressBlockKey('203.0.113.10'),addressBlockKey('198.51.100.10'));
 assert.doesNotMatch(addressBlockKey('203.0.113.10'),/\d+\.\d+/);
});

test('the live sweep bundle uses one retry, the guard, and the overlap lock',()=>{
 assert.match(bundle,/var PROBE_TIMEOUT_MS = 5000;/);
 assert.match(bundle,/deadlineMs: completedSnapshotEnabled \? 95e3 : 60e3/);
 assert.match(bundle,/function publicationForProbe/);
 assert.match(bundle,/function mergeSweepVerdict/);
 assert.match(bundle,/sweep_already_running/);
 assert.match(bundle,/body\.reconcile === true/);
 assert.match(bundle,/Pending sweep verdict/);
 assert.equal(bundle.includes('status = reachable ? "online" : "offline", checked'),false);
});
