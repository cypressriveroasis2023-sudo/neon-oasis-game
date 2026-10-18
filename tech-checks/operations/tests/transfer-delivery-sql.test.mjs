import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {deliveryFixture,transferIds} from './helpers/transfer-delivery-fixture.mjs';
import {transferDelivery} from '../../supabase/functions/service-daily-delivery/transfer-report.ts';
const it=transferIds.it,svc=transferIds.service,other='00000000-0000-4000-8000-000000000003',unknown='00000000-0000-4000-8000-000000000004';
let db,admin,pg,connection,database;
before(async()=>{
 if(process.env.COS_HANDOFF_TEST_DATABASE_URL){
  const url=new URL(process.env.COS_HANDOFF_TEST_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_handoff_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Use only a disposable loopback cos_handoff_test_* database.');
  pg=(await import('../legacy/tests/recon-ordering/node_modules/pg/lib/index.js')).default;
  connection=url.href;database=url.pathname.slice(1);url.pathname='/postgres';admin=new pg.Client({connectionString:url.href});await admin.connect();await admin.query('create database '+database);
  db=new pg.Client({connectionString:connection});await db.connect();
  const query=db.query.bind(db);db.query=(sql,values)=>query(sql,values?.map(v=>Array.isArray(v)?JSON.stringify(v):v));db.exec=sql=>db.query(sql);
 }else db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema app_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 create table profiles(user_id uuid primary key,role text,active boolean,archived_at timestamptz,full_name text,username text);
 create table equipment_master(equipment_key text primary key,unit_tag text,source_family text,canonical_family text,workflow_type text,source_label text,tracker_state text,updated_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 create function app_private.cos_verified_fleet_actor(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where user_id=p_id and active and archived_at is null and (role='owner' or role='it' and user_id='${it}'))$$;
 insert into profiles values('${it}','it',true,null,'Synthetic IT','it'),('${svc}','service',true,null,'Synthetic Service','service'),('${other}','service',true,null,'Other Service','other'),('${unknown}','it',true,null,'Unverified IT','unknown');
 grant usage on schema auth,app_private,storage to authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const file of ['techcheck-named-handoffs-v1.sql','techcheck-transfer-rollout-v2.sql','techcheck-transfer-delivery-v3.sql'])await db.exec(await readFile(new URL('../../database-maintenance/'+file,import.meta.url),'utf8'));
});
after(async()=>{if(admin){await db?.end();await admin.query('drop database '+database);for(const role of ['anon','authenticated','service_role'])await admin.query('drop role '+role);await admin.end();}else await db?.close();});
async function as(role,actor,fn){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false),set_config('request.jwt.claim.role',$2,false)",[actor,role]);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}}
const queue=(action,id=null,lease=null,data={},actor=null)=>as('service_role',it,async()=>(await db.query('select public.techcheck_transfer_delivery_v3($1,$2,$3,$4,$5) result',[action,id,actor,lease,data])).rows[0].result);
async function seed(kind='checkout'){
 const d=deliveryFixture({kind}),id=randomUUID();d.transfer_id=id;d.events[0].id=id;
 d.events.forEach((e,i)=>{if(i)e.id=randomUUID();e.snapshot.transfer_id=id;});d.event_id=d.events.at(-1).id;
 for(const e of d.events)e.photos.forEach(p=>p.path=e.actor_id+'/'+e.id+'/'+'a'.repeat(64)+'.jpg');
 await db.query('insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state,revision) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,it,svc,d.it_name,d.service_name,d.events[0].snapshot.expected,d.events.at(-1).snapshot.state,d.revision]);
 for(const e of d.events)await db.query('insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos,signed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[e.id,id,e.actor_id,e.actor_name,e.kind,{},e.snapshot,e.photos,e.signed_at]);
 await db.query('insert into app_private.techcheck_transfer_outbox(event_id,transfer_id) values($1,$2)',[d.event_id,id]);return d;
}
const saved=async id=>(await db.query('select * from app_private.techcheck_transfer_outbox where event_id=$1',[id])).rows[0];
const archive=q=>({snapshot_sha256:q.snapshot_sha256,complete:true,parts:Object.fromEntries(['folder','html','json','pdf',...q.delivery_snapshot.events.flatMap(e=>e.photos).map((_,i)=>'photo_'+i)].map(k=>[k,{id:'provider_'+k,done:true,sha256:k==='folder'?null:'a'.repeat(64)}]))});

test('installation stays held and server queue and private records deny every browser role',async()=>{
 const settings=(await db.query('select * from app_private.techcheck_transfer_settings')).rows[0];assert.deepEqual(settings,{singleton:true,enabled:false,reports_ready:false,receipt_link_ready:false,custody_ready:false});
 const d=await seed();assert.equal(await queue('claim',d.event_id),null);
 for(const role of ['anon','authenticated'])await as(role,it,async()=>{
  await assert.rejects(db.query("select public.techcheck_transfer_delivery_v3('claim')"),/permission denied/);
  await assert.rejects(db.query('select * from app_private.techcheck_transfer_outbox'),/permission denied/);
 });
 await db.exec('update app_private.techcheck_transfer_settings set enabled=true,reports_ready=true,receipt_link_ready=true,custody_ready=true');
});
test('capture binds checkout and accepted receipt into return archive, with exact immutable digest',async()=>{
 const d=await seed('return'),q=await saved(d.event_id),parsed=transferDelivery(JSON.parse(q.snapshot_text));
 assert.deepEqual(parsed.events.map(e=>e.id),d.events.map(e=>e.id));assert.equal(q.snapshot_sha256,createHash('sha256').update(q.snapshot_text).digest('hex'));assert.equal(q.status,'queued');
 await assert.rejects(db.query("update app_private.techcheck_transfer_outbox set delivery_snapshot='{}' where event_id=$1",[d.event_id]),/immutable/);
 await db.query("update app_private.techcheck_transfers set service_name='Changed later' where id=$1",[d.transfer_id]);assert.equal((await saved(d.event_id)).snapshot_text,q.snapshot_text);
});
test('manual claims enforce active exact recipient or verified IT and never expose other users records',async()=>{
 const d=await seed();
 for(const actor of [other,unknown])assert.equal(await queue('claim',d.event_id,null,{},actor),null);
 await db.query('update profiles set active=false where user_id=$1',[svc]);assert.equal(await queue('claim',d.event_id,null,{},svc),null);await db.query('update profiles set active=true where user_id=$1',[svc]);
 const q=await queue('claim',d.event_id,null,{},svc);assert.equal(q.event_id,d.event_id);assert.equal(q.attempts,1);assert.equal(await queue('claim',d.event_id),null);
 await assert.rejects(queue('finish',d.event_id,randomUUID(),{status:'sent'}),/lease expired/);
});
test('sent requires verified complete archive, ordered send checkpoint and provider identity',async()=>{
 const d=await seed(),q=await queue('claim',d.event_id),lease=q.lease_token;
 await assert.rejects(queue('finish',d.event_id,lease,{status:'sent'}),/provider email confirmation/);
 await assert.rejects(queue('checkpoint',d.event_id,lease,{email_state:'sending'}),/Verified archive/);
 const incomplete=archive(q);delete incomplete.parts.photo_0;await assert.rejects(queue('checkpoint',d.event_id,lease,{drive_manifest:incomplete}),/Every archive part/);
 const manifest=archive(q);await queue('checkpoint',d.event_id,lease,{drive_manifest:manifest});
 const swapped=structuredClone(manifest);swapped.parts.photo_0.id='different';await assert.rejects(queue('checkpoint',d.event_id,lease,{drive_manifest:swapped}),/identities cannot change/);
 await assert.rejects(queue('checkpoint',d.event_id,lease,{email_state:'sent',email_id:'forged-order'}),/ordered email/);
 await queue('checkpoint',d.event_id,lease,{email_state:'sending'});await assert.rejects(queue('checkpoint',d.event_id,lease,{email_state:'sent'}),/ordered email/);
 await queue('checkpoint',d.event_id,lease,{email_state:'sent',email_id:'provider_message'});await queue('finish',d.event_id,lease,{status:'sent'});
 assert.equal((await saved(d.event_id)).status,'sent');assert.equal(await queue('claim',d.event_id),null);
});
test('expired sending lease is quarantined without another claim or duplicate email',async()=>{
 const d=await seed(),q=await queue('claim',d.event_id);await queue('checkpoint',d.event_id,q.lease_token,{drive_manifest:archive(q)});await queue('checkpoint',d.event_id,q.lease_token,{email_state:'sending'});
 await db.query("update app_private.techcheck_transfer_outbox set locked_until=now()-interval '1 second' where event_id=$1",[d.event_id]);
 assert.equal(await queue('claim',d.event_id),null);const row=await saved(d.event_id);assert.equal(row.status,'review');assert.equal(row.email_state,'review');assert.equal(row.attempts,1);
});
test('provider failures back off and stop after eight attempts',async()=>{
 const d=await seed();
 for(let i=1;i<=8;i++){
  const q=await queue('claim',d.event_id);assert.equal(q.attempts,i);await queue('finish',d.event_id,q.lease_token,{status:'retry'});assert.equal(await queue('claim',d.event_id),null);
  await db.query("update app_private.techcheck_transfer_outbox set next_attempt_at=now()-interval '1 second' where event_id=$1",[d.event_id]);
 }
 assert.equal((await saved(d.event_id)).status,'review');assert.equal(await queue('claim',d.event_id),null);
});
test('real PostgreSQL concurrent clients can claim an event only once',{skip:!process.env.COS_HANDOFF_TEST_DATABASE_URL},async()=>{
 const d=await seed(),clients=await Promise.all([0,1].map(async()=>{const c=new pg.Client({connectionString:connection});await c.connect();await c.query("select set_config('request.jwt.claim.role','service_role',false)");await c.query('set role service_role');return c;}));
 try{
  const results=await Promise.all(clients.map(c=>c.query("select public.techcheck_transfer_delivery_v3('claim',$1) result",[d.event_id])));assert.equal(results.filter(r=>r.rows[0].result!==null).length,1);assert.equal((await saved(d.event_id)).attempts,1);
 }finally{await Promise.all(clients.map(c=>c.end()));}
});
