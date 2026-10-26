import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const sql=await readFile(new URL('../db/mhelp-live-inventory.sql',import.meta.url),'utf8');
const original='a'.repeat(64),guard='b'.repeat(64),native='11111111-1111-4111-8111-111111111111';
const record=(id='1',placement='FIELD')=>({productId:id,unitNumber:'Ranger '+id,category:'Ranger',customerId:placement==='SHOP'?'11':'12',customer:placement==='SHOP'?'Cameras Onsite':'Customer: Site',placement,lifecycle:'UNFLAGGED',sourceRow:Number(id)+1,sourceDates:{apiUpdatedAt:null},sourceAddress:{street:placement==='SHOP'?'':'123 Main St',city:'Houston',state:'TX',zip:'77002'},binding:null,possibleAliasUnitIds:[],holdReason:null,apiAssignment:{customerId:placement==='SHOP'?'11':'12',serviceLocationId:'13',equipmentTypeId:'2',active:true},addressReview:null});
async function fixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema cos_mhelp_placement_private;create schema app_private;
 create table public.equipment_units(id uuid,ip text,gps_latitude float8,gps_longitude float8);
 insert into public.equipment_units values('${native}','192.0.2.1',30,-95);
 create table app_private.vision_tracker_locations(id uuid);create table public.equipment_unit_location_history(id uuid);
 create table app_private.cos_geocode_sources(id uuid);create table app_private.cos_archived_representations(id uuid);create table app_private.cos_owner_identity_claims(id uuid);
 create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);
 create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text,receipt jsonb,records jsonb);
 create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql as $$select '${guard}'::text$$;
 create function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql as $$select receipt||jsonb_build_object('sourceSha256',b.source_sha256,'payloadSha256',b.payload_sha256,'records',b.records) from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on c.active_sha256=b.source_sha256 where c.singleton$$;`);
 const r=record();r.binding={productId:'1',trackerId:null,nativeUnitId:native,fullLabel:r.unitNumber,nativeLabel:r.unitNumber,trackerLabel:null,guardCurrent:true,expectedGuard:guard,matchMethod:'reviewed_product_id',evidenceSha256:guard};
 await db.query('insert into cos_mhelp_placement_private.upload_batches values($1,$2,$3,$4)',[original,guard,{contract:'COS_MHELP_UPLOAD_V1',companyCustomerIds:['11'],receivedAt:new Date().toISOString(),trackerRecords:[],trackerSource:null},[r]]);
 await db.query('insert into cos_mhelp_placement_private.upload_control values(true,$1)',[original]);await db.exec(sql);
 const call=async(action,records=[record()],extra={})=>(await db.query('select public.cos_mhelp_live_inventory_session($1,$2) v',[action,{portalId:'224643',complete:true,baselineSourceSha256:original,readAt:new Date().toISOString(),records,...extra}])).rows[0].v;
 const state=async()=>(await db.query("select jsonb_build_object('control',(select to_jsonb(c) from cos_mhelp_placement_private.upload_control c),'native',(select jsonb_agg(to_jsonb(n)) from public.equipment_units n),'original',(select to_jsonb(b) from cos_mhelp_placement_private.upload_batches b where source_sha256='"+original+"')) v")).rows[0].v;
 return {db,call,state};
}
test('staging a complete live snapshot preserves accepted inventory, GPS, IP and original source',async()=>{const f=await fixture();try{const before=await f.state();const r=await f.call('stage');assert.equal(r.state,'staged');assert.deepEqual(await f.state(),before);const staged=(await f.db.query('select records,receipt from cos_mhelp_placement_private.live_inventory_candidates')).rows[0];assert.equal(staged.receipt.contract,'COS_MHELP_API_V1');assert.equal(staged.records[0].binding.nativeUnitId,native);assert.equal(staged.records[0].binding.expectedGuard,guard);}finally{await f.db.close();}});
test('disabled automatic mode stages without activation',async()=>{const f=await fixture();try{const before=await f.state();assert.equal((await f.call('run')).state,'staged');assert.deepEqual(await f.state(),before);}finally{await f.db.close();}});
test('enabled complete source adds inventory, moves Shop and records missing IDs without native writes',async()=>{const f=await fixture();try{const before=await f.state();await f.db.exec('update cos_mhelp_placement_private.live_inventory_control set enabled=true');const r=await f.call('run',[record('2','SHOP')]);assert.equal(r.state,'current');assert.equal(r.summary.total,1);assert.equal(r.summary.shop,1);assert.equal(r.summary.added,1);assert.equal(r.summary.missing,1);const after=await f.state();assert.deepEqual(after.native,before.native);assert.deepEqual(after.original,before.original);const s=(await f.db.query('select receipt,records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[r.sourceSha256])).rows[0];assert.equal(s.receipt.apiMissingRecords[0].productId,'1');assert.equal(s.records[0].binding,null);}finally{await f.db.close();}});
test('renamed products cannot inherit camera identities',async()=>{const f=await fixture();try{const r=await f.call('stage',[{...record(),unitNumber:'Ranger 099',binding:{nativeUnitId:native}}]);const s=(await f.db.query('select records from cos_mhelp_placement_private.live_inventory_candidates where source_sha256=$1',[r.sourceSha256])).rows[0];assert.equal(s.records[0].binding,null);assert(s.records[0].possibleAliasUnitIds.includes(native));}finally{await f.db.close();}});
test('changed equipment categories cannot inherit camera identities even with an unchanged label',async()=>{const f=await fixture();try{const r=await f.call('stage',[{...record(),category:'Solar Stand'}]);const s=(await f.db.query('select records from cos_mhelp_placement_private.live_inventory_candidates where source_sha256=$1',[r.sourceSha256])).rows[0];assert.equal(s.records[0].binding,null);assert(s.records[0].possibleAliasUnitIds.includes(native));}finally{await f.db.close();}});
test('empty, partial, duplicate, stale, cross-portal and moved-source reads reject atomically',async()=>{const f=await fixture();try{const before=await f.state();for(const [rows,extra] of [[[],{}],[[record()],{complete:false}],[[record(),record()],{}],[[record()],{portalId:'9'}],[[record()],{baselineSourceSha256:'c'.repeat(64)}],[[record()],{readAt:'2020-01-01T00:00:00Z'}]])await assert.rejects(f.call('run',rows,extra));assert.deepEqual(await f.state(),before);}finally{await f.db.close();}});
test('client roles cannot use the server-only source writer or private ledgers',async()=>{const f=await fixture();try{for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(f.call('status'),/permission denied/);await assert.rejects(f.db.query('select * from cos_mhelp_placement_private.live_inventory_candidates'),/permission denied/);await f.db.exec('reset role');}}finally{await f.db.close();}});

test('successive Shop Field Shop sources retain dated immutable snapshots and protected native data',async()=>{
 const f=await fixture();try{
  const before=await f.state();await f.db.exec('update cos_mhelp_placement_private.live_inventory_control set enabled=true');
  // The production snapshot revalidates the saved binding guard on every read.
  await f.db.exec(`create or replace function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql as $$select receipt||jsonb_build_object('sourceSha256',b.source_sha256,'payloadSha256',b.payload_sha256,'records',(select jsonb_agg(case when r->'binding'<>'null'::jsonb then jsonb_set(r,'{binding,guardCurrent}',to_jsonb(r->'binding'->>'expectedGuard'='${guard}')) else r end) from jsonb_array_elements(b.records)r)) from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on c.active_sha256=b.source_sha256 where c.singleton$$;`);
  let baselineSourceSha256=original;const snapshots=[];
  for(const placement of ['SHOP','FIELD','SHOP']){
   const r=await f.call('run',[record('1',placement)],{baselineSourceSha256});assert.equal(r.state,'current');
   baselineSourceSha256=r.sourceSha256;
   const saved=(await f.db.query('select source_sha256,receipt,records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[r.sourceSha256])).rows[0];
   assert.equal(saved.records[0].placement,placement);assert.equal(saved.records[0].binding.nativeUnitId,native);assert(saved.receipt.receivedAt);snapshots.push(saved);
  }
  for(const saved of snapshots)assert.deepEqual((await f.db.query('select source_sha256,receipt,records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[saved.source_sha256])).rows[0],saved);
  const after=await f.state();assert.deepEqual(after.native,before.native);assert.deepEqual(after.original,before.original);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.live_inventory_runs')).rows[0].n,3);
 }finally{await f.db.close();}
});
