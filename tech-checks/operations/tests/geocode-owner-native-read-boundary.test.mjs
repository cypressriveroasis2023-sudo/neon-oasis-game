import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGeocodeSourcesHandler,COS_ORGANIZATION_ID as ORG} from '../../supabase/functions/cos-geocode-sources/index.ts';

// Synthetic identifiers only. Owner-only evidence is outside this bridge's
// registry-admitted imported-source scope, even when the response is a digest.
const KEY='a'.repeat(64);
const NATIVE='10000000-0000-4000-8000-000000000001';
const REVISION='20000000-0000-4000-8000-000000000001';
const guard={nativeUnitId:NATIVE,nativeGuardSha256:'b'.repeat(64)};
const binding={auditId:'101',unitKey:'SYNTHETIC OWNER 001',address:'123 Example Rd, Example, TX 77002',addressSha256:'c'.repeat(64),censusOnlyGuard:guard};
const importedIdentity={entityKind:'equipment_unit',nativeUnitId:NATIVE,productId:'1001',sourceRevision:REVISION};
const request=(value,headers={})=>new Request('https://native.example/functions/v1/cos-geocode-sources',{
 method:'POST',headers:{'content-type':'application/json','x-cos-geocode-source-key':KEY,...headers},body:JSON.stringify(value),
});

test('source key cannot request Owner-only native proof or arbitrary native RPC reads',async()=>{
 const calls=[];
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async(name,args)=>{calls.push({name,args});return {};}});
 for(const action of ['read_owner_native_proof','verify_owner_census_source','read_native_guard','cos_owner_identity_snapshot']){
  const response=await handler(request({action,...binding}));
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:'Source request unavailable.'});
 }
 assert.deepEqual(calls,[]);
});

test('Owner bindings cannot be smuggled through imported source read shapes',async()=>{
 const calls=[];
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async(name,args)=>{calls.push({name,args});return {source:null};}});
 for(const value of [
  {action:'read_current',nativeUnitId:NATIVE},
  {action:'read_current',...importedIdentity,...binding},
  {action:'read_current',...importedIdentity,censusOnly:true},
  {action:'read_current',...importedIdentity,censusOnlyGuard:guard},
  {action:'read_current',sources:[{...importedIdentity,...binding}]},
  {action:'read_current',sources:[{...importedIdentity,sourceSystem:'owner_placement'}]},
  {action:'list_changes',afterEventId:'0',limit:1,nativeUnitId:NATIVE},
 ])assert.equal((await handler(request(value))).status,400);
 assert.deepEqual(calls,[]);
});

test('an absent imported registry record stays null and cannot fall back to native proof',async()=>{
 const calls=[];
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async(name,args)=>{
  calls.push({name,args});
  return {source:null,ownerNativeProof:{...binding,allowed:true},nativeGuardSha256:guard.nativeGuardSha256};
 }});
 const response=await handler(request({action:'read_current',...importedIdentity}));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{source:null});
 assert.deepEqual(calls,[{name:'cos_geocode_sources_read_current',args:{p_organization_id:ORG,p_entity_kind:'equipment_unit',p_native_unit_id:NATIVE,p_product_id:'1001',p_source_revision:REVISION}}]);
});

test('an Owner bearer does not replace the dedicated source-key boundary',async()=>{
 let calls=0;
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>{calls++;return {};}});
 const response=await handler(request({action:'read_current',...importedIdentity},{'x-cos-geocode-source-key':'','authorization':'Bearer synthetic-owner-token'}));
 assert.equal(response.status,401);
 assert.equal(calls,0);
});
