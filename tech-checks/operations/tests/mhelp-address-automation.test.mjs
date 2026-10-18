import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../db/mhelp-address-automation.sql',import.meta.url),'utf8');
const source='a'.repeat(64),payload='b'.repeat(64),nextSource='c'.repeat(64),nextPayload='d'.repeat(64);
const address={street:'123 Main Road',city:'Houston',state:'Tx',zip:'77002-1234'};
const rec=(id,placement='FIELD',a=address)=>({productId:String(id),unitNumber:'Synthetic '+id,category:'Other',customer:'Private customer must never leave database',placement,lifecycle:'UNFLAGGED',sourceAddress:a});
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema cos_mhelp_placement_private;create schema net;create schema app_private;
 create function app_private.appdeploy_assume_actor(uuid,uuid) returns void language sql as 'select';
 create function app_private.has_permission(uuid,text) returns boolean language sql as 'select true';
 create table public.equipment_units(id text,ip text,gps_latitude float8,gps_longitude float8);
 insert into public.equipment_units values('unchanged','192.0.2.1',30,-95);
 create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text,records jsonb,receipt jsonb);
 create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);
 create table cos_mhelp_placement_private.census_mhelp_address(source_sha256 text,address_sha256 text,street text,city text,state text,zip text,status text,reason text,request_id bigint,http_status integer,census_benchmark text,matches integer,matched_address text,latitude float8,longitude float8,requested_at timestamptz,completed_at timestamptz,primary key(source_sha256,address_sha256));
 create table cos_mhelp_placement_private.census_mhelp_product(source_sha256 text,payload_sha256 text,product_id text,source_row_sha256 text,unit_number text,placement text,address_sha256 text,observed_at timestamptz default clock_timestamp(),primary key(source_sha256,product_id));
 create sequence net.requests;
 create table net.sent(id bigint,url text,params jsonb,headers jsonb);
 create table net._http_response(id bigint,status_code integer,content text,timed_out boolean,error_msg text);
 create function net.http_get(url text,params jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare i bigint:=nextval('net.requests');begin insert into net.sent values(i,url,params,headers);return i;end$$;`);
 for(const name of ['cos_mhelp_address_resolutions_20261017.sql','20261018041534_cos_mhelp_public_site_reference.sql'])await db.exec(await readFile(new URL('../db/'+name,import.meta.url),'utf8'));
 await db.exec(sql);await db.exec(await readFile(new URL('../db/cos_mhelp_census_map_projection_20261017.sql',import.meta.url),'utf8'));
 const activate=async(records,s=source,p=payload)=>{
  await db.query('insert into cos_mhelp_placement_private.upload_batches values($1,$2,$3,$4)',[s,p,records,{recordCount:records.length}]);
  await db.query('insert into cos_mhelp_placement_private.upload_control values(true,$1) on conflict(singleton) do update set active_sha256=excluded.active_sha256',[s]);
 };
 const tick=async()=>(await db.query('select cos_mhelp_placement_private.address_automation_tick_v1() v')).rows[0].v;
 const read=async()=>(await db.query("select public.cos_mhelp_census_map_snapshot('11111111-1111-4111-8111-111111111111','ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5') v")).rows[0].v;
 const snapshot=async()=>(await db.query("select jsonb_build_object('source',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.upload_batches t),'native',(select jsonb_agg(to_jsonb(t)) from public.equipment_units t),'census',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.census_mhelp_address t),'products',(select jsonb_agg(to_jsonb(t)) from cos_mhelp_placement_private.census_mhelp_product t)) v")).rows[0].v;
 const respond=async(match={matchedAddress:'123 MAIN RD, HOUSTON, TX, 77002',addressComponents:{city:'HOUSTON',state:'TX',zip:'77002'},coordinates:{x:-95.4,y:29.7}})=>{
  await db.query('insert into net._http_response select id,200,$1,false,null from net.sent',[JSON.stringify({result:{addressMatches:match?[match]:[]}})]);
 };
 return {db,activate,tick,read,snapshot,respond};
}
test('accepted import queues unique Field addresses, publishes exact results and reuses unchanged sites across changed counts',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1),rec(2),rec(3,'SHOP',{...address,street:'999 Shop Road'})]);
  assert.equal((await f.tick()).sent,1);
  const sent=(await f.db.query('select * from net.sent')).rows;
  assert.deepEqual(sent[0].params,{street:'123 MAIN ROAD',city:'HOUSTON',state:'TX',zip:'77002',benchmark:'Public_AR_Current',format:'json'});
  assert.equal(JSON.stringify(sent).includes('Private customer'),false);assert.equal((await f.read()).items.length,2);
  const before=await f.snapshot();await f.respond();assert.equal((await f.tick()).settled,1);assert.deepEqual(await f.snapshot(),before,'source, native, Census and membership stay immutable');
  assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,2);
  await f.activate([rec(1),rec(2),rec(4),rec(3,'SHOP')],nextSource,nextPayload);
  assert.equal((await f.tick()).sent,0,'exact saved address reuses positive evidence');
  const after=await f.read();assert.equal(after.totalProducts,4);assert.equal(after.fieldProducts,3);assert.equal(after.shopProducts,1);assert.ok(after.items.every(i=>i.latitude===29.7&&i.verified===false));assert.equal((await f.tick()).sent,0);
  await f.db.exec("update cos_mhelp_placement_private.census_mhelp_product set source_row_sha256='f' where source_sha256='"+nextSource+"' and product_id='3'");
  await assert.rejects(f.read,/Full current mHelpDesk source/,'tampered Shop proof rejects projection');
 }finally{await f.db.close();}
});
test('wrong-city results remain unlocated and retry automatically; errors back off; incomplete addresses send nothing',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1),rec(2,'FIELD',{street:'Bridge',city:'San Antonio',state:'TX',zip:'78205'})]);await f.tick();
  await f.respond({matchedAddress:'123 MAIN RD, MATHIS, TX, 78368',addressComponents:{city:'MATHIS',state:'TX',zip:'78368'},coordinates:{x:-97.8,y:28}});await f.tick();
  let jobs=(await f.db.query('select * from cos_mhelp_placement_private.address_automation_job order by status')).rows;assert.deepEqual(jobs.map(j=>j.status),['invalid_address','no_match']);assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,0);assert.ok(jobs.every(j=>Date.parse(j.next_attempt_at)>Date.now()+6*86400000));
  await f.db.exec("update cos_mhelp_placement_private.address_automation_job set next_attempt_at=now()-interval '1 minute' where status='no_match'");assert.equal((await f.tick()).sent,1);
  await f.db.exec('truncate net._http_response;insert into net._http_response select max(id),503,null,false,null from net.sent');await f.tick();
  const job=(await f.db.query("select * from cos_mhelp_placement_private.address_automation_job where status='provider_error'")).rows[0];assert.equal(job.attempts,2);assert.ok(Date.parse(job.next_attempt_at)>Date.now()+5*60000);
 }finally{await f.db.close();}
});
test('superseded requests cannot publish; new Shop placement is excluded; one tick sends at most eight unique addresses',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1)]);await f.tick();await f.respond();
  await f.activate([rec(1,'SHOP'),...Array.from({length:10},(_,i)=>rec(10+i,'FIELD',{...address,street:(200+i)+' Other Road'}))],nextSource,nextPayload);
  const result=await f.tick();assert.equal(result.sent,8);assert.equal(result.settled,0);assert.equal((await f.read()).items.length,10);assert.ok((await f.read()).items.every(i=>i.productId!=='1'));assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.mhelp_address_resolution')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('incomplete owner-corrected address is reused only for the same exact Field Product-ID group',async()=>{
 const f=await fixture();try{
  const blank={street:'Lee Rd.',city:'Humble',state:'TX',zip:''};await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product limit 1`);
  await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)],nextSource,nextPayload);await f.tick();assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,2);
  await f.activate([rec(1,'FIELD',blank),rec(3,'FIELD',blank)],'e'.repeat(64),'f'.repeat(64));await f.tick();assert.equal((await f.read()).items.filter(i=>i.latitude!==null).length,0);
 }finally{await f.db.close();}
});
test('private worker tables and functions deny every browser/service role',async()=>{
 const f=await fixture();try{for(const role of ['anon','authenticated','service_role']){
  await f.db.exec('set role '+role);await assert.rejects(f.tick);await assert.rejects(f.db.query('select * from cos_mhelp_placement_private.address_automation_job'));await f.db.exec('reset role');
 }}finally{await f.db.close();}
});

