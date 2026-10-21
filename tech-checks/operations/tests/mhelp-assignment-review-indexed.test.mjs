import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {baseline,fixture,reviewData,stageId,activeSha,signature} from './fixtures/assignment-review-indexed.mjs';
import {prepareOwnerAssignmentReviewIndexedSql,assignmentReviewSignature,reviewedAssignmentReviewSha256} from '../scripts/prepareOwnerAssignmentReviewIndexedSql.mjs';

const migration=prepareOwnerAssignmentReviewIndexedSql(baseline);
const errorMessage=error=>String(error.stderr||error.message).match(/ERROR:\s*([^\n]+)/)?.[1]||error.message;
async function outcome(f){try{return {value:await f.read()};}catch(error){return {error:errorMessage(error)};}}
/** Every variant executes both complete SQL functions against the same fixture.
 * Compare the complete JSON, including reviewDigest and per-item evidence hashes. */
async function compareVariants(variants){
 const f=await fixture();
 try{
  const results=[];
  for(const repaired of [false,true]){
   if(repaired)await f.db.exec(migration);
   for(const [index,variant]of variants.entries()){
    const data=reviewData(10,5);variant.change?.(data);await f.load(data);await variant.mutate?.(f,data);
    const before=await f.protectedState(),result=await outcome(f);
    assert.deepEqual(await f.protectedState(),before,`${variant.name}: read cannot modify protected state`);
    if(repaired)assert.deepEqual(result,results[index],`${variant.name}: complete original/repaired parity`);
    else{results.push(result);variant.check?.(result);}
   }
  }
 }finally{await f.db.close();}
}

test('complete 1001-record/354-item review retains every item, digest and all five protected cases',async t=>{
 const f=await fixture();
 try{
  const data=reviewData();await f.load(data);const protectedBefore=await f.protectedState();
  const started=performance.now(),before=await f.read(),oldMs=performance.now()-started;
  assert.equal(before.items.length,354);assert.equal(before.items.filter(x=>x.eligible).length,354);
  assert.equal(before.items.filter(x=>x.sourceAssignmentChanged).length,5);
  assert.equal(before.items.filter(x=>x.continuity?.kind==='timestamp_only').length,344);
  assert.equal(before.items.filter(x=>x.continuity?.kind==='assignment_difference').length,8);
  assert.equal(before.items.filter(x=>x.continuity===null).length,2);
  const byId=new Map(before.items.map(x=>[x.productId,x]));
  const aledo=byId.get('2233383');
  assert.equal(aledo.before.placement,'SHOP');assert.equal(aledo.after.placement,'FIELD');assert.equal(aledo.after.customer,'HEB Aledo');
  assert.deepEqual(aledo.after.address,{street:'14820 Skyline Ridge Rd',city:'Aledo',state:'TX',zip:'76008'});
  assert.equal(aledo.current.gpsPresent,true);assert.equal(aledo.current.internalTrackerCustomer,'Old internal customer');
  for(const id of ['2300344','2226860']){
   const item=byId.get(id);assert.equal(item.after.placement,'SHOP');assert.equal(item.guardChanged,true);
   assert.equal(item.current.nativePlacement,'shop');assert.equal(item.current.nativeStatus,'available');assert.ok(item.current.shopReceiptId);
  }
  assert.equal(byId.get('2229407').after.placement,'SHOP');assert.equal(byId.get('2229407').current.nativePlacement,'field');
  assert.equal(byId.get('2229931').identity.nativeUnitId,null);assert.ok(byId.get('2229931').identity.trackerId);
  await f.db.exec(migration);
  const repairedAt=performance.now(),after=await f.read(),newMs=performance.now()-repairedAt;
  assert.deepEqual(after,before,'Complete review output and digest must remain byte-equivalent as JSON values');
  assert.deepEqual(await f.read(),after,'Read retry is deterministic without saved cache');
  assert.deepEqual(await f.protectedState(),protectedBefore,'No placements, links, IPs, SIMs, GPS, receipts or stage approvals changed');
  t.diagnostic(`Synthetic fixture only: original ${oldMs.toFixed(1)}ms; indexed ${newMs.toFixed(1)}ms. Timing is diagnostic, not a test threshold or live measurement.`);
 }finally{await f.db.close();}
});

