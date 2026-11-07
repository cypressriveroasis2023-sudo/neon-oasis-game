import test from 'node:test';
import assert from 'node:assert/strict';
import {readFleetPresentation,saveFleetPresentation,clearFleetPresentations,fleetDisplaySaveTime} from '../src/savedFleetPresentation.ts';
import {fleetReadingKey,saveFleetReading,readFleetReading} from '../src/savedFleetReading.ts';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const session={authorized:true,legacyOwner:true,role:'Owner',productionOwnerUserId:'00000000-0000-4000-8000-000000000001',features:{fleetAccess:true,vrmRead:true}};
const key=fleetReadingKey(session,'');
function fixture(){const f=fieldProductFixture(),values=new Map();const storage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};return {...f,values,storage,presentation:{checkedAt:f.now,fieldMap:{...f.field,productConnections:f.connections,productConnectionsState:'ready',clientReadAt:f.now},health:f.health,routers:null,vrm:null,sourceErrors:{}}};}
test('full presentation round trip preserves unit details and ORIGINAL check time',()=>{
 const f=fixture();assert.equal(saveFleetPresentation(f.storage,key,f.presentation,f.now),true);
 const saved=readFleetPresentation(f.storage,key,f.now+3600000);
 assert.equal(saved.checkedAt,f.now);assert.deepEqual(saved.fieldMap,f.presentation.fieldMap);assert.deepEqual(saved.health,f.health);
});
test('verified IT reopens the completed presentation with original observations and keeps it after an invalid refresh',()=>{
 const f=fixture(),it={authorized:true,legacyOwner:false,role:'IT',productionTechnicianUserId:'00000000-0000-4000-8000-000000000003',features:{fleetAccess:true,vrmRead:true}};
 const itKey=fleetReadingKey(it,'fleet');assert.ok(itKey);
 assert.equal(saveFleetPresentation(f.storage,itKey,f.presentation,f.now),true);
 const reopened=readFleetPresentation(f.storage,fleetReadingKey(structuredClone(it),'fleet'),f.now+3600000);
 assert.equal(reopened.checkedAt,f.now);assert.deepEqual(reopened.fieldMap,f.presentation.fieldMap);assert.deepEqual(reopened.health,f.health);
 assert.equal(saveFleetPresentation(f.storage,itKey,{...f.presentation,checkedAt:f.now+3600000,fieldMap:{...f.presentation.fieldMap,productConnectionsState:'rejected'}},f.now+3600000),false);
 assert.deepEqual(readFleetPresentation(f.storage,itKey,f.now+3600000),reopened);
 for(const other of [fleetReadingKey({...it,productionTechnicianUserId:'00000000-0000-4000-8000-000000000004'},'fleet'),fleetReadingKey({...it,productionTechnicianUserId:undefined},'fleet'),fleetReadingKey(it,'staff'),key])assert.equal(readFleetPresentation(f.storage,other,f.now+3600000),null);
 clearFleetPresentations(f.storage);assert.equal(readFleetPresentation(f.storage,itKey,f.now+3600000),null);
});
test('other account, mode, permissions and unauthenticated readers cannot restore private details',()=>{
 const f=fixture();saveFleetPresentation(f.storage,key,f.presentation,f.now);
 for(const other of [null,fleetReadingKey({...session,authorized:false},''),fleetReadingKey({...session,productionOwnerUserId:'00000000-0000-4000-8000-000000000002'},''),fleetReadingKey(session,'fleet'),fleetReadingKey({...session,features:{fleetAccess:true,vrmRead:false}},'')])assert.equal(readFleetPresentation(f.storage,other,f.now),null);
});
test('partial checks, source mismatch, malformed dates and future readings are rejected',()=>{
 for(const change of [p=>p.checkedAt=Infinity,p=>p.checkedAt+=1000,p=>p.fieldMap.productConnectionsState='pending',p=>p.fieldMap.productConnections.sourceSha256='b'.repeat(64),p=>p.fieldMap.items=null]){const f=fixture();change(f.presentation);assert.equal(saveFleetPresentation(f.storage,key,f.presentation,f.now),false);assert.equal(f.values.size,0);}
});
test('valid connection-only dashboard persists when provider health is unavailable',()=>{
 const f=fixture();f.presentation.health=null;assert.equal(saveFleetPresentation(f.storage,key,f.presentation,f.now),true);assert.equal(readFleetPresentation(f.storage,key,f.now).health,null);
});
test('credential fields are never serialized and private invalidation leaves unrelated storage alone',()=>{
 const f=fixture();f.presentation.fieldMap.accessToken='synthetic-secret';f.presentation.fieldMap.authorization='synthetic-secret';
 saveFleetPresentation(f.storage,key,f.presentation,f.now);assert.equal([...f.values.values()].join('').includes('synthetic-secret'),false);
 f.storage.setItem('unrelated-setting','keep');clearFleetPresentations(f.storage);assert.deepEqual([...f.values.entries()],[['unrelated-setting','keep']]);
});
test('disabled storage, oversized data and corrupt cache are nonfatal',()=>{
 const f=fixture();assert.equal(readFleetPresentation(null,key),null);assert.equal(saveFleetPresentation(null,key,f.presentation,f.now),false);
 const blocked={getItem(){throw Error('disabled');},setItem(){throw Error('quota');}};
 assert.equal(readFleetPresentation(blocked,key,f.now),null);assert.equal(saveFleetPresentation(blocked,key,f.presentation,f.now),false);
 f.presentation.fieldMap.extra='x'.repeat(4000000);assert.equal(saveFleetPresentation(f.storage,key,f.presentation,f.now),false);
 f.storage.setItem('cos-saved-fleet-presentation-v1:'+key,'{broken');assert.equal(readFleetPresentation(f.storage,key,f.now),null);
});
test('older presentation cannot replace a newer completed dashboard',()=>{
 const f=fixture();saveFleetPresentation(f.storage,key,f.presentation,f.now);
 assert.equal(saveFleetPresentation(f.storage,key,{...f.presentation,checkedAt:f.now-1},f.now),false);
 assert.equal(readFleetPresentation(f.storage,key,f.now).checkedAt,f.now);
});
test('one-millisecond local display clock mismatch saves both views without changing camera observations',()=>{
 const f=fixture(),observations=JSON.stringify(f.presentation.fieldMap.productConnections);
 f.presentation.checkedAt=fleetDisplaySaveTime(f.now+1,f.now);assert.equal(f.presentation.checkedAt,f.now);
 assert.equal(saveFleetPresentation(f.storage,key,f.presentation,f.now),true);
 const counts={checkedAt:f.presentation.checkedAt,field:7,shop:1,online:1,offline:1,unverified:4};
 saveFleetReading(f.storage,key,counts,f.now);assert.deepEqual(readFleetReading(f.storage,key,f.now),counts);
 assert.equal(JSON.stringify(readFleetPresentation(f.storage,key,f.now).fieldMap.productConnections),observations);
});
test('local display clock normalization never renews old readings or accepts larger clock reversals',()=>{
 assert.equal(fleetDisplaySaveTime(1000,10000),1000);assert.equal(fleetDisplaySaveTime(1001,1000),1000);
 assert.equal(fleetDisplaySaveTime(1002,1000),null);assert.equal(fleetDisplaySaveTime(Infinity,1000),null);
 assert.equal(fleetDisplaySaveTime(1000,NaN),null);assert.equal(fleetDisplaySaveTime(-1,1000),null);
 const f=fixture();f.presentation.fieldMap.productConnections.items[0].checkedAt=new Date(f.now+1).toISOString();
 assert.equal(saveFleetPresentation(f.storage,key,f.presentation,f.now),false);
});
