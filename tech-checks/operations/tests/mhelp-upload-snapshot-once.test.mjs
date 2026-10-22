import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {assignmentPostgres} from './fixtures/assignment-postgres.mjs';
import {prepareUploadSnapshotOnceSql,uploadSnapshotSignature,reviewedUploadSnapshotSha256} from '../scripts/prepareUploadSnapshotOnceSql.mjs';
import {createHash} from 'node:crypto';

const baseline=readFileSync(new URL('./fixtures/upload-snapshot-before-20261021.sql',import.meta.url),'utf8');
const migration=prepareUploadSnapshotOnceSql(baseline);
const tracker='11111111-1111-4111-8111-111111111111';
const native='22222222-2222-4222-8222-222222222222';
const payload={
 contract:'COS_MHELP_API_V1',sourceSha256:'a'.repeat(64),reviewed:true,complete:true,
 records:[{productId:'2233383',unitNumber:'Solar Spotter 013',placement:'SHOP',sourceAddress:{street:'Recorded address'},binding:{trackerId:tracker,nativeUnitId:native,expectedGuard:'guard-current',guardCurrent:true}}],
 apiMissingRecords:[
  {productId:'1001',binding:{trackerId:tracker,nativeUnitId:native,expectedGuard:'guard-current',guardCurrent:false}},
  {productId:'1002',binding:{trackerId:tracker,nativeUnitId:null,expectedGuard:'stale-guard',guardCurrent:true}},
  {productId:'1003',binding:null},
  {productId:'1004',note:'No binding supplied'},
 ],
 trackerRecords:[{recordId:'tracker:2233383',ip:'192.0.2.4',sim:'preserved-sim',gps:{verified:false,latitude:29.7,longitude:-95.3}}],
};

/** In-memory or disposable localhost database only. The existing CI adapter
 * has a fixed localhost connection and cannot accept a production URL. */
async function fixture(){
 const db=process.env.COS_ASSIGNMENT_POSTGRES_CI==='1'?assignmentPostgres():new PGlite();
 try{
  await db.exec(`
   create role anon;create role authenticated;create role service_role;
   create schema cos_mhelp_placement_private;
   create sequence cos_mhelp_placement_private.snapshot_calls;
   create table cos_mhelp_placement_private.fixture_state(singleton boolean primary key,payload jsonb,current_guard text,failure text);
   insert into cos_mhelp_placement_private.fixture_state values(true,null,'guard-current',null);
   create table cos_mhelp_placement_private.live_inventory_control(singleton boolean primary key,enabled boolean,last_attempt_at timestamptz,last_success_at timestamptz,error_code text);
   insert into cos_mhelp_placement_private.live_inventory_control values(true,true,'2026-10-21T17:30:00Z','2026-10-21T17:29:00Z','preserved-status');
   create function cos_mhelp_placement_private.api_base_upload_snapshot() returns jsonb language plpgsql stable set search_path='' as $$
   declare r cos_mhelp_placement_private.fixture_state;
   begin
    -- A test-only sequence records invocations without changing the returned
    -- snapshot. STABLE deliberately matches the real helper's optimizer label.
    perform nextval('cos_mhelp_placement_private.snapshot_calls');
    select * into strict r from cos_mhelp_placement_private.fixture_state where singleton;
    if r.failure='source' then raise exception 'synthetic source unavailable';end if;
    return r.payload;
   end $$;
   create function cos_mhelp_placement_private.shop_address_baseline(p_source text) returns jsonb language plpgsql stable set search_path='' as $$
   begin
    if exists(select 1 from cos_mhelp_placement_private.fixture_state where failure='shop') then raise exception 'synthetic Shop baseline unavailable';end if;
    return jsonb_build_object('sourceSha256',p_source,'addresses',jsonb_build_array(jsonb_build_object('productId','2233383','street','Recorded address')));
   end $$;
   create function cos_mhelp_placement_private.upload_binding_guard(p_tracker uuid,p_native uuid) returns text language plpgsql stable set search_path='' as $$
   begin
    if exists(select 1 from cos_mhelp_placement_private.fixture_state where failure='guard') then raise exception 'synthetic protected graph unavailable';end if;
    return (select current_guard from cos_mhelp_placement_private.fixture_state where singleton);
   end $$;
   ${baseline};
   alter function cos_mhelp_placement_private.upload_snapshot() owner to postgres;
   revoke all on function cos_mhelp_placement_private.upload_snapshot() from public,anon,authenticated,service_role;
  `);
  await db.query('update cos_mhelp_placement_private.fixture_state set payload=$1::jsonb',[JSON.stringify(payload)]);
  const read=()=>db.query('select cos_mhelp_placement_private.upload_snapshot() value').then(r=>r.rows[0].value);
  const resetCalls=()=>db.query("select setval('cos_mhelp_placement_private.snapshot_calls',1,false)");
  const calls=()=>db.query('select case when is_called then last_value else 0 end::int n from cos_mhelp_placement_private.snapshot_calls').then(r=>r.rows[0].n);
  const catalog=()=>db.query(`select pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef,p.provolatile,p.proconfig,
   has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
   from pg_proc p where p.oid=$1::regprocedure`,[uploadSnapshotSignature]).then(r=>r.rows[0]);
  const state=()=>db.query('select to_jsonb(s) source,to_jsonb(c) control from cos_mhelp_placement_private.fixture_state s cross join cos_mhelp_placement_private.live_inventory_control c').then(r=>r.rows);
  const installed=await catalog();
  assert.equal(installed.definition,baseline,'Fixture must be the exact reviewed installed definition');
  return {db,read,resetCalls,calls,catalog,state,install:()=>db.exec(migration)};
 }catch(error){await db.close();throw error;}
}

