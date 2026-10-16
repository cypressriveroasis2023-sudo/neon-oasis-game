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
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${unverified}','it',true,null,'Unverified IT','unknown');
 grant usage on schema auth,app_private,storage to authenticated;grant execute on function auth.uid() to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+name,import.meta.url),'utf8'));
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
test('readiness is account-bound and contains no handoff, team or equipment details',async()=>{
 const data=await as(it,async()=>(await db.query('select techcheck_transfer_readiness_v1() value')).rows[0].value);
 assert.equal(data.actor_id,it);assert.equal(data.ready,true);assert.equal(data.role,'it');
 assert.deepEqual(Object.keys(data).sort(),['actor_id','dependencies','enabled','ready','release','role','version']);
 await as(unverified,()=>assert.rejects(db.query('select techcheck_transfer_readiness_v1()'),/verified IT/));
 const service=await as(svc,async()=>(await db.query('select techcheck_transfer_readiness_v1() value')).rows[0].value);
 assert.equal(service.role,'service');assert.equal(service.actor_id,svc);
});
test('enabled alone cannot bypass unfinished report, daily-link and custody release gates',async()=>{
 const r=await request();await seed(r);
 for(const field of ['reports_ready','receipt_link_ready','custody_ready']){
  await db.exec('update app_private.techcheck_transfer_settings set '+field+'=false');
  try{
   assert.equal((await as(it,async()=>(await db.query('select techcheck_transfer_readiness_v1() value')).rows[0].value)).ready,false);
   await assert.rejects(context(it),/held for release/);await assert.rejects(submit(r),/held for release/);
   assert.equal(await as(it,async()=>(await db.query('select app_private.techcheck_transfer_file($1,true) value',[r.p_photos[0].path])).rows[0].value),false);
   await as(svc,()=>assert.rejects(db.exec('update app_private.techcheck_transfer_settings set '+field+'=true'),/permission denied/));
  }finally{await db.exec('update app_private.techcheck_transfer_settings set '+field+'=true');}
 }
});
test('readiness detects a missing read or submit endpoint without loading private records',async()=>{
 for(const name of ['techcheck_transfer_context_v1','submit_techcheck_transfer_v1']){
  const args=name==='techcheck_transfer_context_v1'?'':'uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text';
  await db.exec(`alter function public.${name}(${args}) rename to ${name}_not_deployed`);
  try{const value=await as(it,async()=>(await db.query('select techcheck_transfer_readiness_v1() value')).rows[0].value);assert.equal(value.ready,false);assert.equal(value.dependencies[name.startsWith('submit')?'submit':'read'],false);}
  finally{await db.exec(`alter function public.${name}_not_deployed(${args}) rename to ${name}`);}
 }
});
test('a public or incompatible evidence bucket holds all transfers',async()=>{
 await db.exec("update storage.buckets set public=true where id='techcheck-transfer-evidence'");
 try{assert.equal((await as(it,async()=>(await db.query('select techcheck_transfer_readiness_v1() value')).rows[0].value)).dependencies.privateEvidence,false);await assert.rejects(context(it),/held for release/);}
 finally{await db.exec("update storage.buckets set public=false where id='techcheck-transfer-evidence'");}
});

test('older direct core names cannot bypass the release wrapper',async()=>{
 await as(it,async()=>{
  await assert.rejects(db.query('select app_private.techcheck_transfer_context_core_v1()'),/permission denied/);
  await assert.rejects(db.query("select app_private.submit_techcheck_transfer_core_v1(null,null,null,null,null,null,null,null,null,'')"),/permission denied/);
  await assert.rejects(db.query('select app_private.techcheck_transfer_ready_v1()'),/permission denied/);
 });
});
test('release wrapper delegates an approved checkout unchanged and preserves retry identity',async()=>{
 const r=await request();await seed(r);const result=await submit(r);
 assert.equal(result.state,'awaiting_service');assert.equal(result.event_id,r.p_request_id);
 assert.equal((await submit(r)).replayed,true);
 assert.equal((await context(svc)).transfers.find(t=>t.id===r.p_transfer_id).service_actor,svc);
});
