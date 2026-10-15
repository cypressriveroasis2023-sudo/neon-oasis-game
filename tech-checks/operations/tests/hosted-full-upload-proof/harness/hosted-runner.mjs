// Authorized synthetic proof. This runner is inert unless the exact hosted gate opens.
// Tests real installed package bytes. Never substitutes an unguarded candidate body.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {captureFixture,restoreFixture} from './fixture-state.mjs';
import {addContinuity,widenFixture} from './workload-fixtures.mjs';
import {applyOverloadFixture,removeOverloadFixture} from './overload-fixture.mjs';
import {config,connectDatabase,adapter,assertSettings,assertHostedExecution,loadPackage} from './bootstrap.mjs';
await assertHostedExecution();
assert.match(process.env.COS_FULL_UPLOAD_CHECKOUT_SHA??'',/^[a-f0-9]{40}$/,'Verified exact Git checkout SHA required');
assert.equal(process.env.COS_FULL_UPLOAD_CHECKOUT_SHA,process.env.GITHUB_EVENT_NAME==='pull_request'?process.env.COS_FULL_UPLOAD_PR_HEAD_SHA:process.env.GITHUB_SHA);
const manifest=await loadPackage();
const install=await fs.readFile(resolve(config.packageDir,manifest.installFile),'utf8');
const rollback=await fs.readFile(resolve(config.packageDir,manifest.rollbackFile),'utf8');
assert.equal(createHash('sha256').update(install).digest('hex'),manifest.installSha256);assert.equal(createHash('sha256').update(rollback).digest('hex'),manifest.rollbackSha256);
await fs.mkdir(config.reportDir,{recursive:true});
await fs.writeFile(resolve(config.reportDir,'executed-install.sql'),install);await fs.writeFile(resolve(config.reportDir,'executed-rollback.sql'),rollback);await fs.writeFile(resolve(config.reportDir,'frozen-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const candidateSource=await fs.readFile(resolve(config.packageDir,manifest.candidateFile),'utf8');
const runtimeGateSql=await fs.readFile(resolve(config.packageDir,'db/runtime-gate.sql'),'utf8');
const runtimeGateExpression=runtimeGateSql.replace(/^select\s+/,'').replace(/\s+as fast_path_allowed;\s*$/,'');
assert(candidateSource.includes(runtimeGateExpression),'Diagnostic runtime gate must be the exact expression embedded in the frozen candidate');
const {allFunctions,tableSecurity,representativeCounts,org,sha,t,n}=await import(pathToFileURL(config.fixturePath));
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const report={syntheticOnly:true,productionCalls:0,vendorCalls:0,releaseApproved:false,passed:false,
 acceptedSourceBaseline:{commit:'8c21cac1',tree:'d71e404df6029f5ebe47865c9fb4ec18691ae4c2'},
 testedRevision:{checkoutSha:process.env.COS_FULL_UPLOAD_CHECKOUT_SHA??null,githubSha:process.env.GITHUB_SHA??null,headSha:process.env.COS_FULL_UPLOAD_PR_HEAD_SHA??null,baseSha:process.env.COS_FULL_UPLOAD_PR_BASE_SHA??null,event:process.env.GITHUB_EVENT_NAME??null},
 manifest,runtimeGateSha256:hash(runtimeGateSql),statementTimeout:'8s',lockTimeout:'8s',workMem:'2184kB',defaultPlanner:true,
 equivalence:[],mvcc:[],runtimeDrift:[],installer:[],performance:[],limitations:[
 'Generated rows only; no production data, identity impersonation, Edge activation or production latency claim.',
 'The complete public two-argument RPC and actual PostgREST route are tested, not the entire production field-map endpoint.',
 'READ COMMITTED multi-statement behavior is preserved; no atomic in-call snapshot or ABA protection is claimed.',
 'Native acceptance remains contingent on this exact-head hosted run, full repository checks, and a fresh authorized production catalog/root gate.'
 ]};
const clients=[],actor={p_actor_user_id:t(1),p_organization_id:org},camera={...actor,p_projection:'camera'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function token(role){const b=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const input=b({alg:'HS256',typ:'JWT'})+'.'+b({role,iss:'synthetic-full-upload-proof',exp:Math.floor(Date.now()/1000)+3600});return input+'.'+createHmac('sha256',config.jwtSecret).update(input).digest('base64url');}
const tokens=Object.fromEntries(['anon','authenticated','service_role'].map(role=>[role,token(role)]));
async function http(body=actor,{role='service_role',bearer=undefined}={}){
 const start=performance.now();
 const res=await fetch(config.apiUrl+'/rpc/cos_mhelp_placement_snapshot',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(bearer===null?{}:{Authorization:'Bearer '+(bearer??tokens[role])})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const text=await res.text();let value;try{value=JSON.parse(text);}catch{throw Error('Non-JSON response from dedicated synthetic PostgREST: '+res.status);}
 assert.notEqual(value?.code,'PGRST203','Public overload resolution must stay unambiguous');
 return {outcome:{status:res.status,text,value},ms:performance.now()-start};
}
async function sql(db,projection=null){const start=performance.now();try{
 const query=projection===null?'select public.cos_mhelp_placement_snapshot($1,$2)::text value':'select public.cos_mhelp_placement_snapshot($1,$2,$3)::text value';
 const text=(await db.query(query,projection===null?[t(1),org]:[t(1),org,projection])).rows[0].value;
 return {outcome:{text,value:text===null?null:JSON.parse(text)},ms:performance.now()-start};
 }catch(e){return {outcome:{error:{code:e.code,message:e.message,detail:e.detail??null,hint:e.hint??null}},ms:performance.now()-start};}}
async function connect(name){const db=await connectDatabase(name);clients.push(db);return db;}
const save=async()=>{await fs.mkdir(config.reportDir,{recursive:true});await fs.writeFile(resolve(config.reportDir,'hosted-results.json'),JSON.stringify(report,null,2)+'\n');};
let admin,readerA,readerB,readerC,readerD,readerE,writer,readClients,mode='baseline',baselineCatalog,baselineSecurity,baselineOtherCatalog;
async function fastPathAllowed(){return (await admin.query(runtimeGateSql)).rows[0].fast_path_allowed;}
async function fingerprint(signature){return hash((await admin.query('select pg_get_functiondef($1::regprocedure) value',[signature])).rows[0].value);}
async function catalogExtras(){return (await admin.query(`select jsonb_build_object(
 'roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by rolname) from pg_roles r where rolname in('anon','authenticated','service_role','authenticator')),
 'schemas',(select jsonb_agg(to_jsonb(n) order by nspname) from pg_namespace n where nspname in('public','app_private','cos_mhelp_placement_private')),
 'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where tgrelid in(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','cos_mhelp_placement_private'))),
 'indexes',(select jsonb_agg(to_jsonb(i) order by i.indexrelid) from pg_index i where indrelid in(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','cos_mhelp_placement_private'))),
 'relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'owner',c.relowner,'acl',c.relacl,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','cos_mhelp_placement_private'))
 ) value`)).rows[0].value;}
async function assertCatalog(){
 const after=await allFunctions(adapter(admin));
 assert.deepEqual(after.map(({body,definition,...x})=>x),baselineCatalog.map(({body,definition,...x})=>x),'All function OIDs and non-body catalog fields remain byte-equivalent');
 let changed=0;for(let i=0;i<after.length;i++){if(after[i].body!==baselineCatalog[i].body){assert.equal(after[i].signature,'cos_mhelp_placement_private.upload_snapshot()');changed++;}else assert.equal(after[i].definition,baselineCatalog[i].definition);}
 assert.equal(changed,mode==='baseline'?0:1);
 assert.equal(await fingerprint('cos_mhelp_placement_private.upload_snapshot()'),mode==='baseline'?manifest.baselineUploadDefinitionSha256:manifest.candidateUploadDefinitionSha256);
 assert.equal(await fingerprint('public.cos_mhelp_placement_snapshot(uuid,uuid)'),manifest.fullSnapshotDefinitionSha256);
 assert.equal(await fingerprint('public.cos_mhelp_placement_snapshot(uuid,uuid,text)'),manifest.cameraSnapshotDefinitionSha256);
 assert.deepEqual(await tableSecurity(adapter(admin)),baselineSecurity);
 assert.deepEqual(await catalogExtras(),baselineOtherCatalog);
}
async function switchTo(next){if(mode===next)return;assert.deepEqual(await loadPackage(),manifest,'Package fingerprints remain frozen throughout the complete run');await admin.query(next==='candidate'?install:rollback);mode=next;await assertCatalog();await assertSettings(admin);assert.equal(await fastPathAllowed(),true,'Trusted restored native fixture must retain the fast path');}
const checkpoint=()=>captureFixture(admin);
async function restore(cp){await writer.query('rollback');await restoreFixture(admin,cp);}

async function pairedRead(){const values=await Promise.all([sql(readerA),sql(readerB)]);assert.deepEqual(values[0].outcome,values[1].outcome);assert(!values[0].outcome.error);return values[0].outcome;}
async function fullCase(name,mutate=async()=>{},check=()=>{},cleanup=async()=>{}){
 const cp=await checkpoint(),outcomes={};
 try{for(const kind of ['baseline','candidate']){await switchTo(kind);await mutate();try{
 const a=await sql(readerA),b=await http(),c=await sql(readerB,'camera'),d=await http(camera);
 if(!a.outcome.error){assert.equal(b.outcome.status,200);assert.deepEqual(b.outcome.value,a.outcome.value);}else{assert.equal(b.outcome.value.code,a.outcome.error.code);assert.equal(b.outcome.value.message,a.outcome.error.message);assert.equal(b.outcome.value.details,a.outcome.error.detail);assert.equal(b.outcome.value.hint,a.outcome.error.hint);}
 if(!c.outcome.error){assert.equal(d.outcome.status,200);assert.deepEqual(d.outcome.value,c.outcome.value);}else{assert.equal(d.outcome.value.code,c.outcome.error.code);assert.equal(d.outcome.value.message,c.outcome.error.message);assert.equal(d.outcome.value.details,c.outcome.error.detail);assert.equal(d.outcome.value.hint,c.outcome.error.hint);}
 outcomes[kind]={sql:a.outcome,http:b.outcome,cameraSql:c.outcome,cameraHttp:d.outcome};check(outcomes[kind]);
 }finally{await cleanup();await restore(cp);}}
 assert.deepEqual(outcomes.candidate,outcomes.baseline,name+' complete SQL JSON text/error and HTTP status/body equality');
 report.equivalence.push({name,completeJsonTextEqual:true,sqlErrorEqual:true,httpStatusBodyEqual:true,cameraPreserved:true,outcomeSha256:hash(outcomes.baseline)});await save();
 }finally{await cleanup();await restore(cp);}
}
function sourceRecords(fn){return async()=>{const r=(await admin.query('select records from cos_mhelp_placement_private.upload_batches order by source_sha256 limit 1')).rows[0].records;fn(r);await admin.query('update cos_mhelp_placement_private.upload_batches set records=$1',[JSON.stringify(r)]);};}
function trackerReceipt(fn){return async()=>{const r=(await admin.query('select receipt from cos_mhelp_placement_private.upload_batches order by source_sha256 limit 1')).rows[0].receipt;fn(r);await admin.query('update cos_mhelp_placement_private.upload_batches set receipt=$1',[JSON.stringify(r)]);};}
async function definition(signature){return (await admin.query('select pg_get_functiondef($1::regprocedure) value',[signature])).rows[0].value;}
async function replaceBody(signature,body){const original=await definition(signature);const replacement=original.replace(/AS \$function\$[\s\S]*?\$function\$/,`AS $function$${body}$function$`);assert.notEqual(replacement,original);await admin.query(replacement);return original;}
async function mustReject(statement,allowed=['55000']){let error;try{await admin.query(statement);}catch(e){error=e;}finally{await admin.query('rollback');}assert(error,'Guarded operation unexpectedly succeeded');assert(allowed.includes(error.code),error.code+': '+error.message);return error.code;}
async function waitForReaders(event='advisory'){
 const deadline=Date.now()+6000;
 for(;;){const {rows:[r]}=await admin.query("select count(*)::int n from pg_stat_activity where application_name in('cos_full_upload_proof_reader_a','cos_full_upload_proof_reader_b') and wait_event=$1",[event]);if(r.n===2)return;if(Date.now()>deadline)throw Error('Two independent clients did not reach '+event+' barrier before the8s safety limit');await sleep(10);}
}
async function runInCallRace(cp,action){
 const outcomes={};const guardSignature='cos_mhelp_placement_private.guard(uuid,uuid)',original=await definition(guardSignature);
 for(const kind of ['baseline','candidate']){
  await restore(cp);await switchTo(kind);const before=await pairedRead();
  const renamed=original.replace('FUNCTION cos_mhelp_placement_private.guard(','FUNCTION cos_mhelp_placement_private.synthetic_original_link_guard(');assert.notEqual(renamed,original);
  await admin.query(renamed);await admin.query('revoke all on function cos_mhelp_placement_private.synthetic_original_link_guard(uuid,uuid) from public,anon,authenticated,service_role');
  let pending;
  try{
   await admin.query(`create or replace function cos_mhelp_placement_private.guard(p_tracker uuid,p_native uuid) returns text language plpgsql stable set search_path='' as $hook$
    begin if p_tracker='${t(1)}'::uuid then perform pg_catalog.pg_advisory_xact_lock_shared(144434,771);end if;
    return cos_mhelp_placement_private.synthetic_original_link_guard(p_tracker,p_native);end $hook$`);
   assert.equal(await fastPathAllowed(),true,'Synthetic link hook must not trigger upload dependency fallback');
   await writer.query('begin');await writer.query('select pg_advisory_xact_lock(144434,771)');
   pending=Promise.all([sql(readerA),sql(readerB)]);void pending.catch(()=>{});await waitForReaders();
   await writer.query("insert into public.equipment_unit_location_history values($1,'Synthetic committed during first link statement')",[n(1)]);
   await writer.query("update cos_mhelp_placement_private.upload_batches set receipt=receipt||'{\"syntheticStatementBoundary\":\"fresh upload\"}'");
   await writer.query(action);
   const [a,b]=await pending;assert.deepEqual(a.outcome,b.outcome);assert(!a.outcome.error);assert.deepEqual(a.outcome.value.items,before.value.items,'First public statement keeps its already-acquired snapshot');
   if(action==='commit'){assert.equal(a.outcome.value.upload.syntheticStatementBoundary,'fresh upload');assert.equal(a.outcome.value.upload.records[0].binding.guardCurrent,false,'Later upload statement sees fresh committed graph');}
   else assert.deepEqual(a.outcome,before,'Writer rollback preserves complete result');
   outcomes[kind]=a.outcome;
  }finally{await writer.query('rollback');if(pending)await pending.catch(()=>{});await admin.query(original);await admin.query('drop function if exists cos_mhelp_placement_private.synthetic_original_link_guard(uuid,uuid)');await restore(cp);}
 }
 assert.deepEqual(outcomes.candidate,outcomes.baseline);
 report.mvcc.push({name:'in-call first-link barrier with writer '+action,independentReadCommittedClients:2,firstStatementSnapshotPreserved:true,subsequentUploadFresh:action==='commit',fastPathDependenciesUnmodified:true,completeOutcomeEqual:true,sha256:hash(outcomes.baseline)});
}
async function runMutationRace(cp,race){
 const results={};
 for(const kind of ['baseline','candidate']){
  await restore(cp);await switchTo(kind);const before=await pairedRead(),beforeHttp=(await http()).outcome;
  const stages={};
  try{
   await writer.query('begin');await writer.query(race.statement,race.values??[]);
   stages.uncommitted=await pairedRead();assert.deepEqual(stages.uncommitted,before);assert.deepEqual((await http()).outcome,beforeHttp);
   await writer.query('rollback');stages.rolledBack=await pairedRead();assert.deepEqual(stages.rolledBack,before);assert.deepEqual((await http()).outcome,beforeHttp);
   await writer.query('begin');await writer.query(race.statement,race.values??[]);await writer.query('commit');
   stages.committed=await pairedRead();assert.notDeepEqual(stages.committed,before,race.name+' must be observable');stages.http=(await http()).outcome;assert.equal(stages.http.status,200);assert.deepEqual(stages.http.value,stages.committed.value);
   results[kind]=stages;
  }finally{await writer.query('rollback');await restore(cp);}
 }
 assert.deepEqual(results.candidate,results.baseline,race.name+' complete stage outcomes');
 report.mvcc.push({name:race.name,independentReadCommittedClients:2,uncommittedInvisible:true,rollbackInvisible:true,committedFresh:true,httpFresh:true,completeOutcomeEqual:true,sha256:hash(results.baseline)});await save();
}
function stats(values){const sorted=[...values].sort((a,b)=>a-b);return {samplesMs:values.map(x=>+x.toFixed(3)),meanMs:+(values.reduce((a,b)=>a+b,0)/values.length).toFixed(3),p95Ms:+sorted[Math.ceil(values.length*.95)-1].toFixed(3),maxMs:+Math.max(...values).toFixed(3)};}
async function benchmark(name){
 const cp=await checkpoint();await switchTo('baseline');const expected=(await sql(readerA)).outcome;assert(!expected.error);
 const samples={baseline:{sql:[],http:[],concurrentSql:[],concurrentHttp:[],fiveClientSql:[],fiveClientHttp:[]},candidate:{sql:[],http:[],concurrentSql:[],concurrentHttp:[],fiveClientSql:[],fiveClientHttp:[]}},blocks=[];
 for(let round=0;round<6;round++){
  const block={round};for(const kind of round%2?['candidate','baseline']:['baseline','candidate']){
   await switchTo(kind);assert.equal(await fastPathAllowed(),true,'Measured installed candidate must use its verified optimized branch');await assertSettings(readerA);await assertSettings(readerB);
   // Warm each exact installed version once; exclude install and warm-up time.
   assert.deepEqual((await sql(readerA)).outcome,expected);
   const one=await sql(readerA);assert.deepEqual(one.outcome,expected);samples[kind].sql.push(one.ms);
   const h=await http();assert.equal(h.outcome.status,200);assert.deepEqual(h.outcome.value,expected.value);samples[kind].http.push(h.ms);
   const pair=await Promise.all([sql(readerA),sql(readerB)]);for(const r of pair){assert.deepEqual(r.outcome,expected);samples[kind].concurrentSql.push(r.ms);}
   const hp=await Promise.all([http(),http()]);for(const r of hp){assert.equal(r.outcome.status,200);assert.deepEqual(r.outcome.value,expected.value);samples[kind].concurrentHttp.push(r.ms);}
   const fiveSql=await Promise.all(readClients.map(c=>sql(c)));for(const r of fiveSql){assert.deepEqual(r.outcome,expected);samples[kind].fiveClientSql.push(r.ms);}
   const fiveHttp=await Promise.all(Array.from({length:5},()=>http()));for(const r of fiveHttp){assert.equal(r.outcome.status,200);assert.deepEqual(r.outcome.value,expected.value);samples[kind].fiveClientHttp.push(r.ms);}
   block[kind]={sqlMs:one.ms,httpMs:h.ms,concurrentSqlMeanMs:pair.reduce((a,r)=>a+r.ms,0)/2,concurrentHttpMeanMs:hp.reduce((a,r)=>a+r.ms,0)/2,fiveClientSqlMeanMs:fiveSql.reduce((a,r)=>a+r.ms,0)/5,fiveClientHttpMeanMs:fiveHttp.reduce((a,r)=>a+r.ms,0)/5};
  }blocks.push(block);
 }
 const result={name,fixtureSizes:(await admin.query("select octet_length(records::text) records_bytes,octet_length(receipt::text) receipt_bytes from cos_mhelp_placement_private.upload_batches order by source_sha256 limit 1")).rows[0],wholeUnchangedTwoArgumentRpc:true,actualPostgrest:true,sharedNativePostgres:true,twoConcurrentClients:true,fiveIndependentSqlClients:true,fiveConcurrentHttpRequests:true,blocks,baseline:{},candidate:{},materialImprovement:{}};
 for(const metric of ['sql','http','concurrentSql','concurrentHttp','fiveClientSql','fiveClientHttp']){
  result.baseline[metric]=stats(samples.baseline[metric]);result.candidate[metric]=stats(samples.candidate[metric]);
  const reduction=100*(1-result.candidate[metric].meanMs/result.baseline[metric].meanMs);
  const field={sql:'sqlMs',http:'httpMs',concurrentSql:'concurrentSqlMeanMs',concurrentHttp:'concurrentHttpMeanMs',fiveClientSql:'fiveClientSqlMeanMs',fiveClientHttp:'fiveClientHttpMeanMs'}[metric];
  const wins=blocks.filter(b=>b.candidate[field]<b.baseline[field]).length;
  const p95RegressionPct=100*(result.candidate[metric].p95Ms/result.baseline[metric].p95Ms-1),maxRegressionPct=100*(result.candidate[metric].maxMs/result.baseline[metric].maxMs-1);
  result.materialImprovement[metric]={meanReductionPct:+reduction.toFixed(2),pairedBlockWins:wins,requiredPct:10,requiredBlockWins:4,p95RegressionPct:+p95RegressionPct.toFixed(2),maxRegressionPct:+maxRegressionPct.toFixed(2),maxAllowedTailRegressionPct:10,passed:reduction>=10&&wins>=4&&p95RegressionPct<=10&&maxRegressionPct<=10};
  assert(result.baseline[metric].maxMs<8000&&result.candidate[metric].maxMs<8000,'Every successful measured request must complete within unchanged8s server limit');
 }
 // Evidence is collected even if the material speedup gate fails. A failed gate
 // makes the overall proof fail rather than silently recommending installation.
 report.performance.push(result);await save();
 for(const kind of ['baseline','candidate']){await switchTo(kind);const plan=(await admin.query('explain(analyze,buffers,format json) select public.cos_mhelp_placement_snapshot($1,$2)',[t(1),org])).rows[0]['QUERY PLAN'];await fs.writeFile(resolve(config.reportDir,name+'-'+kind+'-complete-rpc-plan.json'),JSON.stringify(plan,null,2)+'\n');const body=(await admin.query("select prosrc from pg_proc where oid='cos_mhelp_placement_private.upload_snapshot()'::regprocedure")).rows[0].prosrc;const uploadPlan=(await admin.query('explain(analyze,buffers,format json) '+body)).rows[0]['QUERY PLAN'];await fs.writeFile(resolve(config.reportDir,name+'-'+kind+'-installed-upload-plan.json'),JSON.stringify(uploadPlan,null,2)+'\n');}
 await restore(cp);return result;
}
try{
 admin=await connect('admin');readerA=await connect('reader_a');readerB=await connect('reader_b');readerC=await connect('reader_c');readerD=await connect('reader_d');readerE=await connect('reader_e');writer=await connect('writer');readClients=[readerA,readerB,readerC,readerD,readerE];
 report.independentReaderBackendPids=await Promise.all(readClients.map(async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid));assert.equal(new Set(report.independentReaderBackendPids).size,5);
 report.postgresVersion=(await admin.query('show server_version')).rows[0].server_version;
 report.postgrestVersion=(await fs.readFile(resolve(config.reportDir,'postgrest-version.txt'),'utf8')).trim();assert.match(report.postgrestVersion,/PostgREST\s+14\.5(?:\s|\(|$)/);
 baselineCatalog=await allFunctions(adapter(admin));baselineSecurity=await tableSecurity(adapter(admin));baselineOtherCatalog=await catalogExtras();await assertCatalog();
 for(const c of readClients)await c.query('set role service_role');
 for(const c of readClients){await assert.rejects(()=>c.query('select cos_mhelp_placement_private.upload_snapshot()'),e=>e.code==='42501');await assert.rejects(()=>c.query('select * from cos_mhelp_placement_private.upload_batches'),e=>e.code==='42501');}
 const settingsResponse=await fetch(config.apiUrl+'/rpc/synthetic_full_upload_runtime_settings',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.service_role},body:'{}',signal:AbortSignal.timeout(12000)});assert.equal(settingsResponse.status,200);report.httpSettings=await settingsResponse.json();
 assert.deepEqual(report.httpSettings,{statement_timeout:'8s',lock_timeout:'8s',work_mem:'2184kB',transaction_isolation:'read committed',enable_seqscan:'on',enable_indexscan:'on',enable_indexonlyscan:'on',enable_bitmapscan:'on',enable_hashjoin:'on',enable_mergejoin:'on',enable_nestloop:'on'});
 const initial=await sql(readerA);assert(!initial.outcome.error);report.population=representativeCounts(initial.outcome.value);assert.deepEqual((await http()).outcome.value,initial.outcome.value);
 // Exact one-function installation, rejection and rollback checks.
 await admin.query('alter function cos_mhelp_placement_private.upload_snapshot() cost 101');const costError=await mustReject(install);await admin.query('alter function cos_mhelp_placement_private.upload_snapshot() cost 100');await assertCatalog();report.installer.push({name:'catalog cost drift rejects atomically',code:costError});
 const helperOriginal=await replaceBody('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)','select false');const helperError=await mustReject(install);await admin.query(helperOriginal);await assertCatalog();report.installer.push({name:'dependency definition drift rejects atomically',code:helperError});
 const injected=install.replace(/\bcommit\s*;\s*$/i,'select 1/0;\ncommit;');assert.notEqual(injected,install,'Installer must expose final transactional COMMIT');await mustReject(injected,['22012']);await assertCatalog();report.installer.push({name:'failure immediately before commit restores all catalogs',passed:true,exactPackageUnmodified:true});
 await switchTo('candidate');await admin.query(install);await assertCatalog();await switchTo('baseline');await admin.query(rollback);await assertCatalog();report.installer.push({name:'exact install, idempotent duplicate and exact rollback',passed:true});
 const attempts=await Promise.allSettled([admin.query(install),writer.query(install)]);assert(attempts.some(r=>r.status==='fulfilled'),'At least one concurrent guarded installer must succeed; a second may reject its lock or observe the exact idempotent target');for(const r of attempts)if(r.status==='rejected')assert(['55000','55P03','40001','23505'].includes(r.reason.code),r.reason.code);await admin.query('rollback');await writer.query('rollback');mode='candidate';await assertCatalog();await switchTo('baseline');report.installer.push({name:'concurrent installers',outcomes:attempts.map(r=>r.status==='fulfilled'?{status:'success'}:{status:'rejected',code:r.reason.code})});
 for(const kind of ['baseline','candidate']){await switchTo(kind);for(const role of ['anon','authenticated'])for(const body of [actor,camera]){const r=(await http(body,{role})).outcome;assert.equal(r.value.code,'42501');assert([401,403].includes(r.status));}assert.equal((await http(actor,{bearer:null})).outcome.status,401);assert.equal((await http(actor,{bearer:'synthetic.invalid.signature'})).outcome.status,401);}
 await fullCase('unchanged complete representative snapshot',undefined,r=>representativeCounts(r.sql.value));
 for(const [name,statement,values] of [
  ['tracker customer',"update app_private.vision_tracker_locations set customer='Synthetic changed' where id=$1",[t(1)]],
  ['tracker SHOP',"update app_private.vision_tracker_locations set placement='SHOP' where id=$1",[t(1)]],
  ['tracker deletion','delete from app_private.vision_tracker_locations where id=$1',[t(1)]],
  ['native retired',"update public.equipment_units set status='retired' where id=$1",[n(1)]],
  ['native SHOP',"update public.equipment_units set current_location_type='shop' where id=$1",[n(1)]],
  ['native deletion','delete from public.equipment_units where id=$1',[n(1)]],
  ['native GPS','update public.equipment_units set gps_latitude=1,gps_longitude=2 where id=$1',[n(1)]],
  ['source revision',"update app_private.cos_geocode_sources set street='Synthetic changed' where tracker_id=$1",[t(1)]],
  ['source deletion','delete from app_private.cos_geocode_sources where tracker_id=$1',[t(1)]],
  ['source tombstone',"update app_private.cos_geocode_sources set active=false,source_placement='SHOP',eligibility='tombstone' where tracker_id=$1",[t(1)]],
  ['duplicate and sorted Owner history',"insert into public.equipment_unit_location_history values($1,'Z synthetic'),($1,'A synthetic'),($1,'A synthetic')",[n(1)]],
  ['duplicate and sorted Owner claims',"insert into app_private.cos_owner_identity_claims values($1,'Z synthetic'),($1,'A synthetic'),($1,'A synthetic')",[n(1)]],
  ['archive overlapping OR endpoints',"insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)",[org,n(900),n(1),t(900),t(1),sha]],
  ['active pointer null','update cos_mhelp_placement_private.upload_control set active_sha256=null',[]],
  ['active control absent','delete from cos_mhelp_placement_private.upload_control',[]],
  ['empty records',"update cos_mhelp_placement_private.upload_batches set records='[]'",[]],
  ['missing tracker array',"update cos_mhelp_placement_private.upload_batches set receipt=receipt-'trackerRecords'",[]],
  ['null tracker array',"update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{trackerRecords}','null')",[]],
  ['scalar tracker array',"update cos_mhelp_placement_private.upload_batches set receipt=jsonb_set(receipt,'{trackerRecords}','3')",[]],
  ['nonarray records',"update cos_mhelp_placement_private.upload_batches set records='{}'",[]]
 ])await fullCase(name,()=>admin.query(statement,values));
 await fullCase('same pair distinct null expected guards',sourceRecords(r=>{r[1].binding={...r[0].binding,expectedGuard:'f'.repeat(64)};r[2].binding={...r[0].binding,expectedGuard:null};}));
 await fullCase('source null and missing bindings',sourceRecords(r=>{r[0].binding=null;delete r[1].binding;}));
 await fullCase('native-only and null-null identities',sourceRecords(r=>{r[0].binding.trackerId=null;r[1].binding.trackerId=null;r[1].binding.nativeUnitId=null;}));
 await fullCase('mismatched tracker native source OR overlap',sourceRecords(r=>{r[0].binding.nativeUnitId=n(2);}));
 await fullCase('malformed source UUID',sourceRecords(r=>{r[0].binding.trackerId='invalid';}),r=>assert.equal(r.sql.error.code,'22P02'));
 await fullCase('malformed sourceRow sort',sourceRecords(r=>{r[0].sourceRow='invalid';}),r=>assert.equal(r.sql.error.code,'22P02'));
 for(const state of ['held','unlinked','missing',null])await fullCase('malformed tracker UUID with '+state,trackerReceipt(r=>{r.trackerRecords[0].binding={trackerId:'invalid',nativeUnitId:'invalid',expectedGuard:sha};if(state!=='missing')r.trackerRecords[0].binding.state=state;}));
 await fullCase('opaque receipt fields and redaction',trackerReceipt(r=>{r.syntheticOpaque={x:[null,false,3]};r.trackerRecords[0].syntheticOpaque={x:'kept'};}),r=>{assert.deepEqual(r.sql.value.upload.syntheticOpaque,{x:[null,false,3]});assert.equal(r.sql.value.upload.receivedMessageId,undefined);assert.equal(r.sql.value.upload.authorizationSha256,undefined);});
 for(const [name,signature,body] of [
  ['changed upload helper result','cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)',"select 'synthetic changed helper'::text"],
  ['upload helper error','cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)',"select (1/0)::text"],
  ['changed continuity helper result','cos_mhelp_placement_private.continuity_current(uuid,uuid,text)','select false'],
  ['continuity helper error','cos_mhelp_placement_private.continuity_current(uuid,uuid,text)','select (1/0)>0'],
  ['permission denied','app_private.has_permission(uuid,text)','select false']
 ]){const original=await definition(signature);await fullCase('runtime fallback: '+name,async()=>{await replaceBody(signature,body);if(/\.(?:upload_binding_guard|continuity_current)\(/.test(signature))assert.equal(await fastPathAllowed(),false);},()=>{},()=>admin.query(original));report.runtimeDrift.push({name,baselineFallbackEqual:true,exactInstalledCandidate:true});}
 for(const [name,signature,statement] of [
  ['actor denial','app_private.appdeploy_assume_actor(uuid,uuid)',"create or replace function app_private.appdeploy_assume_actor(uuid,uuid) returns void language plpgsql as $$begin raise exception 'Synthetic actor denied' using errcode='42501';end$$"],
  ['consumed status failure','public.cos_mhelp_placement_status()',"create or replace function public.cos_mhelp_placement_status() returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Synthetic status failure' using errcode='XX001';end$$"]
 ]){const original=await definition(signature);await fullCase(name,()=>admin.query(statement),()=>{},()=>admin.query(original));}
 for(const [name,create,drop] of [
  ['defaulted upload guard overload',"create function cos_mhelp_placement_private.upload_binding_guard(p_tracker uuid,p_native uuid,synthetic_option text default null) returns text language sql stable set search_path='' as $$select 'synthetic alternate overload'::text$$;revoke all on function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid,text) from public,anon,authenticated,service_role",'drop function if exists cos_mhelp_placement_private.upload_binding_guard(uuid,uuid,text)'],
  ['defaulted continuity overload',"create function cos_mhelp_placement_private.continuity_current(t uuid,n uuid,original text,synthetic_option text default null) returns boolean language sql stable set search_path='' as $$select false$$;revoke all on function cos_mhelp_placement_private.continuity_current(uuid,uuid,text,text) from public,anon,authenticated,service_role",'drop function if exists cos_mhelp_placement_private.continuity_current(uuid,uuid,text,text)']
 ]){
  const continuityDefinition=name==='defaulted upload guard overload'?await definition('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)'):null;
  await fullCase('runtime fallback: '+name,async()=>{
   await applyOverloadFixture(admin,{createSql:create,continuityDefinition});
   assert.equal(await fastPathAllowed(),false);
  },outcome=>{assert.equal(outcome.sql.error?.code,'42725');assert.equal(outcome.http.value.code,'42725');},()=>removeOverloadFixture(admin,{dropSql:drop,continuityDefinition}));
  report.runtimeDrift.push({name,baselineOverloadResolutionEqual:true,expectedSqlstate:'42725',freshContinuityParse:!!continuityDefinition,sessionSettingRestored:true,exactInstalledCandidate:true});
 }
 const dispatch={};for(const kind of ['baseline','candidate']){await switchTo(kind);dispatch[kind]=[];for(const body of [{...actor,p_organization_id:n(999)},{...camera,p_projection:null},{...camera,p_projection:''},{...camera,p_projection:'CAMERA'},{...camera,p_projection:'all'},{p_actor_user_id:t(1)},{...actor,unreviewed:true},{...actor,p_actor_user_id:'invalid'}])dispatch[kind].push((await http(body)).outcome);for(const result of dispatch[kind])assert(result.status>=400&&result.status<500);}
 assert.deepEqual(dispatch.candidate,dispatch.baseline);report.equivalence.push({name:'wrong organization, invalid selector and malformed named dispatch',actualHttp:true,completeStatusBodyEqual:true,count:dispatch.baseline.length});
 // Transactional DDL drift case is SQL-only so a rolled-back added column cannot
 // leave a dead catalog slot and accidentally weaken the next guarded install.
 const schemaOutcomes={};
 for(const kind of ['baseline','candidate']){await switchTo(kind);await admin.query('begin');try{
  await admin.query("alter table public.equipment_units add column synthetic_private_metadata jsonb default '{\"synthetic\":true}'");
  const result=await sql(admin);assert(!result.outcome.error);schemaOutcomes[kind]=result.outcome;
 }finally{await admin.query('rollback');}await assertCatalog();}
 assert.deepEqual(schemaOutcomes.candidate,schemaOutcomes.baseline);report.runtimeDrift.push({name:'additional full-row native field',sqlOnly:true,transactionalSchemaRollback:true,completeOutcomeEqual:true});
 const timezoneOutcomes={};
 for(const kind of ['baseline','candidate']){await switchTo(kind);await readerA.query("set time zone 'Etc/GMT+6'");try{timezoneOutcomes[kind]=(await sql(readerA)).outcome;}finally{await readerA.query("set time zone 'UTC'");}}
 assert.deepEqual(timezoneOutcomes.candidate,timezoneOutcomes.baseline);report.equivalence.push({name:'alternate caller timezone',sqlOnly:true,completeJsonTextEqual:true});
 const cp=await checkpoint();
 const alternate='e'.repeat(64);await admin.query(`insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records,admitted_at) select $1,payload_sha256,receipt||'{"syntheticAlternateBatch":true}',records,'2026-01-01T12:00:00Z' from cos_mhelp_placement_private.upload_batches order by source_sha256 limit 1`,[alternate]);
 const raceCp=await checkpoint();
 for(const race of [
  {name:'native mutation',statement:"update public.equipment_units set status='retired' where id=$1",values:[n(1)]},
  {name:'new Owner history',statement:"insert into public.equipment_unit_location_history values($1,'Synthetic new Owner history')",values:[n(1)]},
  {name:'new Owner claim',statement:"insert into app_private.cos_owner_identity_claims values($1,'Synthetic new Owner claim')",values:[n(1)]},
  {name:'source mutation',statement:"update app_private.cos_geocode_sources set street='Synthetic committed source' where tracker_id=$1",values:[t(1)]},
  {name:'new source row',statement:`insert into app_private.cos_geocode_sources(organization_id,entity_kind,native_unit_id,tracker_id,product_id,unit_number,tracker_unit_number,family,source_file_sha256,source_row_sha256,street,city,state,zip,address_sha256,native_guard_sha256,source_placement,active,eligibility) values($1,'tracker',$2,$2,'535','Spotter 435','Spotter 435','SPOTTER',$3,$3,'101 Example Road','Sample','TX','77001',$3,$3,'FIELD',true,'FIELD')`,values:[org,t(435),sha]},
  {name:'SHOP tombstone',statement:"update app_private.vision_tracker_locations set placement='SHOP' where id=$1",values:[t(1)]},
  {name:'new archive row',statement:"insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)",values:[org,n(900),n(1),t(900),t(1),sha]},
  {name:'active upload pointer switch',statement:'update cos_mhelp_placement_private.upload_control set active_sha256=$1',values:[alternate]}
 ])await runMutationRace(raceCp,race);
 await runInCallRace(raceCp,'commit');await runInCallRace(raceCp,'rollback');await restore(cp);
 report.continuity=await addContinuity({admin,readSnapshot:()=>sql(readerA),t,n,sha});await fullCase('successful latest continuity chain');
 await fullCase('wrong active payload does not adopt continuity',()=>admin.query('update cos_mhelp_placement_private.upload_batches set payload_sha256=$1',['f'.repeat(64)]));
 await fullCase('latest continuity head rejects changed source graph',()=>admin.query('delete from app_private.cos_geocode_sources where tracker_id=$1',[t(1)]));
 await fullCase('continuity original guard mismatch',sourceRecords(r=>{r[0].binding.expectedGuard='f'.repeat(64);}));
 await fullCase('continuity after Owner mutation',()=>admin.query("insert into public.equipment_unit_location_history values($1,'Synthetic later Owner mutation')",[n(1)]));
 await benchmark('reduced-width-with-continuity');
 // Use existing columns, retaining schema/index/OID invariants and all six graph arrays.
 await restore(cp);await widenFixture({admin,n,t,org,sha});report.wideContinuity=await addContinuity({admin,readSnapshot:()=>sql(readerA),t,n,sha});await fullCase('representative-width complete snapshot with duplicate history/claims');await benchmark('representative-width-with-continuity');
 const lockOutcomes={};
 for(const kind of ['baseline','candidate']){await switchTo(kind);await writer.query('begin');await writer.query('lock table cos_mhelp_placement_private.upload_batches in access exclusive mode');try{const start=performance.now(),[a,b,c]=await Promise.all([http(),http(),http(camera)]);assert(['57014','55P03'].includes(a.outcome.value.code));assert(['57014','55P03'].includes(b.outcome.value.code));assert(a.outcome.status>=400&&b.outcome.status>=400);assert.equal(c.outcome.status,200,'Existing camera overload still bypasses upload');const elapsed=performance.now()-start;assert(elapsed>=7000&&elapsed<11500);lockOutcomes[kind]={bothFullRequestsTimedOut:true,cameraStatus:c.outcome.status};report.mvcc.push({name:kind+' actual HTTP8s upload lock timeout',wallMs:Math.round(elapsed),fullErrors:[a.outcome,b.outcome],twoFullClients:true,cameraPreserved:true});}finally{await writer.query('rollback');}}
 assert.deepEqual(lockOutcomes.candidate,lockOutcomes.baseline);
 const finalCandidate=(await sql(readerA)).outcome;await switchTo('baseline');assert.deepEqual((await sql(readerA)).outcome,finalCandidate);assert.deepEqual((await http()).outcome.value,finalCandidate.value);await assertCatalog();for(const c of clients)await assertSettings(c);
 const failedMetrics=report.performance.flatMap(p=>Object.entries(p.materialImprovement).filter(([,m])=>!m.passed).map(([metric])=>p.name+':'+metric));
 report.materialPerformanceGate={passed:failedMetrics.length===0,failedMetrics};assert.equal(failedMetrics.length,0,'Material repeatable >=10% improvement in >=4/6 paired blocks required for SQL/HTTP/sequential/concurrent, both widths: '+failedMetrics.join(', '));
 report.passed=true;report.onlyChangedFunction='cos_mhelp_placement_private.upload_snapshot()';
}catch(error){report.failure={message:error.message,code:error.code??null};throw error;}
finally{try{await save();}finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}}}
