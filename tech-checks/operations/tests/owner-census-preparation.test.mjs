import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {setImmediate as flush} from 'node:timers/promises';
import {checkedOwnerCensusPreparationBinding,checkedOwnerCensusPreparationReceipt,createOwnerCensusPreparation} from '../src/ownerCensusPreparation.ts';
import {fixture,id,now,receipt,preparationOwner} from './owner-census-preparation-fixtures.mjs';
globalThis.crypto??=webcrypto;
globalThis.fetch=async()=>{throw Error('No network allowed in synthetic preparation tests');};
const deferred=()=>{let resolve,reject;const promise=new Promise((y,n)=>{resolve=y;reject=n;});return {promise,resolve,reject};};
function adapter(snapshot,patch={}){
 const calls=[];
 const api={get:async path=>{calls.push({method:'GET',path});return {data:path==='/api/session'?preparationOwner:snapshot};},post:async(path,body,options)=>{calls.push({method:'POST',path,body,options});return {data:receipt()};},...patch};
 return {api,calls,action:createOwnerCensusPreparation(api,()=>now)};
}
test('private one-key preparation marker binds only its current native target and full address',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id);
 assert.equal(binding.nativeUnitId,id);assert.match(binding.snapshotSha256,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(binding,'nativeGuardSha256'),false);
 assert.deepEqual(checkedOwnerCensusPreparationReceipt(receipt()),receipt());
});
const denials={
 'no private marker':f=>delete f.row.locationGeocode.censusPreparation,'extra marker key':f=>f.row.locationGeocode.censusPreparation.ready=true,
 'wrong marker identity':f=>f.row.locationGeocode.censusPreparation.nativeUnitId='22222222-2222-4222-8222-222222222222',
 'wrong target':f=>f.row.id='22222222-2222-4222-8222-222222222222','duplicate row':f=>f.snapshot.items.push({...f.row}),
 'wrong audit':f=>f.row.placementAuditId='9002','wrong raw key':f=>f.row.placementUnitKey='OTHER',
 'changed suite':f=>f.row.address=f.row.address.replace('700','701'),'bad address digest':f=>f.row.locationGeocode.addressSha256='0'.repeat(64),
 'no match state':f=>f.row.locationGeocode.status='no_match','pending state':f=>f.row.locationGeocode.status='pending','success state':f=>f.row.locationGeocode.status='success',
 'real allowance':f=>f.row.locationGeocode.censusOnly=true,'false allowance marker':f=>f.row.locationGeocode.censusOnly=false,'draining allowance':f=>f.row.locationGeocode.censusOnlyState='draining',
 'real guard':f=>f.row.locationGeocode.censusOnlyGuard={nativeUnitId:id,nativeGuardSha256:'a'.repeat(64)},'real proof':f=>f.snapshot.ownerCensusProofs=[{nativeUnitId:id}],
 'not Owner placement':f=>f.row.placementSource='imported','identity review':f=>f.row.placementStatus='needs_identity_review','tracker':f=>f.row.readOnly=true,
 'current verified GPS':f=>Object.assign(f.row,{latitude:32,longitude:-97,locationVerification:'owner_verified',gpsRecordedAt:'2026-10-11T00:00:00Z',locationVerifiedAt:'2026-10-11T00:00:00Z'}),
 'partial point':f=>f.row.latitude=0,'missing null history proof':f=>delete f.row.locationHistoryId,
};
for(const [label,change] of Object.entries(denials))test('preparation rejects '+label,async()=>{const f=fixture();change(f);assert.equal(await checkedOwnerCensusPreparationBinding(f.snapshot,id),null);});
test('unknown, duplicate-list, malformed or raw-data responses cannot become review receipts',()=>{
 const valid=receipt();
 for(const value of [null,[valid,valid],{...valid,eligible:false},{...valid,eligible:1},{...valid,nativeGuardSha256:'B'.repeat(64)},{...valid,nativeSourceSha256:null},{...valid,rawHistory:[]},{...valid,preparedAt:undefined},{...valid,preparedAt:'invalid'},{...valid,preparedAt:'2026-02-30T00:00:00Z'},{...valid,preparedAt:'2026-10-12T24:00:00Z'},{...valid,preparedAt:'2026-10-12T12:00:00'}])assert.equal(checkedOwnerCensusPreparationReceipt(value),null);
});
test('one read-only preparation request exposes two opaque digests and server time without enrollment or Run',async()=>{
 const f=fixture(),before=structuredClone(f),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),a=adapter(f.snapshot);
 const result=await a.action.prepare(binding);assert.deepEqual(result.receipt,receipt());assert.deepEqual(f,before);
 const requests=a.calls.filter(call=>call.method==='POST');assert.equal(requests.length,1);
 assert.equal(requests[0].path,'/api/field-map/'+id+'/owner-census-prepare');
 assert.deepEqual(requests[0].body,{auditId:binding.auditId,unitKey:binding.unitKey,addressSha256:binding.addressSha256});
 assert.equal(Object.hasOwn(requests[0].body,'snapshotSha256'),false);assert.equal(Object.hasOwn(requests[0].body,'nativeGuardSha256'),false);
 assert.ok(a.calls.every(call=>!call.path.endsWith('/owner-census-once')&&!call.path.endsWith('/gps')));
 assert.deepEqual(a.calls.map(c=>c.path),['/api/session','/api/field-map','/api/session','/api/field-map/'+id+'/owner-census-prepare','/api/field-map','/api/session']);
});
for(const actor of [{...preparationOwner,role:'IT',legacyOwner:false},{...preparationOwner,role:'Service',legacyOwner:false},{...preparationOwner,productionOwnerUserId:null}])test('unavailable or non-Owner actor cannot prepare '+String(actor.role)+' '+String(actor.productionOwnerUserId),async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?actor:f.snapshot})});
 await assert.rejects(a.action.prepare(binding),/Owner session/);assert.equal(a.calls.length,0);
});
test('same-role different Owner during preflight cannot prepare',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id);let sessions=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?++sessions===1?preparationOwner:{...preparationOwner,productionOwnerUserId:'88888888-8888-4888-8888-888888888888'}:f.snapshot})});
 await assert.rejects(a.action.prepare(binding),/Owner session changed/);assert.equal(a.calls.length,0);
});
test('unchanged address with changed visible history is rejected before preparation',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),changed=structuredClone(f.snapshot);changed.items[0].locationNote='Changed synthetic history note';
 const a=adapter(changed);await assert.rejects(a.action.prepare(binding),/installation changed/);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
});
test('source changes after preparation reject the digest receipt',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),changed=structuredClone(f.snapshot);changed.items[0].historicalLatitude=31;let reads=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?preparationOwner:reads++===0?f.snapshot:changed})});
 await assert.rejects(a.action.prepare(binding),/changed during preparation/);assert.equal(a.calls.filter(c=>c.method==='POST').length,1);
});
test('removed preparation marker after response cannot publish stale receipt',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),changed=structuredClone(f.snapshot);delete changed.items[0].locationGeocode.censusPreparation;let reads=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?preparationOwner:reads++===0?f.snapshot:changed})});
 await assert.rejects(a.action.prepare(binding),/changed during preparation/);
});
test('same-role different Owner after proof cannot receive digests',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id);let sessions=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?++sessions<3?preparationOwner:{...preparationOwner,productionOwnerUserId:'88888888-8888-4888-8888-888888888888'}:f.snapshot})});
 await assert.rejects(a.action.prepare(binding),/Owner session changed/);
});
test('duplicate clicks and selected-target change cancel preflight without a request',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),gate=deferred();let selected=true;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?preparationOwner:await gate.promise})});
 const first=a.action.prepare(binding,()=>selected);await flush();await assert.rejects(a.action.prepare(binding),/already in progress/);selected=false;gate.resolve(f.snapshot);
 await assert.rejects(first,/installation changed/);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
});
test('late duplicate-resolution and invalidated session cannot publish preparation',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),gate=deferred(),started=deferred();let signal;
 const a=adapter(f.snapshot,{post:async(path,body,options)=>{signal=options.signal;started.resolve();return gate.promise;}});
 const first=a.action.prepare(binding);await started.promise;a.action.invalidate();assert.equal(signal.aborted,true);gate.resolve({data:receipt()});gate.resolve({data:receipt()});
 await assert.rejects(first,/earlier selection or session/);
});
test('read-only timeout has no automatic retry and an explicit fresh preparation is safe',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id);let requests=0;
 const a=adapter(f.snapshot,{post:async path=>{assert.equal(path.endsWith('/owner-census-prepare'),true);requests++;if(requests===1)throw Error('Synthetic timeout');return {data:receipt()};}});
 await assert.rejects(a.action.prepare(binding),/No lookup was started/);assert.equal(requests,1);assert.deepEqual((await a.action.prepare(binding)).receipt,receipt());assert.equal(requests,2);
});
test('stale or future server receipts are rejected despite valid digest shapes',async()=>{
 for(const preparedAt of ['2026-10-12T11:00:00.000Z','2026-10-12T13:00:00.000Z']){
  const f=fixture(),binding=await checkedOwnerCensusPreparationBinding(f.snapshot,id),a=adapter(f.snapshot,{post:async()=>({data:{...receipt(),preparedAt}})});
  await assert.rejects(a.action.prepare(binding),/stale or future/);
 }
});
