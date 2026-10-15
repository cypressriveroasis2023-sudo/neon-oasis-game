// Import is inert. Connections require the recorded scoped synthetic authorization,
// GitHub-hosted execution, allowed events and exact dedicated loopback endpoints.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const baseDir=dirname(fileURLToPath(import.meta.url));
const repoRoot=resolve(process.env.COS_FULL_UPLOAD_REPO_ROOT||process.env.GITHUB_WORKSPACE||process.cwd());
const fixedDatabaseUrl='postgresql://postgres:synthetic-ci-only@127.0.0.1:55432/cos_camera_receipt_test_ci';
const fixedApiUrl='http://127.0.0.1:53000';
const fixedJwtSecret='synthetic-camera-receipt-proof-only-20261014';
export const config=Object.freeze({
 baseDir,repoRoot,
 fixturePath:resolve(repoRoot,'tech-checks/operations/tests/fixtures/placement-label-index.mjs'),
 packageDir:resolve(baseDir,'..'),
 manifestPath:resolve(baseDir,'../manifest.json'),
 cameraInstallPath:resolve(repoRoot,'tech-checks/operations/tests/hosted-camera-receipt-proof/candidate-overload.sql'),
 builderPath:resolve(baseDir,'../build-package.mjs'),
 artifactDir:resolve(baseDir,'results'),reportDir:resolve(baseDir,'results'),
 databaseUrl:process.env.COS_FULL_UPLOAD_TEST_DATABASE_URL||fixedDatabaseUrl,
 apiUrl:process.env.COS_FULL_UPLOAD_POSTGREST_URL||fixedApiUrl,
 jwtSecret:process.env.COS_FULL_UPLOAD_JWT_SECRET||fixedJwtSecret,
 databaseName:'cos_camera_receipt_test_ci',postgresVersion:'17.6',postgrestVersion:'14.5',
 statementTimeout:'8s',workMem:'2184kB',
 fullSnapshotDefinitionSha256:'95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9',
 cameraSnapshotDefinitionSha256:'c14b0f888d51cbeb6f322cd80df3317caafc16357812c4ee676e4111b36660dd',
 baselineUploadDefinitionSha256:'5eb4d6d918686a3eede3e122a4227acc5281e84f47df05c699ff4e696a56195b'
});

export async function assertHostedExecution(){
 assert.equal(process.env.COS_FULL_UPLOAD_HOSTED_EXECUTION,'authorized-synthetic-hosted-proof','Explicit scoped hosted-execution opt-in required');
 assert.equal(process.env.CI,'true','CI=true required');
 assert.equal(process.env.GITHUB_ACTIONS,'true','GitHub Actions only');
 assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted','Self-hosted/local execution is forbidden');
 assert.ok(['workflow_dispatch','pull_request'].includes(process.env.GITHUB_EVENT_NAME),'Only manual or path-scoped pull-request hosted execution is allowed');
 const barrier=JSON.parse(await readFile(resolve(baseDir,'PREPARE-ONLY.json'),'utf8'));
 assert.equal(barrier.mode,'authorized-hosted-synthetic-proof','Prepare-only barrier is closed');
 assert.equal(barrier.publicationAuthorized,true,'Publication authorization has not been recorded');
 assert.equal(barrier.executionAuthorized,true,'Hosted-execution authorization has not been recorded');
 assert.equal(config.databaseUrl,fixedDatabaseUrl,'Only exact dedicated loopback synthetic PostgreSQL endpoint is allowed');
 assert.equal(config.apiUrl,fixedApiUrl,'Only exact dedicated loopback PostgREST endpoint is allowed');
 assert.equal(config.jwtSecret,fixedJwtSecret,'Only the fixed public synthetic JWT secret is allowed');
 const database=new URL(config.databaseUrl),api=new URL(config.apiUrl);
 assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'55432');
 assert.equal(api.hostname,'127.0.0.1');assert.equal(api.port,'53000');

 return config;
}

