import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {fleetSnapshotStorageKey,readFleetSnapshotCache,writeFleetSnapshotCache,clearFleetSnapshotCache} from '../src/fleetSnapshotStorage.ts';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';

const now=Date.parse('2026-11-03T07:00:00Z');
function browser(t){
 const values=new Map();
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null,get length(){return values.size;}};
 for(const [name,value] of [['localStorage',storage],['crypto',webcrypto]]){
  const old=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,value});
  t.after(()=>{if(old)Object.defineProperty(globalThis,name,old);else delete globalThis[name];});
 }
 return {values,storage};
}
function pair(){
 const health={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:new Date(now).toISOString(),rows:[],evidenceVersion:2,inventory:{allRecords:0,activeFieldRecords:0,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0}};
 return reconcileFleetSnapshot(health,{items:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:new Date(now).toISOString()},now);
}
const jwt=(sub,suffix)=>'header.'+Buffer.from(JSON.stringify({sub})).toString('base64url')+'.'+suffix;

test('a browser reopen restores the complete saved pair with its original reading time',async t=>{
 browser(t);const key=await fleetSnapshotStorageKey(jwt('owner-a','one'),'owner',null),saved=pair();
 writeFleetSnapshotCache(key,saved,now-500);
 const restored=readFleetSnapshotCache(key,now+600000);
 assert.ok(restored);assert.equal(restored.at,now-500);assert.equal(restored.value.readAt,saved.readAt);
 assert.deepEqual(restored.value.health,saved.health);assert.deepEqual(restored.value.fieldMap,saved.fieldMap);
});
test('cache namespace survives token rotation and separates actors, roles and modes',async t=>{
 const {values}=browser(t);const token=jwt('owner-a','one'),key=await fleetSnapshotStorageKey(token,'owner',null);
 assert.equal(await fleetSnapshotStorageKey(jwt('owner-a','two'),'owner',null),key);
 for(const other of [await fleetSnapshotStorageKey(jwt('owner-b','one'),'owner',null),await fleetSnapshotStorageKey(token,'it',null),await fleetSnapshotStorageKey(token,'owner','tv')])assert.notEqual(other,key);
 writeFleetSnapshotCache(key,pair(),now);assert.ok(![...values.keys(),...values.values()].some(value=>value.includes(token)));
});
test('corrupt and future cache entries are discarded instead of displayed',t=>{
 const {values}=browser(t);values.set('bad','broken JSON');assert.equal(readFleetSnapshotCache('bad',now),null);assert.ok(!values.has('bad'));
 writeFleetSnapshotCache('future',pair(),now+60000);assert.equal(readFleetSnapshotCache('future',now),null);assert.ok(!values.has('future'));
});
test('expired connection evidence cannot be restored as an accepted receipt',t=>{
 browser(t);const saved=pair();saved.fieldMap.productConnections={contract:'invalid'};
 writeFleetSnapshotCache('proof',saved,now);const restored=readFleetSnapshotCache('proof',now);
 assert.ok(restored);assert.equal(restored.value.fieldMap.productConnections,null);assert.equal(restored.value.fieldMap.productConnectionsState,'rejected');
});
test('security clearing removes only COS snapshots and can target one actor',async t=>{
 const {values}=browser(t),key=await fleetSnapshotStorageKey('opaque-token','owner',null);
 writeFleetSnapshotCache(key,pair(),now);values.set('unrelated','keep');clearFleetSnapshotCache(key);assert.ok(!values.has(key));
 writeFleetSnapshotCache(key,pair(),now);clearFleetSnapshotCache();assert.deepEqual([...values],[['unrelated','keep']]);
});
test('unavailable or denied browser storage remains optional',async t=>{
 const {storage}=browser(t);storage.setItem=()=>{throw Error('quota');};storage.getItem=()=>{throw Error('denied');};
 assert.doesNotThrow(()=>writeFleetSnapshotCache('key',pair(),now));assert.equal(readFleetSnapshotCache('key',now),null);assert.doesNotThrow(()=>clearFleetSnapshotCache());
});
