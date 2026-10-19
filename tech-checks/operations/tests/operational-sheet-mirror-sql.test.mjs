import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const SHA='a'.repeat(64),ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const OWNER='22222222-2222-4222-8222-222222222222';
const source=[
 {productId:'123',unitNumber:'Ranger 028',placement:'FIELD',customer:'Builder',lifecycle:'UNFLAGGED',sourceAddress:{street:'100 Main St',city:'Houston',state:'TX',zip:'77002'}},
 {productId:'124',unitNumber:'Spotter (solar compatible) 304HDC4',placement:'SHOP',customer:'Cameras OnSite',lifecycle:'UNFLAGGED',sourceAddress:{}}
];
const field={placement:'FIELD',customer:'Builder',site:'Job',address:'100 Main St, Houston TX 77002'};
const shop={placement:'SHOP',customer:'Cameras OnSite',site:'SHOP',address:'9949 W Sam Houston Pkwy N, Houston TX'};
async function setup(){
 const db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role;create schema app_private;create schema cos_mhelp_placement_private;");
 await db.exec("create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,records jsonb not null);");
 await db.exec("create table public.equipment_units(id uuid primary key,ip text,latitude numeric,longitude numeric);");
 await db.exec("create function app_private.cos_owner_identity_assert_actor(p uuid,o uuid,w boolean) returns void language plpgsql set search_path='' as $f$ begin if p is distinct from '22222222-2222-4222-8222-222222222222'::uuid or o is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Owner required' using errcode='42501';end if;end $f$;");
 await db.query("insert into cos_mhelp_placement_private.upload_control values(true,$1)",[SHA]);
 await db.query("insert into cos_mhelp_placement_private.upload_batches values($1,$2)",[SHA,JSON.stringify(source)]);
 await db.query("insert into public.equipment_units values($1,'192.0.2.4',29.5,-95.3)",[randomUUID()]);
 for(const filename of ['cos-operational-transfer-v1.sql','cos-operational-sheet-mirror-v1.sql'])
  await db.exec(await readFile(new URL('../docs/drafts/'+filename,import.meta.url),'utf8'));
 await db.exec("update cos_operational_private.sheet_sync_control set enabled=true");
 return db;
}
const dbcall=(db,name,...args)=>{
 const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
 return db.query('select public.cos_operational_sheet_sync_'+name+'('+placeholders+') v',args).then(r=>r.rows[0].v);
};
const bootstrapRows=[
 {productId:'123',sheetId:386511683,row:28,label:'Ranger 028',matchKey:'RANGERS|Ranger 028',fields:field},
 {productId:'124',sheetId:2017346590,row:305,label:'Spotter 304HDC4',matchKey:'SPOTTERS|Spotter 304HDC4',fields:shop}
];
const activeLease=async db=>(await dbcall(db,'begin')).leaseId;
test('complete 2-product mirror bootstraps without changing a single COS equipment record',async()=>{
 const db=await setup();
 try{
  const before=(await db.query("select to_jsonb(x) v from public.equipment_units x")).rows;
  const lease=await activeLease(db);
  assert.equal(typeof lease,'string');
  const a=await dbcall(db,'bootstrap',lease,SHA,JSON.stringify(bootstrapRows));
  assert.equal(a.bootstrapped,2);
  assert.equal((await db.query("select count(*)::int n from cos_operational_private.sheet_mirror")).rows[0].n,2);
  await assert.rejects(dbcall(db,'bootstrap',lease,SHA,JSON.stringify(bootstrapRows)),/already initialized/);
  assert.deepEqual((await db.query("select to_jsonb(x) v from public.equipment_units x")).rows,before);
  assert.equal((await dbcall(db,'finish',lease)).committed,true);
 }finally{await db.close();}
});
test('outbound COS move stages and settles only after verified row readback, then inbound updates COS',async()=>{
 const db=await setup();
 try{
  let lease=await activeLease(db);
  await dbcall(db,'bootstrap',lease,SHA,JSON.stringify(bootstrapRows));
  await dbcall(db,'finish',lease);
  const moveId=randomUUID();
  const receipt=(await db.query("select public.cos_operational_transfer_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v",
   [OWNER,ORG,'123',SHA,0,moveId,'SHOP','','',''])).rows[0].v;
  assert.equal(receipt.revision,1);assert.equal(receipt.syncState,'pending');
  lease=await activeLease(db);
  const command={productId:'123',requestId:moveId,revision:1,oldFields:field,newFields:shop};
  const stage=await dbcall(db,'stage',lease,SHA,JSON.stringify([command]));
  assert.equal(stage.count,1);
  const ack=await dbcall(db,'ack',lease,SHA,JSON.stringify([{...command,state:'published'}]));
  assert.equal(ack.published,1);
  const mirror=(await db.query("select fields,status from cos_operational_private.sheet_mirror m join cos_operational_private.sheet_outbox o using(product_id)")).rows[0];
  assert.deepEqual(mirror.fields,shop);assert.equal(mirror.status,'published');
  await dbcall(db,'finish',lease);
  const after={placement:'FIELD',customer:'Second Builder',site:'Second Site',address:'200 Second Ave, Houston TX 77002'};
  lease=await activeLease(db);
  const incoming=await dbcall(db,'inbound',lease,SHA,'123',1,randomUUID(),JSON.stringify(shop),JSON.stringify(after));
  assert.equal(incoming.committed,true);
  const row=(await db.query("select placement,customer,address,origin from cos_operational_private.current_placements where product_id='123'")).rows[0];
  assert.equal(row.placement,'FIELD');assert.equal(row.customer,'Second Builder');assert.equal(row.origin,'google_sheet');
  const audit=(await db.query("select origin,actor_id from cos_operational_private.events where origin='google_sheet'")).rows[0];
  assert.equal(audit.actor_id,null);assert.equal(audit.origin,'google_sheet');
  assert.equal((await dbcall(db,'finish',lease)).committed,true);
 }finally{await db.close();}
});
test('partial bootstrap, stale source/lease, conflicting inbound, duplicate row and public execution are denied',async()=>{
 const db=await setup();
 try{
  let lease=await activeLease(db);
  await assert.rejects(dbcall(db,'bootstrap',lease,SHA,JSON.stringify(bootstrapRows.slice(0,1))),/Incomplete/);
  await assert.rejects(dbcall(db,'bootstrap',lease,SHA,JSON.stringify([bootstrapRows[0],{...bootstrapRows[1],sheetId:1970577095}])),/sheet_mirror/);
  assert.equal((await db.query("select count(*)::int n from cos_operational_private.sheet_mirror")).rows[0].n,0);
  await dbcall(db,'bootstrap',lease,SHA,JSON.stringify(bootstrapRows));
  await dbcall(db,'finish',lease);
  lease=await activeLease(db);
  await assert.rejects(dbcall(db,'inbound',lease,SHA,'123',1,randomUUID(),JSON.stringify(field),JSON.stringify(shop)),/Sheet baseline changed/);
  await assert.rejects(dbcall(db,'inbound',randomUUID(),SHA,'123',0,randomUUID(),JSON.stringify(field),JSON.stringify(shop)),/lease expired/);
  await assert.rejects(dbcall(db,'inbound',lease,'b'.repeat(64),'123',0,randomUUID(),JSON.stringify(field),JSON.stringify(shop)),/lease expired/);
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(db.query("select public.cos_operational_sheet_sync_begin()"),/permission denied/);
   await assert.rejects(db.query("select * from cos_operational_private.sheet_mirror"),/permission denied/);
   await db.exec('reset role');
  }
 }finally{await db.close();}
});
