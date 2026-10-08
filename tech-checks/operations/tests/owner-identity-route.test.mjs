import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {fixture,key} from './owner-identity-fixtures.mjs';
import {unitId} from './native-placement-alias-fixtures.mjs';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const users={owner:{id:owner,actor,role:'owner',name:'Owner',code:'owner'},it:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',role:'it',name:'Teddy Hopper',code:'it_technician'},service:{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',role:'service',name:'Abel Cervantes',code:'service_technician'}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const req=(path,method='GET',body=null)=>new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-owner','Content-Type':'application/json'},body:JSON.stringify({path,method,body})});
async function setup(role='owner'){
 const f=await fixture(),user=users[role],calls=[];f.sources.ownerCrosswalk.claims=[];
 const handler=createOperationsHandler({platformUrl:'https://platform.example',serviceKey:'synthetic-service-key',fetch:async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
  if(url.includes('/auth/v1/user'))return json({id:user.id});
  if(url.includes('/profiles?'))return json([{user_id:user.id,full_name:user.name,role:user.role,active:true,archived_at:null}]);
  if(url.includes('/user_profiles?'))return json([{user_id:user.actor,display_name:user.name,department:user.role,active:true}]);
  if(url.includes('/user_roles?'))return json([{roles:{code:user.code,organization_id:org}}]);
  if(url.endsWith('/cos_owner_identity_snapshot'))return json(f.sources.ownerCrosswalk);
  if(url.endsWith('/cos_camera_identity_epochs_v1'))return json(f.sources.ownerEpochs.filter(e=>body.p_unit_keys.includes(e.unitKey)));
  if(url.includes('/camera_devices?'))return json(f.sources.devices);
  if(url.includes('/equipment_units?'))return json(f.sources.units);
  if(url.includes('/vision_vigilant_unit_matches?'))return json([]);
  if(url.includes('/vision_vigilant_devices?'))return json([]);
  if(url.endsWith('/cos_fleet_placement_evidence_v1'))return json([]);
  if(url.endsWith('/cos_owner_identity_confirm')){
   assert.equal(body.p_actor_user_id,actor);assert.equal(body.p_organization_id,org);assert.equal(body.p_claim.provenance,'owner_confirmation');assert.equal(body.p_claim.physicalResources[0].serial,'synthetic-serial-9101');
   f.sources.ownerCrosswalk.claims=[f.claim];f.sources.ownerCrosswalk.revision='c'.repeat(64);return json({claimId:f.claim.id,revision:'1'});
  }
  if(url.endsWith('/cos_owner_identity_revoke')){f.claim.status='revoked';f.claim.revision='2';f.sources.ownerCrosswalk.revision='d'.repeat(64);return json({claimId:f.claim.id,revision:'2'});}
  throw Error('Unhandled synthetic route '+url);
 }});return {f,handler,calls};
}
for(const role of ['it','service'])for(const method of ['GET','POST'])test(role+' cannot access Owner identity '+method+' route',async()=>{
 const {handler,calls}=await setup(role);const response=await handler(req('/api/owner-identity/'+(method==='GET'?'review':'confirm'),method,{}));assert.equal(response.status,403);assert.equal(calls.some(c=>/cos_owner_identity|camera_devices|equipment_units/.test(c.url)),false);
});
test('Owner review exposes bounded exact choices; confirmation builds evidence server-side and independently re-reads',async()=>{
 const {handler,calls,f}=await setup();let response=await handler(req('/api/owner-identity/review'));let result=await response.json();assert.equal(response.status,200);assert.equal(result.nativeUnits.length,1);assert.deepEqual(result.rawKeys,[key]);assert.equal(JSON.stringify(result).includes('serial'),false);
 response=await handler(req('/api/owner-identity/preview','POST',{unitId,unitKey:key}));const preview=await response.json();assert.equal(response.status,200,JSON.stringify(preview));assert.equal(preview.provenance,'owner_confirmation');assert.equal(preview.physicalDigest,undefined);
 const before=calls.length;response=await handler(req('/api/owner-identity/confirm','POST',{unitId,unitKey:key,reviewToken:preview.reviewToken,requestId:'99999999-9999-4999-8999-999999999999',confirmationText:'Verified physical equipment.'}));result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.claimId,f.claim.id);
 const after=calls.slice(before);assert.equal(after.filter(c=>c.url.endsWith('/cos_owner_identity_confirm')).length,1);assert.ok(after.filter(c=>c.url.endsWith('/cos_camera_identity_epochs_v1')).length>=4);assert.equal(after.some(c=>/\/rpc\/(owner_set_camera|[^/]*gps|[^/]*probe)|\/camera_health_current\?/.test(c.url)),false);
 response=await handler(req('/api/owner-identity/revoke','POST',{claimId:f.claim.id,expectedRevision:'1',requestId:'77777777-7777-4777-8777-777777777777',reason:'Replacement resource detected.'}));assert.equal(response.status,200);assert.equal(f.claim.status,'revoked');
});
test('Owner cannot submit a fabricated provider proof or browser-selected actor',async()=>{
 const {handler,calls}=await setup();const response=await handler(req('/api/owner-identity/confirm','POST',{unitId,unitKey:key,actorId:actor,provenance:'native_provider'}));assert.equal(response.status,400);assert.equal(calls.some(c=>c.url.endsWith('/cos_owner_identity_confirm')),false);
});
test('unknown suffix-compatible route cannot reach identity mutations',async()=>{
 const {handler,calls}=await setup();const response=await handler(req('/api/owner-identity/anything/confirm','POST',{unitId,unitKey:key}));assert.equal(response.status,404);assert.equal(calls.some(c=>c.url.endsWith('/cos_owner_identity_confirm')),false);
});
