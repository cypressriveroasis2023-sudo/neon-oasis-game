import test from 'node:test';
import assert from 'node:assert/strict';
import {smallFixture,representativeFixture,snapshot,sql,indexName,allFunctions,tableSecurity,exactFunctionChange,representativeCounts,equivalenceCases,normalizationProof,collisionAndWriterProof,mutationCases,assertMutationHeld,rebuildDisposableFixture} from './fixtures/placement-label-index.mjs';

const index=async db=>(await db.query(`select i.indexrelid::int oid,am.amname,i.indisunique,i.indisvalid,i.indisready,i.indislive,i.indnkeyatts,i.indnatts,i.indpred is null unqualified,
 pg_catalog.pg_get_indexdef(i.indexrelid) definition,pg_catalog.pg_get_expr(i.indexprs,i.indrelid) expression from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
 where i.indexrelid=to_regclass('public.${indexName}')`)).rows;

test('guarded label-index install is exact, catalog-preserving, idempotent and reversible',async()=>{
 const f=await smallFixture(),db=f.db;
 try{
  const install=await sql('install'),rollback=await sql('rollback');
  for(const ddl of [install,rollback]){
   assert.match(ddl,/begin\s*;/i);assert.match(ddl,/set local lock_timeout\s*=\s*'2s'/i);assert.match(ddl,/pg_try_advisory_xact_lock/i);
   assert.doesNotMatch(ddl,/set\s+(?:local\s+)?(?:statement_timeout|work_mem|enable_\w+)/i);
  }
  await db.exec("grant select(unit_number) on public.equipment_units to authenticated;alter table public.equipment_units enable row level security;create policy synthetic_label_read on public.equipment_units for select to authenticated using(false)");
  await db.exec(`create schema synthetic_label_shadow;create function synthetic_label_shadow.pg_get_indexdef(oid) returns text language sql as $$select 'shadowed'::text$$;
   set search_path=synthetic_label_shadow,public,pg_catalog;set statement_timeout='8s';set work_mem='2184kB'`);
  const settings=async()=> (await db.query("select current_setting('search_path') search_path,current_setting('statement_timeout') statement_timeout,current_setting('work_mem') work_mem")).rows[0];
  const callerSettings=await settings();
  const before=await allFunctions(db),security=await tableSecurity(db),expected=await snapshot(db);
  await db.exec(install);assert.deepEqual(await settings(),callerSettings);const installed=await allFunctions(db);exactFunctionChange(before,installed);
  assert.deepEqual(await tableSecurity(db),security);assert.deepEqual(await snapshot(db),expected);
  const [idx]=await index(db);assert.ok(idx);assert.equal(idx.amname,'hash');assert.equal(idx.indisunique,false);
  for(const key of ['indisvalid','indisready','indislive','unqualified'])assert.equal(idx[key],true);
  assert.equal(idx.indnkeyatts,1);assert.equal(idx.indnatts,1);assert.match(idx.expression,/regexp_replace\(lower\(unit_number\)/);
  await db.exec(install);assert.deepEqual(await allFunctions(db),installed);assert.deepEqual(await index(db),[idx]);assert.deepEqual(await tableSecurity(db),security);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('set role '+role);
   try{
    await assert.rejects(()=>db.query("select app_private.cos_source_label('synthetic')"),e=>e.code==='42501');
    await assert.rejects(()=>db.query('select cos_mhelp_placement_private.upload_snapshot()'),e=>e.code==='42501');
    if(role==='service_role')assert.deepEqual(await snapshot(db),expected);else await assert.rejects(()=>snapshot(db),e=>e.code==='42501');
   }finally{await db.exec('reset role');}
  }
  await db.exec(rollback);assert.deepEqual(await settings(),callerSettings);assert.deepEqual(await allFunctions(db),before);assert.deepEqual(await tableSecurity(db),security);assert.deepEqual(await index(db),[]);assert.deepEqual(await snapshot(db),expected);
  await db.exec(rollback);assert.deepEqual(await settings(),callerSettings);assert.deepEqual(await allFunctions(db),before);assert.deepEqual(await index(db),[]);
 }finally{await db.close();}
});

