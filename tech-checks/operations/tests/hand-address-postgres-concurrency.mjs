// Real PostgreSQL, existing CI service only; never a Supabase connection.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const raw=process.env.COS_HAND_ADDRESS_TEST_DATABASE_URL;
if(!raw)throw Error('Disposable loopback COS_HAND_ADDRESS_TEST_DATABASE_URL required.');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^\/cos_hand_address_test_[a-z0-9_]+$/.test(url.pathname))throw Error('Only an isolated loopback cos_hand_address_test_* database is allowed.');
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));
const {Client}=require('pg'),name=url.pathname.slice(1),adminUrl=new URL(url);adminUrl.pathname='/postgres';
const admin=new Client({connectionString:adminUrl.href}),clients=[],passed=[];
const ORG='00000000-0000-4000-8000-000000000001',OWNER='00000000-0000-4000-8000-000000000002',IT='00000000-0000-4000-8000-000000000003';
const address='22725 Ashley Pines Dr, Spring, TX 77373-3257';
let created=false,db,left,right,observer;
const connect=async()=>{const c=new Client({connectionString:url.href});await c.connect();clients.push(c);await c.query("set statement_timeout='12s';set lock_timeout='8s'");return c;};
const payload=(over={})=>({unitKey:'SOLARSPOTTER 023',field:'address',action:'set',value:address,providerValue:null,actorName:'Synthetic Owner',actorRole:'owner',reason:'Synthetic review',expectedAddressRevision:null,...over});
async function edit(c,p,id=randomUUID(),actor=OWNER){return (await c.query('select public.cos_camera_unit_hand_edit_v1($1,$2,$3,$4) result',[actor,ORG,id,payload(p)])).rows[0].result;}
const current=async()=> (await db.query("select * from cos_fleet_hand_edit_private.unit_status_edit_log where field='address' order by seq desc limit 1")).rows[0];
const rows=async()=> (await db.query('select * from cos_fleet_hand_edit_private.unit_status_edit_log order by seq')).rows;
const clear=revision=>({action:'clear_pin',value:null,expectedAddressRevision:revision});
const settle=promise=>promise.then(value=>({value}),error=>({error}));
async function blocked(c){const until=Date.now()+5000;while(Date.now()<until){const row=(await observer.query('select wait_event_type from pg_stat_activity where pid=$1',[c.processID])).rows[0];if(row?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,15));}throw Error('No actual PostgreSQL lock wait observed.');}
async function test(label,fn){await fn();passed.push(label);console.log('PASS '+label);}
try{
 await admin.connect();assert.match((await admin.query('show server_version')).rows[0].server_version,/^17\./);
 if((await admin.query('select 1 from pg_database where datname=$1',[name])).rowCount)throw Error('Refusing to reuse an existing database.');
 await admin.query('create database '+name);created=true;
 db=await connect();left=await connect();right=await connect();observer=await connect();
 await db.query("do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;end$$;create schema app_private;");
 await db.query(`create function app_private.cos_owner_identity_assert_actor(actor uuid,org uuid,w boolean) returns void language plpgsql as $$begin if actor not in ('${OWNER}','${IT}') or org<>'${ORG}' then raise exception 'Denied' using errcode='PT403';end if;end$$;`);
 await db.query(await readFile(new URL('../db/20261112_fleet_unit_status_hand_edits.sql',import.meta.url),'utf8'));
 const upgrade=await readFile(new URL('../db/20261114175728_hand_address_pin_safety.sql',import.meta.url),'utf8');await db.query(upgrade);await db.query(upgrade);
 await edit(db,{field:'site',value:'Original site'});await edit(db,{field:'placement',value:'FIELD'});
 const protectedRows=await rows();
 await left.query('set role service_role');await right.query('set role service_role');
 let seed=await edit(db,{latitude:30.1,longitude:-95.4,matchedAddress:'22726 ASHLEY PINES DR, SPRING, TX'});
 await test('stale pin clear waits for newer address commit, then fails without overwriting',async()=>{
  await left.query('begin');const newer=await edit(left,{value:'9500 Katy Fwy, Houston, TX 77024',expectedAddressRevision:seed.id});
  const pending=settle(edit(right,clear(seed.id)));await blocked(right);await left.query('commit');
  assert.equal((await pending).error?.code,'PT409');assert.equal((await current()).id,newer.id);seed=newer;
 });
 await test('late retry waits for pin withdrawal, then fails its old revision',async()=>{
  await left.query('begin');const cleared=await edit(left,clear(seed.id));
  const pending=settle(edit(right,{value:seed.value,expectedAddressRevision:seed.id,latitude:30.1,longitude:-95.4,matchedAddress:seed.value}));await blocked(right);await left.query('commit');
  assert.equal((await pending).error?.code,'PT409');const row=await current();assert.equal(row.id,cleared.id);assert.equal(row.latitude,null);assert.equal(row.value,seed.value);seed=cleared;
 });
 await test('concurrent duplicate pin clear records once and returns replay after lock',async()=>{
  const id=randomUUID(),request=clear(seed.id),before=(await rows()).length;await left.query('begin');await edit(left,request,id);
  const pending=settle(edit(right,request,id));await blocked(right);await left.query('commit');assert.equal((await pending).value?.repeat,true);assert.equal((await rows()).length,before+1);seed={id,value:(await current()).value};
 });
 await test('concurrent reused ID with altered request is denied',async()=>{
  const id=randomUUID(),request=clear(seed.id);await left.query('begin');await edit(left,request,id);
  const pending=settle(edit(right,{...request,reason:'Different request'},id));await blocked(right);await left.query('commit');assert.equal((await pending).error?.code,'PT409');seed={id,value:(await current()).value};
 });
 await test('retry after refresh can pin; duplicate retry retains first point despite changed provider result',async()=>{
  const id=randomUUID(),request={value:seed.value,expectedAddressRevision:seed.id,latitude:29.7,longitude:-95.5,matchedAddress:seed.value};
  const saved=await edit(db,request,id);const repeated=await edit(db,{...request,latitude:30.4},id);assert.equal(repeated.repeat,true);assert.equal(repeated.latitude,saved.latitude);seed=saved;
 });
 await test('Owner and IT preserve text/history; unauthorized and private delegate calls fail',async()=>{
  const before=await rows();await edit(db,clear(seed.id),randomUUID(),IT);const after=await rows();assert.deepEqual(after.slice(0,-1),before);assert.equal(after.at(-1).value,seed.value);assert.equal(after.at(-1).latitude,null);
  await assert.rejects(()=>edit(db,clear(after.at(-1).id),randomUUID(),randomUUID()),e=>e.code==='PT403');
  await db.query('set role service_role');await assert.rejects(()=>db.query(`select cos_fleet_hand_edit_private.unit_status_edit_nonaddress_v1('${OWNER}','${ORG}','${randomUUID()}','{}')`),e=>e.code==='42501');await db.query('reset role');
  for(const role of ['anon','authenticated']){await db.query('set role '+role);await assert.rejects(()=>edit(db,clear(after.at(-1).id)),e=>e.code==='42501');await db.query('reset role');}
  assert.deepEqual((await rows()).slice(0,2),protectedRows);
 });
 const receipt={postgres:(await db.query('show server_version')).rows[0].server_version,passed,realLockWaits:4,syntheticOnly:true};
 if(process.env.COS_HAND_ADDRESS_TEST_RECEIPT)await writeFile(process.env.COS_HAND_ADDRESS_TEST_RECEIPT,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{
 for(const c of clients){try{await c.query('rollback');}catch{}await c.end().catch(()=>{});}
 if(created)await admin.query('drop database '+name);await admin.end();
}