test('exact reviewed baseline evaluates three times; repaired projection evaluates once and preserves complete output',async()=>{
 const f=await fixture();try{
  const protectedBefore=await f.state();await f.resetCalls();const before=await f.read();
  assert.equal(await f.calls(),3,'Reproduce the actual repeated-evaluation defect');
  assert.deepEqual(before.records,payload.records);assert.deepEqual(before.trackerRecords,payload.trackerRecords);
  assert.equal(before.apiMissingRecords[0].binding.guardCurrent,true);
  assert.equal(before.apiMissingRecords[1].binding.guardCurrent,false);
  assert.equal(before.apiMissingRecords[2].binding,null);assert.equal(before.apiMissingRecords[3].binding,null);
  assert.equal(before.shopAddressBaseline.sourceSha256,payload.sourceSha256);
  assert.equal(before.apiSync.enabled,true);assert.equal(before.apiSync.errorCode,'preserved-status');
  await f.install();await f.resetCalls();const after=await f.read();
  assert.equal(await f.calls(),1);assert.deepEqual(after,before);
  assert.deepEqual(await f.state(),protectedBefore,'Projection must not modify source or control rows');
 }finally{await f.db.close();}
});

test('null source, absent missing records and disabled status retain exact prior output',async()=>{
 const f=await fixture();try{
  const cases=[null,{contract:'COS_MHELP_UPLOAD_V1',sourceSha256:'b'.repeat(64),records:[]},{...payload,apiMissingRecords:[]}];
  const before=[];
  await f.db.exec('update cos_mhelp_placement_private.live_inventory_control set enabled=false,last_success_at=null,error_code=null');
  for(const value of cases){await f.db.query('update cos_mhelp_placement_private.fixture_state set payload=$1::jsonb',[value===null?null:JSON.stringify(value)]);before.push(await f.read());}
  assert.equal(before[0],null);assert.deepEqual(before[1].apiMissingRecords,[]);assert.equal(before[1].apiSync.enabled,false);
  await f.install();
  for(const [index,value] of cases.entries()){
   await f.db.query('update cos_mhelp_placement_private.fixture_state set payload=$1::jsonb',[value===null?null:JSON.stringify(value)]);
   await f.resetCalls();assert.deepEqual(await f.read(),before[index]);assert.equal(await f.calls(),1);
  }
 }finally{await f.db.close();}
});