test('install and rollback reject helper, body, catalog, mixed-state and index-name drift atomically',async context=>{
 const f=await smallFixture(),db=f.db;
 try{
  const install=await sql('install'),rollback=await sql('rollback');
  await db.exec('create role synthetic_label_other_owner');
  await context.test('failure after index and first body replacement rolls back atomically',async()=>{
   const before=await allFunctions(db),security=await tableSecurity(db),broken=install.replace(/\$function\$\s*;/,'$function$;\nselect 1/0;');
   assert.notEqual(broken,install);await assert.rejects(()=>db.exec(broken),e=>e.code==='22012');await db.exec('rollback');
   assert.deepEqual(await allFunctions(db),before);assert.deepEqual(await tableSecurity(db),security);assert.deepEqual(await index(db),[]);
  });
  const fail=async(ddl,mutation)=>{
   const before=await allFunctions(db),security=await tableSecurity(db),indexes=await index(db);
   await db.exec('begin');
   try{await db.exec(mutation);await assert.rejects(()=>db.exec(ddl),e=>e.code==='55000');}
   finally{await db.exec('rollback');}
   assert.deepEqual(await allFunctions(db),before);assert.deepEqual(await tableSecurity(db),security);assert.deepEqual(await index(db),indexes);
  };
  const drift=[
   ['placement body',"create or replace function cos_mhelp_placement_private.guard(p_tracker uuid,p_native uuid) returns text language plpgsql stable set search_path='' as $$begin return null;end$$"],
   ['native body',"create or replace function app_private.cos_source_native_guard(p_kind text,p_id uuid,p_tracker uuid,p_unit_number text,p_tracker_number text) returns text language plpgsql stable set search_path='' as $$begin return null;end$$"],
   ['normalizer helper',"create or replace function app_private.cos_source_label(p_label text) returns text language sql immutable set search_path='' as $$select lower($1)$$"],
   ['helper ACL','grant execute on function app_private.cos_source_label(text) to authenticated'],
   ['guard ACL','grant execute on function cos_mhelp_placement_private.guard(uuid,uuid) to authenticated'],
   ['security definer','alter function cos_mhelp_placement_private.guard(uuid,uuid) security definer'],
   ['owner','alter function cos_mhelp_placement_private.guard(uuid,uuid) owner to synthetic_label_other_owner'],
   ['search path',"alter function cos_mhelp_placement_private.guard(uuid,uuid) set search_path='public'"],
   ['volatility','alter function app_private.cos_source_native_guard(text,uuid,uuid,text,text) volatile'],
   ['parallel','alter function app_private.cos_source_native_guard(text,uuid,uuid,text,text) parallel safe'],
   ['strictness','alter function app_private.cos_source_label(text) called on null input'],
   ['leakproof','alter function cos_mhelp_placement_private.guard(uuid,uuid) leakproof'],
   ['unchanged public snapshot cost','alter function public.cos_mhelp_placement_snapshot(uuid,uuid) cost 101'],
   ['unchanged continuity helper',"create or replace function cos_mhelp_placement_private.continuity_current(t uuid,n uuid,original text) returns boolean language sql stable set search_path='' as $$select true$$"],
   ['missing unchanged upload helper','drop function cos_mhelp_placement_private.upload_snapshot()']
  ];
  for(const [name,mutation] of drift)await context.test('install rejects '+name,()=>fail(install,mutation));
  await context.test('install rejects B-tree index name collision',()=>fail(install,`create index ${indexName} on public.equipment_units(id)`));
  await context.test('install rejects table name collision',()=>fail(install,`create table public.${indexName}(value text)`));
  await context.test('install rejects bare index with baseline bodies',()=>fail(install,`create index ${indexName} on public.equipment_units using hash(pg_catalog.regexp_replace(pg_catalog.lower(unit_number),'[^a-z0-9]','','g'))`));
  await db.exec(install);
  await context.test('rollback failure after index drop and first body restoration is atomic',async()=>{
   const before=await allFunctions(db),security=await tableSecurity(db),indexes=await index(db),broken=rollback.replace(/\$function\$\s*;/,'$function$;\nselect 1/0;');
   assert.notEqual(broken,rollback);await assert.rejects(()=>db.exec(broken),e=>e.code==='22012');await db.exec('rollback');
   assert.deepEqual(await allFunctions(db),before);assert.deepEqual(await tableSecurity(db),security);assert.deepEqual(await index(db),indexes);
  });
  for(const [name,mutation] of drift)await context.test('rollback rejects '+name,()=>fail(rollback,mutation));
  await context.test('reinstall rejects missing index',()=>fail(install,`drop index public.${indexName}`));
  await context.test('rollback rejects wrong index expression',()=>fail(rollback,`drop index public.${indexName};create index ${indexName} on public.equipment_units using hash(unit_number)`));
  await db.exec(rollback);
 }finally{await db.close();}
});

test('current optimized snapshot and 16-row coordinate reads retain 20 exact output/error cases',async()=>{
 const f=await representativeFixture();try{
  representativeCounts(await snapshot(f.db));const cases=await equivalenceCases(f);assert.equal(cases.length,20);
  for(const result of cases)assert.equal(result.baselineSha256,result.candidateSha256);
 }finally{await f.db.close();}
});

test('HASH uses exact equality across collisions, long text, SQL NULL, Unicode, collation and restricted writers',async()=>{
 const f=await smallFixture();try{await normalizationProof(f.db);await collisionAndWriterProof(f.db);}finally{await f.db.close();}
});


test('committed Owner/native cases retain real source invalidation and fixture rebuild resets only disposable data',async()=>{
 const f=await representativeFixture(),db=f.db;
 try{
  const install=await sql('install'),rollback=await sql('rollback');let expected=await snapshot(db);await db.exec(install);
  for(const mutation of mutationCases){
   await db.query(mutation.statement,mutation.values);const changed=await snapshot(db);assert.notDeepEqual(changed,expected);assertMutationHeld(changed,mutation.target);
   await db.exec(rollback);assert.deepEqual(await snapshot(db),changed);await db.exec(install);assert.deepEqual(await snapshot(db),changed);expected=changed;
  }
  const fresh=await rebuildDisposableFixture(db);representativeCounts(await snapshot(fresh.db));await db.exec(install);representativeCounts(await snapshot(fresh.db));await db.exec(rollback);
 }finally{await db.close();}
});
