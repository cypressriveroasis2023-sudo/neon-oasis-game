import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {smallFixture,representativeFixture,snapshot,baselineSql,candidateSql,baselineCatalog,catalogSql,org,sha,request,t,n} from './fixtures/placement-snapshot-dedup.mjs';
const install=await readFile(new URL('../db/mhelp-placement-snapshot-dedup-install.sql',import.meta.url),'utf8');
const rollback=await readFile(new URL('../db/mhelp-placement-snapshot-dedup-rollback.sql',import.meta.url),'utf8');
const candidateCatalog=JSON.parse(await readFile(new URL('./fixtures/placement-snapshot-dedup-catalog.json',import.meta.url),'utf8'));
async function attempt(db){
 await db.exec('savepoint snapshot_attempt');
 try{const value=await snapshot(db);await db.exec('release savepoint snapshot_attempt');return {value};}
 catch(e){await db.exec('rollback to savepoint snapshot_attempt;release savepoint snapshot_attempt');return {error:e.code};}
}
async function compare(db,mutate=async()=>{},check=()=>{}){
 await db.exec('begin');
 try{await mutate();await db.exec(baselineSql);const before=await attempt(db);await db.exec(candidateSql);const after=await attempt(db);assert.deepEqual(after,before);await check(after.value,after);return after;}
 finally{await db.exec('rollback');}
}
test('exact live baseline/catalog and guarded rollout/rollback preserve full results and all permissions',async()=>{
 const f=await smallFixture();try{
  assert.deepEqual((await f.db.query(catalogSql)).rows,baselineCatalog);const before=await snapshot(f.db);
  await f.db.exec(install);assert.deepEqual((await f.db.query(catalogSql)).rows,candidateCatalog);assert.deepEqual(await snapshot(f.db),before);
  for(const role of ['anon','authenticated','service_role']){
   await f.db.exec('set role '+role);
   await assert.rejects(()=>f.db.query('select cos_mhelp_placement_private.upload_snapshot()'),e=>e.code==='42501');
   if(role==='service_role')assert.deepEqual(await snapshot(f.db),before);else await assert.rejects(()=>snapshot(f.db),e=>e.code==='42501');
   await f.db.exec('reset role');
  }
  await f.db.exec(rollback);assert.deepEqual((await f.db.query(catalogSql)).rows,baselineCatalog);assert.deepEqual(await snapshot(f.db),before);
  await assert.rejects(()=>f.db.exec(rollback),/Rollback precondition/);await f.db.exec('rollback');
 }finally{await f.db.close();}
});
test('migration refuses body, owner/security, ACL and search-path drift before any replacement',async()=>{
 const f=await smallFixture();try{
  for(const change of [
   "alter function cos_mhelp_placement_private.guard(uuid,uuid) set search_path='public'",
   'grant execute on function cos_mhelp_placement_private.upload_snapshot() to authenticated',
   'alter function public.cos_mhelp_placement_snapshot(uuid,uuid) security invoker',
   "create or replace function cos_mhelp_placement_private.continuity_current(t uuid,n uuid,original text) returns boolean language sql stable set search_path='' as $$select true$$"
  ]){
   await f.db.exec(baselineSql);await f.db.exec(change);
   await assert.rejects(()=>f.db.exec(install),/Install precondition/);await f.db.exec('rollback');
   await f.db.exec("alter function cos_mhelp_placement_private.guard(uuid,uuid) set search_path='';revoke all on function cos_mhelp_placement_private.upload_snapshot() from authenticated");
  }
 }finally{await f.db.close();}
});
test('full representative outputs preserve ordering, redaction, nulls, all graph drift and base-link holds',async context=>{
 const f=await representativeFixture();try{
  await context.test('unchanged whole snapshot',()=>compare(f.db,undefined,s=>{
   assert.equal(s.items.length,434);assert.equal(s.items.filter(x=>x.state==='confirmed').length,367);
   assert.equal(s.upload.records.length,1001);assert.equal(s.upload.trackerRecords.length,810);
   assert.equal(s.upload.records.filter(r=>r.binding?.guardCurrent).length,564);
   assert.equal(s.upload.trackerRecords.filter(r=>r.binding?.guardCurrent).length,756);
   assert.equal(s.upload.receivedMessageId,undefined);assert.equal(s.upload.authorizationSha256,undefined);
   assert.equal(s.upload.records[0].binding.reviewEvidence,undefined);assert.equal(s.upload.trackerRecords[0].ownerQuote,undefined);
  }));
  const changes=[
   ['tracker customer',"update app_private.vision_tracker_locations set customer='Changed synthetic customer' where id=$1",[t(1)]],
   ['tracker label',"update app_private.vision_tracker_locations set unit_number='Changed synthetic label' where id=$1",[t(1)]],
   ['tracker GPS','update app_private.vision_tracker_locations set latitude=1,longitude=2 where id=$1',[t(1)]],
   ['native status',"update public.equipment_units set status='retired' where id=$1",[n(1)]],
   ['native GPS',"update public.equipment_units set gps_latitude=1,gps_longitude=2,gps_recorded_at='2026-01-02' where id=$1",[n(1)]],
   ['native site','update public.equipment_units set installed_site_id=$2 where id=$1',[n(1),request]],
   ['Owner history',"insert into public.equipment_unit_location_history values($1,'Later synthetic Owner move')",[n(1)]],
   ['Owner identity',"insert into app_private.cos_owner_identity_claims values($1,'Later synthetic Owner identity')",[n(1)]],
   ['source revision/postimage',"update app_private.cos_geocode_sources set street='Changed synthetic street' where tracker_id=$1",[t(1)]],
   ['source deletion','delete from app_private.cos_geocode_sources where tracker_id=$1',[t(1)]],
   ['archive membership',`insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)`,[org,n(900),n(1),t(900),t(1),sha]]
  ];
  for(const [name,sql,params] of changes)await context.test(name,()=>compare(f.db,()=>f.db.query(sql,params),s=>{
   assert.equal(s.upload.records[0].binding.guardCurrent,false);assert.equal(s.upload.trackerRecords[0].binding.guardCurrent,false);
  }));
  await context.test('same pair with distinct/null expected guards stays separately held',()=>compare(f.db,async()=>{
   const records=structuredClone(f.records);records[1].binding={...records[0].binding,expectedGuard:'f'.repeat(64)};records[2].binding={...records[0].binding,expectedGuard:null};
   await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[records]);
  },s=>{assert.equal(s.upload.records[0].binding.guardCurrent,true);assert.equal(s.upload.records[1].binding.guardCurrent,false);assert.equal(s.upload.records[2].binding.guardCurrent,null);}));
  for(const state of ['held','unlinked'])await context.test(state+' tracker malformed UUID is never evaluated',()=>compare(f.db,async()=>{
   const receipt=structuredClone(f.receipt);receipt.trackerRecords[0].binding={state,trackerId:'invalid',nativeUnitId:'invalid',expectedGuard:sha};
   await f.db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1',[receipt]);
  },s=>assert.equal(s.upload.trackerRecords[0].binding.guardCurrent,false)));
  for(const state of ['missing',null])await context.test('nullable tracker state '+state+' retains malformed UUID rejection',()=>compare(f.db,async()=>{
   const receipt=structuredClone(f.receipt);receipt.trackerRecords[0].binding={trackerId:'invalid',nativeUnitId:null,expectedGuard:sha};
   if(state===null)receipt.trackerRecords[0].binding.state=null;
   await f.db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1',[receipt]);
  },(_,r)=>assert.equal(r.error,'22P02')));
  await context.test('active pointer absent returns SQL null upload',()=>compare(f.db,()=>f.db.exec('update cos_mhelp_placement_private.upload_control set active_sha256=null'),s=>assert.equal(s.upload,null)));
  await context.test('empty source array retains null aggregate',()=>compare(f.db,()=>f.db.exec("update cos_mhelp_placement_private.upload_batches set records='[]'"),s=>assert.equal(s.upload.records,null)));
  await context.test('missing tracker array retains empty aggregate',()=>compare(f.db,()=>f.db.exec("update cos_mhelp_placement_private.upload_batches set receipt=receipt-'trackerRecords'"),s=>assert.deepEqual(s.upload.trackerRecords,[])));
  await context.test('explicit JSON-null tracker array retains error behavior',()=>compare(f.db,()=>f.db.exec("update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{trackerRecords}','null')"),(_,r)=>assert.equal(r.error,'22023')));
  await context.test('missing and JSON-null bindings remain JSON null',()=>compare(f.db,async()=>{
   const records=structuredClone(f.records);delete records[0].binding;records[1].binding=null;
   await f.db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[records]);
  },s=>{assert.equal(s.upload.records[0].binding,null);assert.equal(s.upload.records[1].binding,null);}));
  await context.test('permission failure remains 42501',()=>compare(f.db,()=>f.db.exec("create or replace function app_private.has_permission(uuid,text) returns boolean language sql as $$select false$$"),(_,r)=>assert.equal(r.error,'42501')));
 }finally{await f.db.close();}
});
test('exact continuity transitions, rollback, wrong payload and later Owner drift retain whole-output equivalence',async context=>{
 const f=await smallFixture();try{
  await f.call();await context.test('legitimate admission',()=>compare(f.db,undefined,s=>assert.equal(s.upload.records[0].binding.guardCurrent,true)));
  await context.test('restoring old graph cannot bypass newest continuity head',()=>compare(f.db,()=>f.db.exec('delete from app_private.cos_geocode_sources'),s=>assert.equal(s.upload.records[0].binding.guardCurrent,false)));
  await context.test('wrong active payload cannot use continuity transition',()=>compare(f.db,()=>f.db.query('update cos_mhelp_placement_private.upload_batches set payload_sha256=$1',['f'.repeat(64)]),s=>assert.equal(s.upload.records[0].binding.guardCurrent,false)));
  await context.test('post-admission Owner history invalidates both arrays',()=>compare(f.db,()=>f.db.query("insert into public.equipment_unit_location_history values($1,'Later synthetic history')",[n(1)]),s=>{assert.equal(s.upload.records[0].binding.guardCurrent,false);assert.equal(s.upload.trackerRecords[0].binding.guardCurrent,false);}));
  await f.rollback();await context.test('legitimate tombstone rollback',()=>compare(f.db,undefined,s=>assert.equal(s.upload.records[0].binding.guardCurrent,true)));
 }finally{await f.db.close();}
});
test('materialized evaluation counts prove one exact guard per link/triple without replacing guard semantics',async()=>{
 const f=await representativeFixture();try{
  await f.db.exec('create sequence public.synthetic_base_calls;create sequence public.synthetic_continuity_calls');
  const guard=(await f.db.query("select pg_get_functiondef('cos_mhelp_placement_private.guard(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  await f.db.exec(guard.replace('begin\n',"begin\n perform nextval('public.synthetic_base_calls');\n")+';');
  const continuity=(await f.db.query("select prosrc from pg_proc where oid='cos_mhelp_placement_private.continuity_current(uuid,uuid,text)'::regprocedure")).rows[0].prosrc;
  await f.db.exec(`create or replace function cos_mhelp_placement_private.continuity_current(t uuid,n uuid,original text) returns boolean language plpgsql stable set search_path='' as $$declare result boolean;begin perform nextval('public.synthetic_continuity_calls');select q.value into result from (${continuity}) q(value);return result;end$$;`);
  const before=await snapshot(f.db);
  const counts=async()=> (await f.db.query('select (select last_value from public.synthetic_base_calls) base,(select last_value from public.synthetic_continuity_calls) continuity')).rows[0];
  assert.deepEqual(await counts(),{base:801,continuity:1320});
  await f.db.exec(candidateSql);await f.db.exec("select setval('public.synthetic_base_calls',1,false),setval('public.synthetic_continuity_calls',1,false)");
  assert.deepEqual(await snapshot(f.db),before);assert.deepEqual(await counts(),{base:434,continuity:770});
 }finally{await f.db.close();}
});
