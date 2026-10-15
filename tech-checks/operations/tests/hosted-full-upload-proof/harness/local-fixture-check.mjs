// Bounded, optional PGlite-only preflight. No server, Docker, browser, HTTP or
// dependency installation. It cannot establish hosted PostgreSQL/MVCC behavior.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {captureFixture,restoreFixture} from './fixture-state.mjs';
import {addContinuity,widenFixture} from './workload-fixtures.mjs';
import {applyOverloadFixture,removeOverloadFixture} from './overload-fixture.mjs';
import {captureCatalog,renderGuardedPackage} from '../build-package.mjs';
const base=dirname(fileURLToPath(import.meta.url)),root=process.env.COS_FULL_UPLOAD_LOCAL_FIXTURE_ROOT;
assert(root,'Explicit source repository root with existing PGlite dependency required');
const {PGlite}=await import(pathToFileURL(resolve(root,'tech-checks/operations/node_modules/@electric-sql/pglite/dist/index.js')));
const {representativeFixture,sql,snapshot,t,n,org,sha}=await import(pathToFileURL(resolve(root,'tech-checks/operations/tests/fixtures/placement-label-index.mjs')));
const db=new PGlite(),hash=s=>createHash('sha256').update(s).digest('hex');
const report={kind:'bounded-PGlite-fixture-preflight',syntheticOnly:true,nativePostgresExecuted:false,postgrestExecuted:false,concurrencyClaim:false,passed:false,cases:[]};
try{
 await db.exec("set work_mem='2184kB';set statement_timeout='8s';set lock_timeout='8s';set time zone 'UTC'");
 await representativeFixture(db);await db.exec(await sql());await db.exec(await readFile(resolve(root,'tech-checks/operations/tests/hosted-camera-receipt-proof/candidate-overload.sql'),'utf8'));
 const candidateSql=await readFile(resolve(base,'../db/upload-setbased.sql'),'utf8'),baselineSql=await readFile(resolve(base,'../db/upload-baseline.sql'),'utf8');
 report.candidateSha256=hash(candidateSql);const capture=await captureCatalog(db),pkg=renderGuardedPackage(capture,{candidateSql,baselineSql});report.manifest=pkg.manifest;
 const initial=await snapshot(db),state=await captureFixture(db);
 await db.query("insert into public.equipment_unit_location_history values($1,'Synthetic check')",[n(1)]);assert.notDeepEqual(await snapshot(db),initial);await restoreFixture(db,state);assert.deepEqual(await snapshot(db),initial);report.cases.push('exact shared fixture-state capture/restore after triggers');
 const pg={query:async(text,params)=>params?db.query(text,params):(await db.exec(text)).at(-1)};
 const mutations=[
 ['new source row',`insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,source_file_sha256,source_row_sha256,street,city,state,zip,address_sha256,native_guard_sha256,source_placement,active,eligibility) values('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5','tracker',$1,$1,'535','Spotter 435','Spotter 435','SPOTTER',$2,$2,'101 Example Road','Sample','TX','77001',$2,$2,'FIELD',true,'FIELD')`,[t(435),'a'.repeat(64)]],
 ['Owner duplicate rows',"insert into app_private.cos_owner_identity_claims values($1,'A synthetic'),($1,'A synthetic')",[n(1)]],
 ['SHOP tombstone',"update app_private.vision_tracker_locations set placement='SHOP' where id=$1",[t(1)]]
 ];
 for(const [name,statement,values] of mutations){await db.query(statement,values);const baseline=await snapshot(db);await db.exec(pkg.install);assert.deepEqual(await snapshot(db),baseline);await db.exec(pkg.install);assert.deepEqual(await snapshot(db),baseline);await db.exec(pkg.rollback);await db.exec(pkg.rollback);await restoreFixture(db,state);assert.deepEqual(await snapshot(db),initial);report.cases.push(name+' exact installed/rollback/idempotent equality');}
 for(const [name,create,drop] of [
  ['defaulted upload guard overload',"create function cos_mhelp_placement_private.upload_binding_guard(p_tracker uuid,p_native uuid,synthetic_option text default null) returns text language sql stable set search_path='' as $$select 'synthetic alternate overload'::text$$;revoke all on function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid,text) from public,anon,authenticated,service_role",'drop function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid,text)'],
  ['defaulted continuity overload',"create function cos_mhelp_placement_private.continuity_current(t uuid,n uuid,original text,synthetic_option text default null) returns boolean language sql stable set search_path='' as $$select false$$;revoke all on function cos_mhelp_placement_private.continuity_current(uuid,uuid,text,text) from public,anon,authenticated,service_role",'drop function cos_mhelp_placement_private.continuity_current(uuid,uuid,text,text)']
 ]){
  const continuityDefinition=name==='defaulted upload guard overload'?(await db.query("select pg_get_functiondef('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)'::regprocedure) value")).rows[0].value:null;
  const runtimeGateSql=await readFile(resolve(base,'../db/runtime-gate.sql'),'utf8');
  const outcomes={};for(const kind of ['baseline','candidate']){
   if(kind==='candidate')await db.exec(pkg.install);
   await applyOverloadFixture(pg,{createSql:create,continuityDefinition});
   try{assert.equal((await db.query(runtimeGateSql)).rows[0].fast_path_allowed,false);try{outcomes[kind]={value:await snapshot(db)};}catch(e){outcomes[kind]={error:{code:e.code,message:e.message,detail:e.detail??null,hint:e.hint??null}};}assert.equal(outcomes[kind].error?.code,'42725');}
   finally{await removeOverloadFixture(pg,{dropSql:drop,continuityDefinition});}
  }
  assert.deepEqual(outcomes.candidate,outcomes.baseline,name);await db.exec(pkg.rollback);report.cases.push(name+' fresh-parse SQLSTATE42725 exact installed fallback equality');
 }
 const out={};for(const kind of ['baseline','candidate']){if(kind==='candidate')await db.exec(pkg.install);await db.exec('begin');try{await db.exec("alter table public.equipment_units add column synthetic_private_metadata jsonb default '{\"synthetic\":true}'");out[kind]=await snapshot(db);}finally{await db.exec('rollback');}}
 assert.deepEqual(out.candidate,out.baseline);await db.exec(pkg.rollback);report.cases.push('transactional full-row added column equality and exact rollback');
 await widenFixture({admin:pg,n,t,org,sha});report.continuity=await addContinuity({admin:pg,readSnapshot:async()=>({outcome:{value:await snapshot(db)}}),t,n,sha});
 const wide=await snapshot(db);await db.exec(pkg.install);assert.deepEqual(await snapshot(db),wide);await db.exec(pkg.rollback);assert.deepEqual(await snapshot(db),wide);report.cases.push('shared wide fixture and64-row successful continuity chain exact installed equality');
 report.passed=true;
}catch(error){report.failure={message:error.message,code:error.code??null};throw error;}
finally{await writeFile(resolve(base,'local-check-results.json'),JSON.stringify(report,null,2)+'\n');await db.close();}
console.log(JSON.stringify(report,null,2));
