// Hosted disposable PostgreSQL service proof only. Never accepts a production URL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {representativeFixture,snapshot,baselineSql,baselineCatalog,catalogSql,n} from './fixtures/placement-snapshot-dedup.mjs';
const raw=process.env.COS_SNAPSHOT_TEST_DATABASE_URL;
if(process.env.COS_SNAPSHOT_POSTGRES_CI!=='1'||!raw)throw Error('Explicit synthetic PostgreSQL CI opt-in required.');
const url=new URL(raw);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/cos_snapshot_dedup_test_ci'||url.username!=='postgres'||url.password!=='synthetic-ci-only')throw Error('Only the dedicated disposable loopback PostgreSQL service is allowed.');
const require=createRequire(new URL('../legacy/tests/recon-ordering/package.json',import.meta.url));const {Client}=require('pg');
const install=await readFile(new URL('../db/mhelp-placement-snapshot-dedup-install.sql',import.meta.url),'utf8');
const rollback=await readFile(new URL('../db/mhelp-placement-snapshot-dedup-rollback.sql',import.meta.url),'utf8');
const candidateCatalog=JSON.parse(await readFile(new URL('./fixtures/placement-snapshot-dedup-catalog.json',import.meta.url),'utf8'));
const clients=[],report={syntheticOnly:true,productionWrites:0,providerCalls:0,statementTimeout:'8s',sharedPostgresClients:2,passes:[]};
const connect=async name=>{const c=new Client({connectionString:url.href,application_name:'cos_snapshot_test_'+name});await c.connect();clients.push(c);await c.query("set statement_timeout='8s';set lock_timeout='8s';set time zone 'UTC'");return c;};
const params=values=>values?.map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
const adapter=c=>({exec:sql=>c.query(sql),query:(sql,values)=>c.query(sql,params(values)),close:async()=>{}});
const round=n=>Math.round(n*100)/100;
const stats=values=>({samplesMs:values.map(round),meanMs:round(values.reduce((a,b)=>a+b,0)/values.length),maxMs:round(Math.max(...values))});
try{
 const a=await connect('left'),b=await connect('right'),da=adapter(a),db=adapter(b);
 assert.equal((await a.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private'")).rows[0].n,0,'Refuse a pre-populated application database');
 const f=await representativeFixture(da);report.population=f.population;report.postgresVersion=(await a.query('show server_version')).rows[0].server_version;
 assert.deepEqual((await a.query(catalogSql)).rows,baselineCatalog);const expected=await snapshot(da);
 const timed=async connection=>{const start=performance.now();assert.deepEqual(await snapshot(connection),expected);return performance.now()-start;};
 const measure=async()=>{
  await timed(da);const sequential=[];for(let i=0;i<4;i++)sequential.push(await timed(da));
  const concurrent=[];const start=performance.now();for(let i=0;i<3;i++)concurrent.push(...await Promise.all([timed(da),timed(db)]));
  return {sequential:stats(sequential),concurrent:{...stats(concurrent),burstWallMs:round(performance.now()-start)}};
 };
 report.baseline=await measure();
 await a.query(install);assert.deepEqual((await a.query(catalogSql)).rows,candidateCatalog);report.candidate=await measure();
 report.passes.push('Complete old/new outputs match across sequential and genuinely concurrent clients, all under the unchanged 8-second statement limit.');
 report.sequentialMeanReductionPercent=round(100*(1-report.candidate.sequential.meanMs/report.baseline.sequential.meanMs));
 report.concurrentMeanReductionPercent=round(100*(1-report.candidate.concurrent.meanMs/report.baseline.concurrent.meanMs));
 assert.ok(report.candidate.sequential.meanMs<report.baseline.sequential.meanMs,'Candidate must improve actual nested sequential timing');
 assert.ok(report.candidate.concurrent.meanMs<report.baseline.concurrent.meanMs,'Candidate must improve actual nested concurrent timing');
 await b.query('begin');await b.query("insert into public.equipment_unit_location_history values($1,'Synthetic concurrent Owner correction')",[n(1)]);
 assert.deepEqual(await snapshot(da),expected);await b.query('commit');
 const changed=await snapshot(da);assert.equal(changed.upload.records[0].binding.guardCurrent,false);assert.equal(changed.upload.trackerRecords[0].binding.guardCurrent,false);assert.equal(changed.items[0].state,'held');
 await a.query(rollback);assert.deepEqual(await snapshot(da),changed);assert.deepEqual((await a.query(catalogSql)).rows,baselineCatalog);
 report.passes.push('Uncommitted concurrent Owner history is excluded by MVCC; after commit both upload arrays reject it and base placement is held; rollback reproduces the exact same rejection.');
 await a.query(install);assert.deepEqual(await snapshot(da),changed);
 report.passes.push('Guarded reinstall and rollback preserve all function identities, security flags, ACLs and dependency fingerprints.');
 console.log(JSON.stringify(report,null,2));
}catch(e){report.failure={message:e.message,code:e.code};throw e;}
finally{
 await writeFile('placement-snapshot-postgres-results.json',JSON.stringify(report,null,2)+'\n');
 for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
}
