import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
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

const gate="select pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6))";
const hold='update app_private.techcheck_transfer_settings set enabled=false,reports_ready=false,receipt_link_ready=false,custody_ready=false where singleton';
const resume='update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true where singleton';
async function waitFor(pid,event){
 for(let n=0;n<200;n++){const row=(await f.db.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[pid])).rows[0];if(row?.wait_event_type==='Lock'&&row.wait_event===event)return;await setTimeout(10);}
 assert.fail('Expected independent PostgreSQL client to wait on '+event);
}
async function actorClient(actor=IT){const client=new f.pg.Client({connectionString:f.connection});await client.connect();await client.query("select set_config('test.actor',$1,false)",[actor]);await client.query('set role authenticated');return client;}
const values=args=>Object.values(args).map(x=>Array.isArray(x)?JSON.stringify(x):x);
run('the documented shared-gate hold drains an admitted checkout before all four flags commit false',async()=>{
 const p=await f.checkout(),args={...p,p_location_proof:await signed(p)};
 const row=new f.pg.Client({connectionString:f.connection}),operator=new f.pg.Client({connectionString:f.connection}),caller=await actorClient();await row.connect();await operator.connect();
 try{
  await row.query('begin');await row.query('select 1 from equipment_master where equipment_key=$1 for update',[p.p_items[0].equipment_key]);
  const pid=(await caller.query('select pg_backend_pid() pid')).rows[0].pid;
  const checkout=caller.query(f.sql('submit_techcheck_transfer_v7',args),values(args));await waitFor(pid,'transactionid');
  await operator.query('begin');const holdPid=(await operator.query('select pg_backend_pid() pid')).rows[0].pid;
  const draining=operator.query(gate);await waitFor(holdPid,'advisory');
  assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_events where id=$1',[p.p_request_id])).rows[0].n,0);
  await row.query('commit');assert.equal((await checkout).rows[0].result.state,'awaiting_service');
  await draining;await operator.query(hold);await operator.query('commit');
  await assert.rejects(f.rpc('submit_techcheck_transfer_v7',args),/held for release review/);
  assert.deepEqual((await f.db.query('select enabled,reports_ready,receipt_link_ready,custody_ready from app_private.techcheck_transfer_settings')).rows[0],{enabled:false,reports_ready:false,receipt_link_ready:false,custody_ready:false});
 }finally{await row.query('rollback').catch(()=>{});await operator.query('rollback').catch(()=>{});await Promise.all([row.end(),operator.end(),caller.end()]);await f.db.exec(resume);}
});
run('v7 checkout and Owner release already waiting behind the complete hold reject without receipts or custody loss',async()=>{
 async function behindHold(name,args,actor=IT){
  const operator=new f.pg.Client({connectionString:f.connection}),caller=await actorClient(actor);await operator.connect();
  try{
   await operator.query('begin');await operator.query(gate);await operator.query(hold);
   const pid=(await caller.query('select pg_backend_pid() pid')).rows[0].pid;
   const pending=caller.query(f.sql(name,args),values(args)).then(value=>({value}),error=>({error}));await waitFor(pid,'advisory');
   await operator.query('commit');assert.match((await pending).error?.message||'',/held for release review/);
   for(const [table,key] of [['techcheck_location_receipts_v7','request_id'],['techcheck_transfer_events','id']])assert.equal((await f.db.query(`select count(*)::int n from app_private.${table} where ${key}=$1`,[args.p_request_id])).rows[0].n,0);
  }finally{await operator.query('rollback').catch(()=>{});await Promise.all([operator.end(),caller.end()]);await f.db.exec(resume);}
 }
 const p=await f.checkout();await behindHold('submit_techcheck_transfer_v7',{...p,p_location_proof:await signed(p)});
 await f.rpc('submit_techcheck_transfer_v7',{...p,p_location_proof:await signed(p)});
 const receipt=await f.evidence({...p,p_request_id:randomUUID(),p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true}},SERVICE);await f.submit(receipt,SERVICE);
 const returned=await f.evidence({...p,p_request_id:randomUUID(),p_kind:'return',p_expected_revision:2,p_checks:{[p.p_items[0].equipment_key]:Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(k=>[k,true]))}});await f.submit(returned);
 const id=randomUUID();await behindHold('owner_release_techcheck_return_v7',{p_request_id:id,p_transfer_id:p.p_transfer_id,p_equipment_key:p.p_items[0].equipment_key,p_return_event_id:returned.p_request_id,p_inventory_confirmed:true,p_notes:'Synthetic reviewed Shop inventory.',p_location_proof:await signed({...p,p_request_id:id},OWNER,'inventory_release')},OWNER);
 assert.equal((await f.db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows[0].n,1);
});
