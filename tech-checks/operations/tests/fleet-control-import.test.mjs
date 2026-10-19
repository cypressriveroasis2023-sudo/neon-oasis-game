import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
const OWNER='22222222-2222-4222-8222-222222222222',ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',OLD='a'.repeat(64);
const csv=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\r\n11,Sniper 193,100,Builder: Project,Sniper ES,4112 Example Rd,Houston,TX,77092\r\n12,Sniper 208,200,Cameras OnSite,Sniper ES,9949 Example Pkwy,Houston,TX,77064\r\n13,Stand 003,200,Cameras OnSite,Stand,9949 Example Pkwy,Houston,TX,77064\r\n');
const sourceSha=createHash('sha256').update(csv).digest('hex'),rows=parseEquipmentCsv(csv.toString());
async function setup(){
 const db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role;create schema app_private;create schema cos_mhelp_placement_private;");
 await db.exec("create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $$begin if p is distinct from '22222222-2222-4222-8222-222222222222'::uuid or o is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Owner required' using errcode='42501';end if;end$$;");
 await db.exec("create function app_private.cos_owner_identity_assert_actor(p uuid,o uuid,w boolean) returns void language plpgsql as $$begin perform app_private.appdeploy_assume_actor(p,o);end$$;");
 await db.exec("create function app_private.has_permission(o uuid,p text) returns boolean language sql as $$select p='equipment.manage'$$;");
 await db.exec("create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text,receipt jsonb,records jsonb,admitted_at timestamptz default now());create table cos_mhelp_placement_private.upload_audit(id bigint generated always as identity,action text,source_sha256 text,previous_sha256 text,authorization_sha256 text);");
 for(const t of ['app_private.vision_tracker_locations','public.equipment_units','app_private.cos_geocode_sources','public.equipment_unit_location_history','app_private.cos_owner_identity_claims','app_private.cos_archived_representations'])await db.exec(`create table ${t}(id uuid)`);
 await db.exec("create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql as $$select repeat('d',64)$$;");
 await db.exec("create function cos_mhelp_placement_private.scoped_records(s text) returns jsonb language sql as $$select records from cos_mhelp_placement_private.upload_batches where source_sha256=s$$;");
 const prior=structuredClone(rows);prior[0]={...prior[0],placement:'SHOP',customer:'Cameras OnSite',customerId:'200',sourceAddress:rows[1].sourceAddress};prior[1]={...prior[1],placement:'FIELD',customer:'Builder: Project',customerId:'100',sourceAddress:rows[0].sourceAddress};
 await db.query('insert into cos_mhelp_placement_private.upload_control values(true,$1)',[OLD]);
 await db.query('insert into cos_mhelp_placement_private.upload_batches values($1,$2,$3,$4,now())',[OLD,'b'.repeat(64),JSON.stringify({contract:'COS_MHELP_UPLOAD_V1',filename:'ServiceItem_List_20261013120000.csv',trackerRecords:[],sourceSha256:OLD}),JSON.stringify(prior)]);
 const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
 await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.review_upload('),overlay.indexOf('create function cos_mhelp_placement_private.rollback_upload(')));
 const hash=(await db.query("select encode(sha256(convert_to(pg_get_functiondef('cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)'::regprocedure),'UTF8')),'hex') v")).rows[0].v;
 const sql=readFileSync(new URL('../db/cos-fleet-control-import-v2.sql',import.meta.url),'utf8').replace('b572e843f0540743dfe34db9750fbac5342bf1c99708deba141b676c6fc23484',hash);
 await db.exec(sql);
 return db;
}
const stage=(db,id=randomUUID(),actor=OWNER,records=rows,bytes=csv,sha=sourceSha)=>db.query('select public.cos_fleet_csv_stage_v2($1,$2,$3,$4,$5,$6,$7,$8) v',[actor,ORG,id,'ServiceItem_List_20261019183246.csv',sha,OLD,bytes.toString('base64'),JSON.stringify(records)]).then(x=>x.rows[0].v);
const commit=(db,id,actor=OWNER)=>db.query('select public.cos_fleet_csv_commit_v2($1,$2,$3) v',[actor,ORG,id]).then(x=>x.rows[0].v);
test('complete private CSV stages and applies safe source moves without waiting for Google or erasing native data',async()=>{
 const db=await setup();try{
  const id=randomUUID(),r=await stage(db,id);assert.equal(r.records,3);assert.equal(r.field,1);assert.equal(r.shop,2);assert.equal(r.validated,true);
  const s=(await db.query('select receipt,source_bytes from cos_fleet_import_private.stages where id=$1',[id])).rows[0];
  assert.equal(s.receipt.libraryFileId,undefined);assert.equal(s.receipt.sourceEvidence.contract,'COS_PRIVATE_CSV_BYTES_V2');assert.deepEqual(Buffer.from(s.source_bytes),csv);
  assert.equal((await db.query('select active_sha256 from cos_mhelp_placement_private.upload_control')).rows[0].active_sha256,OLD);
  const applied=await commit(db,id);assert.equal(applied.applied,true);assert.equal(applied.sourceSha256,sourceSha);assert.equal(applied.trackerState,'pending_verified_publish');
  assert.equal((await commit(db,id)).idempotent,true);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,1);
 }finally{await db.close()}
});
test('bad bytes, duplicate Product IDs, actor substitution and anonymous table access are rejected',async()=>{
 const db=await setup();try{
  await assert.rejects(stage(db,randomUUID(),OWNER,rows,Buffer.from('altered'),sourceSha),/checksum/);
  await assert.rejects(stage(db,randomUUID(),OWNER,[rows[0],rows[0]]),/duplicate/);
  await assert.rejects(stage(db,randomUUID(),randomUUID()),/Owner/);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from cos_fleet_import_private.stages'),/permission/);await assert.rejects(commit(db,randomUUID()),/permission/);await db.exec('reset role');}
 }finally{await db.close()}
});
test('stage retry is idempotent and a newer source prevents an older staged commit',async()=>{
 const db=await setup();try{
  const id=randomUUID();await stage(db,id);assert.equal((await stage(db,id)).idempotent,true);
  await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',['e'.repeat(64)]);
  await assert.rejects(commit(db,id),/stale/);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,0);
 }finally{await db.close()}
});