export async function loadPackage(){
 const manifest=JSON.parse(await readFile(config.manifestPath,'utf8'));
 for(const key of ['installSha256','rollbackSha256','candidateSha256','baselineUploadDefinitionSha256','candidateUploadDefinitionSha256','fullSnapshotDefinitionSha256','cameraSnapshotDefinitionSha256'])assert.match(manifest[key],/^[a-f0-9]{64}$/,key);
 for(const key of ['fullSnapshotDefinitionSha256','cameraSnapshotDefinitionSha256','baselineUploadDefinitionSha256'])assert.equal(manifest[key],config[key],key);
 assert.equal(manifest.syntheticOnly,true);assert.equal(manifest.productionInstallationApproved,false);
 assert.equal(manifest.installFile,'install.sql');assert.equal(manifest.rollbackFile,'rollback.sql');assert.equal(manifest.candidateFile,'db/upload-setbased.sql');
 for(const [file,key] of [[manifest.installFile,'installSha256'],[manifest.rollbackFile,'rollbackSha256'],[manifest.candidateFile,'candidateSha256']]){
  const bytes=await readFile(resolve(config.packageDir,file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest[key],file+' exact frozen bytes');
 }
 return Object.freeze(manifest);
}

export function adapter(client){
 const params=values=>values?.map(value=>value!==null&&typeof value==='object'?JSON.stringify(value):value);
 return {exec:statement=>client.query(statement),query:(statement,values)=>client.query(statement,params(values)),close:async()=>{}};
}

export async function assertSettings(client){
 const settings=(await client.query(`select current_setting('statement_timeout') statement_timeout,
 current_setting('lock_timeout') lock_timeout,current_setting('work_mem') work_mem,current_setting('transaction_isolation') transaction_isolation,
 current_setting('enable_seqscan') enable_seqscan,current_setting('enable_indexscan') enable_indexscan,
 current_setting('enable_indexonlyscan') enable_indexonlyscan,current_setting('enable_bitmapscan') enable_bitmapscan,
 current_setting('enable_hashjoin') enable_hashjoin,current_setting('enable_mergejoin') enable_mergejoin,
 current_setting('enable_nestloop') enable_nestloop`)).rows[0];
 assert.deepEqual(settings,{statement_timeout:'8s',lock_timeout:'8s',work_mem:'2184kB',transaction_isolation:'read committed',
  enable_seqscan:'on',enable_indexscan:'on',enable_indexonlyscan:'on',enable_bitmapscan:'on',
  enable_hashjoin:'on',enable_mergejoin:'on',enable_nestloop:'on'});
 const overriddenPlanner=(await client.query(`select name,setting,boot_val,source from pg_settings
 where (name like 'enable_%' or name in('seq_page_cost','random_page_cost','cpu_tuple_cost','cpu_index_tuple_cost','cpu_operator_cost','effective_cache_size','geqo','plan_cache_mode'))
 and setting is distinct from boot_val order by name`)).rows;
 assert.deepEqual(overriddenPlanner,[],'Default planner only; no cost or enable_* overrides');
 return settings;
}

export async function connectDatabase(name='reader'){
 await assertHostedExecution();
 assert.match(name,/^[a-zA-Z0-9_-]{1,48}$/);
 const require=createRequire(pathToFileURL(resolve(repoRoot,'tech-checks/operations/legacy/tests/recon-ordering/package.json')));
 assert.equal(require('pg/package.json').version,'8.16.3','Use existing exact pinned pg dependency');
 const {Client}=require('pg');
 const client=new Client({connectionString:config.databaseUrl,application_name:'cos_full_upload_proof_'+name,
  connectionTimeoutMillis:8000,query_timeout:9000});
 try{
  await client.connect();
  assert.equal((await client.query('select current_database() value')).rows[0].value,config.databaseName);
  assert.match((await client.query('show server_version')).rows[0].server_version,/^17\.6(?:\s|$)/);
  await client.query("set statement_timeout='8s';set lock_timeout='8s';set work_mem='2184kB';set time zone 'UTC'");
  await assertSettings(client);return client;
 }catch(error){await client.end().catch(()=>{});throw error;}
}

export async function bootstrap(){
 await assertHostedExecution();
 const client=await connectDatabase('bootstrap');
 const report={syntheticOnly:true,productionReads:0,productionWrites:0,providerCalls:0,forcedPlannerSettings:false,
  candidateInstalled:false,statementTimeout:'8s',workMem:'2184kB'};
 try{
  assert.equal((await client.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('app_private','cos_mhelp_placement_private') or (n.nspname='public' and c.relkind in('r','p','v','m','S'))`)).rows[0].n,0,'Refuse pre-populated application database');
  assert.equal((await client.query("select count(*)::int n from pg_roles where rolname in('anon','authenticated','service_role','authenticator')")).rows[0].n,0,'Refuse pre-existing application roles or shared cluster');
  report.postgresVersion=(await client.query('show server_version')).rows[0].server_version;
  report.databaseCollation=(await client.query(`select datcollate,datctype,datlocprovider,datcollversion,
   pg_database_collation_actual_version(d.oid) actual_version,
   coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale') locale
   from pg_database d where datname=current_database()`)).rows[0];
  assert.equal(report.databaseCollation.datlocprovider,'i','ICU collation required');
  assert.equal(report.databaseCollation.locale,'en-US');
  assert.equal(report.databaseCollation.datcollversion,report.databaseCollation.actual_version,'Recorded and actual ICU versions differ');
  report.referenceIcuVersion='153.121';report.exactReferenceIcuVersion=report.databaseCollation.actual_version==='153.121';
  const {representativeFixture,sql}=await import(pathToFileURL(config.fixturePath));
  const fixture=await representativeFixture(adapter(client));
  await client.query(await sql());
  report.population=fixture.population;
  const definition=(await client.query("select pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure) value")).rows[0].value;
  report.baselineFunctionSha256=createHash('sha256').update(definition).digest('hex');
  assert.equal(report.baselineFunctionSha256,config.fullSnapshotDefinitionSha256,'Existing generic fixture must exactly match frozen full snapshot definition');
  const catalog=(await client.query(`select proowner::regrole::text owner,proacl::text acl,prosecdef security_definer,
   proconfig settings,pronargdefaults defaults from pg_proc where oid='public.cos_mhelp_placement_snapshot(uuid,uuid)'::regprocedure`)).rows[0];
  assert.deepEqual(catalog,{owner:'postgres',acl:'{postgres=X/postgres,service_role=X/postgres}',security_definer:true,settings:['search_path=""'],defaults:0});
  await client.query(await readFile(config.cameraInstallPath,'utf8'));
  const cameraDefinition=(await client.query("select pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid,text)'::regprocedure) value")).rows[0].value;
  assert.equal(createHash('sha256').update(cameraDefinition).digest('hex'),config.cameraSnapshotDefinitionSha256);
  report.cameraSnapshotDefinitionSha256=config.cameraSnapshotDefinitionSha256;
  await client.query(await readFile(resolve(baseDir,'bootstrap-roles.sql'),'utf8'));
  // Builder reads only this fresh, generated disposable database. It must write its
  // exact schema/catalog-pinned install, rollback and manifest into packageDir.
  const {prepareGuardedPackage}=await import(pathToFileURL(config.builderPath));
  assert.equal(typeof prepareGuardedPackage,'function');
  await prepareGuardedPackage(client,{packageDir:config.packageDir,repoRoot:config.repoRoot});
  report.package=await loadPackage();
  report.roles=(await client.query(`select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig
   from pg_roles where rolname in('anon','authenticated','service_role','authenticator') order by rolname`)).rows;
  for(const role of report.roles){assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.rolcanlogin,role.rolname==='authenticator');}
  report.finalSettings=await assertSettings(client);report.prepared=true;
  return report;
 }catch(error){report.prepared=false;report.failure={message:error.message,code:error.code};throw error;}
 finally{await mkdir(config.reportDir,{recursive:true});await writeFile(resolve(config.reportDir,'bootstrap.json'),JSON.stringify(report,null,2)+'\n');await client.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]!=='--bootstrap')throw Error('No default execution. Future approved hosted workflow must use --bootstrap.');
 console.log(JSON.stringify(await bootstrap(),null,2));
}
