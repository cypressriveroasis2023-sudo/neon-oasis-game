import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const it='00000000-0000-4000-8000-000000000001',svc='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',unverified='00000000-0000-4000-8000-000000000004';
let db,contract;
before(async()=>{
 db=new PGlite();contract=JSON.parse(await readFile(new URL('../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('test.jwt_role',true))$$;
 create table prep_tickets(id uuid primary key,status text,is_test boolean default false);
 create table prep_items(id uuid primary key,prep_ticket_id uuid,equipment_type text,unit_tag text);
 create table service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text);
 create table unit_returns(id uuid,equipment_type text,unit_tag text,status text,service_tech_id uuid);
 create table unit_registry(equipment_type text,unit_tag text,lifecycle_status text,current_holder_id uuid);
 create table app_private.service_daily_reports(id uuid,service_tech_id uuid,check_date date,submitted_at timestamptz default now(),snapshot jsonb);
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${unverified}','it',true,null,'Unverified IT','unknown');
 grant usage on schema auth,app_private,storage to authenticated;grant execute on function auth.uid() to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-integration-v3.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
});
after(async()=>db?.close());
async function as(who,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const submit=(r,who=it)=>as(who,async()=>(await db.query(`select public.submit_techcheck_transfer_v1(${Object.keys(r).map((k,n)=>k+'=> $'+(n+1)).join(',')}) as result`,Object.values(r))).rows[0].result);
const context=who=>as(who,async()=>(await db.query('select public.techcheck_transfer_context_v1() as result')).rows[0].result);
const total=async table=>(await db.query('select count(*)::int n from app_private.'+table)).rows[0].n;
async function request(){
 const id=randomUUID(),key='Sniper:'+id,tag='S-'+id.slice(0,8);
 await db.query("insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values($1,$2,'Sniper','Sniper','Sniper',$3,'shop')",[key,tag,'Sniper '+tag]);
 const checks=Object.fromEntries(contract.families.Sniper.bool_fields.map(field=>[field,true]));
 return {p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:svc,p_items:[{equipment_key:key,family:'Sniper',unit_tag:tag,sims:['00123456789012345670'],battery_count:2,parts:[{name:'SD card',quantity:1}]}],p_checks:{[key]:checks},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[{equipment_key:key,kind:'unit',path:it+'/'+id+'/'+'a'.repeat(64)+'.jpg'}],p_notes:'Synthetic only'};
}
async function seed(r){for(const p of r.p_photos)await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[p.path]);}

test('ITTECH uses the same account-bound release and workflow as verified IT',async()=>{
 const r=await request();await seed(r);const result=await submit(r);
 assert.equal(result.state,'awaiting_service');assert.equal(result.delivery,'queued');
 assert.equal((await submit(r)).replayed,true);
 assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_outbox where event_id=$1',[r.p_request_id])).rows[0].n,1);
 const view=await context(it);assert.equal(view.transfers.find(t=>t.id===r.p_transfer_id).events[0].delivery,'queued');
 await as(unverified,()=>assert.rejects(db.query('select techcheck_transfer_context_v1()'),/verified IT/));
});
test('legacy preparations, truck assignments, returns and registry custody block checkout',async()=>{
 for(const source of ['prep','truck','return','registry']){
  const r=await request();await seed(r);const item=r.p_items[0];
  if(source==='prep'){const id=randomUUID();await db.query("insert into prep_tickets values($1,'released',false)",[id]);await db.query('insert into prep_items values($1,$2,$3,$4)',[randomUUID(),id,item.family,item.unit_tag]);}
  if(source==='truck')await db.query("insert into service_truck_units values($1,$2,$3,'assigned')",[svc,item.family,item.unit_tag]);
  if(source==='return')await db.query("insert into unit_returns values($1,$2,$3,'waiting_it',$4)",[randomUUID(),item.family,item.unit_tag,svc]);
  if(source==='registry')await db.query("insert into unit_registry values($1,$2,'deployed',$3)",[item.family,item.unit_tag,svc]);
  await assert.rejects(submit(r),/Equipment unavailable/);
  assert.equal((await context(it)).equipment.find(e=>e.equipment_key===item.equipment_key).reserved,true);
 }
});
test('new reservations block legacy issue and status changes without conflating family tags',async()=>{
 const r=await request();await seed(r);const item=r.p_items[0];
 await db.query("insert into service_truck_units values($1,$2,$3,'unassigned')",[svc,item.family,item.unit_tag]);
 await submit(r);
 await assert.rejects(db.query("update service_truck_units set status='assigned' where unit_tag=$1",[item.unit_tag]),/unresolved named handoff/);
 const prep=randomUUID();await db.query("insert into prep_tickets values($1,'released',false)",[prep]);
 await assert.rejects(db.query('insert into prep_items values($1,$2,$3,$4)',[randomUUID(),prep,item.family,item.unit_tag]),/unresolved named handoff/);
 await db.query("insert into service_truck_units values($1,'Ranger',$2,'assigned')",[svc,item.unit_tag]);
});
test('independent Service receipt is linked to the signed daily snapshot; return stays review-held',async()=>{
 const r=await request();await seed(r);await submit(r);const id=randomUUID();
 const receipt={...r,p_request_id:id,p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true},p_photos:r.p_items.map(i=>({equipment_key:i.equipment_key,kind:'unit',path:svc+'/'+id+'/'+'b'.repeat(64)+'.jpg'}))};
 await seed(receipt);await assert.rejects(submit(receipt,it),/not allowed/);
 assert.equal((await submit(receipt,svc)).state,'accepted');
 await db.query("insert into app_private.service_daily_reports(id,service_tech_id,check_date,submitted_at,snapshot) values($1,$2,timezone('America/Chicago',now())::date,now()+interval '1 second','{}')",[randomUUID(),svc]);
 const daily=(await db.query('select snapshot from app_private.service_daily_reports where service_tech_id=$1',[svc])).rows[0].snapshot;
 assert.equal(daily.transfer_receipts.at(-1).event_id,id);assert.equal(daily.transfer_receipts.at(-1).revision,2);
 const returnId=randomUUID(),ret={...r,p_request_id:returnId,p_kind:'return',p_expected_revision:2,p_checks:Object.fromEntries(r.p_items.map(i=>[i.equipment_key,Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(f=>[f,true]))])),p_photos:r.p_items.map(i=>({equipment_key:i.equipment_key,kind:'unit',path:it+'/'+returnId+'/'+'c'.repeat(64)+'.jpg'}))};
 await seed(ret);assert.equal((await submit(ret)).state,'returned_review');
 assert.equal((await db.query('select count(*)::int n from app_private.techcheck_transfer_reservations where transfer_id=$1',[r.p_transfer_id])).rows[0].n,1);
});
test('server-only report queue requires a valid lease, verified actor and archive/email confirmation',async()=>{
 const r=await request();await seed(r);await submit(r);
 const queue=async args=>{await db.exec('reset role');await db.query("select set_config('test.jwt_role','service_role',false)");await db.exec('set role service_role');try{return(await db.query(`select techcheck_transfer_delivery_v1(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result;}finally{await db.exec('reset role');}};
 assert.equal(await queue({p_action:'claim',p_id:r.p_request_id,p_actor:other}),null);
 const claimed=await queue({p_action:'claim',p_id:r.p_request_id,p_actor:it});assert.equal(claimed.id,r.p_request_id);assert.equal(claimed.kind,'checkout');
 await assert.rejects(queue({p_action:'finish',p_id:r.p_request_id,p_lease:claimed.lease_token,p_data:{status:'sent'}}),/confirmation required/);
 await queue({p_action:'checkpoint',p_id:r.p_request_id,p_lease:claimed.lease_token,p_data:{drive_manifest:{complete:true},email_state:'sent',email_id:'provider-message'}});
 await queue({p_action:'finish',p_id:r.p_request_id,p_lease:claimed.lease_token,p_data:{status:'sent'}});
 assert.equal(await queue({p_action:'claim',p_id:r.p_request_id,p_actor:it}),null);
 await as(it,()=>assert.rejects(db.query("select techcheck_transfer_delivery_v1('claim')"),/permission denied/));
});
