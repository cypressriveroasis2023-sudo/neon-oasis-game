import test from 'node:test';import assert from 'node:assert/strict';
import {retainCompletedSnapshot,newerFleetConnectionRead,latestFleetConnectionRead} from '../src/snapshotRetention.ts';
const snapshot=(state='ready',sha='a')=>({readAt:'2026-11-03T20:00:00Z',fieldMap:{uploadInventory:{sourceSha256:sha},productConnectionsState:state}});
test('only unfinished and failed reads of the same source retain completed results',()=>{
 const previous=snapshot();for(const state of ['pending','error','timeout','rejected'])assert.equal(retainCompletedSnapshot(previous,snapshot(state)),true);
 assert.equal(retainCompletedSnapshot(previous,snapshot('ready')),false);
 assert.equal(retainCompletedSnapshot(previous,snapshot('error','b')),false);
 assert.equal(retainCompletedSnapshot(null,snapshot('error')),false);
});
const attempt=(revision,state,sha='a',extra={})=>({revision,map:snapshot(state,sha).fieldMap,...extra});
test('retained completed authority does not hide a failed attempt or renew its saved time',()=>{
 const saved=snapshot(),before=structuredClone(saved);
 for(const state of ['error','timeout','rejected']){
  const failed=attempt(2,state);failed.map.productConnectionsDiagnostic={stage:'saved_checks',code:'source_unavailable'};
  assert.equal(retainCompletedSnapshot(saved,{fieldMap:failed.map}),true);
  assert.equal(latestFleetConnectionRead(saved.fieldMap,attempt(1,'ready'),failed),failed);
  assert.deepEqual(saved,before);
 }
});
test('request revision orders same-time attempts; a new pending read supersedes an old failure',()=>{
 const failed={...attempt(4,'error'),startedAt:100},pending={...attempt(5,'pending'),startedAt:100},authority=snapshot().fieldMap;
 assert.equal(latestFleetConnectionRead(authority,failed,pending),pending);
 assert.equal(latestFleetConnectionRead(authority,pending,failed),pending);
 for(const state of ['ready','error','timeout','rejected']){
  const completed=attempt(5,state);
  assert.equal(latestFleetConnectionRead(authority,pending,completed),completed);
  assert.equal(latestFleetConnectionRead(authority,completed,pending),completed);
 }
});
test('independent proof completion remains visible when provider health has no completed pair',()=>{
 const authority=snapshot().fieldMap,pending=attempt(6,'pending'),failed=attempt(6,'error');
 assert.equal(latestFleetConnectionRead(authority,null,failed),failed);
 assert.equal(latestFleetConnectionRead(authority,pending,failed),failed);
 const recovered=attempt(7,'ready');assert.equal(latestFleetConnectionRead(authority,failed,recovered),recovered);
});
test('attempt diagnostics cannot cross inventory authority or survive cleared session state',()=>{
 const old=attempt(9,'error','a'),current=attempt(8,'ready','b');
 assert.equal(latestFleetConnectionRead(snapshot('ready','b').fieldMap,old,current),current);
 assert.equal(latestFleetConnectionRead(snapshot('ready','b').fieldMap,old,null),null);
 assert.equal(latestFleetConnectionRead(null,old,current),null);
 assert.equal(latestFleetConnectionRead(snapshot().fieldMap,null,null),null);
});
test('verified readback clears its own failure but cannot borrow a newer request revision',()=>{
 const verified=attempt(10,'ready','a',{verified:true}),failed=attempt(10,'error'),pending=attempt(10,'pending');
 for(const earlier of [failed,pending]){
  assert.equal(newerFleetConnectionRead(earlier,verified),verified);
  assert.equal(newerFleetConnectionRead(verified,earlier),verified);
 }
 const newerFailure=attempt(11,'error'),newerPending=attempt(11,'pending');
 for(const newer of [newerFailure,newerPending]){
  assert.equal(newerFleetConnectionRead(newer,verified),newer);
  assert.equal(latestFleetConnectionRead(snapshot().fieldMap,newer,verified),newer);
 }
});
