// Disposable loopback PostgreSQL only; no production credentials or targets.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixture,actor,it,org,native,tracker,requestId,hash} from './fixtures/owner-identity-upload-fixture.mjs';
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
const {Client}=require('pg');
const url=new URL(process.env.COS_IDENTITY_BINDING_TEST_DATABASE_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_identity_binding_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Use a disposable loopback cos_identity_binding_test_* database.');
const adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=new Client({connectionString:adminUrl.href});await admin.connect();
const json=values=>values?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const rpc='select public.cos_owner_identity_confirm($1,$2,$3,$4,$5) v';
const params=(f,id=requestId)=>json([actor,org,f.revision,id,f.claim]);
async function blocked(observer,c){
 const deadline=Date.now()+4000;
 while(Date.now()<deadline){if((await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}
 throw Error('Expected an independent PostgreSQL lock wait.');
}
async function scenario(suffix,run){
 const database=url.pathname.slice(1)+'_'+suffix,caseUrl=new URL(url);caseUrl.pathname='/'+database;
 const clients=[];await admin.query('create database '+database);
 try{
  for(let i=0;i<4;i++){const c=new Client({connectionString:caseUrl.href});await c.connect();await c.query("set statement_timeout='8s';set lock_timeout='6s'");clients.push(c);}
  const [db,left,right,observer]=clients;
  assert.equal(new Set(clients.map(c=>c.processID)).size,4);
  const adapter={exec:sql=>db.query(sql.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`)),query:(sql,values)=>db.query(sql,json(values))};
  const f=await fixture({database:adapter,recordCount:1001});await run({f,db,left,right,observer});
  console.log('PASS '+suffix);
 }finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end();}await admin.query('drop database '+database);}
}
try{
 await scenario('source_preservation',async({f})=>{
  const before=await f.preserved(),snapshot=await f.snapshot();await f.confirm();
  assert.deepEqual(await f.snapshot(),snapshot);assert.deepEqual(await f.preserved(),before);
  assert.equal(snapshot.records.length,1001);assert.equal(snapshot.records.filter(r=>r.placement==='FIELD').length,287);assert.equal(snapshot.records.filter(r=>r.placement==='SHOP').length,714);
  assert.equal((await f.confirm()).replayed,true);
 });
 await scenario('competing_confirmations',async({f,db,left,right,observer})=>{
  await left.query('begin');await left.query(rpc,params(f));
  const losing=right.query(rpc,params(f,'66666666-6666-4666-8666-666666666666')).then(()=>({ok:true}),e=>({code:e.code}));
  await blocked(observer,right);await left.query('commit');assert.equal((await losing).code,'40001');
  assert.equal((await db.query('select count(*)::int n from app_private.cos_owner_identity_claims')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.identity_binding_receipts')).rows[0].n,1);
 });
 await scenario('later_gps_writer',async({f,left,right,observer})=>{
  await left.query('begin');await left.query(rpc,params(f));
  const writing=right.query('update equipment_units set gps_latitude=31 where id=$1',[native]);
  await blocked(observer,right);await left.query('commit');await writing;
  assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
  assert.equal((await f.confirm()).replayed,true);assert.equal((await f.snapshot()).records[0].binding.guardCurrent,false);
 });
 await scenario('concurrent_tracker_correction',async({f,db,left,right,observer})=>{
  await db.query(`create function app_private.synthetic_confirmation_gate() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(987654321);return new;end$$;
   create trigger synthetic_confirmation_gate after insert on app_private.cos_owner_identity_claims for each row execute function app_private.synthetic_confirmation_gate();`);
  await right.query('begin');await right.query('select pg_advisory_xact_lock(987654321)');
  const losing=left.query(rpc,params(f)).then(()=>({ok:true}),e=>({code:e.code}));
  await blocked(observer,left);
  await right.query("update app_private.vision_tracker_locations set customer='Concurrent verified correction' where id=$1",[tracker]);await right.query('commit');
  assert.equal((await losing).code,'40001');
  assert.equal((await db.query('select count(*)::int n from app_private.cos_owner_identity_claims')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.identity_binding_receipts')).rows[0].n,0);
  assert.equal((await db.query('select customer from app_private.vision_tracker_locations where id=$1',[tracker])).rows[0].customer,'Concurrent verified correction');
 });
 await scenario('source_activation_serializes',async({f,db,left,right,observer})=>{
  await left.query('begin');await left.query(rpc,params(f));
  const activation=right.query('update cos_mhelp_placement_private.upload_control set active_sha256=null where singleton');
  await blocked(observer,right);await left.query('commit');await activation;
  assert.equal(await f.snapshot(),null);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.identity_binding_receipts where source_sha256=$1',[hash])).rows[0].n,1);
 });
 await scenario('real_role_gates',async({f,db})=>{
  for(const role of ['anon','authenticated','service_role']){
   await db.query('set role '+role);
   await assert.rejects(()=>db.query('select * from cos_mhelp_placement_private.identity_binding_receipts'),e=>e.code==='42501');
   await assert.rejects(()=>db.query('select app_private.cos_owner_identity_confirm_base($1,$2,$3,$4,$5)',params(f)),e=>e.code==='42501');
   if(role!=='service_role')await assert.rejects(()=>db.query(rpc,params(f)),e=>e.code==='42501');
   await db.query('reset role');
  }
  await db.query('set role service_role');await assert.rejects(()=>f.confirm({actor:it}),e=>e.code==='42501');await f.confirm();await db.query('reset role');
  await assert.rejects(()=>db.query('delete from cos_mhelp_placement_private.identity_binding_receipts'),e=>e.code==='42501');
 });
 console.log('6/6 PostgreSQL identity/upload preservation and contention scenarios passed');
}finally{await admin.end();}
