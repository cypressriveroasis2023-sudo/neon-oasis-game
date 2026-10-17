import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {configuredIttechActor,verifiedItFleet,ITTECH_LEGACY_ID} from '../../supabase/functions/cos-operations-pages/fleetAccess.ts';
const native='00000000-0000-4000-8000-000000000099',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
function fixture({configured=native,active=true,archived=false,nativeActive=true,role='it',nativeDepartment='it',nativeRole='it_technician',nativeOrg=org,legacyName='Test IT',nativeName='Test IT'}={}){
 const calls=[],fetch=async(url,init={})=>{calls.push({url,body:init.body&&JSON.parse(init.body)});const name=new URL(url).pathname.split('/').at(-1);let data;
  if(name==='user')data={id:ITTECH_LEGACY_ID};
  else if(name==='profiles')data=[{user_id:ITTECH_LEGACY_ID,full_name:legacyName,role,active,archived_at:archived?'2026-10-01':null}];
  else if(name==='user_profiles')data=[{user_id:native,display_name:nativeName,department:nativeDepartment,active:nativeActive}];
  else if(name==='user_roles')data=nativeRole?[{role_id:'3c1728b2-ae72-4dea-a4f6-35dc1c019799',roles:{code:nativeRole,organization_id:nativeOrg}}]:[];
  else throw Error('Unexpected synthetic route '+name);
  return new Response(JSON.stringify(data));
 };
 const handler=createOperationsHandler({fetch,platformUrl:'https://native.invalid',serviceKey:'synthetic-only',ittechNativeActorId:configured});
 const run=path=>handler(new Request('https://native.invalid/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json',Origin:'https://cos-vision-integration-preview.pages.dev'},body:JSON.stringify({path,method:'GET',body:{}})}));return {calls,run};
}
test('explicit configured ITTECH native pair receives the ordinary IT session and no Owner workspaces',async()=>{
 const f=fixture(),response=await f.run('/api/session'),session=await response.json();assert.equal(response.status,200,JSON.stringify(session));assert.equal(session.role,'IT');assert.equal(session.legacyOwner,false);assert.equal(session.features.fleetAccess,true);assert.equal(session.features.fieldLocationVerification,false);
 const tech=await f.run('/api/tech/session');assert.equal((await tech.json()).productionTechnicianUserId,native);
 for(const path of ['/api/owner/jobs','/api/team','/api/quotes'])assert.equal((await f.run(path)).status,403);
});
for(const [name,options] of Object.entries({'missing approved native binding':{configured:null},'inactive legacy profile':{active:false},'archived legacy profile':{archived:true},'changed legacy role':{role:'service'},'changed legacy name':{legacyName:'Different account'},'inactive native profile':{nativeActive:false},'wrong native department':{nativeDepartment:'owner'},'Owner role cannot substitute for IT':{nativeRole:'owner'},'revoked IT role':{nativeRole:null},'foreign organization':{nativeOrg:native},'changed native name':{nativeName:'Different person'}}))test(name+' holds ITTECH access',async()=>{const f=fixture(options),response=await f.run('/api/session');assert.equal(response.status,403,await response.text());});
test('configuration cannot borrow any existing Owner or technician actor and never changes the two approved IT pairs',()=>{
 for(const value of [null,'invalid','3f073784-96e7-43d8-b9e0-33ab31c3c8b1','d0757b64-9623-4adc-afff-21cc7853e88a','3caf7c00-627f-445f-bce4-ddeae574ee5c','7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8','1a7d3523-8a3c-488a-9216-4e37f4f7ecb9'])assert.equal(configuredIttechActor(value),null);
 assert.equal(verifiedItFleet({legacyId:ITTECH_LEGACY_ID,actorId:native,department:'it',legacyOwner:false}),false);
 assert.equal(verifiedItFleet({legacyId:ITTECH_LEGACY_ID,actorId:native,department:'it',legacyOwner:false},native),true);
 assert.equal(verifiedItFleet({legacyId:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actorId:'d0757b64-9623-4adc-afff-21cc7853e88a',department:'it',legacyOwner:false}),true);
});