test('scoped lookup preserves first matching row, duplicates, and missing/null Product ID semantics',async()=>{
 await compareVariants([
  {name:'duplicate scoped row after first match',change:d=>d.scoped.push({...d.scoped[0],binding:null}),check:r=>assert.equal(r.value.items.length,5)},
  {name:'first scoped row has no binding',change:d=>d.scoped.unshift({...d.scoped[0],binding:null}),check:r=>assert.equal(r.value.items.length,4)},
  {name:'first scoped row has stale identity',change:d=>d.scoped.unshift({...d.scoped[0],unitNumber:'Different exact unit'}),check:r=>assert.equal(r.value.items.find(x=>x.productId==='2233383').eligible,false)},
  {name:'missing prior Product ID',change:d=>d.scoped=d.scoped.filter(x=>x.productId!=='2233383'),check:r=>assert.equal(r.value.items.length,4)},
  {name:'null and absent IDs in scoped and staged rows',change:d=>{
   d.scoped.push(null,{productId:null,binding:d.scoped[0].binding},{binding:d.scoped[0].binding});
   d.records.push({...d.records[0],productId:null},{...d.records[0],productId:undefined});
  },check:r=>assert.equal(r.value.items.length,5)},
  {name:'null and missing unused continuity IDs',change:d=>d.savedSnapshots.push(null,{productId:null},{protectedStateSha256:'unrelated'}),check:r=>assert.equal(r.value.items.length,5)},
  {name:'empty item set does not inspect malformed unused continuity/original arrays',change:d=>{
   d.records=d.records.map(r=>({...r,placementHeld:false}));d.savedSnapshots='unused invalid shape';d.original='unused invalid shape';
  },check:r=>assert.equal(r.value.items.length,0)},
  {name:'empty staged record array does not inspect malformed unused scoped array',change:d=>{
   d.records=[];d.scoped='unused invalid shape';
  },check:r=>assert.equal(r.value.items.length,0)},
  {name:'empty original and scoped arrays',change:d=>{d.original=[];d.scoped=[];},check:r=>assert.equal(r.value.items.length,0)},
 ]);
});

test('continuity duplicates, missing snapshots and changed evidence still reject the entire read',async()=>{
 const rejected=r=>assert.match(r.error,/Assignment evidence changed after staging/);
 await compareVariants([
  {name:'same continuity Product ID repeated',change:d=>d.savedSnapshots.push(structuredClone(d.savedSnapshots[0])),check:rejected},
  {name:'conflicting first continuity snapshot',change:d=>d.savedSnapshots.unshift({...d.savedSnapshots[0],protectedStateSha256:'different'}),check:rejected},
  {name:'missing continuity snapshot',change:d=>d.savedSnapshots=d.savedSnapshots.slice(1),check:rejected},
  {name:'malformed continuity contract',change:d=>d.receiptContract='OTHER_CONTRACT',check:rejected},
  {name:'fresh protected-state guard changed after stage',change:d=>d.currentSnapshots[0].protectedStateSha256='fresh-changed-guard',check:rejected},
  {name:'fresh identity proof changed after stage',change:d=>d.currentSnapshots[0].canonicalIdentityEvidence.provenance={changed:true},check:rejected},
  {name:'partial evidence read failure',mutate:f=>f.db.query('update cos_mhelp_placement_private.fixture_source set failure_product=$1',['2233383']),check:r=>assert.match(r.error,/synthetic evidence read failure/)},
 ]);
});

test('native and tracker competing identities, retired or stale identities and lifecycle holds remain blocked',async()=>{
 const blocked=r=>assert.equal(r.value.items.find(x=>x.productId==='2233383').eligible,false);
 await compareVariants([
  {name:'another Product ID shares native identity',change:d=>d.original.push({productId:'9999999',binding:{nativeUnitId:d.scoped[0].binding.nativeUnitId}}),check:blocked},
  {name:'another Product ID shares tracker identity',change:d=>d.original.push({productId:'9999999',binding:{trackerId:d.scoped[0].binding.trackerId}}),check:blocked},
  {name:'same Product ID and null/absent competing IDs preserve SQL null semantics',change:d=>{
   const b=d.scoped[0].binding;d.original.push({productId:'2233383',binding:b},{productId:null,binding:b},{binding:b},null,{productId:'9999999',binding:null});
  },check:r=>assert.equal(r.value.items.find(x=>x.productId==='2233383').eligible,true)},
  {name:'stale native label',change:d=>d.natives[0].unit_number='Different native identity',check:blocked},
  {name:'missing tracker identity',change:d=>d.trackers.shift(),check:blocked},
  {name:'retired native identity',change:d=>d.natives[0].status='retired',check:blocked},
  {name:'lifecycle restriction',change:d=>d.records[0].lifecycle='DO_NOT_USE',check:blocked},
  {name:'archived representation conflict',change:d=>d.archived.push({archived_native_id:d.natives[0].id}),check:blocked},
  {name:'conflicting geocode Product ID',change:d=>d.geocode.push({active:true,native_unit_id:d.natives[0].id,product_id:'9999999'}),check:blocked},
  {name:'Shop receipt cannot be guessed',change:d=>d.moves=d.moves.filter(m=>m.unit_id!==d.scoped[1].binding.nativeUnitId),check:r=>assert.equal(r.value.items.find(x=>x.productId==='2300344').blocker,'Changed protected state lacks an exact recorded Shop receipt')},
  {name:'early identity rejection does not evaluate malformed original array',change:d=>{
   d.records=[d.records[0]];d.scoped[0].unitNumber='Different exact identity';d.original='unused invalid original';
  },check:blocked},
  {name:'needed malformed original array still errors',change:d=>d.original='invalid original',check:r=>assert.match(r.error,/cannot extract elements from a scalar/)},
 ]);
});

