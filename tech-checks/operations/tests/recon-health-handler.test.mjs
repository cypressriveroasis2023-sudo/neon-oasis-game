// Complete handler regression with synthetic sources and no network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';
const owner='e4abc521-1ef3-45a6-9829-b87faff78210',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
function fixture(scenario='ok'){
 const counters={snapshot:0,integration:0,pending:0,aborted:0},at=new Date().toISOString();
 const devices=Array.from({length:750},(_,i)=>({id:10000+i,source:'reconeyez',device_type:'Reconeyez detector',device_name:'Synthetic detector '+i,unit_key:'Synthetic area '+i,organization:'Synthetic field',activation_state:'active',source_status:i===0?'offline':'online',source_last_seen_at:at,device_serial:'synthetic:'+i,external_device_id:'synthetic-'+i}));
 const inventoryItems=Array.from({length:800},(_,i)=>({id:'a0000000-0000-4000-8000-'+String(i).padStart(12,'0'),unitNumber:'Synthetic Recon II '+i,modelName:'RECON II',readOnly:true,recordSource:'Synthetic tracker',snapshotImportedAt:at,sourceVerifiedAt:null,address:'Synthetic test address '.repeat(20)}));
 const optional=(signal,kind)=>{
  assert(signal instanceof AbortSignal);counters[kind]++;
  if(scenario==='failed')return response({message:'Synthetic source unavailable'},503);
  if(scenario==='malformed')return response(kind==='snapshot'?{inventoryItems:{invalid:true}}:[null]);
  if(scenario==='stalled'){counters.pending++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{counters.pending--;counters.aborted++;reject(new DOMException('Synthetic cancelled read','AbortError'));},{once:true}));}
  return response(kind==='snapshot'?{items:inventoryItems.slice(0,320),inventoryItems}:[]);
 };
 const handler=createOperationsHandler({platformUrl:'https://synthetic.invalid',serviceKey:'synthetic-only',fetch:async(url,init={})=>{
  const u=new URL(url),name=u.pathname.split('/').at(-1);
  if(u.pathname.includes('/auth/v1/user'))return response({id:owner});
  if(name==='profiles')return response([{user_id:owner,full_name:'Synthetic Owner',role:'owner',active:true,archived_at:null}]);
  if(name==='user_profiles')return response([{user_id:actor,display_name:'Synthetic Owner',department:'owner',active:true}]);
  if(name==='user_roles')return response([{roles:{code:'owner',organization_id:org}}]);
  if(name==='cos_owner_identity_snapshot')return response({revision:'a'.repeat(64),claims:[],nativeEpochs:[]});
  if(name==='appdeploy_field_map_snapshot')return optional(init.signal,'snapshot');
  if(name==='camera_integrations'&&u.searchParams.get('provider')==='eq.reconeyez'){assert.equal(u.searchParams.get('limit'),'2');return optional(init.signal,'integration');}
  if(name==='camera_devices')return response(devices);
  if(['equipment_units','vision_vigilant_unit_matches','vision_vigilant_devices','cos_fleet_placement_evidence_v1','camera_health_current','equipment_master','camera_integrations'].includes(name))return response([]);
  throw Error('Unexpected synthetic transport: '+name);
 }});
 return {counters,run:()=>handler(new Request('https://synthetic.invalid/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-local-test','Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path:'/api/camera-health/summary-v3',method:'GET',body:null})}))};
}
test('complete 800-row health handler makes one bounded optional snapshot read and retains 750 actual detector rows',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.status,200);const h=await r.json();assert.equal(h.rows.length,750);assert.equal(h.rows[0].evidence.status,'offline');assert.deepEqual(h.reconProviderUnitIdentities,[]);assert.equal(f.counters.snapshot,1);assert.equal(f.counters.integration,1);
});
test('failed or malformed optional Recon sources leave the existing complete health response available',async()=>{
 for(const scenario of ['failed','malformed']){const f=fixture(scenario),r=await f.run();assert.equal(r.status,200);const h=await r.json();assert.equal(h.rows.length,750);assert.equal(h.rows[0].evidence.status,'offline');assert.deepEqual(h.reconProviderUnitIdentities,[]);}
});
test('five-second optional Recon deadline cancels both pending reads with no orphan request',async()=>{
 const f=fixture('stalled'),started=performance.now(),r=await f.run();assert.equal(r.status,200);const h=await r.json();assert.equal(h.rows.length,750);assert.deepEqual(h.reconProviderUnitIdentities,[]);assert.equal(f.counters.pending,0);assert.equal(f.counters.aborted,2);assert(performance.now()-started<10000);
});