test('subsequent requests see changed source and protected guards without a saved cache',async()=>{
 const f=await fixture();try{
  await f.install();await f.resetCalls();const first=await f.read();assert.equal(await f.calls(),1);
  const changed={...payload,sourceSha256:'c'.repeat(64),records:[{...payload.records[0],placement:'FIELD',customer:'Current customer'}]};
  await f.db.query("update cos_mhelp_placement_private.fixture_state set payload=$1::jsonb,current_guard='guard-after-protected-edit'",[JSON.stringify(changed)]);
  await f.db.exec("update cos_mhelp_placement_private.live_inventory_control set error_code='fresh-status'");
  await f.resetCalls();const next=await f.read();assert.equal(await f.calls(),1);
  assert.equal(first.apiMissingRecords[0].binding.guardCurrent,true);
  assert.equal(next.apiMissingRecords[0].binding.guardCurrent,false);
  assert.equal(next.apiMissingRecords[0].binding.expectedGuard,'guard-current','Never refresh a stale guard');
  assert.deepEqual(next.records,changed.records);assert.equal(next.sourceSha256,changed.sourceSha256);
  assert.equal(next.shopAddressBaseline.sourceSha256,changed.sourceSha256);assert.equal(next.apiSync.errorCode,'fresh-status');
 }finally{await f.db.close();}
});

test('source, Shop-address and protected-guard errors propagate unchanged',async()=>{
 const f=await fixture();try{
  for(const repaired of [false,true]){
   if(repaired)await f.install();
   for(const [failure,message] of [['source','synthetic source unavailable'],['shop','synthetic Shop baseline unavailable'],['guard','synthetic protected graph unavailable']]){
    await f.db.query('update cos_mhelp_placement_private.fixture_state set failure=$1',[failure]);
    const before=await f.state();await assert.rejects(f.read,new RegExp(message));assert.deepEqual(await f.state(),before);
   }
   await f.db.exec('update cos_mhelp_placement_private.fixture_state set failure=null');
  }
 }finally{await f.db.close();}
});

test('installation preserves owner, ACL, security, volatility and search path; repeated install refuses drift',async()=>{
 const f=await fixture();try{
  const {definition,...before}=await f.catalog();
  assert.equal(createHash('sha256').update(definition).digest('hex'),reviewedUploadSnapshotSha256);
  assert.deepEqual(before,{owner:'postgres',acl:'{postgres=X/postgres}',prosecdef:false,provolatile:'s',proconfig:['search_path=""'],anon_execute:false,authenticated_execute:false,service_execute:false});
  await f.install();const {definition:changed,...after}=await f.catalog();assert.deepEqual(after,before);assert.notEqual(changed,definition);
  await assert.rejects(f.install,/Installed upload snapshot changed/);await f.db.exec('rollback');
  assert.deepEqual(await f.catalog(),{definition:changed,...after});
 }finally{await f.db.close();}
});

test('source or ACL drift refuses migration and late failure rolls the function replacement back',async()=>{
 for(const scenario of ['source','ACL','late failure']){
  const f=await fixture();try{
   if(scenario==='source')await f.db.exec("create or replace function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql stable set search_path='' as $$select '{}'::jsonb$$");
   if(scenario==='ACL')await f.db.exec('grant execute on function cos_mhelp_placement_private.upload_snapshot() to anon');
   const before=await f.catalog(),state=await f.state();
   const candidate=scenario==='late failure'?migration.replace(/commit;\s*$/,()=>"do $$begin raise exception 'synthetic late installation failure';end $$;\ncommit;\n"):migration;
   await assert.rejects(()=>f.db.exec(candidate),scenario==='source'?/Installed upload snapshot changed/:scenario==='ACL'?/permissions or configuration changed/:/synthetic late installation failure/);
   await f.db.exec('rollback');assert.deepEqual(await f.catalog(),before);assert.deepEqual(await f.state(),state);
  }finally{await f.db.close();}
 }
 assert.throws(()=>prepareUploadSnapshotOnceSql(baseline+' '),/Exact reviewed upload snapshot definition required/);
});