test('current source, scoped revision, bytes, expiry and applied-stage guards retain rejection behavior',async()=>{
 await compareVariants([
  {name:'active source changed',mutate:f=>f.db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',['c'.repeat(64)]),check:r=>assert.match(r.error,/Assignment source stage is stale/)},
  {name:'original bytes changed',mutate:f=>f.db.exec("update cos_mhelp_placement_private.owner_equipment_stages set source_bytes=convert_to('changed','UTF8')"),check:r=>assert.match(r.error,/Assignment source stage is stale/)},
  {name:'stage expired',mutate:f=>f.db.exec("update cos_mhelp_placement_private.owner_equipment_stages set expires_at='2000-01-01'"),check:r=>assert.match(r.error,/Assignment source stage is stale/)},
  {name:'stage already applied',mutate:f=>f.db.exec("update cos_mhelp_placement_private.owner_equipment_stages set applied_at='2026-10-21'"),check:r=>assert.match(r.error,/Assignment source stage is stale/)},
  {name:'scoped revision changed',mutate:f=>f.db.exec('update cos_mhelp_placement_private.scoped_control set revision=8'),check:r=>assert.match(r.error,/Assignment scoped authority changed/)},
  {name:'scoped record changed',mutate:f=>f.db.exec("update cos_mhelp_placement_private.fixture_source set scoped=jsonb_set(scoped,'{0,customer}','\"Concurrent customer change\"')"),check:r=>assert.match(r.error,/Assignment scoped authority changed/)},
 ]);
});

test('subsequent requests reevaluate evidence; approved item membership stays stable without refreshing guards',async()=>{
 const f=await fixture();try{
  const data=reviewData(10,5);await f.load(data);await f.db.exec(migration);const first=await f.read();
  await f.db.exec("update cos_mhelp_placement_private.fixture_snapshots set snapshot=jsonb_set(snapshot,'{protectedStateSha256}','\"new-current-state\"') where product_id='2233383'");
  await assert.rejects(f.read,/Assignment evidence changed after staging/);
  await f.load(data);assert.deepEqual(await f.read(),first,'Retry with original evidence is unchanged');
  data.records=data.records.map(r=>({...r,placementHeld:false}));data.reviewReceipt={assignmentReview:{productIds:first.items.map(x=>x.productId)}};
  await f.load(data);const approvedMembership=await f.read();
  assert.deepEqual(approvedMembership,first,'Review membership and digest are retained after explicit approval records the same IDs');
  const stored=await f.db.query('select records from cos_mhelp_placement_private.upload_batches where source_sha256=$1',[activeSha]);
  assert.equal(stored.rows[0].records.find(x=>x.productId==='2300344').binding.expectedGuard,data.scoped[1].binding.expectedGuard,'Never refresh an existing protected guard');
 }finally{await f.db.close();}
});

test('installation preserves owner, ACL, security and configuration and refuses repeated installation',async()=>{
 const f=await fixture();try{
  const {definition,...before}=await f.catalog();assert.equal(definition,baseline);assert.equal(signature,assignmentReviewSignature);
  assert.equal(createHash('sha256').update(definition).digest('hex'),reviewedAssignmentReviewSha256);
  assert.deepEqual(before,{owner:'postgres',acl:'{postgres=X/postgres}',prosecdef:false,provolatile:'s',proconfig:['search_path=""'],anon_execute:false,authenticated_execute:false,service_execute:false});
  await f.db.exec(migration);const {definition:changed,...after}=await f.catalog();assert.deepEqual(after,before);assert.notEqual(changed,definition);
  await assert.rejects(()=>f.db.exec(migration),/Installed assignment review changed/);await f.db.exec('rollback');
  assert.deepEqual(await f.catalog(),{definition:changed,...after});
 }finally{await f.db.close();}
});

test('migration source/ACL drift and late installation failure abort without changing function or data',async()=>{
 for(const scenario of ['source','ACL','late failure']){
  const f=await fixture();try{
   await f.load(reviewData(10,5));
   if(scenario==='source')await f.db.exec("create or replace function cos_mhelp_placement_private.assignment_review(p_stage uuid) returns jsonb language sql stable set search_path='' as $$select '{}'::jsonb$$");
   if(scenario==='ACL')await f.db.exec('grant execute on function cos_mhelp_placement_private.assignment_review(uuid) to anon');
   const catalog=await f.catalog(),state=await f.protectedState();
   const candidate=scenario==='late failure'?migration.replace(/commit;\s*$/,()=>"do $$begin raise exception 'synthetic late installation failure';end $$;\ncommit;\n"):migration;
   await assert.rejects(()=>f.db.exec(candidate),scenario==='source'?/Installed assignment review changed/:scenario==='ACL'?/permissions or configuration changed/:/synthetic late installation failure/);
   await f.db.exec('rollback');assert.deepEqual(await f.catalog(),catalog);assert.deepEqual(await f.protectedState(),state);
  }finally{await f.db.close();}
 }
 assert.throws(()=>prepareOwnerAssignmentReviewIndexedSql(baseline+' '),/Exact reviewed assignment review definition required/);
});
