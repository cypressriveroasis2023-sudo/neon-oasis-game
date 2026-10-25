import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../db/mhelp-address-automation.sql',import.meta.url),'utf8');
const source='a'.repeat(64),payload='b'.repeat(64),nextSource='c'.repeat(64),nextPayload='d'.repeat(64);
const address={street:'123 Main Road',city:'Houston',state:'Tx',zip:'77002-1234'};
const rec=(id,placement='FIELD',a=address)=>({productId:String(id),unitNumber:'Synthetic '+id,category:'Other',customerId:placement==='SHOP'?'11':'12',customer:'Private customer must never leave database',placement,lifecycle:'UNFLAGGED',sourceAddress:a});
async function fixture({legacyCache=false,optimized=true}={}){
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
 await db.exec(legacyCache?sql.replace("   if current_group is null or prior_group is null or not current_group <@ prior_group then continue;end if;\n   -- A returned-to-Shop product may leave a reviewed group. Every remaining\n   -- Field product must still have the same recorded customer/site context.\n   if exists(\n    select 1 from jsonb_array_elements(b.records) current_record\n    where current_record->>'productId'=any(current_group)\n     and not exists(\n      select 1 from cos_mhelp_placement_private.upload_batches prior_batch\n      cross join lateral jsonb_array_elements(prior_batch.records) prior_record\n      where prior_batch.source_sha256=cached.source_sha256\n       and prior_record->>'productId'=current_record->>'productId'\n       and prior_record->>'placement'='FIELD'\n       and coalesce(current_record->>'customerId','')<>''\n       and prior_record->>'customerId'=current_record->>'customerId'\n       and upper(trim(regexp_replace(prior_record->>'customer','[[:space:]]+',' ','g')))\n        =upper(trim(regexp_replace(current_record->>'customer','[[:space:]]+',' ','g')))\n     )\n   ) then continue;end if;",'   if prior_group is distinct from current_group then continue;end if;'):sql);await db.exec(await readFile(new URL('../db/cos_mhelp_census_map_projection_20261017.sql',import.meta.url),'utf8'));
 if(optimized&&!legacyCache)await db.exec(await readFile(new URL('../db/mhelp-address-history-lookup.sql',import.meta.url),'utf8'));
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
test('incomplete owner-corrected address never spreads to an unknown Field Product ID',async()=>{
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

test('reviewed incomplete-address references survive returns to Shop but reject changed customer/site context',async()=>{
 const f=await fixture();try{
  const blank={street:'Lee Rd.',city:'Humble',state:'TX',zip:''};await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product limit 1`);
  await f.activate([rec(1,'FIELD',blank),rec(2,'SHOP',blank)],nextSource,nextPayload);assert.equal((await f.tick()).sent,0);let output=await f.read();assert.equal(output.fieldProducts,1);assert.equal(output.shopProducts,1);assert.equal(output.items[0].latitude,29.9);
  for(const [i,change] of [[0,{customerId:'99'}],[1,{customer:'Changed private site label'}]]){
   await f.activate([{...rec(1,'FIELD',blank),...change},rec(2,'SHOP',blank)],String(7+i).repeat(64),String(5+i).repeat(64));await f.tick();assert.equal((await f.read()).items[0].latitude,null,'changed context cannot borrow the old point');
  }
 }finally{await f.db.close();}
});
test('upgrade of the installed cache function preserves all data and enables the guarded subset behavior',async()=>{
 const f=await fixture({legacyCache:true});try{
  const blank={street:'Lee Rd.',city:'Humble',state:'TX',zip:''};await f.activate([rec(1,'FIELD',blank),rec(2,'FIELD',blank)]);await f.tick();
  await f.db.exec(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','18538 Lee Rd, Humble, TX 77032','address_review','18538 Lee Rd, Houston, TX 77032',29.9,-95.3,now(),'{}','${'e'.repeat(64)}' from cos_mhelp_placement_private.census_mhelp_product limit 1`);
  const before=await f.snapshot();await f.db.exec(await readFile(new URL('../db/mhelp-address-cache-continuity.sql',import.meta.url),'utf8'));assert.deepEqual(await f.snapshot(),before,'function upgrade cannot rewrite source or native data');
  await f.activate([rec(1,'FIELD',blank),rec(2,'SHOP',blank)],nextSource,nextPayload);await f.tick();assert.equal((await f.read()).items[0].latitude,29.9);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);await assert.rejects(f.db.query('select cos_mhelp_placement_private.address_automation_sync_v1()'));await f.db.exec('reset role');
  }
 }finally{await f.db.close();}
});

