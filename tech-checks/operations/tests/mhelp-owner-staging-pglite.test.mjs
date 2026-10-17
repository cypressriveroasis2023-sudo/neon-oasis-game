import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/** Disposable in-memory PostgreSQL-style proof. Never connects to COS production. */
const actor='22222222-2222-4222-8222-222222222222';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const previous='a'.repeat(64),censusSha='c'.repeat(64);
const source=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n11,Ranger 007,100,Domain Builders,Ranger,Site,Houston,TX,77064\n12,Ranger 024,200,Cameras OnSite,Ranger,Shop,Houston,TX,77064\n13,Sniper 230,200,Cameras OnSite,Sniper,Shop,Houston,TX,77064\n');
const digest=createHash('sha256').update(source).digest('hex');
const records=[
 {productId:'11',unitNumber:'Ranger 007',customerId:'100',customer:'Domain Builders',category:'Ranger',placement:'FIELD',lifecycle:'UNFLAGGED',sourceRow:2,sourceAddress:{street:'Site',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'12',unitNumber:'Ranger 024',customerId:'200',customer:'Cameras OnSite',category:'Ranger',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:3,sourceAddress:{street:'Shop',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'13',unitNumber:'Sniper 230',customerId:'200',customer:'Cameras OnSite',category:'Sniper',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:4,sourceAddress:{street:'Shop',city:'Houston',state:'TX',zip:'77064'}}
];
const census=records.map(r=>({productId:r.productId,family:r.category,unitLabel:r.unitNumber,placement:r.placement,customer:r.customer}));
const draft=readFileSync(new URL('../docs/drafts/cos-owner-equipment-stage-commit-20261016.sql',import.meta.url),'utf8');
async function setup(){
 const db=new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role; create schema app_private; create schema cos_mhelp_placement_private;");
 await db.exec("create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);");
 await db.exec("create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text not null,receipt jsonb not null,records jsonb not null,admitted_at timestamptz not null default clock_timestamp());");
 await db.query("insert into cos_mhelp_placement_private.upload_control values(true,$1)",[previous]);
 await db.exec("create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $f$ begin if p is distinct from '22222222-2222-4222-8222-222222222222'::uuid or o is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'no actor' using errcode='42501'; end if; end $f$;");
 await db.exec("create function app_private.has_permission(o uuid,p text) returns boolean language sql as $f$ select o='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and p='equipment.manage' $f$;");
 await db.exec("create function cos_mhelp_placement_private.review_upload(receipt jsonb,records jsonb,expected text,apply_it boolean default false) returns jsonb language plpgsql as $f$ declare old text; total int; field int; shop int; begin select active_sha256 into old from cos_mhelp_placement_private.upload_control where singleton for update; if old is distinct from expected then raise exception 'Active source changed' using errcode='40001'; end if; select count(*),count(*) filter(where x->>'placement'='FIELD'),count(*) filter(where x->>'placement'='SHOP') into total,field,shop from jsonb_array_elements(records) x; if total::text is distinct from receipt->>'recordCount' or jsonb_array_length(receipt->'trackerRecords')<>total or receipt->>'libraryFileId' !~ '^libfile_[a-z0-9]+$' then raise exception 'incomplete receipt'; end if; if apply_it then insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values(receipt->>'sourceSha256','b',receipt,records); update cos_mhelp_placement_private.upload_control set active_sha256=receipt->>'sourceSha256' where singleton; end if; return jsonb_build_object('applied',apply_it,'sourceSha256',receipt->>'sourceSha256','records',total,'recordedField',field,'recordedShop',shop); end $f$;");
 const oldReceipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:previous,filename:'ServiceItem_List_20261013141848.csv',recordCount:3,trackerRecords:[{recordId:'old:ranger7',unitNumber:'Ranger 007',matchedProductId:'11',binding:{state:'unlinked',unitIds:[],unitLabels:{},guardCurrent:null}}],companyCustomerIds:['200']};
 const oldRows=[{...records[0],binding:null},{...records[1],binding:null},{...records[2],productId:'99',binding:null}];
 await db.query("insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,'b',$2,$3)",[previous,JSON.stringify(oldReceipt),JSON.stringify(oldRows)]);
 await db.exec("create table cos_mhelp_placement_private.scoped_control(base_sha256 text primary key,revision bigint,active_id uuid);create table cos_mhelp_placement_private.scoped_batches(id uuid primary key,base_sha256 text,records jsonb);");
 const scoped=readFileSync(new URL('../db/scoped_inventory_overlay.sql',import.meta.url),'utf8');
 const start=scoped.indexOf('create function cos_mhelp_placement_private.scoped_records(');
 await db.exec(scoped.slice(start,scoped.indexOf('$$;',start)+3));
 await db.exec(draft);
 return db;
}
const params=(requestId=randomUUID(),overrides={})=>[actor,org,requestId,'ServiceItem_List_20261016131754.csv',overrides.sourceSha||digest,overrides.prevSha||previous,censusSha,JSON.stringify(overrides.census||census),source.toString('base64'),JSON.stringify(records)];
const stage=(db,args)=>db.query("select public.cos_owner_mhelp_equipment_stage_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::jsonb,$9::text,$10::jsonb) result",args).then(r=>r.rows[0].result);
const commit=(db,id,note='I reviewed and approve the current COS Field and Shop inventory.',sha=censusSha)=>db.query("select public.cos_owner_mhelp_equipment_commit_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) result",[actor,org,id,previous,sha,note]).then(r=>r.rows[0].result);

test('current scoped holds and label corrections cannot inherit raw bindings, and later revisions fence commit',async()=>{
 const db=await setup();
 try{
  const raw=(await db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[previous])).rows[0].records;
  raw[0].binding={productId:'11',fullLabel:raw[0].unitNumber,marker:'old reviewed binding'};
  raw[1].binding={productId:'12',fullLabel:raw[1].unitNumber,marker:'old reviewed binding'};
  await db.query('update cos_mhelp_placement_private.upload_batches set records=$1 where source_sha256=$2',[JSON.stringify(raw),previous]);
  const effective=structuredClone(raw),revisionId=randomUUID();
  effective[0]={...effective[0],binding:null,placementHeld:true,scopedAuthority:{revisionId}};
  effective[1]={...effective[1],sourceLabelAuthority:{revisionId}};
  await db.query('insert into cos_mhelp_placement_private.scoped_batches values($1,$2,$3)',[revisionId,previous,JSON.stringify(effective)]);
  await db.query('insert into cos_mhelp_placement_private.scoped_control values($1,1,$2)',[previous,revisionId]);
  const id=randomUUID();await stage(db,params(id));
  const staged=(await db.query('select records,expected_scoped_revision from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[id])).rows[0];
  assert.equal(Number(staged.expected_scoped_revision),1);
  for(const productId of ['11','12']){
   assert.equal(staged.records.find(r=>r.productId===productId).binding,null);
   assert.equal(staged.records.find(r=>r.productId===productId).placementHeld,true);
  }
  await db.query('update cos_mhelp_placement_private.scoped_control set revision=2 where base_sha256=$1',[previous]);
  await assert.rejects(commit(db,id),/scoped source changed/);
  assert.equal((await db.query('select active_sha256 from cos_mhelp_placement_private.upload_control')).rows[0].active_sha256,previous);
  assert.equal((await db.query('select applied_at from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[id])).rows[0].applied_at,null);
 }finally{await db.close();}
});

test('source-only stage and retry exercise the actual reviewed-upload validator',async()=>{
 const db=await setup();
 try{
  // Empty native tables establish the real validator's locking dependencies.
  // This case admits source-only rows; linked identity graphs need separate proof.
  for(const table of ['app_private.vision_tracker_locations','public.equipment_units',
   'app_private.cos_geocode_sources','public.equipment_unit_location_history',
   'app_private.cos_owner_identity_claims','app_private.cos_archived_representations']){
   await db.exec(`create table ${table}(id uuid)`);
  }
  await db.exec("create table cos_mhelp_placement_private.upload_audit(id bigint generated always as identity,action text,source_sha256 text,previous_sha256 text,authorization_sha256 text)");
  await db.exec('drop function cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)');
  const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
  await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.review_upload('),overlay.indexOf('create function cos_mhelp_placement_private.rollback_upload(')));
  const id=randomUUID(),preview=await stage(db,params(id));
  assert.equal(preview.recordedField,1);
  assert.equal(preview.recordedShop,2);
  assert.equal(preview.boundRecords,0);
  const applied=await commit(db,id),repeated=await commit(db,id);
  assert.equal(applied.sourceReceiptsApplied,true);
  assert.equal(repeated.contract,applied.contract);
  assert.equal(repeated.sourceReceiptsApplied,true);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,1);
 }finally{await db.close();}
});

test('private Owner stage preserves original bytes and source-only holds, then commits atomically',async()=>{
 const db=await setup();
 try{
  const id=randomUUID(),preview=await stage(db,params(id));
  assert.equal(preview.contract,'COS_OWNER_EQUIPMENT_STAGE_V1');
  assert.equal(preview.productIdsMatched,3);
  assert.equal(preview.recordedField,1);
  assert.equal(preview.recordedShop,2);
  assert.equal(preview.readyToCommit,false);
  const entry=(await db.query("select source_bytes,records,receipt from cos_mhelp_placement_private.owner_equipment_stages where id=$1",[id])).rows[0];
  assert.equal(Buffer.from(entry.source_bytes).toString('hex'),source.toString('hex'));
  assert.equal(entry.records.find(x=>x.productId==='13').binding,null);
  assert.equal(entry.records.find(x=>x.productId==='13').placementHeld,true);
  assert.equal(entry.receipt.trackerRecords.length,3);
  assert.equal((await db.query("select active_sha256 from cos_mhelp_placement_private.upload_control")).rows[0].active_sha256,previous);
  const applied=await commit(db,id);
  assert.equal(applied.applied,true);
  assert.equal(applied.contract,'COS_OWNER_EQUIPMENT_COMMIT_V1');
  assert.equal((await db.query("select active_sha256 from cos_mhelp_placement_private.upload_control")).rows[0].active_sha256,digest);
  const repeated=await commit(db,id);
  assert.equal(repeated.idempotent,true);
  assert.equal(repeated.contract,applied.contract);
  assert.equal(repeated.stageId,applied.stageId);
  assert.equal(repeated.sourceReceiptsApplied,true);
 }finally{await db.close();}
});
test('source checksum, source CAS, changed current 2027 ID, and weak Owner confirmation are rejected',async()=>{
 const db=await setup();
 try{
  await assert.rejects(stage(db,params(randomUUID(),{sourceSha:'d'.repeat(64)})),/checksum mismatch/);
  await assert.rejects(stage(db,params(randomUUID(),{prevSha:'d'.repeat(64)})),/source changed/);
  await assert.rejects(stage(db,params(randomUUID(),{census:[{...census[0],productId:'999'},...census.slice(1)]})),/Product ID authority mismatch/);
  const id=randomUUID();await stage(db,params(id));
  await assert.rejects(commit(db,id,'yes'),/Explicit source approval/);
  await assert.rejects(commit(db,id,'I reviewed all current records but the census is stale.','d'.repeat(64)),/Equipment source review is stale/);
  assert.equal((await db.query("select active_sha256 from cos_mhelp_placement_private.upload_control")).rows[0].active_sha256,previous);
 }finally{await db.close();}
});
