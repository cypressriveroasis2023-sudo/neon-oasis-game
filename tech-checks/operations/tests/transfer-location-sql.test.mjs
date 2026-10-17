import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {custodyFixture,IT,SERVICE,OWNER} from './helpers/custody-fixture.mjs';
const enabled=Boolean(process.env.COS_HANDOFF_TEST_DATABASE_URL),secret='34'.repeat(32),native='00000000-0000-4000-8000-000000000011';let f;
before(async()=>{if(!enabled)return;f=await custodyFixture();await f.db.exec("create schema extensions;create extension pgcrypto with schema extensions");await f.db.exec(await f.readMigration('techcheck-location-proof-v7.sql'));});
after(async()=>{await f?.close();});
const run=(name,fn)=>test(name,{skip:!enabled},fn);
async function signed(p,actor=IT,purpose='checkout',overrides={}){
 const items=await Promise.all(p.p_items.map(async i=>{const e=(await f.db.query('select updated_at::text from equipment_master where equipment_key=$1',[i.equipment_key])).rows[0];return {equipment_key:i.equipment_key,family:i.family,unit_tag:i.unit_tag,legacy_updated_at:e.updated_at,native_id:native,tracker_id:native,authority_sha256:'a'.repeat(64),observed_at:new Date().toISOString()};}));
 const issued=Math.floor(Date.now()/1000),payload=JSON.stringify({version:7,key_id:'v1',organization_id:'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',actor_id:actor,request_id:p.p_request_id,purpose,issued_at:issued,expires_at:issued+30,items,...overrides});return {payload,signature:createHmac('sha256',Buffer.from(secret,'hex')).update(payload).digest('hex')};
}
run('missing approved location key holds readiness even when old operator flags are true',async()=>{
 assert.equal((await f.rpc('techcheck_transfer_readiness_v1',{})).ready,false);
 await f.db.query("insert into app_private.techcheck_location_keys_v7 values('v1',decode($1,'hex'),true)",[secret]);assert.equal((await f.rpc('techcheck_transfer_readiness_v1',{})).ready,true);
 await f.as(IT,async()=>{await assert.rejects(f.db.query('select secret from app_private.techcheck_location_keys_v7'),/permission denied/);});
});
run('old endpoint and unsigned, altered, expired, foreign-action or foreign-actor proofs cannot create events',async()=>{
 const p=await f.checkout();await assert.rejects(f.submit(p),/verify current Shop/);
 const good=await signed(p),expired=await signed(p,IT,'checkout',{issued_at:0,expires_at:30});
 for(const proof of [null,{...good,signature:'0'.repeat(64)},{...good,payload:good.payload.replace('Sniper','Ranger')},expired,await signed(p,SERVICE),await signed(p,IT,'inventory_release'),await signed(p,IT,'checkout',{request_id:randomUUID()})])await assert.rejects(f.rpc('submit_techcheck_transfer_v7',{...p,p_location_proof:proof}),/verification|Shop/);
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events where transfer_id=$1',[p.p_transfer_id])).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_location_receipts_v7')).rows[0].n,0);
});
run('exact current observation commits atomically with checkout and is archived; identical retries need no new proof',async()=>{
 const p=await f.checkout(),proof=await signed(p),args={...p,p_location_proof:proof};assert.equal((await f.rpc('submit_techcheck_transfer_v7',args)).state,'awaiting_service');assert.equal((await f.rpc('submit_techcheck_transfer_v7',{...args,p_location_proof:null})).replayed,true);assert.equal((await f.submit(p)).replayed,true);
 const archive=(await f.db.query('select delivery_snapshot from app_private.techcheck_transfer_outbox where event_id=$1',[p.p_request_id])).rows[0].delivery_snapshot;assert.equal(archive.location_verification.observation.request_id,p.p_request_id);
 await assert.rejects(f.rpc('submit_techcheck_transfer_v7',{...args,p_notes:'Changed after sign-off'}),/different details/);
 await assert.rejects(f.db.query("update app_private.techcheck_location_receipts_v7 set proof_sha256='changed' where request_id=$1",[p.p_request_id]),/immutable/);
});
run('legacy revision changes and new custody between observation and submission veto the entire write',async()=>{
 const p=await f.checkout(),proof=await signed(p);await f.db.query("update equipment_master set updated_at=updated_at+interval '1 second' where equipment_key=$1",[p.p_items[0].equipment_key]);await assert.rejects(f.rpc('submit_techcheck_transfer_v7',{...p,p_location_proof:proof}),/placement changed/);
 const q=await f.checkout(),fresh=await signed(q);await f.db.query("insert into service_truck_units values($1,'Sniper',$2,'assigned')",[SERVICE,q.p_items[0].unit_tag]);await assert.rejects(f.rpc('submit_techcheck_transfer_v7',{...q,p_location_proof:fresh}),/permanent truck/);
 for(const x of [p,q])assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_location_receipts_v7 where request_id=$1',[x.p_request_id])).rows[0].n,0);
});
run('Owner inventory release requires a new purpose-bound Shop observation and keeps exact retry identity',async()=>{
 const p=await f.checkout();await f.rpc('submit_techcheck_transfer_v7',{...p,p_location_proof:await signed(p)});
 const receipt=await f.evidence({...p,p_request_id:randomUUID(),p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true}},SERVICE);await f.submit(receipt,SERVICE);
 const r=await f.evidence({...p,p_request_id:randomUUID(),p_kind:'return',p_expected_revision:2,p_checks:{[p.p_items[0].equipment_key]:Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(k=>[k,true]))}});await f.submit(r);
 const id=randomUUID(),args={p_request_id:id,p_transfer_id:p.p_transfer_id,p_equipment_key:p.p_items[0].equipment_key,p_return_event_id:r.p_request_id,p_inventory_confirmed:true,p_notes:'Owner reconciled MHelpDesk Shop inventory and exact unit.',p_location_proof:null};
 await assert.rejects(f.rpc('owner_release_techcheck_return_v7',args,OWNER),/Shop verification/);
 args.p_location_proof=await signed({...p,p_request_id:id},OWNER,'inventory_release');assert.equal((await f.rpc('owner_release_techcheck_return_v7',args,OWNER)).released,true);assert.equal((await f.rpc('owner_release_techcheck_return_v7',{...args,p_location_proof:null},OWNER)).replayed,true);
 await f.as(OWNER,async()=>{await assert.rejects(f.db.query('select app_private.owner_release_techcheck_return_v6($1,$2,$3,$4,true,$5)',[id,p.p_transfer_id,p.p_items[0].equipment_key,r.p_request_id,args.p_notes]),/permission denied/);});
});
