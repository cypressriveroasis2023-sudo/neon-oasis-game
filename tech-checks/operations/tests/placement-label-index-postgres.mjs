// Destructive fixture setup is restricted to the dedicated disposable loopback service.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {representativeFixture,snapshot,sql,indexName,digest,allFunctions,tableSecurity,exactFunctionChange,representativeCounts,equivalenceCases,normalizationProof,collisionAndWriterProof,mutationCases,assertMutationHeld,rebuildDisposableFixture,org,n} from './fixtures/placement-label-index.mjs';
const raw=process.env.COS_LABEL_INDEX_TEST_DATABASE_URL;
if(process.env.COS_LABEL_INDEX_POSTGRES_CI!=='1'||!raw)throw Error('Explicit synthetic PostgreSQL CI opt-in required.');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.port!=='5432'||url.pathname!=='/cos_placement_label_index_test_ci'||url.username!=='postgres'||url.password!=='synthetic-ci-only')throw Error('Only the dedicated disposable loopback PostgreSQL service is allowed.');
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));const {Client}=require('pg');
const clients=[],report={syntheticOnly:true,productionReads:0,productionWrites:0,providerCalls:0,statementTimeout:'8s',workMem:'2184kB',forcedPlannerSettings:false,independentClients:3,passes:[]};
const params=values=>values?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const adapter=c=>({exec:statement=>c.query(statement),query:(statement,values)=>c.query(statement,params(values)),close:async()=>{}});
const connect=async name=>{const c=new Client({connectionString:url.href,application_name:'cos_label_index_test_'+name});await c.connect();clients.push(c);await c.query("set statement_timeout='8s';set lock_timeout='8s';set work_mem='2184kB';set time zone 'UTC'");return c;};
const round=n=>Math.round(n*100)/100;
const stats=values=>({samplesMs:values.map(round),meanMs:round(values.reduce((a,b)=>a+b,0)/values.length),maxMs:round(Math.max(...values))});
try{
 const a=await connect('reader_a'),b=await connect('reader_b'),writer=await connect('writer'),da=adapter(a),db=adapter(b);
 const callerSearchPath=(await a.query("select current_setting('search_path') value")).rows[0].value;
 assert.equal((await a.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app_private','cos_mhelp_placement_private') or (n.nspname='public' and c.relkind in ('r','p','v','m','S'))")).rows[0].n,0,'Refuse a pre-populated application database');
 report.postgresVersion=(await a.query('show server_version')).rows[0].server_version;assert.match(report.postgresVersion,/^17\.6(?:\s|$)/);
 report.databaseCollation=(await a.query(`select datcollate,datctype,datlocprovider,datcollversion,pg_database_collation_actual_version(d.oid) actual_version,coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale') locale from pg_database d where datname=current_database()`)).rows[0];
 report.collationVersionCoverage={referenceVersion:'153.121',recordedMatchesActual:report.databaseCollation.datcollversion===report.databaseCollation.actual_version,matchesReference:report.databaseCollation.actual_version==='153.121',versionGap:report.databaseCollation.actual_version==='153.121'?null:'Hosted ICU version differs from the reference; this is not exact-version parity.'};
 assert.equal(report.databaseCollation.datlocprovider,'i','Hosted proof must use ICU, not a C-locale substitute');assert.equal(report.databaseCollation.locale,'en-US');
 const f=await representativeFixture(da);report.population=f.population;
 report.unitColumnCollations=(await a.query(`select n.nspname schema,c.relname relation,a.attname,co.collname,co.collprovider,co.collisdeterministic from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace join pg_collation co on co.oid=a.attcollation where a.attname='unit_number' and a.attrelid in ('public.equipment_units'::regclass,'app_private.vision_tracker_locations'::regclass) order by 1,2`)).rows;
 assert.equal(report.unitColumnCollations.length,2);for(const c of report.unitColumnCollations){assert.equal(c.collname,'default');assert.equal(c.collisdeterministic,true);}
 const install=await sql('install'),rollback=await sql('rollback'),baselineFunctions=await allFunctions(da),baselineSecurity=await tableSecurity(da),expected=await snapshot(da);
 report.expectedCounts=representativeCounts(expected);report.fullSnapshotSha256=digest(expected);
 const timed=async connection=>{const start=performance.now();const value=await snapshot(connection);assert.deepEqual(value,expected);return performance.now()-start;};
 const measure=async()=>{
  await timed(da);const sequential=[];for(let i=0;i<5;i++)sequential.push(await timed(da));
  const concurrent=[],start=performance.now();for(let i=0;i<4;i++)concurrent.push(...await Promise.all([timed(da),timed(db)]));
  return {sequential:stats(sequential),concurrent:{...stats(concurrent),burstWallMs:round(performance.now()-start)}};
 };
 report.baselineCurrentOptimizedSnapshot=await measure();
 await a.query(install);
 report.functionParity=exactFunctionChange(baselineFunctions,await allFunctions(da));assert.deepEqual(await tableSecurity(da),baselineSecurity);
 // Deliberately measure the immediately installed index before any post-index ANALYZE.
 report.candidateWithoutPostInstallAnalyze=await measure();
 report.immediateDefaultPlan=(await a.query(`explain(analyze,buffers,format json) select count(*) from public.equipment_units where organization_id=$1 and pg_catalog.regexp_replace(pg_catalog.lower(unit_number),'[^a-z0-9]','','g')=app_private.cos_source_label('Spotter 001')`,[org])).rows[0]['QUERY PLAN'];
 assert.ok(JSON.stringify(report.immediateDefaultPlan).includes(indexName),'Default planner must use the immediately installed index without post-install ANALYZE');
 const base=report.baselineCurrentOptimizedSnapshot,candidate=report.candidateWithoutPostInstallAnalyze;
 report.sequentialReductionPercent=round(100*(1-candidate.sequential.meanMs/base.sequential.meanMs));report.concurrentReductionPercent=round(100*(1-candidate.concurrent.meanMs/base.concurrent.meanMs));
 assert.ok(candidate.sequential.meanMs<base.sequential.meanMs,'Actual nested sequential snapshot must improve over the current optimized baseline');
 assert.ok(candidate.concurrent.meanMs<base.concurrent.meanMs,'Actual nested concurrent snapshots must improve over the current optimized baseline');
 report.passes.push('Whole snapshots, exact counts and hashes match under the unchanged 8-second limit; sequential and concurrent timings improve immediately after install with the default planner.');
 const installedFunctions=await allFunctions(da);await a.query(install);assert.deepEqual(await allFunctions(da),installedFunctions);assert.deepEqual(await tableSecurity(da),baselineSecurity);
 // ANALYZE is explicitly isolated from the primary immediate-install performance gate.
 await a.query('analyze public.equipment_units');report.candidateAfterExplicitAnalyze=await measure();
 // Genuine independent-session MVCC: two readers while a third connection mutates.
 report.concurrentMutations=[];
 let currentExpected=expected;
 const both=()=>Promise.all([snapshot(da),snapshot(db)]);
 for(const mutation of mutationCases){
  await writer.query('begin');await writer.query(mutation.statement,mutation.values);
  for(const value of await both())assert.deepEqual(value,currentExpected,mutation.name+': uncommitted write invisible');
  await writer.query('rollback');for(const value of await both())assert.deepEqual(value,currentExpected,mutation.name+': rolled-back write invisible');
  await writer.query('begin');await writer.query(mutation.statement,mutation.values);await writer.query('commit');
  const changed=await both();assert.deepEqual(changed[0],changed[1]);assert.notDeepEqual(changed[0],currentExpected);
  const first=changed[0];assertMutationHeld(first,mutation.target);
  await a.query(rollback);assert.deepEqual(await allFunctions(da),baselineFunctions);assert.deepEqual(await tableSecurity(da),baselineSecurity);for(const value of await both())assert.deepEqual(value,first,'Rolled-back implementation must reject the same committed drift');
  await a.query(install);for(const value of await both())assert.deepEqual(value,first);
  currentExpected=first; // Keep committed source-trigger invalidations; never pretend native reversal restores them.
  report.concurrentMutations.push({name:mutation.name,uncommittedInvisible:true,transactionRollbackInvisible:true,committedInvalidatesBothUploadArrays:true,migrationRollbackAndReinstallEqual:true,changedSnapshotSha256:digest(first)});
 }
 report.passes.push('Independent readers preserve MVCC for Owner history/identity and native insert/rename/GPS/delete; committed changes are held identically before and after migration rollback.');
 await a.query(rollback);await a.query(rollback);assert.deepEqual(await allFunctions(da),baselineFunctions);assert.deepEqual(await tableSecurity(da),baselineSecurity);
 assert.equal((await a.query('select to_regclass($1) value',['public.'+indexName])).rows[0].value,null);
 // Both advisory serialization and actual relation-lock contention fail closed.
 const lockKey=install.match(/hashtextextended\('([^']+)',\s*0\)/)?.[1];assert.ok(lockKey,'Installer must expose its fixed advisory migration key');
 await writer.query('begin');await writer.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
 await assert.rejects(()=>a.query(install),e=>e.code==='55P03');await a.query('rollback');await writer.query('rollback');assert.deepEqual(await allFunctions(da),baselineFunctions);
 await writer.query('begin');await writer.query('update public.equipment_units set status=status where id=$1',[n(1)]);
 const lockStart=performance.now();await assert.rejects(()=>a.query(install),e=>e.code==='55P03');report.installLockWaitMs=round(performance.now()-lockStart);assert.ok(report.installLockWaitMs<4000,'Installer must retain its 2-second relation lock timeout');
 await a.query('rollback');await writer.query('rollback');assert.deepEqual(await allFunctions(da),baselineFunctions);assert.equal((await a.query('select to_regclass($1) value',['public.'+indexName])).rows[0].value,null);
 report.passes.push('Guarded install is idempotent; rollback is exact and idempotent; advisory and relation-lock failures leave baseline bodies and index absence intact.');
 // Rebuild only the guarded disposable fixture so accumulated source invalidations cannot contaminate independent equivalence cases.
 const fresh=await rebuildDisposableFixture(da);report.freshFixtureRebuiltForEquivalence=true;
 report.normalization=await normalizationProof(da);report.hashCollisionAndWrites=await collisionAndWriterProof(da);
 report.equivalenceCases=await equivalenceCases(fresh);
 report.coordinateLimitation='The 16-row complete coordinate result is equal. This label-only repair does not resolve the separate coordinate-concern scan bottleneck.';
 const settings=(await a.query("select current_setting('search_path') search_path,current_setting('statement_timeout') statement_timeout,current_setting('work_mem') work_mem,current_setting('enable_seqscan') enable_seqscan,current_setting('enable_indexscan') enable_indexscan,current_setting('enable_bitmapscan') enable_bitmapscan")).rows[0];
 assert.deepEqual(settings,{search_path:callerSearchPath,statement_timeout:'8s',work_mem:'2184kB',enable_seqscan:'on',enable_indexscan:'on',enable_bitmapscan:'on'});report.finalSettings=settings;
 report.passed=true;console.log(JSON.stringify(report,null,2));
}catch(e){report.passed=false;report.failure={message:e.message,code:e.code};throw e;}
finally{
 await writeFile('placement-label-index-postgres-results.json',JSON.stringify(report,null,2)+'\n');
 for(const client of clients){await client.query('rollback').catch(()=>{});await client.end().catch(()=>{});}
}
