import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',unit='00000000-0000-4000-8000-000000000011',tracker='00000000-0000-4000-8000-000000000012';
const actors={it:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',native:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper'},owner:{id:'e4abc521-1ef3-45a6-9829-b87faff78210',native:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',name:'Synthetic Owner'},service:{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',native:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes'}};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function fixture({role='it',revoked=false,field=false,missingKey=false}={}){
 const actor=actors[role],at=new Date(Date.now()-60000).toISOString(),calls=[];
 const native={id:unit,unitNumber:'Sniper 001',readOnly:false,placement:'SHOP',currentLocationType:'shop',status:'shop',hasUnitGps:false,...(field?{installedSiteId:tracker}:{}),_sourceField:false};
 const transport=async(url,init={})=>{
  const name=new URL(url).pathname.split('/').at(-1);calls.push(name);
  if(name==='user')return json({id:actor.id});
  if(name==='profiles')return json([{user_id:actor.id,full_name:actor.name,role,active:true,archived_at:null}]);
  if(name==='user_profiles')return json([{user_id:actor.native,display_name:actor.name,department:role,active:true}]);
  if(name==='user_roles')return json(revoked?[]:[{role_id:unit,roles:{code:role==='owner'?'owner':role+'_technician',organization_id:org}}]);
  if(name==='cos_owner_identity_snapshot')return json({revision:'a'.repeat(64),claims:[],nativeEpochs:[]});
  if(name==='appdeploy_field_map_snapshot')return json({items:[],inventoryItems:[native],summary:{fieldUnits:0},generatedAt:at});
  if(name==='equipment_units')return json([{id:unit,organization_id:org,unit_number:'Sniper 001',status:'shop'}]);
  if(name==='equipment_master')return json([{equipment_key:'sniper:001',canonical_family:'Sniper',unit_tag:'001',tracker_state:'shop',updated_at:at}]);
  if(name==='cos_mhelp_placement_snapshot')return json({contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:at,items:[{trackerId:tracker,nativeUnitId:unit,trackerLabel:'Sniper 001',nativeLabel:'Sniper 001',state:'confirmed',guardCurrent:true,placement:'SHOP',customerLabel:'Shop',siteLabel:'Shop',observedAt:at,locationReview:false,assignmentChanged:false}]});
  if(name==='cos_mhelp_location_snapshot')return json({contract:'COS_MHELP_FLEET_LOCATIONS_V1',items:[]});
  if(['camera_devices','vision_vigilant_unit_matches','vision_vigilant_devices','cos_fleet_placement_evidence_v1','cos_geocode_sources_map_projection','cos_archived_representation_projection','cos_source_recorded_coordinates_read_many'].includes(name))return json([]);
  throw Error('Unexpected non-approved route '+name);
 };
 const handler=createOperationsHandler({platformUrl:'https://native.invalid',serviceKey:'synthetic-only',fetch:transport,mhelpPlacementEnabled:true,handoffLocation:{getSecret:()=>missingKey?undefined:'12'.repeat(32)}});
 const request=new Request('https://native.invalid/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-only','Content-Type':'application/json',Origin:'https://cos-vision-integration-preview.pages.dev'},body:JSON.stringify({path:'/api/techcheck/location-proof',method:'POST',body:{request_id:unit,purpose:'checkout',items:[{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001'}]}})});
 return {calls,run:()=>handler(request),actor};
}
for(const role of ['it','owner'])test(role+' receives a bound proof through the complete authenticated current map pipeline',async()=>{
 const f=fixture({role}),r=await f.run(),body=await r.json();assert.equal(r.status,200,JSON.stringify({body,calls:f.calls}));assert.equal(JSON.parse(body.payload).actor_id,f.actor.id);assert.match(body.signature,/^[a-f0-9]{64}$/);assert.equal(f.calls.filter(n=>n==='appdeploy_field_map_snapshot').length,4);assert.equal(f.calls.filter(n=>n==='user').length,3);
});
for(const [name,options,status] of [['Service',{role:'service'},403],['revoked IT',{revoked:true},403],['missing secret',{missingKey:true},503],['native installed-site conflict',{field:true},409]])test(name+' cannot obtain a Shop proof',async()=>{
 const f=fixture(options),r=await f.run(),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));assert.equal(body.signature,undefined);if(status===403||options.missingKey)assert.equal(f.calls.includes('appdeploy_field_map_snapshot'),false);
});
