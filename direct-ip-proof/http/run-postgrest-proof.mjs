/** This tests a real PostgREST service, not the synthetic Supabase/SQL adapter. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {openDatabase} from '../lib/database.mjs';
import {assertHostedHttp,FIXTURE_META,REPORT_PATH,request,rpc,operation,token,publisherIdentity,snapshot} from './common.mjs';
import {loseCommittedResponse} from './response-drop-proxy.mjs';
import {beginDirectAttempt,completeDirectAttempt} from '../inputs/client/directAttemptClient.ts';

assertHostedHttp();
const metadata=JSON.parse(await readFile(FIXTURE_META,'utf8'));
const postgrestVersion=(await readFile(new URL('./postgrest-version.generated.txt',import.meta.url),'utf8')).trim();
assert.match(postgrestVersion,/\b14\.5\b/,'Actual image executable must report the reviewed PostgREST version.');
const postgrestImageDigests=JSON.parse(await readFile(new URL('./postgrest-image-digests.generated.json',import.meta.url),'utf8'));
assert.ok(Array.isArray(postgrestImageDigests)&&postgrestImageDigests.some(value=>/^postgrest\/postgrest@sha256:[0-9a-f]{64}$/.test(value)));
assert.match(metadata.serverVersion,/^17\.6(?:\s|$)/,'Actual PostgreSQL must be the proposed 17.6 fixture version.');
assert.equal(metadata.kind,'synthetic-hosted-postgrest-fixture');
const database=await openDatabase('postgres'),pg=database.pg;
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const report={kind:'actual-postgrest-http-proof',status:'running',startedAt:new Date().toISOString(),
 postgrestImage:'postgrest/postgrest:v14.5@sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9',postgrestVersion,postgrestImageDigests,postgresImage:'postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929',candidateSqlSha256:metadata.candidateSqlSha256,
 publisher:metadata.publisher,serverVersion:metadata.serverVersion,clock:metadata.clock,fixtureOnlyChanges:metadata.fixtureOnlyChanges,
 productionCalls:0,providerCalls:0,checks:[],limitations:[
  'This is synthetic PostgreSQL plus a real PostgREST service on a hosted runner.',
  'It does not certify Supabase Edge, native Deno, provider transport, production grants/catalogs or deployment compatibility.',
  'Public fixed test signing key and database password are used only inside an ephemeral CI service.',
  'Response loss is simulated only after a separate session confirms the upstream operation committed.'
 ]};
async function check(name,fn){
 try{const details=await fn();report.checks.push({name,pass:true,...details});console.log('PASS '+name);}
 catch(error){report.checks.push({name,pass:false,error:String(error.stack||error)});throw error;}
}
async function ok(args,options){const response=await rpc(args,options);assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.data.ok,true,JSON.stringify(response.data));return response.data;}
const completion=(ticket,ports)=>operation(metadata,'complete',ticket.attempt_id,{sequence:ticket.sequence,
 result:{completed_at:new Date().toISOString(),ports}});
const connected=[{port:443,state:'connected',latency_ms:1,reason:null}];
const refused=[{port:443,state:'refused',latency_ms:null,reason:'connection_refused'}];
async function receiptVisible(receipt){
 const row=(await pg.query('select registration_receipt,completion_receipt from camera_direct_health_private.attempt_receipts where attempt_id=$1::uuid',[receipt.attempt_id])).rows[0];
 assert.ok(row,'separate admin session must observe committed receipt');
 const {is_current,...immutable}=receipt;
 assert.deepEqual(row.completion_receipt??row.registration_receipt,immutable);
}
try{
 let ready=false,last;
 for(let i=0;i<60;i++){
  try{last=await request('/rpc/direct_ip_proof_http_context',{method:'POST',body:{}});if(last.status===200){ready=true;break;}}catch(error){last=String(error);}
  await sleep(1000);
 }
 assert.equal(ready,true,'PostgREST did not become ready: '+JSON.stringify(last));
 await check('JWT-to-database role switching uses actual JSON request claims',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   const response=await request('/rpc/direct_ip_proof_http_context',{method:'POST',body:{},token:token(role)});
   assert.equal(response.status,200);assert.deepEqual(response.data,{database_role:role,session_role:'direct_ip_http_authenticator',jwt_role:role,legacy_jwt_role:null});
  }
  return {roles:['anon','authenticated','service_role'],usesLegacyGuc:false};
 });
 await check('Publisher rejects missing, invalid, unsigned, expired and wrong-role JWTs without mutations',async()=>{
  const before=await snapshot(pg),args=operation(metadata,'begin',id(1));
  const cases=[
   ['missing',null,[401],'42501'],['anon',token('anon'),[401],'42501'],
   ['authenticated',token('authenticated'),[403],'42501'],
   ['wrong-signature',token('service_role',{key:'public-deliberately-wrong-signature-key'}),[401],/^PGRST30[13]$/],
   ['unsigned',token('service_role',{algorithm:'none'}),[401],/^PGRST30[13]$/],
   ['expired',token('service_role',{expires:1}),[401],/^PGRST30[13]$/],
   ['ungranted-owner-role',token('postgres'),[403],'42501']
  ];
  const results=[];
  for(const [name,jwt,statuses,code] of cases){
   const response=await rpc(args,{token:jwt});assert.ok(statuses.includes(response.status),name+': '+JSON.stringify(response));
   if(code instanceof RegExp)assert.match(response.data.code,code);else assert.equal(response.data.code,code);
   assert.deepEqual(await snapshot(pg),before);results.push({name,status:response.status,code:response.data.code});
  }
  return {results};
 });
 await check('Real HTTP begin, completion, read and retry preserve immutable receipts',async()=>{
  const begin=operation(metadata,'begin',id(1)),ticket=await ok(begin);
  assert.equal(ticket.phase,'pending');assert.equal(ticket.is_current,true);assert.equal(typeof ticket.sequence,'string');
  const afterBegin=await snapshot(pg);assert.deepEqual(await ok(begin),ticket);assert.deepEqual(await snapshot(pg),afterBegin);
  const args=completion(ticket,connected),completed=await ok(args);
  assert.equal(completed.phase,'completed');assert.equal(completed.validity,'connected');assert.equal(completed.health_published,true);
  const afterComplete=await snapshot(pg);
  assert.deepEqual(await ok(args),completed);
  assert.deepEqual(await ok(operation(metadata,'read',id(1),{sequence:ticket.sequence})),completed);
  assert.deepEqual(await ok(begin),completed);
  assert.deepEqual(await snapshot(pg),afterComplete);
  const changed=structuredClone(args);changed.p_health.direct_attempt.result.ports[0].latency_ms=2;
  const conflict=await rpc(changed);assert.equal(conflict.status,200);assert.deepEqual(conflict.data,{ok:false,reason:'attempt_conflict'});
  assert.deepEqual(await snapshot(pg),afterComplete);
  return {sequence:ticket.sequence,completeStatus:completed.status,replayCreatesNoWrites:true,conflictingCompletion:'attempt_conflict'};
 });
 await check('Committed begin and completion survive a lost real HTTP response',async()=>{
  const begin=operation(metadata,'begin',id(2));
  const lostBegin=await loseCommittedResponse(begin,receiptVisible);
  const ticket=await ok(operation(metadata,'read',id(2)));
  assert.deepEqual(ticket,lostBegin.receipt);const registered=await snapshot(pg);
  assert.deepEqual(await ok(begin),ticket);assert.deepEqual(await snapshot(pg),registered);
  const args=completion(ticket,refused),lostComplete=await loseCommittedResponse(args,receiptVisible);
  const completed=await ok(operation(metadata,'read',id(2),{sequence:ticket.sequence}));
  assert.deepEqual(completed,lostComplete.receipt);assert.equal(completed.validity,'refused');assert.equal(completed.health_published,true);
  const committed=await snapshot(pg);assert.deepEqual(await ok(args),completed);assert.deepEqual(await snapshot(pg),committed);
  return {beginClientError:lostBegin.client.error,completeClientError:lostComplete.client.error,
   upstreamStatuses:[lostBegin.upstreamStatus,lostComplete.upstreamStatus],downstreamBytes:0,commitsConfirmedBySeparateConnection:true};
 });
 await check('Actual reviewed client helper handles committed HTTP response loss without retrying transport or redating',async()=>{
  const c={device:{...metadata.binding,id:metadata.baseArgs.p_device_id,connection_revision:metadata.baseArgs.p_revision,
   public_ip:metadata.baseArgs.p_public_ip,expected_ports:metadata.baseArgs.p_expected_ports,monitoring_profile:metadata.baseArgs.p_monitoring_profile},
   master:metadata.binding.master,host:metadata.baseArgs.p_public_ip,ports:metadata.baseArgs.p_expected_ports,key:metadata.binding.unit_key};
  const calls=[];let lose='begin';
  // This is a minimal SDK-shaped adapter over actual PostgREST HTTP. It does not
  // claim to execute supabase-js, GoTrue, Edge or native Deno transport.
  const db={rpc(name,args){assert.equal(name,'publish_camera_connection_v1');const q={abortSignal(){return q;},then(resolve,reject){
   return (async()=>{const op=args.p_health.direct_attempt.op;calls.push(structuredClone(args));
    if(op===lose){lose=null;const loss=await loseCommittedResponse(args,receiptVisible);assert.equal(loss.client.error,'ECONNRESET');throw Object.assign(Error('actual proxy connection reset'),{code:'ECONNRESET'});}
    const out=await rpc(args);return out.status===200?{data:out.data,error:null}:{data:null,error:out.data};
   })().then(resolve,reject);
  }};return q;}};
  const request=make=>make(new AbortController().signal);
  const uncertain=await beginDirectAttempt(db,c,'automatic_tcp_sweep',request,()=>id(5));
  assert.equal(uncertain,null,'uncertain committed begin cannot authorize the caller to open sockets');
  assert.deepEqual(calls.map(a=>a.p_health.direct_attempt.op),['begin']);
  assert.equal((await ok(operation(metadata,'read',id(5)))).phase,'pending');
  const ticket=await beginDirectAttempt(db,c,'automatic_tcp_sweep',request,()=>id(6));assert.ok(ticket);
  lose='complete';const frozen={completed_at:new Date().toISOString(),ports:refused};
  const completed=await completeDirectAttempt(db,ticket,frozen,request);assert.ok(completed);assert.equal(completed.health_published,true);
  assert.equal(Date.parse(completed.completed_at),Date.parse(frozen.completed_at));
  assert.deepEqual(calls.map(a=>a.p_health.direct_attempt.op),['begin','begin','complete','read']);
  assert.equal(calls[2].p_health.direct_attempt.result.completed_at,frozen.completed_at);
  return {helper:'exact proposed directAttemptClient.ts',actualHttp:true,uncertainRegistrationAuthorizesTransport:false,
   completionReadback:true,completionPayloadFrozen:true,supabaseJs:false,edge:false};
 });
 await check('Prefer tx=rollback undoes successful begin and successful completion',async()=>{
  const before=await snapshot(pg),begin=operation(metadata,'begin',id(3));
  const rolledBegin=await rpc(begin,{headers:{Prefer:'tx=rollback,handling=strict'}});
  assert.equal(rolledBegin.status,200);assert.equal(rolledBegin.data.ok,true);assert.match(rolledBegin.headers['preference-applied'],/tx=rollback/);
  assert.deepEqual(await snapshot(pg),before);
  const missing=await rpc(operation(metadata,'read',id(3)));assert.equal(missing.status,200);assert.deepEqual(missing.data,{ok:false,reason:'attempt_not_found'});
  const ticket=await ok(begin),pending=await snapshot(pg),args=completion(ticket,connected);
  const rolledComplete=await rpc(args,{headers:{Prefer:'tx=rollback,handling=strict'}});
  assert.equal(rolledComplete.status,200);assert.equal(rolledComplete.data.health_published,true);assert.match(rolledComplete.headers['preference-applied'],/tx=rollback/);
  assert.deepEqual(await snapshot(pg),pending);
  assert.equal((await ok(operation(metadata,'read',id(3),{sequence:ticket.sequence}))).phase,'pending');
  const committed=await ok(args);assert.equal(committed.health_published,true);
  return {beginReceiptAbsentAfterRollback:true,completionRemainsPendingAfterRollback:true,retryCommits:true};
 });
 await check('Database exception after publisher writes atomically rolls back HTTP completion',async()=>{
  const ticket=await ok(operation(metadata,'begin',id(4))),before=await snapshot(pg),args=completion(ticket,refused);
  const failure=await rpc(args,{headers:{'x-direct-ip-proof-fault':'abort-completion'}});
  assert.equal(failure.status,400);assert.equal(failure.data.code,'P0001');assert.equal(failure.data.message,'synthetic HTTP completion rollback');
  assert.deepEqual(await snapshot(pg),before,'health, history, device timestamps, state and receipts must all roll back');
  const pending=await ok(operation(metadata,'read',id(4),{sequence:ticket.sequence}));assert.equal(pending.phase,'pending');
  assert.equal((await ok(args)).health_published,true);
  return {httpStatus:failure.status,code:failure.data.code,allTransactionalRowsRestored:true,retryCommits:true};
 });
 await check('Private schema is absent from HTTP resources and cannot be selected by profile',async()=>{
  const before=await snapshot(pg);
  for(const jwt of [token('service_role'),token('authenticated'),null]){
   for(const path of ['/attempt_state','/attempt_receipts','/camera_direct_health_private.attempt_receipts']){
    const response=await request(path,{token:jwt});assert.equal(response.status,404,JSON.stringify(response));assert.equal(response.data.code,'PGRST205');
   }
   const profile=await request('/attempt_receipts',{token:jwt,headers:{'Accept-Profile':'camera_direct_health_private'}});
   assert.equal(profile.status,406);assert.equal(profile.data.code,'PGRST106');
  }
  const postProfile=await rpc(operation(metadata,'read',id(1)),{headers:{'Content-Profile':'camera_direct_health_private'}});
  assert.equal(postProfile.status,406);assert.equal(postProfile.data.code,'PGRST106');
  const openapi=await request('/',{headers:{Accept:'application/openapi+json'}});assert.equal(openapi.status,200);
  assert.ok(openapi.data.paths['/rpc/publish_camera_connection_v1']);
  for(const path of Object.keys(openapi.data.paths))assert.doesNotMatch(path,/attempt_state|attempt_receipts|camera_direct_health_private/);
  assert.deepEqual(await snapshot(pg),before);
  return {privateResources:404,privateProfile:406,privateOpenApiPaths:0};
 });
 await check('Exact publisher definition, owner and EXECUTE boundary survived HTTP setup and tests',async()=>{
  assert.deepEqual(await publisherIdentity(pg),metadata.publisher);
  const acl=(await pg.query(`select has_function_privilege('service_role',$1,'EXECUTE') as service,
   has_function_privilege('anon',$1,'EXECUTE') as anonymous,
   has_function_privilege('authenticated',$1,'EXECUTE') as authenticated`,['public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)'])).rows[0];
  assert.deepEqual(acl,{service:true,anonymous:false,authenticated:false});return {acl};
 });
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;console.error(report.error);}
finally{report.finishedAt=new Date().toISOString();await writeFile(REPORT_PATH,JSON.stringify(report,null,2)+'\n');await database.close();}
