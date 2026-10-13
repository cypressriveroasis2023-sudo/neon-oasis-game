import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {setImmediate as flush} from 'node:timers/promises';
import {checkedOwnerCensusOnceBinding,createOwnerCensusOnceAction,ownerCensusSessionAllowed,ownerCensusPolicyMessage} from '../src/ownerCensusOnce.ts';
import {fixture,consumed,id,owner,now} from './owner-census-once-fixtures.mjs';
globalThis.crypto??=webcrypto;
globalThis.fetch=async()=>{throw Error('No network allowed in synthetic one-shot tests');};
const deferred=()=>{let resolve,reject;const promise=new Promise((y,n)=>{resolve=y;reject=n;});return {promise,resolve,reject};};
function adapter(snapshot,patch={}){
 const calls=[];let reads=0;
 const api={get:async path=>{calls.push({method:'GET',path});return {data:path==='/api/session'?owner:reads++===0?snapshot:consumed(snapshot)};},post:async(path,body,options)=>{calls.push({method:'POST',path,body,options});return {data:{ok:true,censusOnly:true,allowance:'consumed'}};},...patch};
 return {api,calls,action:createOwnerCensusOnceAction(api,()=>now)};
}
test('only exact authorized Owner session can enable action; IT/Service/missing legacy role are denied',()=>{
 assert.equal(ownerCensusSessionAllowed(owner),true);
 for(const session of [null,{}, {...owner,role:'IT'},{...owner,role:'Service'},{...owner,role:'owner'},{...owner,legacyOwner:false},{...owner,legacyOwner:undefined},{...owner,authorized:false}])assert.equal(ownerCensusSessionAllowed(session),false);
});
test('complete unique proof and exact ready binding yields only immutable request identity, no address',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id);
 assert.deepEqual(Object.keys(binding),['nativeUnitId','auditId','unitKey','addressSha256','nativeGuardSha256']);
 assert.equal(binding.nativeUnitId,id);assert.equal(Object.hasOwn(binding,'address'),false);
});
const denials={
 'missing proof':f=>delete f.snapshot.ownerCensusProofs,'empty proof':f=>f.snapshot.ownerCensusProofs=[],
 'incomplete proof':f=>f.proof.complete=false,'missing complete flag':f=>delete f.proof.complete,'duplicate proof':f=>f.snapshot.ownerCensusProofs.push({...f.proof}),
 'unknown proof data':f=>f.proof.address='extra', 'wrong proof contract':f=>f.proof.contract='OTHER',
 'wrong proof digest':f=>f.proof.nativeGuardSha256='b'.repeat(64),'wrong proof audit':f=>f.proof.auditId='9002',
 'wrong proof key':f=>f.proof.unitKey='OTHER','wrong proof address hash':f=>f.proof.addressSha256='b'.repeat(64),
 'missing enrollment':f=>delete f.row.locationGeocode.censusOnly,'consumed enrollment':f=>f.row.locationGeocode.censusOnlyState='consumed',
 'mandatory drain':f=>f.row.locationGeocode.censusOnlyState='draining','held source':f=>{f.row.locationGeocode.status='held';delete f.row.locationGeocode.censusOnlyGuard;},
 'wrong native binding':f=>f.row.locationGeocode.censusOnlyGuard.nativeUnitId='22222222-2222-4222-8222-222222222222',
 'unknown guard field':f=>f.row.locationGeocode.censusOnlyGuard.extra=true,'changed suite':f=>f.row.address=f.row.address.replace('700','701'),
 'changed audit':f=>f.row.placementAuditId='9002','changed raw unit key':f=>f.row.placementUnitKey='OTHER',
 'wrong provider':f=>f.row.locationGeocode.provider='geocodio','wrong benchmark':f=>f.row.locationGeocode.benchmark='OTHER',
 'current success':f=>f.row.locationGeocode.status='success','pending result':f=>f.row.locationGeocode.status='pending',
 'not native':f=>f.row.readOnly=true,'not Owner placement':f=>f.row.placementSource='imported','identity review':f=>f.row.placementStatus='needs_identity_review',
 'current verified GPS':f=>Object.assign(f.row,{latitude:32,longitude:-97,locationVerification:'owner_verified',gpsRecordedAt:f.row.addressUpdatedAt,locationVerifiedAt:f.row.addressUpdatedAt}),
 'partial current point':f=>f.row.latitude=0,'missing null history id':f=>delete f.row.locationHistoryId,
 'duplicate native row':f=>f.snapshot.items.push({...f.row}),
};
for(const [label,change] of Object.entries(denials))test('ready action rejects '+label,async()=>{const f=fixture();change(f);assert.equal(await checkedOwnerCensusOnceBinding(f.snapshot,id),null);});
test('one explicit bound POST with fresh Owner checks and readback yields only unverified estimate',async()=>{
 const f=fixture(),before=structuredClone(f),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),a=adapter(f.snapshot);
 const result=await a.action.run(binding);assert.equal(result.outcome,'estimate');assert.match(result.message,/remain unverified/);
 const writes=a.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);
 assert.equal(writes[0].path,'/api/field-map/'+id+'/owner-census-once');
 const {nativeUnitId,...body}=binding;assert.deepEqual(writes[0].body,body);assert.equal(writes[0].options.signal.aborted,false);
 assert.deepEqual(a.calls.map(c=>c.path),['/api/session','/api/field-map','/api/session','/api/field-map/'+id+'/owner-census-once','/api/field-map']);
 await assert.rejects(a.action.run(binding),/already submitted/);assert.equal(a.calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(f,before);
});
test('draining and held states explain their pause without enabling an action or using a client timer',async()=>{
 for(const kind of ['draining','held']){
  const f=fixture();if(kind==='draining'){f.row.locationGeocode.censusOnlyState='draining';f.row.locationGeocode.censusOnlyNotBefore='2020-01-01T00:00:00Z';}
  else {f.row.locationGeocode.status='held';delete f.row.locationGeocode.censusOnlyGuard;}
  assert.equal(await checkedOwnerCensusOnceBinding(f.snapshot,id),null);
  assert.match(ownerCensusPolicyMessage(f.row),kind==='draining'?/waiting for earlier address work/:/on hold/);
 }
});
for(const role of ['IT','Service'])test(role+' cannot dispatch despite complete proof',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),calls=[];
 const a=adapter(f.snapshot,{get:async path=>{calls.push(path);return {data:path==='/api/session'?{...owner,role,legacyOwner:false}:f.snapshot};}});
 await assert.rejects(a.action.run(binding),/Owner session/);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);assert.deepEqual(calls,['/api/session']);
});
test('role changes after fresh map preflight cause zero POSTs',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id);let sessions=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?++sessions===1?owner:{...owner,role:'IT',legacyOwner:false}:f.snapshot})});
 await assert.rejects(a.action.run(binding),/Owner session changed/);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
});
test('duplicate clicks and changed selection during preflight cannot dispatch',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),pending=deferred();let current=true;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?owner:await pending.promise})});
 const first=a.action.run(binding,()=>current);await flush();await assert.rejects(a.action.run(binding),/already in progress/);
 current=false;pending.resolve(f.snapshot);await assert.rejects(first,/changed/);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
});
test('stale native guard or consumed fresh policy sends no POST',async()=>{
 for(const change of [s=>s.ownerCensusProofs[0].nativeGuardSha256='b'.repeat(64),s=>s.items[0].locationGeocode.censusOnlyState='consumed']){
  const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),fresh=structuredClone(f.snapshot);change(fresh);const a=adapter(fresh);
  await assert.rejects(a.action.run(binding),/allowance changed/);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
 }
});
test('timeout never replays POST and a consumed success is established from readback alone',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id);let posts=0;
 const a=adapter(f.snapshot,{post:async()=>{posts++;throw Error('Synthetic timeout');}});
 assert.equal((await a.action.run(binding)).outcome,'estimate');await assert.rejects(a.action.run(binding),/already submitted/);assert.equal(posts,1);
});
test('timeout plus still-ready readback remains uncertain and cannot resend in this view',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id);let posts=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?owner:f.snapshot}),post:async()=>{posts++;throw Error('Synthetic timeout');}});
 assert.equal((await a.action.run(binding)).outcome,'unconfirmed');await assert.rejects(a.action.run(binding),/already submitted/);assert.equal(posts,1);
});
for(const status of ['invalid_address','no_match','provider_error'])test('consumed '+status+' honestly stops without fallback or resend',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id);let reads=0;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?owner:reads++===0?f.snapshot:consumed(f.snapshot,status)})});
 assert.equal((await a.action.run(binding)).outcome,'no_match');assert.equal(a.calls.filter(c=>c.method==='POST').length,1);
});
test('newer verified GPS on readback wins over submitted estimate without GPS/history writes',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),fresh=consumed(f.snapshot);let reads=0;
 Object.assign(fresh.items[0],{latitude:32,longitude:-97,locationVerification:'owner_verified',gpsRecordedAt:'2026-10-11T00:00:00Z',locationVerifiedAt:'2026-10-11T00:00:00Z'});
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?owner:reads++===0?f.snapshot:fresh})});
 const result=await a.action.run(binding);assert.equal(result.outcome,'current_verified');assert.equal(result.snapshot.items[0].latitude,32);
 assert.equal(a.calls.filter(c=>c.method==='POST').length,1);assert.ok(a.calls.every(c=>!c.path.endsWith('/gps')));
});
test('session invalidation aborts in-flight POST and late response cannot publish a result',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),pending=deferred(),started=deferred();let signal;
 const a=adapter(f.snapshot,{post:async(p,b,o)=>{signal=o.signal;started.resolve();return pending.promise;}});
 const action=a.action.run(binding);await started.promise;assert.ok(signal);a.action.invalidate();assert.equal(signal.aborted,true);
 pending.resolve({data:{ok:true}});await assert.rejects(action,/earlier selection or session/);assert.equal(a.action.wasAttempted(binding),true);
});
test('selection invalidation during preflight survives a return to the original selection and sends zero POSTs',async()=>{
 const f=fixture(),binding=await checkedOwnerCensusOnceBinding(f.snapshot,id),pending=deferred();let current=true;
 const a=adapter(f.snapshot,{get:async path=>({data:path==='/api/session'?owner:await pending.promise})});
 // Exercise the actual FieldMap selection-effect wiring, not a hand-written invalidate call.
 const source=readFileSync(new URL('../src/FieldMap.tsx',import.meta.url),'utf8');
 const effect=/useEffect\(\(\)=>\{([^\n]*?)\},\[selectedId\]\);/.exec(source);assert.ok(effect,'FieldMap selection effect is present');
 const select=new Function('censusAction','censusPreparation','setCensusMessage','setPreparationMessage',effect[1]);
 const changed=()=>select({current:a.action},{current:{invalidate(){}}},()=>{},()=>{});
 const action=a.action.run(binding,()=>current);await flush();current=false;changed();current=true;changed();
 pending.resolve(f.snapshot);let failure;await action.catch(error=>{failure=error;});
 assert.equal(a.calls.filter(c=>c.method==='POST').length,0);assert.match(failure?.message||'',/no lookup was sent/);
});
