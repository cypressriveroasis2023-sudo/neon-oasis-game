import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../db/mhelp-address-automation.sql',import.meta.url),'utf8');
const lookup=JSON.parse(await readFile(new URL('./fixtures/mhelp-address-cache-lookup.json',import.meta.url),'utf8'));
const source='a'.repeat(64),payload='b'.repeat(64);
export async function fixture({legacyCache=false,indexedCache=true,database}={}){
 const db=database||new PGlite();
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
 if(indexedCache&&!legacyCache){
  await db.exec(lookup.helper);
  const definition=(await db.query("select pg_get_functiondef('cos_mhelp_placement_private.address_automation_sync_v1()'::regprocedure) d")).rows[0].d;
  assert.equal(definition.split(lookup.old).length,2,'exact deployed query anchor');
  await db.exec(definition.replace(lookup.old,lookup.new));
 }
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