test('numbered street with city/state can fill missing ZIP while preserving the original bytes',async()=>{
 const f=await fixture();try{
  await f.activate([rec(1,'FIELD',{...address,zip:''})]);assert.equal((await f.tick()).sent,1);const before=await f.snapshot();await f.respond();await f.tick();
  const item=(await f.read()).items[0];assert.equal(item.sourceAddress.zip,'');assert.equal(item.latitude,29.7);assert.equal(item.status,'address_review');assert.deepEqual(await f.snapshot(),before);
 }finally{await f.db.close();}
});
test('a later file with an owner-corrected full address reuses the reviewed reference',async()=>{
 const f=await fixture();try{
  const original={street:'Lee Rd.',city:'Humble',state:'TX',zip:''},corrected={street:'18538 Lee Rd.',city:'Humble',state:'TX',zip:'77032'};
  await f.activate([rec(1,'FIELD',original)]);await f.tick();
  await f.db.query(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),$1,$2 from cos_mhelp_placement_private.census_mhelp_product limit 1`,[{ownerCorrectedAddress:corrected},'e'.repeat(64)]);
  await f.activate([rec(2,'FIELD',corrected)],nextSource,nextPayload);assert.equal((await f.tick()).sent,0);assert.equal((await f.read()).items[0].latitude,29.9);
 }finally{await f.db.close();}
});
