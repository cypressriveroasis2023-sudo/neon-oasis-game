import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
import {org,native,body,locationRead,secret} from './fixtures/handoff-proof-fixtures.mjs';
const actors={it:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',native:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper'},ittech:{id:'05bf20fe-19f7-4db7-ac05-5b2a5f681fdf',name:'Test IT'},owner:{id:'e4abc521-1ef3-45a6-9829-b87faff78210',native:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',name:'Synthetic Owner'},service:{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',native:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes'}};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture({role='ittech',revoked=false,missingKey=false,capability=true,denyNative=false,mutate,requestBody=body,path='/api/techcheck/location-proof',method='POST',direct=false,authorization='Bearer synthetic-legacy-only',authStatus=200}={}){
 const actor=actors[role],calls=[],state={auth:0,cap:0,native:0,active:true,archived:null,role:role==='ittech'?'it':role,capability,revoked},at=new Date(Date.now()-60000).toISOString();
 const transport=async(url,init={})=>{
  const u=new URL(url),name=u.pathname.split('/').at(-1),payload=init.body?JSON.parse(init.body):null;calls.push({name,url,method:init.method||'GET',payload});
  if(name==='user'){state.auth++;mutate?.(state,'auth');assert.equal(u.origin,'https://goqrnolcvqnirjmzaeyk.supabase.co');assert.equal(init.headers.Authorization,authorization);return json(authStatus===200?{id:actor.id}:{error:'Synthetic invalid, expired or foreign-project bearer'},authStatus);}
  if(name==='profiles')return json([{user_id:actor.id,full_name:actor.name,role:state.role,active:state.active,archived_at:state.archived}]);
  if(name==='user_profiles')return json([{user_id:actor.native,display_name:actor.name,department:role,active:true}]);
  if(name==='user_roles')return json(state.revoked?[]:[{role_id:native,roles:{code:role==='owner'?'owner':role+'_technician',organization_id:org}}]);
  if(name==='cos_verified_fleet_capabilities_v1'){state.cap++;mutate?.(state,'cap');assert.equal(init.headers.Authorization,'Bearer synthetic-legacy-only');assert.deepEqual(payload,{});return json({fleetRead:state.capability});}
  if(name==='equipment_master')return json([{equipment_key:'sniper:001',canonical_family:'Sniper',unit_tag:'001',tracker_state:'shop',updated_at:at}]);
  if(name==='camera_devices'||name==='cos_fleet_placement_evidence_v1'){assert.equal(init.headers.Authorization,'Bearer synthetic-legacy-only');return json([]);}
  if(name==='cos_techcheck_shop_attestation_v1'){
   state.native++;mutate?.(state,'native');assert.equal(init.headers.Authorization,'Bearer synthetic-native-server-only');
   assert.deepEqual(payload,{p_legacy_actor_id:actor.id,p_request_id:requestBody.request_id,p_purpose:requestBody.purpose,p_items:requestBody.items});
   if(denyNative)return json({message:'permission denied'},403);
   const r=locationRead({time:Date.now(),who:actor.id,requestBody}).attestation;r.items[0].observed_at=at;r.items[0].source_success_at=at;return json(r);
  }
  throw Error('Unexpected non-approved route '+name);
 };
 const handler=createOperationsHandler({platformUrl:'https://native.invalid',serviceKey:'synthetic-native-server-only',fetch:transport,mhelpPlacementEnabled:true,handoffLocation:{getSecret:()=>missingKey?undefined:secret}});
 const request=()=>new Request('https://native.invalid/functions/v1/cos-operations-pages'+(direct?path:''),{method:direct?method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json',Origin:'https://cos-vision-integration-preview.pages.dev'},...((direct&&method==='GET')?{}:{body:JSON.stringify(direct?requestBody:{path,method,body:requestBody})})});
 return {calls,state,actor,run:()=>handler(request())};
}
for(const role of ['ittech','it','owner'])test(role+' obtains an own-actor scoped proof with fresh legacy capability and no native actor borrowed',async()=>{
 const f=fixture({role}),r=await f.run(),proof=await r.json();assert.equal(r.status,200,JSON.stringify(proof));
 assert.equal(JSON.parse(proof.payload).actor_id,f.actor.id);assert.equal(f.state.native,2);assert.equal(f.state.cap,3);assert.equal(f.state.auth,4);
 assert.equal(f.calls.some(c=>['appdeploy_field_map_snapshot','cos_mhelp_placement_snapshot','cos_owner_identity_snapshot'].includes(c.name)),false);
 if(role==='ittech')assert.equal(f.calls.some(c=>['user_profiles','user_roles'].includes(c.name)),false);
 assert.equal(f.calls.some(c=>c.method!=='GET'&&!['cos_verified_fleet_capabilities_v1','cos_fleet_placement_evidence_v1','cos_techcheck_shop_attestation_v1'].includes(c.name)),false);
});
for(const [name,options,status] of [['Service',{role:'service'},403],['revoked linked native role',{role:'it',revoked:true},403],['unverified IT',{capability:false},403],['missing key',{missingKey:true},503],['native EXECUTE revoked',{denyNative:true},403]])test(name+' cannot obtain a proof',async()=>{
 const f=fixture(options),r=await f.run();assert.equal(r.status,status,JSON.stringify(await r.clone().json()));assert.equal((await r.json()).signature,undefined);
 if(!options.denyNative)assert.equal(f.state.native,0);
});
for(const step of [1,2,3])test('current legacy fleet capability revoked on check '+step+' stops signing',async()=>{
 const f=fixture({mutate:(s,event)=>{if(event==='cap'&&s.cap===step)s.capability=false;}}),r=await f.run();assert.equal(r.status,403);assert.equal((await r.json()).signature,undefined);assert.equal(f.state.native,step-1);
});
for(const [name,change] of Object.entries({inactive:s=>s.active=false,archived:s=>s.archived='2026-01-01Z',role:s=>s.role='service'}))test(name+' legacy actor before final signing is denied',async()=>{
 const f=fixture({mutate:(s,event)=>{if(event==='auth'&&s.auth===4)change(s);}}),r=await f.run();assert.equal(r.status,403);assert.equal((await r.json()).signature,undefined);
});
test('purpose and body scope remain exact; Owner release uses own legacy identity',async()=>{
 for(const requestBody of [{...body,actor_id:native},{...body,organization_id:org},{...body,purpose:'inventory_release'}]){
  const f=fixture({requestBody}),r=await f.run();assert.equal(r.status,403);assert.equal(f.state.native,0);
 }
 const f=fixture({role:'owner',requestBody:{...body,purpose:'inventory_release'}}),r=await f.run();assert.equal(r.status,200);assert.equal(JSON.parse((await r.json()).payload).purpose,'inventory_release');
});
test('direct transport is equivalent and GET cannot issue proofs',async()=>{
 assert.equal((await fixture({direct:true}).run()).status,200);const f=fixture({direct:true,method:'GET'});assert.equal((await f.run()).status,403);assert.equal(f.state.native,0);
});
test('unlinked ITTECH still cannot use native Fleet/map endpoints through this route change',async()=>{
 const f=fixture({path:'/api/field-map',method:'GET',requestBody:{}}),r=await f.run();assert.equal(r.status,403);assert.equal(f.state.native,0);
});
for(const authorization of ['', 'Basic synthetic-only', 'Bearer forged', 'Bearer expired', 'Bearer wrong-project'])test('unverified bearer '+(authorization||'missing')+' cannot reach native reads',async()=>{
 const f=fixture({authorization,authStatus:401}),r=await f.run();assert.equal(r.status,401);assert.equal(f.state.native,0);assert.equal(f.state.cap,0);
});
test('oversized request and query overrides are denied before native access',async()=>{
 const large=fixture({requestBody:{...body,notes:'x'.repeat(70000)}});assert.equal((await large.run()).status,413);assert.equal(large.state.native,0);
 const query=fixture({direct:true,path:'/api/techcheck/location-proof?actor_id=foreign'});assert.equal((await query.run()).status,400);assert.equal(query.state.native,0);
});
