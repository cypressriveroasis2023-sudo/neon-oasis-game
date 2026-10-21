import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {schema as nativeSchema} from './fixtures/mhelp-placement-schema.mjs';

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
const timeoutSql=readFileSync(new URL('../docs/drafts/cos-owner-equipment-timeout-20261017.sql',import.meta.url),'utf8');
async function setup({withTimeout=true}={}){
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
 await db.exec("create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql stable as $$select repeat('d',64)$$;");
 await db.exec(readFileSync(new URL('../docs/drafts/cos-shop-address-evidence.sql',import.meta.url),'utf8'));
 await db.exec(draft);
 if(withTimeout)await db.exec(timeoutSql);
 return db;
}
test('bounded import timeout preserves function bodies, permissions and session limits',async()=>{
 const db=await setup({withTimeout:false});
 try{
  const query="select proname,prosrc,proacl::text privileges,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('cos_owner_mhelp_equipment_stage_v1','cos_owner_mhelp_equipment_commit_v1') order by proname";
  const before=(await db.query(query)).rows;
  const session=(await db.query('show statement_timeout')).rows;
  await db.exec(timeoutSql);
  const after=(await db.query(query)).rows;
  assert.deepEqual(after.map(({proconfig,...row})=>row),before.map(({proconfig,...row})=>row));
  for(const row of after){
   assert.ok(row.proconfig.includes('statement_timeout=60s'));
   assert.ok(row.proconfig.includes('search_path=""'));
  }
  assert.deepEqual((await db.query('show statement_timeout')).rows,session);
 }finally{await db.close();}
});
const params=(requestId=randomUUID(),overrides={})=>[actor,org,requestId,'ServiceItem_List_20261016131754.csv',overrides.sourceSha||digest,overrides.prevSha||previous,censusSha,JSON.stringify(overrides.census||census),source.toString('base64'),JSON.stringify(records)];
const stage=(db,args)=>db.query("select public.cos_owner_mhelp_equipment_stage_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::jsonb,$9::text,$10::jsonb) result",args).then(r=>r.rows[0].result);
const commit=(db,id,note='I reviewed and approve the current COS Field and Shop inventory.',sha=censusSha)=>db.query("select public.cos_owner_mhelp_equipment_commit_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) result",[actor,org,id,previous,sha,note]).then(r=>r.rows[0].result);
async function installActualReview(db){
 await db.exec("create table cos_mhelp_placement_private.upload_audit(id bigint generated always as identity,action text,source_sha256 text,previous_sha256 text,authorization_sha256 text)");
 await db.exec('drop function cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)');
 const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
 await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.review_upload('),overlay.indexOf('create function cos_mhelp_placement_private.rollback_upload(')));
}

for(const productLink of [true,false])test(`actual native GPS changes fence commit and stale ${productLink?'product':'tracker-only'} links are held on fresh stage`,async()=>{
 const db=await setup();
 try{
  await db.exec(nativeSchema.slice(nativeSchema.indexOf(' create table '),nativeSchema.indexOf(' create function ')));
  await db.exec('create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,full_label text,observation jsonb,observed_at timestamptz)');
  await db.exec('drop function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)');
  const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
  await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.upload_binding_guard('),overlay.indexOf('create function cos_mhelp_placement_private.review_upload(')));
  await installActualReview(db);
  const tracker=randomUUID();
  await db.query("insert into app_private.vision_tracker_locations values($1,$2,'Ranger 007','ranger007','RANGERS','FIELD','Domain Builders','Saved Site','Saved Address',30,-95)",[tracker,org]);
  const guard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,null) value',[tracker])).rows[0].value;
  const old=(await db.query('select records,receipt from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[previous])).rows[0];
  if(productLink)old.records[0].binding={productId:'11',trackerId:tracker,nativeUnitId:null,trackerLabel:'Ranger 007',nativeLabel:null,fullLabel:'Ranger 007',matchMethod:'exact_family_unit',representedUnitIds:[tracker],representationEvidenceSha256:previous,canonicalKey:'RANGER:7',reviewEvidence:{method:'synthetic'},evidenceSha256:previous,expectedGuard:guard};
  old.receipt.trackerRecords[0].binding={state:'linked',trackerId:tracker,nativeUnitId:null,unitIds:[tracker],representedUnitIds:[tracker],unitLabels:{[tracker]:'Ranger 007'},expectedGuard:guard};
  await db.query('update cos_mhelp_placement_private.upload_batches set records=$1,receipt=$2 where source_sha256=$3',[JSON.stringify(old.records),JSON.stringify(old.receipt),previous]);
  const first=randomUUID();await stage(db,params(first));
  await db.query("update app_private.vision_tracker_locations set latitude=31,site='Newer approved site' where id=$1",[tracker]);
  const preserved=(await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t where id=$1',[tracker])).rows[0].value;
  await assert.rejects(commit(db,first),/identity graph changed/);
  assert.equal((await db.query('select active_sha256 from cos_mhelp_placement_private.upload_control')).rows[0].active_sha256,previous);
  const fresh=randomUUID();await stage(db,params(fresh));
  const held=(await db.query('select records,receipt from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[fresh])).rows[0];
  assert.equal(held.records[0].binding,null);assert.equal(held.records[0].placementHeld,true);
  assert.equal(held.receipt.trackerRecords[0].binding.state,'held');
  await commit(db,fresh);
  assert.deepEqual((await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t where id=$1',[tracker])).rows[0].value,preserved);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,1);
 }finally{await db.close();}
});

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
  await installActualReview(db);
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

test('complete API baseline → October20 CSV preview/stage/commit preserves 1001 IDs and native records',async()=>{
 const {parseEquipmentCsv}=await import('../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts');
 const {ownerEquipmentCsvReview}=await import('../../supabase/functions/cos-operations-pages/mhelpEquipmentOwnerReview.ts');
 const {stageOwnerEquipmentCsv,commitOwnerEquipmentCsv}=await import('../../supabase/functions/cos-operations-pages/mhelpEquipmentWriteBridge.ts');
 const db=await setup();try{
  await db.exec(nativeSchema.slice(nativeSchema.indexOf(' create table '),nativeSchema.indexOf(' create function ')));await installActualReview(db);
  // Synthetic census. The actual customer file is never included in source control.
  await db.exec("alter table public.equipment_units add column ip text,add column sim text; insert into public.equipment_units(id,organization_id,unit_number,status,gps_latitude,gps_longitude,ip,sim) values('00000000-0000-4000-8000-000000000777','ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5','Ranger 777','ACTIVE',30,-95,'192.0.2.7','synthetic-sim');insert into public.equipment_unit_location_history values('00000000-0000-4000-8000-000000000777');insert into app_private.vision_tracker_locations values('00000000-0000-4000-8000-000000000778','ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5','Ranger 777','ranger777','RANGERS','FIELD','Domain Builders','Saved Site','Saved Address',30,-95)");
  const nativeSnapshot=async()=>{const all={};for(const table of ['public.equipment_units','public.equipment_unit_location_history','app_private.vision_tracker_locations'])all[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') value from ${table} t`)).rows[0].value;return all;};const protectedBefore=await nativeSnapshot();
  const csv=['ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip,ProductDesc',...Array.from({length:1001},(_,i)=>`${i+1},Ranger ${i+1},${i<284?'100':'200'},${i<284?'Domain Builders':'Cameras OnSite'},Ranger,${i+1} Main St,Houston,TX,77064,198.51.100.77`)].join('\n');
  const next=parseEquipmentCsv(csv),old=structuredClone(next);for(const r of old.slice(284,287))Object.assign(r,{placement:'FIELD',customerId:'100',customer:'Domain Builders'});
  const api={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',reviewed:true,complete:true,recordCount:1001,sourceSha256:previous,payloadSha256:'b'.repeat(64),receivedAt:'2026-10-20T17:36:07Z',receivedAtPrecision:'second',exportAsOf:null,apiMissingRecords:[],records:old,companyCustomerIds:['200'],trackerRecords:[]};
  await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1,records=$2 where source_sha256=$3',[JSON.stringify(api),JSON.stringify(old),previous]);
  const hash=createHash('sha256').update(csv).digest('hex'),body={sourceFilename:'ServiceItem_List_20261020170000.csv',bytesBase64:Buffer.from(csv).toString('base64'),expectedSha256:hash};let reads=0;
  const verifyCensus=async()=>{reads++;return {contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1',verifiedBy:'cos_sheets_service',sourceSha256:censusSha,observedAt:new Date().toISOString(),productIds:next.map(r=>r.productId),productRows:next.map(r=>({productId:r.productId,family:r.category,unitLabel:r.unitNumber,placement:r.placement,customer:r.customer})),total:1001,field:284,shop:717};};
  const options={actorId:actor,organizationId:org,previous:api,body,google:{getServiceAccountJson:()=>null},verifyCensus};
  const review=await ownerEquipmentCsvReview(options);assert.equal(review.censusStatus,'verified');assert.equal(review.readyToCommit,false);assert.equal(review.admission.gates.canCommit,false);assert.equal(review.changes.placement,3);assert.deepEqual(review.inventory,{total:1001,field:284,shop:717,inactive:0});
  const rpc=async(name,a)=>{
   if(name==='cos_owner_mhelp_equipment_stage_v1')return stage(db,[a.p_actor_user_id,a.p_organization_id,a.p_request_id,a.p_filename,a.p_source_sha256,a.p_expected_active_sha256,a.p_current_2027_sha256,JSON.stringify(a.p_current_2027_rows),a.p_original_bytes_base64,JSON.stringify(a.p_records)]);
   assert.equal(name,'cos_owner_mhelp_equipment_commit_v1');return commit(db,a.p_stage_id,a.p_confirmation_text,a.p_current_2027_sha256);
  };
  const staged=await stageOwnerEquipmentCsv({...options,requestId:randomUUID(),rpc});assert.equal(staged.productIdsMatched,1001);assert.equal(staged.readyToCommit,false);
  const out=await commitOwnerEquipmentCsv({...options,stageId:staged.stageId,confirmationText:'I reviewed the October 20 source with 1001 IDs, 284 Field and 717 Shop.',rpc});assert.deepEqual({records:out.records,field:out.field,shop:out.shop},{records:1001,field:284,shop:717});assert.equal(reads,3);
  const saved=(await db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[hash])).rows[0].records;assert.equal(new Set(saved.map(r=>r.productId)).size,1001);assert.equal(saved.filter(r=>r.placementHeld).length,3);assert(!JSON.stringify(saved).includes('198.51.100.77'));assert.deepEqual(await nativeSnapshot(),protectedBefore);
 }finally{await db.close();}
});

for(const scenario of ['verified enrichment','different historical address','different historical customer','different historical placement','stale guard','lifecycle change','nonblank API address','unreviewed history','corrupt history','unsupported baseline'])
 test(`Shop source-address stage: ${scenario}`,async()=>{
 const db=await setup();
 try{
  await db.exec(nativeSchema.slice(nativeSchema.indexOf(' create table '),nativeSchema.indexOf(' create function ')));
  await db.exec('create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,full_label text,observation jsonb,observed_at timestamptz)');
  await installActualReview(db);
  const tracker=randomUUID();
  await db.query("insert into app_private.vision_tracker_locations values($1,$2,'Ranger 024','ranger024','RANGERS','SHOP','Cameras OnSite','Saved Shop','Saved Address',30,-95)",[tracker,org]);
  const old=(await db.query('select records,receipt from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[previous])).rows[0];
  const historyRows=structuredClone(old.records),historySha='f'.repeat(64);
  if(scenario==='different historical address')historyRows[1].sourceAddress.street='Other Shop';
  if(scenario==='different historical customer')historyRows[1].customerId='201';
  if(scenario==='different historical placement')historyRows[1].placement='FIELD';
  const historyReceipt={...old.receipt,sourceSha256:historySha,reviewed:scenario!=='unreviewed history'};
  await db.query("insert into cos_mhelp_placement_private.upload_batches values($1,'pending',$2,$3,clock_timestamp()-interval '1 day')",[historySha,JSON.stringify(historyReceipt),JSON.stringify(historyRows)]);
  await db.query("update cos_mhelp_placement_private.upload_batches set payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',records)::text,'UTF8')),'hex') where source_sha256=$1",[historySha]);
  if(scenario==='corrupt history')await db.query("update cos_mhelp_placement_private.upload_batches set payload_sha256=repeat('0',64) where source_sha256=$1",[historySha]);
  const binding={productId:'12',trackerId:tracker,nativeUnitId:null,trackerLabel:'Ranger 024',nativeLabel:null,fullLabel:'Ranger 024',matchMethod:'exact_family_unit',representedUnitIds:[tracker],representationEvidenceSha256:previous,canonicalKey:'RANGER:24',reviewEvidence:{method:'synthetic'},evidenceSha256:previous,expectedGuard:(scenario==='stale guard'?'e':'d').repeat(64)};
  old.records[1]={...old.records[1],binding,sourceAddress:{street:'',city:'',state:'',zip:''},apiAssignment:{placementProof:{version:1,serviceVerified:false,siteLabel:''}},addressReview:null};
  if(scenario==='nonblank API address')old.records[1].sourceAddress.street='Other Shop';
  if(scenario==='lifecycle change')old.records[1].lifecycle='DO_NOT_USE';
  old.receipt={...old.receipt,contract:scenario==='unsupported baseline'?'COS_MHELP_UPLOAD_V1':'COS_MHELP_API_V1',complete:true,origin:'mhelpdesk_api',portalId:'224643'};
  await db.query('update cos_mhelp_placement_private.upload_batches set records=$1,receipt=$2 where source_sha256=$3',[JSON.stringify(old.records),JSON.stringify(old.receipt),previous]);
  const nativeBefore=(await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t')).rows;
  const id=randomUUID();await stage(db,params(id));
  const staged=(await db.query('select records,receipt from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[id])).rows[0];
  const row=staged.records.find(r=>r.productId==='12');
  assert.deepEqual(row.sourceAddress,records[1].sourceAddress);
  if(['verified enrichment','different historical placement'].includes(scenario)){
   assert.deepEqual(row.binding,binding);assert.notEqual(row.placementHeld,true);
  }else{assert.equal(row.binding,null);assert.equal(row.placementHeld,true);}
  await commit(db,id);await commit(db,id);
  assert.deepEqual((await db.query('select to_jsonb(t) value from app_private.vision_tracker_locations t')).rows,nativeBefore);
  assert.equal((await db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,1);
  assert.deepEqual((await db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[previous])).rows[0].records,old.records);
 }finally{await db.close();}
});

test('guarded SQL release preserves stage privileges and aborts on definition drift',async()=>{
 const db=await setup();
 try{
  const {prepareMhelpShopAddressSql}=await import('../scripts/prepareMhelpShopAddressSql.mjs');
  await db.exec("create table cos_mhelp_placement_private.live_inventory_control(singleton boolean,enabled boolean,last_attempt_at timestamptz,last_success_at timestamptz,error_code text);insert into cos_mhelp_placement_private.live_inventory_control values(true,false,null,null,null);create function cos_mhelp_placement_private.api_base_upload_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;create function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;revoke all on function cos_mhelp_placement_private.upload_snapshot() from public,anon,authenticated,service_role;");
  // Reconstruct the prior stage by reversing only this patch's three anchors.
  const patched=(await db.query("select pg_get_functiondef('public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)'::regprocedure) d")).rows[0].d;
  const start=patched.indexOf("or (old_row->'sourceAddress' is distinct from row_data->'sourceAddress' and not coalesce((");
  const stop=patched.indexOf('),false))',start)+9;
  const beforeStage=(patched.slice(0,start)+"or old_row->'sourceAddress' is distinct from row_data->'sourceAddress'"+patched.slice(stop))
   .replace('; shop_baseline jsonb;',';').replace(" shop_baseline:=cos_mhelp_placement_private.shop_address_baseline(prior_sha);\n",'');
  await db.exec(beforeStage);
  const projection=readFileSync(new URL('../db/mhelp-live-inventory-projection.sql',import.meta.url),'utf8');
  const pstart=projection.indexOf('create function cos_mhelp_placement_private.upload_snapshot()');
  await db.exec(projection.slice(pstart,projection.indexOf('$$;',pstart)+3).replace('create function','create or replace function'));
  const names=['public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb)','cos_mhelp_placement_private.upload_snapshot()'];
  const installed={};for(const name of names)installed[name]=(await db.query('select pg_get_functiondef($1::regprocedure) d',[name])).rows[0].d;
  const inspect=()=>db.query('select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[names[0]]).then(r=>r.rows);
  const before=await inspect();
  await db.exec(await prepareMhelpShopAddressSql(installed));assert.deepEqual(await inspect(),before);
  assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') v",[names[0]])).rows[0].v,false);
  assert.equal((await db.query("select has_function_privilege('service_role','cos_mhelp_placement_private.shop_address_baseline(text)','EXECUTE') v")).rows[0].v,false);
  await assert.rejects(db.exec(await prepareMhelpShopAddressSql(installed)),/Installed source changed/);
  await db.exec('rollback');assert.deepEqual(await inspect(),before);
 }finally{await db.close();}
});
