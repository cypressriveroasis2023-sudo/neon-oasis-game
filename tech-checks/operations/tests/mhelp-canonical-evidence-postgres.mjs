import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {assignmentPostgres} from './fixtures/assignment-postgres.mjs';
import {schema} from './fixtures/mhelp-placement-schema.mjs';
import {setup,installActualReview,actor,org,previous,censusSha,stage} from './mhelp-owner-staging-fixture.mjs';
import {prepareOwnerAssignmentReviewSql} from '../scripts/prepareOwnerAssignmentReviewSql.mjs';
import {prepareOwnerAssignmentContinuitySql,assignmentContinuityFunctions} from '../scripts/prepareOwnerAssignmentContinuitySql.mjs';
import {prepareOwnerCanonicalEvidenceSql,canonicalEvidenceFunctions} from '../scripts/prepareOwnerCanonicalEvidenceSql.mjs';

const filename='ServiceItem_List_20261020172623.csv';
const historicalSources=[previous,'b'.repeat(64)];
const note='I confirm these exact existing canonical identities and reviewed assignments.';
const secretMarker='private-original-canonical-proof';
const clone=value=>structuredClone(value);
const sourceSql=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
async function definitions(db,signatures){const result={};for(const signature of signatures)result[signature]=(await db.query('select pg_get_functiondef($1::regprocedure) d',[signature])).rows[0].d;return result;}

/** Synthetic local/in-memory fixture only. The CI opt-in uses the existing
 * disposable localhost PostgreSQL adapter and cannot accept a production URL. */
