import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

// Synthetic PGlite only. Never makes a COS or provider network request.
const OWNER='22222222-2222-4222-8222-222222222222';
const IT='33333333-3333-4333-8333-333333333333';
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const SHA='a'.repeat(64);
const FIELD={productId:'101',unitNumber:'Ranger 028',customer:'Synthetic Builder',placement:'FIELD',lifecycle:'UNFLAGGED',sourceAddress:{street:'1 Main St',city:'Houston',state:'TX',zip:'77002'}};
const SHOP={productId:'102',unitNumber:'Spotter 304HDC4',customer:'Cameras OnSite',placement:'SHOP',lifecycle:'UNFLAGGED',sourceAddress:{}};
const HELD={productId:'103',unitNumber:'Sniper 008',customer:'Cameras OnSite',placement:'SHOP',lifecycle:'DO_NOT_USE',sourceAddress:{}};
async function fixture(){
 const db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role;create schema app_private;create schema cos_mhelp_placement_private;");
 await db.exec("create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,records jsonb not null);");
 await db.exec("create table public.equipment_units(id uuid primary key,unit_number text,ip text,gps_lat numeric,gps_long numeric,status text);create table app_private.vision_tracker_locations(id uuid primary key,unit_number text,placement text,ip text);");
 await db.exec("create function app_private.cos_owner_identity_assert_actor(p uuid,o uuid,w boolean) returns void language plpgsql set search_path='' as $f$ begin if p is distinct from '22222222-2222-4222-8222-222222222222'::uuid or o is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Owner permission required' using errcode='42501';end if;end $f$;");
 await db.query("insert into cos_mhelp_placement_private.upload_control values(true,$1)",[SHA]);
 await db.query("insert into cos_mhelp_placement_private.upload_batches values($1,$2)",[SHA,[FIELD,SHOP,HELD]]);
 await db.query("insert into public.equipment_units values($1,'Ranger 028','192.0.2.100',29.5,-95.2,'installed')",[randomUUID()]);
 await db.query("insert into app_private.vision_tracker_locations values($1,'Ranger 028','FIELD','192.0.2.100')",[randomUUID()]);
 await db.exec(await readFile(new URL('../docs/drafts/cos-operational-transfer-v1.sql',import.meta.url),'utf8'));
 return db;
}
const snap=(db,actor=OWNER)=>db.query("select public.cos_operational_transfer_snapshot($1,$2) v",[actor,ORG]).then(r=>r.rows[0].v);
const command=(productId,placement,changes={},rev=0,requestId=randomUUID(),sha=SHA)=>[
 OWNER,ORG,productId,sha,rev,requestId,placement,
 changes.customer??'Synthetic New Customer',
 changes.site??'Synthetic New Site',
 changes.address??'300 New Rd, Houston, TX 77002'
];
const move=(db,args)=>db.query("select public.cos_operational_transfer_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v",args).then(r=>r.rows[0].v);
const native=db=>db.query("select jsonb_build_object('equipment',(select jsonb_agg(to_jsonb(t)) from public.equipment_units t),'tracker',(select jsonb_agg(to_jsonb(t)) from app_private.vision_tracker_locations t)) v").then(r=>r.rows[0].v);

test('Field to Shop is an immediate local commit; queues Sheets independently and preserves native records',async()=>{
 const db=await fixture();try{
  const before=await native(db);
  assert.equal((await snap(db)).items.length,3);
  const args=command('101','SHOP',{customer:'',site:'',address:''});
  const receipt=await move(db,args);
  assert.equal(receipt.committed,true);assert.equal(receipt.replayed,false);
  assert.equal(receipt.placement,'SHOP');assert.equal(receipt.revision,1);assert.equal(receipt.syncState,'pending');
  const unit=(await snap(db)).items.find(x=>x.productId==='101');
  assert.equal(unit.placement,'SHOP');assert.equal(unit.site,'SHOP');
  assert.equal(unit.customer,'Cameras OnSite');assert.equal(unit.syncState,'pending');
  assert.deepEqual(await native(db),before);
  assert.equal((await db.query("select count(*)::int n from cos_operational_private.sheet_outbox")).rows[0].n,1);
 }finally{await db.close();}
});

test('Shop to Field records chosen address without GPS, provider observations or network calls',async()=>{
 const db=await fixture();try{
  const before=await native(db),receipt=await move(db,command('102','FIELD'));
  assert.equal(receipt.placement,'FIELD');
  assert.equal(receipt.address,'300 New Rd, Houston, TX 77002');
  const unit=(await snap(db)).items.find(x=>x.productId==='102');
  assert.equal(unit.placement,'FIELD');assert.equal(unit.revision,1);
  assert.deepEqual(await native(db),before);
 }finally{await db.close();}
});

test('retries are idempotent; concurrent revisions and source changes cannot overwrite newer moves',async()=>{
 const db=await fixture();try{
  const requestId=randomUUID(),args=command('101','SHOP',{},0,requestId);
  assert.equal((await move(db,args)).replayed,false);
  assert.equal((await move(db,args)).replayed,true);
  await assert.rejects(move(db,[...args.slice(0,6),'FIELD',...args.slice(7)]),/different move/);
  await assert.rejects(move(db,command('101','FIELD',{},0)),/moved elsewhere/);
  assert.equal((await db.query("select count(*)::int n from cos_operational_private.events")).rows[0].n,1);
  const newHash='b'.repeat(64);
  await db.query("insert into cos_mhelp_placement_private.upload_batches values($1,$2)",[newHash,[{...FIELD,placement:'FIELD'},SHOP,HELD]]);
  await db.query("update cos_mhelp_placement_private.upload_control set active_sha256=$1",[newHash]);
  assert.equal((await snap(db)).items.find(x=>x.productId==='101').placement,'SHOP');
  await assert.rejects(move(db,command('101','FIELD',{},1,randomUUID(),SHA)),/Inventory changed/);
  assert.equal((await move(db,command('101','FIELD',{},1,randomUUID(),newHash))).revision,2);
 }finally{await db.close();}
});

test('missing, duplicate, restricted, malformed and unauthorized moves are denied',async()=>{
 const db=await fixture();try{
  await assert.rejects(move(db,command('103','FIELD')),/Restricted/);
  await assert.rejects(move(db,command('999','SHOP')),/not found/);
  await assert.rejects(move(db,command('102','FIELD',{address:''})),/requires customer/);
  await assert.rejects(move(db,command('102','FIELD',{customer:'=IMPORTXML()'})),/Unsafe/);
  await assert.rejects(snap(db,IT),/Owner permission/);
  await assert.rejects(move(db,[IT,...command('101','SHOP').slice(1)]),/Owner permission/);
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(snap(db),/permission denied/);
   await assert.rejects(db.query('select * from cos_operational_private.events'),/permission denied/);
   await db.exec('reset role');
  }
  await db.query("update cos_mhelp_placement_private.upload_batches set records=$1 where source_sha256=$2",[[FIELD,FIELD,SHOP,HELD],SHA]);
  await assert.rejects(snap(db),/Duplicate Product IDs/);
  await assert.rejects(move(db,command('101','SHOP')),/duplicated/);
  assert.equal((await db.query("select count(*)::int n from cos_operational_private.events")).rows[0].n,0);
 }finally{await db.close();}
});
