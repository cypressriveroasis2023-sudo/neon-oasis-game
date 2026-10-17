import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {shopFixture} from './helpers/shop-attestation-fixture.mjs';
import {custodyFixture,IT,SERVICE,OWNER} from './helpers/custody-fixture.mjs';
import {createOperationsHandler} from '../../supabase/functions/cos-operations-pages/index.ts';

test('real native SQL through the actual bridge produces a proof consumed by PostgreSQL checkout and Owner release; post-issue revocation still denies',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const native=await shopFixture({real:false});let legacy;
 try{
  legacy=await custodyFixture();
  await legacy.db.exec("create schema extensions;create extension pgcrypto with schema extensions");await legacy.db.exec(await legacy.readMigration('techcheck-location-proof-v7.sql'));
  // Fixed synthetic bytes exercise the real HMAC consumer; no secret is generated
  // or sent to a provider, remote database, log, file, or production environment.
  const secret='12'.repeat(32);await legacy.db.query("insert into app_private.techcheck_location_keys_v7 values('v1',decode($1,'hex'),true)",[secret]);
  await legacy.db.exec("create function public.cos_verified_fleet_capabilities_v1() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('fleetRead',app_private.cos_verified_fleet_actor(auth.uid()))$$");
  let actor=IT;
  const calls=[];
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const handler=createOperationsHandler({platformUrl:'https://synthetic-native.invalid',serviceKey:'synthetic-only',handoffLocation:{getSecret:()=>secret},fetch:async(url,init={})=>{
   const name=new URL(url).pathname.split('/').at(-1);calls.push(name);
   if(name==='user')return json({id:actor});
   if(name==='profiles')return json((await legacy.db.query('select * from profiles where user_id=$1',[actor])).rows);
   if(name==='cos_verified_fleet_capabilities_v1')return json(await legacy.rpc(name,{},actor));
   if(name==='equipment_master')return json((await legacy.db.query("select equipment_key,unit_tag,canonical_family,tracker_state,to_char(updated_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') updated_at from equipment_master order by equipment_key")).rows);
   if(name==='camera_devices'||name==='cos_fleet_placement_evidence_v1')return json([]);
   if(name==='cos_techcheck_shop_attestation_v1'){
    try{return json(await native.attest(JSON.parse(init.body)));}catch{return json({message:'Current Shop placement could not be verified'},409);}
   }
   throw Error('Unexpected cross-project route '+name);
  }});
  const issue=async(p,purpose='checkout')=>{
   const response=await handler(new Request('https://synthetic-native.invalid/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:'Bearer synthetic-legacy-only','Content-Type':'application/json'},body:JSON.stringify({path:'/api/techcheck/location-proof',method:'POST',body:{request_id:p.p_request_id,purpose,items:p.p_items.map(({equipment_key,family,unit_tag})=>({equipment_key,family,unit_tag}))}})}));
   const proof=await response.json();assert.equal(response.status,200,JSON.stringify(proof));assert.equal(JSON.parse(proof.payload).actor_id,actor);return proof;
  };
  const p=await legacy.checkout();await native.addUnit({family:p.p_items[0].family,tag:p.p_items[0].unit_tag});
  const proof=await issue(p);assert.equal((await legacy.rpc('submit_techcheck_transfer_v7',{...p,p_location_proof:proof})).state,'awaiting_service');
  assert.equal((await legacy.rpc('submit_techcheck_transfer_v7',{...p,p_location_proof:null})).replayed,true);
  const received=await legacy.evidence({...p,p_request_id:randomUUID(),p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true}},SERVICE);await legacy.submit(received,SERVICE);
  const returned=await legacy.evidence({...p,p_request_id:randomUUID(),p_kind:'return',p_expected_revision:2,p_checks:{[p.p_items[0].equipment_key]:Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(k=>[k,true]))}});await legacy.submit(returned);
  actor=OWNER;const release={p_request_id:randomUUID(),p_transfer_id:p.p_transfer_id,p_equipment_key:p.p_items[0].equipment_key,p_return_event_id:returned.p_request_id,p_inventory_confirmed:true,p_notes:'Synthetic Owner reconciled exact Shop inventory.'};
  const releaseProof=await issue({...p,p_request_id:release.p_request_id},'inventory_release');
  assert.equal((await legacy.rpc('owner_release_techcheck_return_v7',{...release,p_location_proof:releaseProof},OWNER)).released,true);
  assert.equal((await legacy.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows[0].n,0);
  actor=IT;const revoked=await legacy.checkout();await native.addUnit({family:revoked.p_items[0].family,tag:revoked.p_items[0].unit_tag});const fresh=await issue(revoked);
  await legacy.db.query('update profiles set active=false where user_id=$1',[IT]);
  await assert.rejects(legacy.rpc('submit_techcheck_transfer_v7',{...revoked,p_location_proof:fresh}),/Verified IT/);
  assert.equal((await legacy.db.query('select count(*)::int n from app_private.techcheck_transfer_events where transfer_id=$1',[revoked.p_transfer_id])).rows[0].n,0);
  assert.equal(calls.some(name=>['appdeploy_field_map_snapshot','cos_mhelp_placement_snapshot','user_profiles','user_roles'].includes(name)),false);
 }finally{await legacy?.close();await native.close();}
});