async function fixture({repair=true}={}){
 const db=await setup(process.env.COS_ASSIGNMENT_POSTGRES_CI==='1'?assignmentPostgres():undefined);
 try{
  await db.exec(schema.slice(schema.indexOf(' create table '),schema.indexOf(' create function ')));
  await db.exec("alter table public.equipment_units add column model_id uuid,add column sim text,add column ip text; create table cos_mhelp_placement_private.links(equipment_id text,tracker_id uuid,native_unit_id uuid,full_label text,observation jsonb,observed_at timestamptz);create table app_private.cos_fleet_shop_moves(id uuid,organization_id uuid,unit_id uuid,unit_number text,model_id uuid,created_at timestamptz,source_bindings jsonb);");
  const overlay=sourceSql('../db/mhelp_upload_overlay.sql');
  await db.exec('drop function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)');
  await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.upload_binding_guard('),overlay.indexOf('create function cos_mhelp_placement_private.review_upload(')));
  await installActualReview(db);
  await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.upload_tracker_snapshot('),overlay.indexOf('revoke all on function cos_mhelp_placement_private.upload_binding_guard(')));
  const originals=[],trackers=[];
  for(let index=0;index<2;index++){
   const productId=String(11001+index),unitNumber=`Ranger ${String(7+index).padStart(3,'0')}`;
   const trackerId=randomUUID(),nativeUnitId=randomUUID();
   await db.query("insert into app_private.vision_tracker_locations values($1,$2,$3,$3,'Ranger','FIELD','Field customer','Recorded site','Recorded address',29.7,-95.3)",[trackerId,org,unitNumber]);
   await db.query("insert into public.equipment_units(id,organization_id,unit_number,status,current_location_type,gps_latitude,gps_longitude,sim,ip) values($1,$2,$3,'available','field',29.7,-95.3,'preserved-sim','192.0.2.4')",[nativeUnitId,org,unitNumber]);
   await db.query('insert into public.equipment_unit_location_history values($1)',[nativeUnitId]);
   const expectedGuard=(await db.query('select cos_mhelp_placement_private.upload_binding_guard($1,$2) g',[trackerId,nativeUnitId])).rows[0].g;
   const reviewEvidence={kind:'exact_family_unit',privateProof:secretMarker,productId,trackerId,nativeUnitId};
   const representedUnitIds=[nativeUnitId],representationEvidenceSha256=createHash('sha256').update(JSON.stringify(representedUnitIds)).digest('hex');
   const evidenceSha256=createHash('sha256').update(JSON.stringify({identity:reviewEvidence,representedUnitIds,representationEvidenceSha256})).digest('hex');
   const binding={productId,fullLabel:unitNumber,trackerId,trackerLabel:unitNumber,nativeUnitId,nativeLabel:unitNumber,matchMethod:'exact_family_unit',canonicalKey:`ranger:${7+index}`,reviewEvidence,evidenceSha256,representedUnitIds,representationEvidenceSha256,expectedGuard};
   originals.push({productId,unitNumber,category:'Ranger',customerId:'100',customer:'Field customer',placement:'FIELD',lifecycle:'UNFLAGGED',sourceRow:index+2,sourceAddress:{street:'Recorded address',city:'Houston',state:'TX',zip:'77064'},binding});
   await db.query('insert into cos_mhelp_placement_private.links values($1,$2,$3,$4,null,null)',[productId,trackerId,nativeUnitId,unitNumber]);
   trackers.push({recordId:`tracker:${productId}`,matchedProductId:productId,unitNumber,category:'Ranger',placement:'FIELD',lifecycle:'ACTIVE',customer:'Field customer',binding:{state:'linked',trackerId,nativeUnitId,expectedGuard,unitIds:[nativeUnitId],unitLabels:{[trackerId]:unitNumber,[nativeUnitId]:unitNumber},representedUnitIds:[nativeUnitId],reviewEvidence}});
  }
  for(const [index,sha] of historicalSources.entries()){
   const receipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha,filename:'ServiceItem_List_20261013141848.csv',recordCount:originals.length,companyCustomerIds:['200'],trackerSource:{contract:'COS_CURRENT_TRACKER_CENSUS_V1',complete:true,sourceSha256:censusSha,totalSourceRecords:2},trackerRecords:trackers,authorizationSha256:'e'.repeat(64),libraryFileId:'libfile_syntheticcanonicalproof',receivedMessageId:'synthetic-evidence',receivedAt:'2026-10-13T08:00:00Z',receivedAtPrecision:'second',exportAsOf:null};
   await db.query("insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records,admitted_at) values($1,encode(sha256(convert_to(jsonb_build_object('receipt',$2::jsonb,'records',$3::jsonb)::text,'UTF8')),'hex'),$2,$3,$4) on conflict(source_sha256) do update set payload_sha256=excluded.payload_sha256,receipt=excluded.receipt,records=excluded.records,admitted_at=excluded.admitted_at",[sha,JSON.stringify(receipt),JSON.stringify(originals),`2026-10-${13+index}T08:00:00Z`]);
  }
  await db.exec(sourceSql('../db/mhelp-live-inventory.sql'));
  await db.exec('update cos_mhelp_placement_private.live_inventory_control set enabled=true');
  const apiRows=originals.map(({binding,...row})=>({...row,apiAssignment:{customerId:row.customerId,equipmentTypeId:'9'}}));
  const apiRun=async(expected,rows=apiRows)=>db.query("select public.cos_mhelp_live_inventory_session('run',$1) r",[JSON.stringify({portalId:'224643',complete:true,baselineSourceSha256:expected,readAt:new Date().toISOString(),records:rows})]).then(r=>r.rows[0].r);
  // Reproduce the defect through the real API importer: its public snapshot
  // loses private evidence before immutable API-source persistence.
  const oldRun=await apiRun(previous),baseSha=oldRun.sourceSha256;
  const currentRows=async()=>(await db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[baseSha])).rows[0].records;
  const apiBaseline=await currentRows();
  assert.equal(oldRun.state,'current');assert.ok(apiBaseline.every(r=>!('reviewEvidence' in r.binding)));
  assert.ok(apiBaseline.every(r=>r.binding.expectedGuard===originals.find(o=>o.productId===r.productId).binding.expectedGuard));
  await db.exec(await prepareOwnerAssignmentReviewSql(await definitions(db,[assignmentContinuityFunctions.stage,assignmentContinuityFunctions.commit])));
  await db.exec(await prepareOwnerAssignmentContinuitySql(await definitions(db,Object.values(assignmentContinuityFunctions))));
  const preservedSignatures=['cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)','cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)','cos_mhelp_placement_private.scoped_records(text)','cos_mhelp_placement_private.upload_snapshot()','cos_mhelp_placement_private.upload_tracker_snapshot(jsonb)'];
  const beforeDefinitions=await definitions(db,preservedSignatures);
  const install=async()=>db.exec(await prepareOwnerCanonicalEvidenceSql(await definitions(db,Object.values(canonicalEvidenceFunctions))));
  if(repair)await install();
  const rows=apiRows.map(({apiAssignment,...r},i)=>i===0?r:{...r,customerId:'200',customer:'Cameras OnSite',placement:'SHOP',sourceAddress:{street:'Known Shop',city:'Houston',state:'TX',zip:'77064'}});
  const bytes=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n'+rows.map(r=>[r.productId,r.unitNumber,r.customerId,r.customer,r.category,r.sourceAddress.street,r.sourceAddress.city,r.sourceAddress.state,r.sourceAddress.zip].join(',')).join('\n')+'\n');
  const sha=createHash('sha256').update(bytes).digest('hex'),id=randomUUID();
  const stageArgs=[actor,org,id,filename,sha,baseSha,censusSha,JSON.stringify(rows.map(r=>({productId:r.productId,unitLabel:r.unitNumber,family:r.category,placement:r.placement,customer:r.customer}))),bytes.toString('base64'),JSON.stringify(rows)];
  const read=()=>db.query('select public.cos_owner_mhelp_assignment_review_v1($1,$2,$3,$4,$5) r',[actor,org,id,sha,censusSha]).then(r=>r.rows[0].r);
  const approve=digest=>db.query("select public.cos_owner_mhelp_assignment_review_v1($1,$2,$3,$4,$5,'approve',$6,$7) r",[actor,org,id,sha,censusSha,digest,note]).then(r=>r.rows[0].r);
  const commit=()=>db.query('select public.cos_owner_mhelp_equipment_commit_v1($1,$2,$3,$4,$5,$6) r',[actor,org,id,baseSha,censusSha,note]).then(r=>r.rows[0].r);
  const stored=()=>db.query('select records,receipt,review_receipt,applied_at from cos_mhelp_placement_private.owner_equipment_stages where id=$1',[id]).then(r=>r.rows[0]);
  const protectedState=async()=>{const result={};for(const table of ['public.equipment_units','app_private.vision_tracker_locations','public.equipment_unit_location_history','cos_mhelp_placement_private.links','app_private.cos_fleet_shop_moves','app_private.cos_geocode_sources'])result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') r from ${table} t`)).rows[0].r;return result;};
  const recover=row=>db.query('select cos_mhelp_placement_private.recover_identity_evidence($1) r',[JSON.stringify(row)]).then(r=>r.rows[0].r);
  const historicalBatches=(await db.query("select source_sha256,receipt from cos_mhelp_placement_private.upload_batches where receipt->>'contract'='COS_MHELP_UPLOAD_V1'")).rows;
  const setHistory=async(records)=>{for(const source of historicalSources){const receipt=historicalBatches.find(b=>b.source_sha256===source).receipt;await db.query("update cos_mhelp_placement_private.upload_batches set records=$1,receipt=$3,payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',$3::jsonb,'records',$1::jsonb)::text,'UTF8')),'hex') where source_sha256=$2",[JSON.stringify(records),source,JSON.stringify(receipt)]);}};
  const active=()=>db.query('select active_sha256 a from cos_mhelp_placement_private.upload_control').then(r=>r.rows[0].a);
  return {db,originals,apiBaseline,apiRows,baseSha,id,sha,rows,stageArgs,install,read,approve,commit,stored,protectedState,recover,currentRows,apiRun,setHistory,active,beforeDefinitions,preservedSignatures,stage:()=>stage(db,stageArgs)};
 }catch(error){await db.close();throw error;}
}

test('actual API projection loss fails before repair, then exact historical proof permits full protected Owner flow',async()=>{
 const f=await fixture({repair:false});try{
  await assert.rejects(f.stage(),/Canonical identity evidence required/);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.owner_equipment_stages')).rows[0].n,0);
  const protectedBefore=await f.protectedState();await f.install();
  const recovered=await f.recover(f.apiBaseline[0]);
  assert.deepEqual(recovered.binding,f.originals[0].binding);
  assert.equal(recovered.provenance.contract,'COS_CANONICAL_IDENTITY_EVIDENCE_RECOVERY_V1');
  assert.equal(recovered.provenance.productId,f.originals[0].productId);
  assert.deepEqual(recovered.provenance.sources.map(s=>s.sourceSha256),historicalSources);
  for(const source of recovered.provenance.sources)for(const field of ['payloadSha256','recordSha256','proofSha256'])assert.match(source[field],/^[a-f0-9]{64}$/);
  await f.stage();const staged=await f.stored();
  assert.deepEqual(staged.records[0].binding,f.originals[0].binding);assert.equal(staged.records[1].binding,null);
  assert.deepEqual(staged.receipt.assignmentContinuity.canonicalIdentityRecovery,[recovered.provenance,(await f.recover(f.apiBaseline[1])).provenance]);
  const held=staged.receipt.assignmentContinuity.items[0];
  assert.deepEqual(held.originalBinding,f.apiBaseline[1].binding);
  assert.deepEqual(held.canonicalIdentityEvidence.binding,f.originals[1].binding);
  const review=await f.read();assert.equal(review.items.length,1);assert.equal(review.items[0].eligible,true);assert.equal(JSON.stringify(review).includes(secretMarker),false);
  assert.equal((await f.stage()).stageId,f.id);
  await assert.rejects(f.commit(),/assignment review required/);
  assert.equal((await f.approve(review.reviewDigest)).approved,true);
  assert.equal((await f.approve(review.reviewDigest)).idempotent,true);
  const approved=await f.stored();assert.deepEqual(approved.records.map(r=>r.binding),f.originals.map(r=>r.binding));
  assert.deepEqual(approved.receipt.assignmentContinuity,staged.receipt.assignmentContinuity);
  assert.equal((await f.commit()).applied,true);assert.equal((await f.commit()).idempotent,true);
  assert.equal(await f.active(),f.sha);assert.deepEqual(await f.protectedState(),protectedBefore);
  assert.deepEqual(await f.currentRows(),f.apiBaseline);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,1);
  assert.deepEqual(await definitions(f.db,f.preservedSignatures),f.beforeDefinitions);
  const publicSnapshot=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() r')).rows[0].r;
  assert.ok(publicSnapshot.records.every(r=>!('reviewEvidence' in r.binding)));
  assert.ok(publicSnapshot.trackerRecords.every(r=>!('reviewEvidence' in r.binding)));
 }finally{await f.db.close();}
});

test('missing, conflicting, malformed or mismatched historical identity proof fails closed without staging',async()=>{
 const f=await fixture();try{
  for(const scenario of ['missing','conflicting','malformed','evidence hash','representation hash','native identity','canonical key','duplicate Product ID','unreviewed history','tampered payload','wrong record count']){
   await f.setHistory(f.originals);
   const changed=clone(f.originals);
   if(scenario==='missing')delete changed[0].binding.reviewEvidence;
   if(scenario==='malformed')changed[0].binding.reviewEvidence=[];
   if(scenario==='evidence hash')changed[0].binding.evidenceSha256='0'.repeat(64);
   if(scenario==='representation hash')changed[0].binding.representationEvidenceSha256='0'.repeat(64);
   if(scenario==='native identity')changed[0].binding.nativeUnitId=randomUUID();
   if(scenario==='canonical key')changed[0].binding.canonicalKey='ranger:999';
   if(scenario==='duplicate Product ID')changed.push(clone(changed[0]));
   await f.setHistory(changed);
   if(scenario==='conflicting'){
    const conflicting=clone(f.originals);conflicting[0].binding.reviewEvidence.privateProof='different-private-proof';
    await f.db.query("update cos_mhelp_placement_private.upload_batches set records=$1,payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'records',$1::jsonb)::text,'UTF8')),'hex') where source_sha256=$2",[JSON.stringify(conflicting),historicalSources[1]]);
   }
   if(scenario==='unreviewed history')await f.db.exec("update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{reviewed}','false') where receipt->>'contract'='COS_MHELP_UPLOAD_V1'");
   if(scenario==='tampered payload')await f.db.exec("update cos_mhelp_placement_private.upload_batches set payload_sha256=repeat('0',64) where receipt->>'contract'='COS_MHELP_UPLOAD_V1'");
   if(scenario==='wrong record count')await f.db.exec("update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{recordCount}','999') where receipt->>'contract'='COS_MHELP_UPLOAD_V1'");
   await assert.rejects(f.recover(f.apiBaseline[0]),/canonical identity|historical.*evidence/i,scenario);
   await assert.rejects(f.stage(),/canonical identity|historical.*evidence/i,scenario);
   assert.equal(await f.active(),f.baseSha,scenario);
   assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.owner_equipment_stages')).rows[0].n,0,scenario);
  }
 }finally{await f.db.close();}
});

test('current proof and guards remain exact; malformed current proof cannot be replaced with convenient history',async()=>{
 const f=await fixture();try{
  const present=await f.recover(f.originals[0]);assert.deepEqual(present,{binding:f.originals[0].binding,provenance:null});
  const stale=clone(f.apiBaseline[0]);stale.binding.expectedGuard='0'.repeat(64);stale.binding.previousAssignment={productId:stale.productId,customerId:'999',placement:'SHOP',observedAt:'2026-10-12T08:00:00Z'};
  const recovered=await f.recover(stale);
  assert.equal(recovered.binding.expectedGuard,stale.binding.expectedGuard);assert.deepEqual(recovered.binding.previousAssignment,stale.binding.previousAssignment);
  assert.deepEqual({...recovered.binding,reviewEvidence:undefined},{...stale.binding,reviewEvidence:undefined});
  for(const reviewEvidence of [null,[],42,'invented-proof']){
   const malformed=clone(f.apiBaseline[0]);malformed.binding.reviewEvidence=reviewEvidence;
   await assert.rejects(f.recover(malformed),/cannot be recovered/);
  }
  const idsOnly=clone(f.apiBaseline[0]);idsOnly.binding.matchMethod='reviewed_product_id';
  assert.deepEqual(await f.recover(idsOnly),{binding:idsOnly.binding,provenance:null});
  assert.deepEqual(await f.recover({...f.apiBaseline[0],binding:null}),{binding:null,provenance:null});
  const grants=(await f.db.query("select r,signature,has_function_privilege(r,signature,'execute') allowed from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['cos_mhelp_placement_private.recover_identity_evidence(jsonb)','cos_mhelp_placement_private.recover_identity_evidence_records(jsonb)']) signature")).rows;
  assert.ok(grants.every(row=>row.allowed===false));
 }finally{await f.db.close();}
});

for(const phase of ['Stage','approval'])test(`a changed held native identity after ${phase} rejects review, retry, approval and commit atomically`,async()=>{
 const f=await fixture();try{
  await f.stage();const review=await f.read();if(phase==='approval')await f.approve(review.reviewDigest);const stored=await f.stored();
  await f.db.query("update public.equipment_units set ip='192.0.2.99' where id=$1",[f.apiBaseline[1].binding.nativeUnitId]);
  for(const action of [f.read,f.stage,()=>f.approve(review.reviewDigest),f.commit])await assert.rejects(action(),/evidence changed|assignment review|source stage/i);
  assert.deepEqual(await f.stored(),stored);assert.equal(await f.active(),f.baseSha);
  assert.equal((await f.db.query('select count(*)::int n from cos_mhelp_placement_private.upload_audit')).rows[0].n,0);
 }finally{await f.db.close();}
});

test('a late approval failure rolls back the entire staged evidence recovery',async()=>{
 const f=await fixture();try{
  await f.stage();const review=await f.read(),stored=await f.stored(),before=await f.protectedState();
  await f.db.exec("create function app_private.synthetic_evidence_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic evidence approval failure';end $$;create trigger evidence_failure after update on cos_mhelp_placement_private.owner_equipment_stages for each row execute function app_private.synthetic_evidence_failure()");
  await assert.rejects(f.approve(review.reviewDigest),/synthetic evidence approval failure/);
  assert.deepEqual(await f.stored(),stored);assert.deepEqual(await f.protectedState(),before);assert.equal(await f.active(),f.baseSha);
 }finally{await f.db.close();}
});

test('the existing API importer persists restored private evidence while its public read remains redacted',async()=>{
 const f=await fixture();try{
  const before=await f.protectedState(),run=await f.apiRun(f.baseSha);
  assert.equal(run.state,'current');assert.notEqual(run.sourceSha256,f.baseSha);
  const batch=(await f.db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[run.sourceSha256])).rows[0];
  assert.deepEqual(batch.records.map(r=>r.binding),f.originals.map(r=>r.binding));
  assert.deepEqual(await f.currentRows(),f.apiBaseline);assert.deepEqual(await f.protectedState(),before);
  const snapshot=(await f.db.query('select cos_mhelp_placement_private.upload_snapshot() r')).rows[0].r;
  assert.ok(snapshot.records.every(r=>!('reviewEvidence' in r.binding)));
  assert.ok(snapshot.trackerRecords.every(r=>!('reviewEvidence' in r.binding)));
  assert.equal((await f.apiRun(run.sourceSha256)).sourceSha256,run.sourceSha256);
 }finally{await f.db.close();}
});
