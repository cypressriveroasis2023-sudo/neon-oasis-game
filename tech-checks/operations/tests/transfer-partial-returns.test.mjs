import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {transferDelivery} from '../../supabase/functions/service-daily-delivery/transfer-report.ts';
const it='00000000-0000-4000-8000-000000000001',svc='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
let db,contract,pg,admin,connection,database;
before(async()=>{
 if(process.env.COS_HANDOFF_TEST_DATABASE_URL){
  const url=new URL(process.env.COS_HANDOFF_TEST_DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_handoff_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Disposable loopback handoff database required.');
  pg=(await import('../legacy/tests/recon-ordering/node_modules/pg/lib/index.js')).default;connection=url.href;database=url.pathname.slice(1);url.pathname='/postgres';admin=new pg.Client({connectionString:url.href});await admin.connect();await admin.query('create database '+database);db=new pg.Client({connectionString:connection});await db.connect();const query=db.query.bind(db);db.query=(sql,values)=>query(sql,values?.map(v=>Array.isArray(v)?JSON.stringify(v):v));db.exec=sql=>db.query(sql);
 }else db=new PGlite();
 contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other');
 grant usage on schema auth,app_private,storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-delivery-v3.sql','techcheck-partial-returns-v4.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
});
after(async()=>{if(admin){await db?.end();await admin.query('drop database '+database);for(const role of ['anon','authenticated','service_role'])await admin.query('drop role '+role);await admin.end();}else await db?.close();});
async function as(who,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const sql=p=>`select public.submit_techcheck_transfer_v1(${Object.keys(p).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`;
const submit=(p,who=it)=>as(who,async()=>(await db.query(sql(p),Object.values(p))).rows[0].result);
const context=(who=it)=>as(who,async()=>(await db.query('select public.techcheck_transfer_context_v1() result')).rows[0].result);
async function evidence(p,who){p.p_photos=p.p_items.map((item,i)=>({equipment_key:item.equipment_key,kind:'unit',path:who+'/'+p.p_request_id+'/'+String(i).padStart(64,'0')+'.jpg'}));for(const photo of p.p_photos)await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[photo.path]);return p;}
async function accepted(){
 const id=randomUUID(),items=['Sniper','Ranger'].map((family,i)=>({equipment_key:family+':'+id,unit_tag:'00'+(i+1)+'-'+id.slice(0,5),family,sims:['0012345678901234567'+i],battery_count:2,parts:[{name:'SD card',quantity:1}]}));
 for(const item of items)await db.query("insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values($1,$2,$3,$3,$3,$4,'shop')",[item.equipment_key,item.unit_tag,item.family,item.family+' '+item.unit_tag]);
 const p=await evidence({p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:items,p_checks:Object.fromEntries(items.map(i=>[i.equipment_key,Object.fromEntries(contract.families[i.family].bool_fields.map(f=>[f,true]))])),p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[],p_notes:'Synthetic handoff'},it);await submit(p);
 const r=await evidence({...p,p_request_id:randomUUID(),p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true}},svc);await submit(r,svc);return p;
}
async function returned(p,items,revision=2,passed=true){return evidence({...p,p_request_id:randomUUID(),p_kind:'return',p_expected_revision:revision,p_items:items,p_checks:Object.fromEntries(items.map(i=>[i.equipment_key,Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(f=>[f,passed]))])),p_notes:passed?'Physically returned.':'Damage observed; repair required.'},it);}
test('partial return leaves other equipment assigned and all equipment held from fresh checkout',async()=>{
 const p=await accepted(),r=await returned(p,[p.p_items[0]]),result=await submit(r);assert.equal(result.state,'partial_return');assert.equal(result.revision,3);assert.deepEqual(result.remaining,[p.p_items[1]]);
 const t=(await context()).transfers.find(t=>t.id===p.p_transfer_id);assert.equal(t.returned_items.length,1);assert.deepEqual(t.remaining,[p.p_items[1]]);assert.equal(t.events.find(e=>e.id===r.p_request_id).delivery,'queued');
 const reservations=(await db.query('select * from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows;assert.equal(reservations.length,2);
 const retry=await submit(r);assert.equal(retry.replayed,true);assert.equal((await db.query('select * from app_private.techcheck_transfer_item_returns where transfer_id=$1',[p.p_transfer_id])).rows.length,1);
 const duplicate=await returned(p,[p.p_items[0]],3);await assert.rejects(submit(duplicate),/already been returned/);
 const stale=await returned(p,[p.p_items[1]],2);await assert.rejects(submit(stale),/changed/);
 const rest=await returned(p,[p.p_items[1]],3),finished=await submit(rest);assert.equal(finished.state,'returned_review');assert.equal(finished.remaining.length,0);assert.equal(finished.previous_returns[0].event_id,r.p_request_id);
 const outbox=(await db.query('select delivery_snapshot from app_private.techcheck_transfer_outbox where event_id=$1',[rest.p_request_id])).rows[0].delivery_snapshot;assert.equal(transferDelivery(outbox).events.at(-1).snapshot.previous_returns.length,1);
 assert.equal((await db.query('select * from app_private.techcheck_transfer_reservations where transfer_id=$1',[p.p_transfer_id])).rows.length,2);assert.equal((await db.query('select count(*)::int n from equipment_master where tracker_state<>$1',['shop'])).rows[0].n,0);
});
test('one damaged partial return keeps final handoff in repair hold and does not affect the other item result',async()=>{
 const p=await accepted();await submit(await returned(p,[p.p_items[0]],2,false));assert.equal((await submit(await returned(p,[p.p_items[1]],3))).state,'returned_repair');
 const rows=(await db.query('select passed from app_private.techcheck_transfer_item_returns where transfer_id=$1 order by passed',[p.p_transfer_id])).rows;assert.deepEqual(rows.map(r=>r.passed),[false,true]);
});
test('wrong identity, empty returns, Service actions and inactive IT cannot append a return',async()=>{
 const p=await accepted(),r=await returned(p,[p.p_items[0]]),wrong=structuredClone(r);wrong.p_items[0].sims=['999'];await assert.rejects(submit(wrong),/exact equipment/);
 await assert.rejects(submit({...r,p_items:[]}),/Select 1 to 20/);await assert.rejects(submit(r,svc),/not allowed/);await assert.rejects(submit(r,other),/not allowed/);
 await db.query('update profiles set active=false where user_id=$1',[it]);await assert.rejects(submit(r),/verified IT/);await db.query('update profiles set active=true where user_id=$1',[it]);
 assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_item_returns where transfer_id=$1',[p.p_transfer_id])).rows[0].n,0);
});
test('real concurrent returns from one revision serialize and one must reload',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const p=await accepted(),requests=[await returned(p,[p.p_items[0]]),await returned(p,[p.p_items[1]])],clients=await Promise.all(requests.map(async()=>{const c=new pg.Client({connectionString:connection});await c.connect();await c.query("select set_config('test.actor',$1,false)",[it]);await c.query('set role authenticated');return c;}));
 try{const results=await Promise.allSettled(clients.map((c,i)=>c.query(sql(requests[i]),Object.values(requests[i]).map(v=>Array.isArray(v)?JSON.stringify(v):v))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/changed/);assert.equal((await db.query('select revision from app_private.techcheck_transfers where id=$1',[p.p_transfer_id])).rows[0].revision,3);}finally{await Promise.all(clients.map(c=>c.end()));}
});
