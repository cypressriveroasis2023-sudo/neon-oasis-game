import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export const IT='00000000-0000-4000-8000-000000000001',SERVICE='00000000-0000-4000-8000-000000000002',OWNER='00000000-0000-4000-8000-000000000003',OTHER='00000000-0000-4000-8000-000000000004';
export async function custodyFixture({install=true}={}){
 let db,admin,pg,connection,database;
 if(process.env.COS_HANDOFF_TEST_DATABASE_URL){
  const url=new URL(process.env.COS_HANDOFF_TEST_DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_handoff_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Disposable loopback handoff database required.');
  pg=(await import('../../legacy/tests/recon-ordering/node_modules/pg/lib/index.js')).default;connection=url.href;database=url.pathname.slice(1);url.pathname='/postgres';admin=new pg.Client({connectionString:url.href});await admin.connect();await admin.query('create database '+database);db=new pg.Client({connectionString:connection});await db.connect();const query=db.query.bind(db);db.query=(sql,values)=>query(sql,values?.map(v=>Array.isArray(v)?JSON.stringify(v):v));db.exec=sql=>db.query(sql);
 }else db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_user_id and active and archived_at is null and (role='owner' or role='it' and user_id='${IT}'))$$;
 insert into profiles values('${IT}','it',true,null,'Synthetic IT','it'),('${SERVICE}','service',true,null,'Synthetic Service','service'),('${OWNER}','owner',true,null,'Synthetic Owner','owner'),('${OTHER}','it',true,null,'Unverified IT','other');
 create function public.normalize_unit_key(text) returns text language sql immutable as $$select lower(btrim($1))$$;
 create function public.actor_display_name() returns text language sql stable as $$select full_name from public.profiles where user_id=auth.uid()$$;
 create table unit_registry(unit_key text primary key,unit_tag text,equipment_type text,lifecycle_status text,current_holder_id uuid,current_holder_name text,current_site text,ticket_no text,prep_ticket_id uuid,prep_item_id uuid,last_event text,updated_at timestamptz);
 create table prep_tickets(id uuid primary key,status text,created_at timestamptz default now());
 create table prep_items(id uuid primary key,prep_ticket_id uuid,equipment_type text,unit_tag text);
 create table unit_returns(id uuid primary key,unit_tag text,equipment_type text,status text,mhelp_inventory_confirmed boolean);
 create table asset_inventory(unit_key text primary key,unit_tag text,asset_type text,asset_category text,availability_status text,assigned_to uuid,assigned_to_name text,notes text,last_event text,created_by uuid,created_by_name text,updated_at timestamptz);
 create table asset_inventory_history(id bigint generated always as identity,unit_key text,unit_tag text,action text,from_status text,to_status text,from_user_id uuid,from_user_name text,to_user_id uuid,to_user_name text,actor_id uuid,actor_name text,notes text);
 create table service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text);
 create table service_truck_restock_requests(id uuid primary key,replacement_unit_tag text,status text,old_unit_tag text,original_ticket_no text,service_tech_id uuid,updated_at timestamptz);
 create table service_solar_checks(id uuid);
 grant usage on schema auth,app_private,storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 set check_function_bodies=false;`);
 const definitions=JSON.parse(await readFile(new URL('../fixtures/custody-writers-20261017.json',import.meta.url),'utf8'));
 for(const row of definitions)await db.exec(row.definition);
 const readMigration=name=>readFile(new URL('../../../database-maintenance/'+name,import.meta.url),'utf8');
 // The archived definitions are source code only; all records in this database
 // are synthetic. Compiling the complete catalog verifies exact drift seals.
 if(install){
  for(const name of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-delivery-v3.sql','techcheck-partial-returns-v4.sql','techcheck-custody-writer-lock-order-v6.sql','techcheck-shared-custody-v6.sql'])await db.exec(await readMigration(name));
  await db.exec('set check_function_bodies=true;update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
 }
 const contract=JSON.parse(await readFile(new URL('../../../transfers/checklist-contract.json',import.meta.url),'utf8'));
 const sql=(name,p)=>`select public.${name}(${Object.keys(p).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`;
 async function as(who,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[who]);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
 const rpc=(name,p,who=IT)=>as(who,async()=>(await db.query(sql(name,p),Object.values(p))).rows[0].result);
 const submit=(p,who=IT)=>rpc('submit_techcheck_transfer_v1',p,who);
 async function evidence(p,who=IT){p.p_photos=p.p_items.map((i,n)=>({equipment_key:i.equipment_key,kind:'unit',path:who+'/'+p.p_request_id+'/'+String(n).padStart(64,'0')+'.jpg'}));for(const photo of p.p_photos)await db.query("insert into storage.objects values('techcheck-transfer-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":1234}')",[photo.path]);return p;}
 async function checkout(){const id=randomUUID(),item={equipment_key:'Sniper:'+id,unit_tag:id.slice(0,12),family:'Sniper',sims:['00123456789012345678'],battery_count:2,parts:[]};await db.query("insert into equipment_master(equipment_key,unit_tag,source_family,canonical_family,workflow_type,source_label,tracker_state) values($1,$2,'Sniper','Sniper','Sniper',$3,'shop')",[item.equipment_key,item.unit_tag,'Sniper '+item.unit_tag]);return evidence({p_request_id:id,p_transfer_id:id,p_kind:'checkout',p_expected_revision:0,p_service_actor:SERVICE,p_items:[item],p_checks:{[item.equipment_key]:Object.fromEntries(contract.families.Sniper.bool_fields.map(k=>[k,true]))},p_signature:{method:'typed',name:'Synthetic IT',confirmed:true},p_photos:[],p_notes:'Synthetic physical checkout.'});}
 async function returned(p,passed=true){await submit(p);await submit(await evidence({...p,p_request_id:randomUUID(),p_kind:'receipt',p_expected_revision:1,p_checks:{},p_signature:{method:'typed',name:'Synthetic Service',confirmed:true}},SERVICE),SERVICE);const r=await evidence({...p,p_request_id:randomUUID(),p_kind:'return',p_expected_revision:2,p_checks:{[p.p_items[0].equipment_key]:Object.fromEntries(['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'].map(k=>[k,passed]))},p_notes:passed?'Physically returned.':'Damage found; repair required.'});await submit(r);return r;}
 async function close(){if(admin){await db?.end();await admin.query('drop database '+database);for(const role of ['anon','authenticated','service_role'])await admin.query('drop role '+role);await admin.end();}else await db?.close();}
 return {db,pg,connection,definitions,readMigration,as,rpc,sql,submit,evidence,checkout,returned,close};
}
