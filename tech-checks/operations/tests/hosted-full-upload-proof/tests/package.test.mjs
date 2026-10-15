import assert from 'node:assert/strict';import {readFile,writeFile,mkdir}from'node:fs/promises';
import {createRequire}from'node:module';import{resolve,dirname}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
const fixtureUrl=process.env.COS_FULL_UPLOAD_REPO_ROOT?pathToFileURL(resolve(process.env.COS_FULL_UPLOAD_REPO_ROOT,'tech-checks/operations/tests/fixtures/placement-label-index.mjs')):new URL('../../fixtures/placement-label-index.mjs',import.meta.url);
const {smallFixture,snapshot}=await import(fixtureUrl);const require=createRequire(new URL('../../package.json',fixtureUrl));const {PGlite}=require('@electric-sql/pglite');
import {prepareGuardedPackage,captureCatalog,catalogQuery,schemaQuery,sha256}from'../build-package.mjs';
const packageDir=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repoRoot=process.env.COS_FULL_UPLOAD_REPO_ROOT||resolve(packageDir,'../../../..');
const report={syntheticOnly:true,productionReads:0,productionWrites:0,tests:[]};const db=new PGlite();
const error=async(sql,code)=>{try{await db.exec(sql);assert.fail('Expected '+code);}catch(e){assert.equal(e.code,code);}finally{await db.exec('rollback');}};
try{
 await db.exec("set time zone 'UTC';set work_mem='2184kB';set statement_timeout='8s';set lock_timeout='8s'");const f=await smallFixture(db);
 await db.exec(await readFile(repoRoot+'/tech-checks/operations/db/mhelp-placement-label-index.sql','utf8'));
 await db.exec(await readFile(new URL('../hosted-camera-receipt-proof/candidate-overload.sql',fixtureUrl),'utf8'));
 report.helperDefinitions=(await db.query("select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition_md5 from pg_proc p where p.oid in ('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)'::regprocedure,'cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)'::regprocedure) order by 1")).rows;
 const manifest=await prepareGuardedPackage(db,{packageDir,repoRoot});report.manifest=manifest;
 const install=await readFile(packageDir+'/install.sql','utf8'),rollback=await readFile(packageDir+'/rollback.sql','utf8');assert.equal(sha256(install),manifest.installSha256);assert.equal(sha256(rollback),manifest.rollbackSha256);
 const original=await snapshot(db),before=await captureCatalog(db);await db.exec(install);assert.deepEqual(await snapshot(db),original);let after=await captureCatalog(db);assert.equal(after.catalog.find(x=>x.signature==='cos_mhelp_placement_private.upload_snapshot()').definition_sha256,manifest.candidateUploadDefinitionSha256);assert.deepEqual(after.schema,before.schema);report.tests.push('exact synthetic schema/catalog install and full output parity');
 await db.exec(install);assert.deepEqual(await captureCatalog(db),after);report.tests.push('exact already-installed state is an idempotent no-op');
 await db.exec(rollback);assert.deepEqual(await captureCatalog(db),before);await db.exec(rollback);assert.deepEqual(await captureCatalog(db),before);report.tests.push('exact rollback and duplicate rollback no-op');
 const broken=install.replace('-- POST_REPLACEMENT_TEST_MARKER: fault injection belongs only in disposable tests.','perform 1/0;');assert.notEqual(broken,install);await error(broken,'22012');assert.deepEqual(await captureCatalog(db),before);report.tests.push('failure after replacement rolls back entire transaction');
 for(const [name,change,restore]of[
 ['unexpected helper default overload',"create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid,boolean default false) returns text language sql as $$select 'x'::text$$",'drop function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid,boolean)'],
 ['unexpected helper variadic overload',"create function cos_mhelp_placement_private.continuity_current(uuid,uuid,text,variadic text[]) returns boolean language sql as $$select false$$",'drop function cos_mhelp_placement_private.continuity_current(uuid,uuid,text,text[])'],
 ['unexpected public overload',"create function public.cos_mhelp_placement_snapshot(uuid,uuid,text,text) returns jsonb language sql as $$select '{}'::jsonb$$",'drop function public.cos_mhelp_placement_snapshot(uuid,uuid,text,text)'],
 ['target COST drift','alter function cos_mhelp_placement_private.upload_snapshot() cost 101','alter function cos_mhelp_placement_private.upload_snapshot() cost 100'],
 ['camera COST drift','alter function public.cos_mhelp_placement_snapshot(uuid,uuid,text) cost 101','alter function public.cos_mhelp_placement_snapshot(uuid,uuid,text) cost 100'],
 ['helper ACL drift','grant execute on function cos_mhelp_placement_private.continuity_current(uuid,uuid,text) to service_role','revoke execute on function cos_mhelp_placement_private.continuity_current(uuid,uuid,text) from service_role'],
 ['table schema drift','alter table public.equipment_units add column synthetic_added text','alter table public.equipment_units drop column synthetic_added'],
 ['table ACL drift','grant select on cos_mhelp_placement_private.upload_batches to service_role','revoke select on cos_mhelp_placement_private.upload_batches from service_role']
 ]){await db.exec(change);const drift=await captureCatalog(db);await error(install,'55000');assert.deepEqual(await captureCatalog(db),drift);await db.exec(restore);report.tests.push(name+' rejected before replacement');}
 // Dropped-column physical attnums do not affect named existing column pins; no column content is weakened.
 assert.deepEqual(await captureCatalog(db),before);
 await db.exec(install);await db.exec('alter function public.cos_mhelp_placement_snapshot(uuid,uuid,text) cost 101');const drift=await captureCatalog(db);await error(rollback,'55000');assert.deepEqual(await captureCatalog(db),drift);await db.exec('alter function public.cos_mhelp_placement_snapshot(uuid,uuid,text) cost 100');await db.exec(rollback);assert.deepEqual(await captureCatalog(db),before);report.tests.push('rollback also refuses unspecified camera overload drift');
 report.passed=true;console.log(JSON.stringify({passed:true,tests:report.tests,manifest},null,2));
}catch(e){report.passed=false;report.failure={message:e.message,code:e.code,stack:e.stack};throw e;}finally{await writeFile(packageDir+'/tests/package-results.json',JSON.stringify(report,null,2)+'\n');await db.close();}