test('history lookup preserves candidate precedence, duplicate corrected keys, and rollback semantics',async()=>{
 const selections=[];
 for(const optimized of [false,true]){
  const f=await fixture({optimized});try{
   await f.activate([rec(1)]);await f.tick();
   await f.db.exec(`update cos_mhelp_placement_private.census_mhelp_address set status='matched',census_benchmark='Public_AR_Current',matched_address='Census',latitude=31,longitude=-96,completed_at='2030-01-01';`);
   for(const [i,date,lat] of [[1,'2026-01-01',29.1],[2,'2026-02-01',29.2],[3,'2026-02-01',29.3]])await f.db.query(`insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256) select source_sha256,payload_sha256,address_sha256,'public_site_reference','Synthetic reviewed address','address_review','Synthetic reviewed address',$1,-95,$2,$3,$4 from cos_mhelp_placement_private.census_mhelp_product limit 1`,[lat,date,{ownerCorrectedAddress:address},String(i).repeat(64)]);
   await f.activate([rec(1)],nextSource,nextPayload);
   const before=await f.snapshot();await f.tick();const after=await f.snapshot();
   assert.deepEqual(after.source,before.source);assert.deepEqual(after.native,before.native);
   const chosen=(await f.db.query('select latitude,evidence from cos_mhelp_placement_private.mhelp_address_resolution where source_sha256=$1',[nextSource])).rows;
   assert.equal(chosen.length,1);assert.equal(chosen[0].latitude,29.3,'resolution priority, latest timestamp, then greatest ID win');selections.push(chosen);
   await f.activate([rec(1)],'9'.repeat(64),'8'.repeat(64));
   await f.db.exec(`create function cos_mhelp_placement_private.reject_completion() returns trigger language plpgsql as $$begin raise exception 'synthetic partial failure';end$$;create trigger reject_completion before insert on cos_mhelp_placement_private.address_automation_import for each row execute function cos_mhelp_placement_private.reject_completion();`);
   const protectedBefore=await f.snapshot();await assert.rejects(f.tick,/synthetic partial failure/);assert.deepEqual(await f.snapshot(),protectedBefore);
   assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.mhelp_address_resolution where source_sha256=$1',['9'.repeat(64)])).rows[0].n,0);
   await f.db.exec('drop trigger reject_completion on cos_mhelp_placement_private.address_automation_import');
   if(optimized){const saved=await f.snapshot();await f.db.exec(await readFile(new URL('../db/mhelp-address-history-lookup-rollback.sql',import.meta.url),'utf8'));assert.deepEqual(await f.snapshot(),saved);}
  }finally{await f.db.close();}
 }
 assert.deepEqual(selections[1],selections[0]);
});

test('history lookup completes a 1001-product import against 45 historical batches within the unchanged worker budget',async()=>{
 const f=await fixture();try{
  const records=Array.from({length:1001},(_,i)=>rec(i+1,i<284?'FIELD':'SHOP',{...address,street:(100+i%106)+' Synthetic Road'}));
  await f.db.exec(`insert into cos_mhelp_placement_private.upload_batches select lpad(to_hex(n),64,'0'),repeat('f',64),'[]'::jsonb,'{"recordCount":0}'::jsonb from generate_series(1,45)n;
   insert into cos_mhelp_placement_private.census_mhelp_address(source_sha256,address_sha256,street,city,state,zip,status,reason,matched_address,latitude,longitude,completed_at,census_benchmark)
   select b.source_sha256,encode(sha256(convert_to(parts::text,'UTF8')),'hex'),parts->>'street',parts->>'city',parts->>'state',parts->>'zip','matched','Synthetic prior evidence',parts->>'street',29.7,-95.4,'2026-01-01','Public_AR_Current'
   from cos_mhelp_placement_private.upload_batches b cross join generate_series(0,105)n cross join lateral (select cos_mhelp_placement_private.address_parts_v1(jsonb_build_object('street',(100+n)||' Synthetic Road','city','Houston','state','TX','zip','77002')) parts) normalized;
   insert into cos_mhelp_placement_private.mhelp_address_resolution(source_sha256,payload_sha256,address_sha256,provider,lookup_address,status,matched_address,latitude,longitude,geocoded_at,evidence,evidence_sha256)
   select a.source_sha256,b.payload_sha256,a.address_sha256,'public_site_reference',a.street,'address_review',a.street,a.latitude,a.longitude,a.completed_at,'{}'::jsonb,repeat('e',64) from cos_mhelp_placement_private.census_mhelp_address a join cos_mhelp_placement_private.upload_batches b using(source_sha256);`);
  await f.activate(records);
  await f.db.exec("set statement_timeout='25s'");
  const before=await f.snapshot(),start=performance.now();const result=await f.tick();const elapsed=performance.now()-start;
  assert.ok(elapsed<25000,'candidate must complete under the existing worker limit');
  assert.equal(result.sent,0,'positive historical evidence needs no new provider request');
  const after=await f.snapshot();assert.deepEqual(after.source,before.source);assert.deepEqual(after.native,before.native);
  assert.equal((await f.read()).totalProducts,1001);assert.equal((await f.read()).fieldProducts,284);assert.equal((await f.read()).shopProducts,717);
  assert.equal((await f.db.query('select count(*) n from cos_mhelp_placement_private.census_mhelp_product where source_sha256=$1',[source])).rows[0].n,1001);
  console.log(JSON.stringify({synthetic:true,historicalBatches:45,historicalAddresses:4770,historicalResolutions:4770,currentProducts:1001,elapsedMs:Math.round(elapsed),statementTimeoutMs:25000}));
 }finally{await f.db.close();}
});
