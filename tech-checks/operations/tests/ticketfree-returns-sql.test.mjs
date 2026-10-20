import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const svc='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',it='33333333-3333-4333-8333-333333333333',it2='44444444-4444-4444-8444-444444444444',inactive='55555555-5555-4555-8555-555555555555';
const fields=['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'];
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table public.profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 insert into public.profiles values('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${it}','it',true,null,'Synthetic IT','it'),('${it2}','it',true,null,'Second IT','it2'),('${inactive}','it',false,null,'Inactive IT','inactive');
 create table public.equipment_master(equipment_key text primary key,unit_tag text not null,canonical_family text not null,workflow_type text,tracker_state text check(tracker_state in ('shop','field_or_unknown','retired')),tracker_public_ip text default '192.0.2.1',source_label text,updated_at timestamptz default now());
 create table public.unit_registry(unit_key text primary key,unit_tag text,equipment_type text,lifecycle_status text,current_holder_id uuid,current_holder_name text,current_site text,last_event text,updated_at timestamptz default now());
 create table public.service_truck_units(service_tech_id uuid,equipment_type text,unit_tag text,status text,last_used_ticket_no text,last_used_at timestamptz,old_unit_tag text,updated_at timestamptz default now(),primary key(service_tech_id,equipment_type));
 create table public.service_truck_restock_requests(id uuid primary key default gen_random_uuid(),service_tech_id uuid,service_tech_name text,item_kind text,item_type text,qty_needed integer,used_unit_tag text,old_unit_tag text,status text,reason text,updated_at timestamptz default now());
 create table public.service_truck_unit_history(id uuid primary key default gen_random_uuid(),service_tech_id uuid,equipment_type text,unit_tag text,event text,old_unit_tag text,actor_id uuid,actor_name text);
 create table public.service_truck_inventory_checks(service_tech_id uuid,check_date date,ready boolean,updated_at timestamptz default now());
 create table public.prep_tickets(id uuid primary key,status text,is_test boolean default false);
 create table public.prep_items(id uuid primary key,prep_ticket_id uuid,equipment_type text,unit_tag text);
 create table public.unit_returns(id uuid primary key,equipment_type text,unit_tag text,status text);
 create table public.app_notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid,kind text,title text,body text,unit_tag text);
 create table app_private.techcheck_transfers(id uuid primary key,state text,service_actor uuid);
 create table app_private.techcheck_transfer_reservations(equipment_key text primary key,transfer_id uuid);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));alter table storage.objects enable row level security;
 grant usage on schema auth,app_private,storage to authenticated;grant execute on function auth.uid() to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 `);
 const integration=readFileSync(new URL('../../database-maintenance/techcheck-transfer-integration-v3.sql',import.meta.url),'utf8');
 const start=integration.indexOf('create function app_private.techcheck_transfer_legacy_guard_v1()');
 const end=integration.indexOf('create function app_private.techcheck_transfer_legacy_ticket_guard_v1()',start);
 assert.ok(start>0&&end>start);await db.exec(integration.slice(start,end));
 await db.exec(readFileSync(new URL('../../database-maintenance/techcheck-ticketfree-returns-v1.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
async function as(actor,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[actor||'']);await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}}
const rpc=async(actor,name,args)=>as(actor,async()=>(await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args))).rows[0].result);
const send=(args,actor=svc)=>rpc(actor,'submit_techcheck_ticketfree_return_v1',args);
const receive=(args,actor=it)=>rpc(actor,'receive_techcheck_ticketfree_return_v1',args);
const context=actor=>rpc(actor,'techcheck_ticketfree_context_v1',{});
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
async function equipment({family='Sniper',state='field_or_unknown',tag=randomUUID().slice(0,8)}={}){const key=family.toLowerCase()+':'+tag;await db.query('insert into equipment_master(equipment_key,unit_tag,canonical_family,workflow_type,tracker_state,source_label) values($1,$2,$3,$3,$4,$5)',[key,tag,family,state,family+' '+tag]);return {key,tag,family};}
async function truckItem({actor=svc,family='Sniper'}={}){const e=await equipment({family,state:'shop'});await db.query("insert into service_truck_units(service_tech_id,equipment_type,unit_tag,status) values($1,$2,$3,'assigned') on conflict(service_tech_id,equipment_type) do update set unit_tag=excluded.unit_tag,status='assigned'",[actor,family,e.tag]);return e;}
const request=(returned,used=null)=>({p_request_id:randomUUID(),p_returned_key:returned.key,p_used_key:used?.key||null,p_notes:'Synthetic no-ticket return',p_photos:[]});
const intake=(id,disposition='ready')=>({p_request_id:randomUUID(),p_return_id:id,p_revision:1,p_received:true,p_disposition:disposition,p_checks:Object.fromEntries(fields.map(f=>[f,true])),p_notes:disposition==='repair'?'Damaged connector':'',p_photos:[]});

test('active roles are required and private records cannot be read directly',async()=>{
 await assert.rejects(context(null),/active/);await assert.rejects(context(inactive),/active/);
 await as(svc,()=>assert.rejects(db.query('select * from app_private.techcheck_ticketfree_returns_v1'),/permission denied/));
 await as(it,()=>assert.rejects(db.query("update app_private.techcheck_ticketfree_returns_v1 set state='checked_in'"),/permission denied/));
});
test('a no-ticket swap atomically records usage, a pending return, and notices for both IT techs',async()=>{
 const old=await equipment(),used=await truckItem(),r=request(old,used);const result=await send(r);
 assert.equal(result.state,'waiting_it');assert.equal((await scalar('select status,last_used_ticket_no from service_truck_units where service_tech_id=$1 and equipment_type=$2',[svc,used.family])).status,'used_restock_due');
 assert.equal((await scalar('select tracker_state from equipment_master where equipment_key=$1',[used.key])).tracker_state,'field_or_unknown');
 assert.equal((await scalar('select tracker_state from equipment_master where equipment_key=$1',[old.key])).tracker_state,'field_or_unknown');
 assert.equal((await scalar('select lifecycle_status from unit_registry where unit_key=$1',[old.key])).lifecycle_status,'returned_waiting_it');
 const notices=await db.query("select recipient_user_id from app_notifications where unit_tag=$1 and kind='returned_unit'",[old.tag]);assert.deepEqual(notices.rows.map(r=>r.recipient_user_id).sort(),[it,it2].sort());
 assert.ok((await context(svc)).returns.some(x=>x.id===r.p_request_id));assert.ok(!(await context(other)).returns.some(x=>x.id===r.p_request_id));
 const before=(await scalar('select count(*)::int n from app_private.techcheck_ticketfree_events_v1')).n;assert.equal((await send(r)).replayed,true);assert.equal((await scalar('select count(*)::int n from app_private.techcheck_ticketfree_events_v1')).n,before);
 await assert.rejects(send({...r,p_notes:'changed'}),/already used/);await assert.rejects(send(r,other),/already used/);await assert.rejects(send(request(old)),/already been sent/);
 await assert.rejects(send(request(await equipment()),it),/Only.*Service/);
 const receipt=intake(r.p_request_id);await assert.rejects(receive(receipt,svc),/IT must/);await assert.rejects(receive({...receipt,p_received:false}),/physical receipt/);
 await assert.rejects(receive({...receipt,p_checks:{}}),/all six/);await assert.rejects(receive({...receipt,p_checks:{...receipt.p_checks,batteries_ok:false}}),/All condition/);
 const complete=await receive(receipt);assert.equal(complete.state,'checked_in');assert.equal((await receive(receipt)).replayed,true);
 await assert.rejects(receive({...receipt,p_request_id:randomUUID()},it2),/already been checked/);
 assert.equal((await scalar('select lifecycle_status from unit_registry where unit_key=$1',[old.key])).lifecycle_status,'shop_inventory');
 assert.deepEqual(await scalar('select tracker_state,tracker_public_ip from equipment_master where equipment_key=$1',[old.key]),{tracker_state:'shop',tracker_public_ip:'192.0.2.1'});
 assert.equal((await scalar('select status from service_truck_restock_requests where used_unit_tag=$1',[used.tag])).status,'requested');
 assert.equal((await scalar('select count(*)::int n from unit_returns')).n,0);assert.equal((await scalar('select count(*)::int n from app_private.techcheck_transfers')).n,0);
});
test('unused truck returns remove that slot without installing the unit in the field',async()=>{
 const e=await truckItem({family:'Ranger'}),r=request(e);await send(r);
 assert.equal((await scalar('select source_mode from app_private.techcheck_ticketfree_returns_v1 where id=$1',[r.p_request_id])).source_mode,'truck_return');
 assert.equal((await scalar('select tracker_state from equipment_master where equipment_key=$1',[e.key])).tracker_state,'shop');
});
test('another technicians truck cannot be returned, and a stale replacement cannot be reused',async()=>{
 const e=await truckItem({actor:other,family:'Spotter'});await assert.rejects(send(request(e)),/another Service/);
 const old=await equipment(),used=await truckItem({family:'Solar Spotter'});await send(request(old,used));const next=await equipment();await assert.rejects(send(request(next,used)),/no longer assigned/);
 assert.equal((await scalar('select count(*)::int n from app_private.techcheck_ticketfree_returns_v1 where returned_key=$1',[next.key])).n,0);
});
test('failed intake routes to repair; existing maintenance and retirement cannot become Ready',async()=>{
 for(const hold of [null,'maintenance','retired']){
  const e=await equipment({state:hold==='retired'?'retired':'field_or_unknown'});
  if(hold==='maintenance')await db.query("insert into unit_registry(unit_key,equipment_type,unit_tag,lifecycle_status) values($1,$2,$3,'maintenance')",[e.key,e.family,e.tag]);
  const r=request(e);await send(r);const receipt=intake(r.p_request_id,'repair');receipt.p_checks.electronics_ok=false;
  await assert.rejects(receive({...receipt,p_notes:''}),/Describe/);
  if(hold)await assert.rejects(receive({...intake(r.p_request_id)}),/hold/);
  assert.equal((await receive(receipt)).state,'repair');
  assert.equal((await scalar('select lifecycle_status from unit_registry where unit_key=$1',[e.key])).lifecycle_status,hold==='retired'?'retired':'maintenance');
 }
});
test('family and suffix identities are not joined by number',async()=>{
 const tag='017HDC2-'+randomUUID().slice(0,4),a=await equipment({family:'Sniper',tag}),b=await equipment({family:'Ranger',tag});
 await send(request(a));assert.equal((await scalar('select tracker_state from equipment_master where equipment_key=$1',[b.key])).tracker_state,'field_or_unknown');
 assert.equal((await scalar('select count(*)::int n from unit_registry where unit_key=$1',[b.key])).n,0);await send(request(b));
});
test('older preparation, return and truck writers cannot bypass the pending-return hold',async()=>{
 const e=await equipment(),r=request(e);await send(r);
 await assert.rejects(db.query("insert into unit_returns values($1,$2,$3,'waiting_it')",[randomUUID(),e.family,e.tag]),/waiting for IT/);
 await assert.rejects(db.query('insert into prep_items values($1,null,$2,$3)',[randomUUID(),e.family,e.tag]),/waiting for IT/);
 await assert.rejects(db.query("update unit_registry set lifecycle_status='shop_inventory',current_holder_id=null where unit_key=$1",[e.key]),/waiting for IT/);
 await db.query("update unit_registry set current_site='Address corrected without a custody change' where unit_key=$1",[e.key]);
 assert.equal((await receive(intake(r.p_request_id))).state,'checked_in');
});
test('signed handoff reservations and existing legacy returns remain protected',async()=>{
 const e=await equipment(),id=randomUUID();await db.query("insert into app_private.techcheck_transfers values($1,'accepted',$2)",[id,svc]);await db.query('insert into app_private.techcheck_transfer_reservations values($1,$2)',[e.key,id]);
 await assert.rejects(send(request(e)),/signed handoff/);
 const e2=await equipment();await db.query("insert into unit_returns values($1,$2,$3,'needs_replacement')",[randomUUID(),e2.family,e2.tag]);await assert.rejects(send(request(e2)),/unresolved IT return/);
});
test('photo paths must be uploaded and owned by this request; other Service cannot read evidence',async()=>{
 const e=await equipment(),r=request(e),path=svc+'/'+r.p_request_id+'/'+'a'.repeat(64)+'.jpg';r.p_photos=[path];
 await assert.rejects(send(r),/Save each photo/);
 await as(other,()=>assert.rejects(db.query("insert into storage.objects values('techcheck-ticketfree-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":20}')",[path]),/row-level security/));
 await as(svc,()=>db.query("insert into storage.objects values('techcheck-ticketfree-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":20}')",[path]));await send(r);
 assert.equal((await as(it,()=>db.query('select * from storage.objects where name=$1',[path]))).rows.length,1);
 assert.equal((await as(other,()=>db.query('select * from storage.objects where name=$1',[path]))).rows.length,0);
 assert.equal((await as(svc,()=>db.query("update storage.objects set metadata='{}' where name=$1 returning *",[path]))).rows.length,0);
});
