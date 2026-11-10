// Actual immutable-production handler; all authentication, RPC and source reads
// are synthetic in-memory transports. No production state is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import ts from 'typescript';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const directory=new URL('../../docs/vision-native-preview-20261107/source/',import.meta.url);
const source=readFileSync(new URL('serve.ts',directory),'utf8');
const code=buildSync({stdin:{contents:source+'\nglobalThis.__nativeFactory=createOperationsHandler;',resolveDir:fileURLToPath(directory),sourcefile:'serve.ts',loader:'ts'},bundle:true,platform:'node',format:'iife',target:'es2022',external:['jose'],write:false,logLevel:'silent'}).outputFiles[0].text;
const owner={legacy:'e4abc521-1ef3-45a6-9829-b87faff78210',actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',department:'owner',role:'owner',name:'Synthetic Owner'};
const it={legacy:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',department:'it',role:'it_technician',name:'Teddy Hopper'};
const secondIt={legacy:'b7cc3cbf-d11e-4d4a-9742-c07701857911',actor:'3caf7c00-627f-445f-bce4-ddeae574ee5c',department:'it',role:'it_technician',name:'Victor Garcia'};
const service={legacy:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',department:'service',role:'service_technician',name:'Abel Cervantes'};
const recordId='a2345678-1234-1234-1234-123456789abc',followId='b2345678-1234-1234-1234-123456789abc';
const organization='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
function fixture(who=owner,options={}){
 const data=fieldProductFixture(),calls=[],sources=[],tasks=[];
 const saved={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:null,runs:[]};
 const json=(body,status=200)=>Response.json(body,{status});
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[data.now]));}static now(){return data.now;}}
 const deny=()=>{throw Error('Unexpected network or signing in offline proof');};
 let handler;const hops=[],attempts={},claims={},lost={},requests={};
 // HTTP 200 with a body that ends mid-value.
 const cut=text=>new Response(text,{status:200,headers:{'Content-Type':'application/json'}});
 const context=vm.createContext({console,crypto:webcrypto,structuredClone,Date:FixedDate,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,5)),clearTimeout,
  fetch:async(url,init)=>{
   assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer synthetic-token');
   const body=JSON.parse(init.body);
   if(body.path==='/api/fleet-saved-board/produce'){
    // Internal hand-off: the dedicated worker runs the same recorded handler.
    hops.push(url);assert.equal(body.method,'POST');assert.equal(init.headers['X-COS-Fleet-Batch'],undefined);
    if(url==='https://platform.example/functions/v1/cos-fleet-board-producer'){
     if(!options.producer)return json({error:'Function not found'},404);
     if(options.producer==='gateway')return json({error:'Bad gateway'},502);
     if(options.producer==='offline')throw new TypeError('connection refused');
    }
    assert.match(url,/^https:\/\/platform\.example\/functions\/v1\/cos-(fleet-board-producer|operations-pages)$/);
    const hop=await handler(new Request(url,{method:'POST',headers:init.headers,body:init.body}));
    // The worker started, but its acknowledgment never reached the caller.
    if(options.producer==='lostAck'&&url.endsWith('cos-fleet-board-producer'))throw new DOMException('The operation timed out.','TimeoutError');
    return hop;
   }
   assert.equal(url,'https://platform.example/functions/v1/cos-operations-pages');assert.equal(init.headers['X-COS-Fleet-Batch'],'1');
   assert.equal(body.method,'GET');assert.equal(body.body,null);sources.push(body.path);
   if(options.sourceFails)return json({error:'synthetic unavailable'},404);
   attempts[body.path]=(attempts[body.path]||0)+1;
   if(options.unavailable?.[body.path]>=attempts[body.path])return json({error:'synthetic hold',diagnostic:{stage:'tracker_source',code:'timeout',note:'Never Stored 10.9.8.7'}},503);
   const values={'/api/fleet-map-source':data.field,'/api/product-connections':data.connections,'/api/camera-health/summary-v3':data.health};assert.ok(Object.hasOwn(values,body.path));return json(values[body.path]);
  },require:name=>{assert.equal(name,'jose');return {importPKCS8:deny,SignJWT:class{constructor(){deny();}}};},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://platform.example':undefined},serve:()=>{}},EdgeRuntime:{waitUntil:task=>tasks.push(task)}});
 vm.runInContext(code,context,{timeout:5000});
 handler=context.__nativeFactory({platformUrl:'https://platform.example',serviceKey:'synthetic-key',fetch:async(url,init={})=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({path,method:init.method||'GET',body,signal:init.signal||null});
  if(path==='/auth/v1/user')return json({id:who.legacy},options.invalidToken?401:200);
  if(path==='/rest/v1/profiles')return json([{user_id:who.legacy,full_name:who.name,role:who.department,active:!options.inactive,archived_at:null}]);
  if(path==='/rest/v1/user_profiles')return json([{user_id:who.actor,display_name:who.name,department:who.department,active:true}]);
  if(path==='/rest/v1/user_roles')return json(options.revoked?[]:[{role_id:recordId,roles:{code:who.role,organization_id:organization}}]);
  if(path==='/rest/v1/rpc/cos_fleet_board_status'){if(options.truncated?.status&&!lost.status){lost.status=true;return cut('{"contract":"COS_DUR');}return json(options.status?options.status(calls):saved);}
  if(path==='/rest/v1/rpc/cos_fleet_board_payload')return new Response(options.payload??'null',{status:options.payloadStatus||200});
  if(path==='/rest/v1/rpc/cos_fleet_board_progress')return json(true);
  if(path==='/rest/v1/rpc/cos_fleet_board_claim'){
   if(options.claim===false||(claims[body.p_run]&&claims[body.p_run]!==body.p_producer))return json({claimed:false});
   claims[body.p_run]=body.p_producer;
   // The claim took effect, but its reply never reached the handler.
   if(options.claimReplyLost&&!lost.claim){lost.claim=true;return json({message:'upstream reset'},502);}
   // The claim took effect and the reply is a 200 whose body is cut off.
   if(options.truncated?.claim&&!lost.claim){lost.claim=true;return cut('{"claimed":tr');}
   return json({claimed:true,leaseRemainingMs:options.leaseRemainingMs??176000});}
  if(path==='/rest/v1/rpc/cos_fleet_board_history')return json({items:[]});
  if(path==='/rest/v1/rpc/cos_fleet_board_begin'){
   assert.match(body.p_request,/^[a-f0-9-]{36}$/,'every lease request carries a request token');
   if(requests[body.p_request])return json({id:requests[body.p_request],replayed:true});
   if(options.leaseBusy||(body.p_force&&options.forceRefused)||(body.p_force===false&&!options.followUp))return json(null);
   const id=requests[body.p_request]=body.p_force===false?followId:recordId;
   if(options.beginReplyLost&&!lost.begin){lost.begin=true;return json({message:'upstream reset'},502);}
   if(options.truncated?.begin&&!lost.begin){lost.begin=true;return cut('{"id":"a23');}
   return json({id});}
  if(path==='/rest/v1/rpc/cos_fleet_board_finish'&&options.truncated?.finish)return cut('tr');
  if(['/rest/v1/rpc/cos_fleet_board_stage','/rest/v1/rpc/cos_fleet_board_finish','/rest/v1/rpc/cos_fleet_board_fail'].includes(path))return json(true);
  throw Error('Unexpected synthetic route '+path);
 }});
 return {calls,sources,tasks,saved,hops,claims,request:async(path='/api/fleet-saved-board/refresh',method='POST',body={})=>{
  const response=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{Authorization:options.noBearer?'':'Bearer synthetic-token','Content-Type':'application/json',Origin:options.origin||'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method,body})}));
  const value=await response.json();for(let seen=0;seen<tasks.length;){seen=tasks.length;await Promise.all(tasks);}return {status:response.status,body:value};
 }};
}
test('recorded refresh dispatch is outside GET-only routing and hash matches',()=>{
 const ast=ts.createSourceFile('serve.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0);let matches=0;
 function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(ast).includes('/api/fleet-saved-board/refresh')){matches++;for(let p=node.parent;p;p=p.parent)if(ts.isIfStatement(p))assert.doesNotMatch(p.expression.getText(ast),/^method\s*===\s*['"]GET['"]$/);}ts.forEachChild(node,visit);}visit(ast);assert.equal(matches,1);
 const manifest=JSON.parse(readFileSync(new URL('../manifest.json',directory),'utf8'));assert.equal(createHash('sha256').update(source).digest('hex'),manifest.sourceHashes['serve.ts']);
});
for(const [label,who] of [['Owner',owner],['IT one',it],['IT two',secondIt]])test(label+' POST refresh reaches lease and completes all three sources',async()=>{
 const f=fixture(who),r=await f.request();assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,f.saved);assert.equal(f.tasks.length,1);assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));const names=rpcs.map(c=>c.path.split('/').at(-1));assert.equal(names[0],'cos_fleet_board_begin');assert.deepEqual(names.filter(n=>!n.endsWith('status')),['cos_fleet_board_begin','cos_fleet_board_claim','cos_fleet_board_progress','cos_fleet_board_progress','cos_fleet_board_progress','cos_fleet_board_finish']);assert.ok(!names.includes('cos_fleet_board_read')&&!names.includes('cos_fleet_board_stage'));assert.equal(rpcs[0].body.p_force,true);assert.match(rpcs[0].body.p_request,/^[a-f0-9-]{36}$/);
 const finish=rpcs.find(c=>c.path.endsWith('finish'));assert.equal(finish.body.p_run,recordId);assert.match(finish.body.p_producer,/^[a-f0-9-]{36}$/);assert.equal(finish.body.p_producer,f.claims[recordId]);assert.ok(rpcs.filter(c=>c.path.endsWith('progress')).every(c=>c.body.p_producer===f.claims[recordId]));assert.equal(finish.body.p_payload.contract,'COS_SAVED_FLEET_BOARD_V1');assert.deepEqual(finish.body.p_diagnostics.steps.map(x=>[x.step,x.ok,x.attempts]),[['map',true,1],['connections',true,1],['health',true,1],['project',true,undefined]]);
 // No dedicated worker in this fixture: one declined hand-off, then the batch runs here.
 assert.deepEqual(f.hops,['https://platform.example/functions/v1/cos-fleet-board-producer']);
});
test('saved read starts no refresh lease or source work',async()=>{
 const f=fixture(),r=await f.request('/api/fleet-saved-board','GET');assert.equal(r.status,200);assert.deepEqual(r.body,f.saved);assert.deepEqual(f.sources,[]);assert.equal(f.tasks.length,0);assert.deepEqual(f.calls.filter(c=>c.path.includes('/rpc/')).map(c=>c.path),['/rest/v1/rpc/cos_fleet_board_status']);assert.deepEqual(f.hops,[]);
});
test('busy shared lease returns saved board without duplicate work',async()=>{
 const f=fixture(owner,{leaseBusy:true}),r=await f.request();assert.equal(r.status,200);assert.deepEqual(f.sources,[]);
 // The only extra work is one status check for an owed follow-up; a running batch owes none.
 assert.equal(f.tasks.length,1);assert.deepEqual(f.calls.filter(c=>c.path.includes('/rpc/')).map(c=>c.path.split('/').at(-1)),['cos_fleet_board_begin','cos_fleet_board_status','cos_fleet_board_status']);assert.deepEqual(f.hops,[]);
});
test('failed supporting read records failure without replacing completed board',async()=>{
 const f=fixture(owner,{sourceFails:true}),r=await f.request();assert.equal(r.status,200);assert.deepEqual(r.body,f.saved);assert.deepEqual(f.sources,['/api/fleet-map-source']);const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));const failed=rpcs.find(c=>c.path.endsWith('fail'));assert.equal(failed.body.p_code,'source_read_failed');assert.equal(failed.body.p_producer,f.claims[recordId]);assert.equal(failed.body.p_diagnostics.failedStep,'map');assert.deepEqual(failed.body.p_diagnostics.steps,[{step:'map',ok:false,ms:0,kind:'http',status:404,attempts:1}]);assert.ok(rpcs.every(c=>!c.path.endsWith('stage')&&!c.path.endsWith('finish')));
});
for(const [name,who,options,status] of [['missing bearer',owner,{noBearer:true},401],['invalid bearer',owner,{invalidToken:true},401],['inactive owner',owner,{inactive:true},403],['revoked IT',it,{revoked:true},403],['Service',service,{},403],['foreign origin',owner,{origin:'https://unapproved.example'},403],['read-only preview',owner,{origin:'https://9321842b.cos-vision-integration-preview.pages.dev'},405]])test(name+' still cannot refresh',async()=>{
 const f=fixture(who,options),r=await f.request();assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.ok(f.calls.every(c=>!c.path.includes('/rpc/')));
});
for(const [name,path,method,body,status] of [['GET refresh','/api/fleet-saved-board/refresh','GET',{},405],['POST saved read','/api/fleet-saved-board','POST',{},405],['nonempty refresh','/api/fleet-saved-board/refresh','POST',{force:true},400],['forged actor','/api/fleet-saved-board/refresh','POST',{actorId:recordId},400]])test(name+' cannot start source work',async()=>{
 const f=fixture(),r=await f.request(path,method,body);assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.ok(f.calls.every(c=>!c.path.includes('/rpc/')));
});

test('saved history remains an authorized read without refresh work',async()=>{
 const f=fixture(it),r=await f.request('/api/fleet-saved-board/history/'+recordId,'GET');assert.equal(r.status,200);assert.deepEqual(r.body,{items:[]});assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));assert.equal(rpcs.length,1);assert.equal(rpcs[0].path,'/rest/v1/rpc/cos_fleet_board_history');assert.deepEqual(rpcs[0].body,{p_run:recordId});
});

const board={contract:'COS_SAVED_FLEET_BOARD_V1',fleet:{readAt:'2026-11-09T19:37:00Z'},counts:{online:3}};
const status=(state='completed',id=recordId,extra={})=>({contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id:followId,completedAt:'2026-11-10T01:37:01Z'},refresh:{id,state,...extra},history:[]});
for(const [label,who] of [['Owner',owner],['IT',it]])test(label+' reopen returns the stored board with its original completion time and starts nothing',async()=>{
 const f=fixture(who,{status:()=>status('failed',recordId,{error:'source_read_failed',diagnostics:{failedStep:'connections'}}),payload:JSON.stringify(board)});
 const first=await f.request('/api/fleet-saved-board','GET'),again=await f.request('/api/fleet-saved-board','GET');
 for(const r of [first,again]){assert.equal(r.status,200);assert.deepEqual(r.body.latest,{id:followId,completedAt:'2026-11-10T01:37:01Z',payload:board});assert.equal(r.body.refresh.state,'failed');assert.equal(r.body.refresh.diagnostics.failedStep,'connections');}
 assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.deepEqual(f.hops,[]);
 // The unchanged board is loaded from the database once, not on every poll.
 assert.deepEqual(f.calls.filter(c=>c.path.includes('/rpc/')).map(c=>c.path.split('/').at(-1)),['cos_fleet_board_status','cos_fleet_board_payload','cos_fleet_board_status']);
});
test('an unreadable stored board is an error, never an empty or re-dated board',async()=>{
 const f=fixture(owner,{status:()=>status(),payloadStatus:503});const r=await f.request('/api/fleet-saved-board','GET');assert.ok(r.status>=500,JSON.stringify(r.body));assert.equal(r.body.latest,undefined);
});
test('refresh hands the claimed batch to the dedicated worker, which reads, records and commits it',async()=>{
 const f=fixture(it,{producer:true,payload:JSON.stringify(board),status:calls=>status(calls.some(c=>c.path.endsWith('finish'))?'completed':'running')}),r=await f.request();assert.equal(r.status,200);
 assert.deepEqual(f.hops,['https://platform.example/functions/v1/cos-fleet-board-producer']);assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 assert.equal(f.tasks.length,2,'the refresh request hands off; only the worker request runs the batch');
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/')).map(c=>c.path.split('/').at(-1));assert.equal(rpcs.filter(n=>n==='cos_fleet_board_begin').length,1);assert.equal(rpcs.filter(n=>n==='cos_fleet_board_finish').length,1);assert.ok(!rpcs.includes('cos_fleet_board_fail'));
});
test('a temporarily unavailable source is retried inside the batch and the retry is recorded',async()=>{
 const f=fixture(owner,{unavailable:{'/api/product-connections':2}}),r=await f.request();assert.equal(r.status,200);
 assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/product-connections','/api/product-connections','/api/camera-health/summary-v3']);
 const finish=f.calls.find(c=>c.path.endsWith('finish'));assert.deepEqual(finish.body.p_diagnostics.steps.map(x=>[x.step,x.attempts]).slice(0,3),[['map',1],['connections',3],['health',1]]);
});
test('a source that stays unavailable is named in the failure with categories only',async()=>{
 const f=fixture(owner,{unavailable:{'/api/product-connections':9}}),r=await f.request();assert.equal(r.status,200);
 assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/product-connections','/api/product-connections']);
 const failed=f.calls.find(c=>c.path.endsWith('fail'));assert.equal(failed.body.p_code,'source_read_failed');assert.equal(failed.body.p_diagnostics.failedStep,'connections');
 assert.deepEqual(failed.body.p_diagnostics.steps.at(-1),{step:'connections',ok:false,ms:0,kind:'http',status:503,attempts:3,stage:'tracker_source',code:'timeout'});
 assert.doesNotMatch(JSON.stringify(failed.body),/10\.9\.8\.7|Never Stored|synthetic hold/);assert.ok(f.calls.every(c=>!c.path.endsWith('finish')));
});
test('a refresh queued behind a running batch gets exactly one follow-up as a new request',async()=>{
 const f=fixture(owner,{producer:true,followUp:true,payload:JSON.stringify(board),status:calls=>{const done=calls.filter(c=>c.path.endsWith('finish')).length,begun=calls.filter(c=>c.path.endsWith('begin')).length;return status(done<begun?'running':done===1?'queued':'completed',begun>1?followId:recordId);}});
 const r=await f.request();assert.equal(r.status,200);
 assert.deepEqual(f.hops,['https://platform.example/functions/v1/cos-fleet-board-producer','https://platform.example/functions/v1/cos-fleet-board-producer']);
 const begins=f.calls.filter(c=>c.path.endsWith('begin')).map(c=>c.body.p_force),finishes=f.calls.filter(c=>c.path.endsWith('finish')).map(c=>c.body.p_run);
 assert.deepEqual(begins,[true,false]);assert.deepEqual(finishes,[recordId,followId]);assert.equal(f.sources.length,6);
});
for(const [name,who,body,options,expected] of [['a batch that is not active or already claimed',owner,{run:followId},{claim:false},409],['missing batch',owner,{},{},400],['extra field',owner,{run:recordId,force:true},{},400],['malformed batch',owner,{run:'latest'},{},400],['Service',service,{run:recordId},{},403],['read-only preview',owner,{run:recordId},{origin:'https://9321842b.cos-vision-integration-preview.pages.dev'},405]])test('worker entry rejects '+name,async()=>{
 const f=fixture(who,options),r=await f.request('/api/fleet-saved-board/produce','POST',body);assert.equal(r.status,expected,JSON.stringify(r.body));assert.equal(f.tasks.length,0);assert.deepEqual(f.sources,[]);assert.ok(f.calls.every(c=>!/begin|finish|fail|progress|status/.test(c.path)));if(expected!==409)assert.ok(f.calls.every(c=>!c.path.endsWith('claim')),'rejected before any claim');
});
test('worker entry cannot be reached with GET and a browser request keeps the original connection budget',async()=>{
 const f=fixture(),r=await f.request('/api/fleet-saved-board/produce','GET',{});assert.equal(r.status,405);assert.equal(f.tasks.length,0);
 assert.equal(source.split("request.headers.get('x-cos-fleet-batch')==='1'?40_000:26_000").length,2);assert.equal(source.split('cosProductRequestStartedAt+cosProductBudgetMs').length,2);assert.equal(source.includes('26_000,Date.now'),false);
});

const done=calls=>status(calls.some(c=>c.path.endsWith('finish')||c.path.endsWith('fail'))?'completed':'running');
test('lost acknowledgment: the worker that did start keeps the run and the refresh request starts no second producer',async()=>{
 const f=fixture(owner,{producer:'lostAck',payload:JSON.stringify(board),status:done}),r=await f.request();assert.equal(r.status,200);
 assert.deepEqual(f.hops,['https://platform.example/functions/v1/cos-fleet-board-producer']);
 assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3'],'the sources are read once, by the worker');
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));const claims=rpcs.filter(c=>c.path.endsWith('claim'));
 assert.equal(claims.length,2,'the worker claimed first; the fallback asked and was refused');assert.notEqual(claims[0].body.p_producer,claims[1].body.p_producer);
 const finishes=rpcs.filter(c=>c.path.endsWith('finish'));assert.equal(finishes.length,1);assert.equal(finishes[0].body.p_producer,claims[0].body.p_producer);assert.ok(rpcs.every(c=>!c.path.endsWith('fail')));
});
for(const [label,producer,kind] of [['an unreachable worker (uncertain)','offline'],['a gateway error (uncertain)','gateway'],['a missing worker (definite)',false]])test(label+' leaves exactly one producer: the refresh request claims the run and completes it',async()=>{
 const f=fixture(it,{producer,payload:JSON.stringify(board),status:done}),r=await f.request();assert.equal(r.status,200);
 assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));assert.equal(rpcs.filter(c=>c.path.endsWith('claim')).length,1);assert.equal(rpcs.filter(c=>c.path.endsWith('finish')).length,1);assert.ok(rpcs.every(c=>!c.path.endsWith('fail')));
});
test('a follow-up already claimed by another producer is neither duplicated nor failed by this worker',async()=>{
 // First batch runs here (no dedicated worker). Its queued follow-up is refused everywhere.
 const f=fixture(owner,{followUp:true,payload:JSON.stringify(board),status:calls=>{const ended=calls.filter(c=>c.path.endsWith('finish')||c.path.endsWith('fail')).length,begun=calls.filter(c=>c.path.endsWith('begin')).length;return status(ended<begun?'running':ended===1?'queued':'failed',begun>1?followId:recordId);}});
 const original=f.request;const handlerClaims=f.claims;
 // The self-hosted worker entry refuses because the follow-up run is already claimed in this scenario.
 handlerClaims[followId]='another-producer';
 const r=await original();assert.equal(r.status,200);
 assert.deepEqual(f.hops,['https://platform.example/functions/v1/cos-fleet-board-producer','https://platform.example/functions/v1/cos-fleet-board-producer','https://platform.example/functions/v1/cos-operations-pages']);
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/'));assert.deepEqual(rpcs.filter(c=>c.path.endsWith('finish')).map(c=>c.body.p_run),[recordId]);
 // The run is owned by another producer, so this worker must not fail it either.
 assert.ok(rpcs.every(c=>!(c.path.endsWith('fail')&&c.body.p_run===followId)));assert.equal(f.sources.length,3);
});
test('a refresh queued after the batch ended is started by the request that queued it',async()=>{
 const f=fixture(it,{leaseBusy:false,producer:true,followUp:true,payload:JSON.stringify(board),status:calls=>{const begun=calls.filter(c=>c.path.endsWith('begin')&&c.body.p_force===false).length,ended=calls.some(c=>c.path.endsWith('finish'));return status(ended?'completed':begun?'running':'queued',followId);},forceRefused:true});
 const r=await f.request();assert.equal(r.status,200);assert.equal(r.body.refresh.state,'queued');
 assert.deepEqual(f.calls.filter(c=>c.path.endsWith('begin')).map(c=>c.body.p_force),[true,false]);
 assert.deepEqual(f.hops,['https://platform.example/functions/v1/cos-fleet-board-producer']);assert.deepEqual(f.calls.filter(c=>c.path.endsWith('finish')).map(c=>c.body.p_run),[followId]);assert.equal(f.sources.length,3);
 // Opening in the same queued state starts nothing.
 const open=fixture(it,{payload:JSON.stringify(board),status:()=>status('queued')}),seen=await open.request('/api/fleet-saved-board','GET');assert.equal(seen.status,200);assert.equal(open.tasks.length,0);assert.ok(open.calls.every(c=>!c.path.endsWith('begin')));
});
test('the canonical IT permission list and the recorded handler allow the same saved-board routes',async()=>{
 const {fleetRouteAllowed}=await import('../../supabase/functions/cos-operations-pages/fleetAccess.ts');
 const start=source.indexOf('function fleetRouteAllowed');let depth=0,end=source.indexOf('{',start);do{depth+=source[end]==='{'?1:source[end]==='}'?-1:0;end++;}while(depth);const allow=vm.runInNewContext('('+source.slice(start,end)+')');
 const routes=[['GET','/api/fleet-saved-board'],['POST','/api/fleet-saved-board'],['POST','/api/fleet-saved-board/refresh'],['GET','/api/fleet-saved-board/refresh'],['POST','/api/fleet-saved-board/produce'],['GET','/api/fleet-saved-board/produce'],['PUT','/api/fleet-saved-board/produce'],['POST','/api/fleet-saved-board/produce/'],['POST','/api/fleet-saved-board/producer'],['GET','/api/fleet-saved-board/history/'+recordId],['POST','/api/fleet-saved-board/history/'+recordId],['POST','/api/camera-health/refresh'],['POST','/api/vrm-fleet/refresh']];
 const expected=[true,false,true,false,true,false,false,false,false,true,false,false,false];
 routes.forEach(([method,path],i)=>{assert.equal(fleetRouteAllowed(method,path),expected[i],'canonical '+method+' '+path);assert.equal(allow(method,path),expected[i],'recorded '+method+' '+path);});
});
test('IT can reach the worker entry end to end and Service cannot',async()=>{
 const f=fixture(it,{producer:true,payload:JSON.stringify(board),status:done}),r=await f.request('/api/fleet-saved-board/produce','POST',{run:recordId});assert.equal(r.status,202,JSON.stringify(r.body));assert.deepEqual(r.body,{accepted:true});
 assert.equal(f.sources.length,3);assert.equal(f.calls.filter(c=>c.path.endsWith('finish')).length,1);
 const again=await f.request('/api/fleet-saved-board/produce','POST',{run:recordId});assert.equal(again.status,409,'the same run cannot be started twice');assert.equal(f.sources.length,3);
});

test('worker claim committed but unanswered: the worker reports 503, keeps the run and completes it; the refresh request adds no second producer',async()=>{
 const f=fixture(owner,{producer:true,claimReplyLost:true,payload:JSON.stringify(board),status:done}),r=await f.request();assert.equal(r.status,200);
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/')),claims=rpcs.filter(c=>c.path.endsWith('claim'));
 const worker=claims[0].body.p_producer;assert.ok(claims.filter(c=>c.body.p_producer===worker).length>=2,'the worker asked again with the token it kept');
 assert.equal(f.claims[recordId],worker);assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 const finishes=rpcs.filter(c=>c.path.endsWith('finish'));assert.equal(finishes.length,1);assert.equal(finishes[0].body.p_producer,worker);assert.ok(rpcs.every(c=>!c.path.endsWith('fail')));
 const direct=fixture(it,{claimReplyLost:true,payload:JSON.stringify(board),status:done}),answer=await direct.request('/api/fleet-saved-board/produce','POST',{run:recordId});
 assert.equal(answer.status,503,'an unconfirmed claim is never acknowledged as accepted');assert.equal(direct.calls.filter(c=>c.path.endsWith('finish')).length,1,'yet the batch it owns is completed');
});
test('refresh lease granted but unanswered: the same request token recovers the lease and the batch runs once',async()=>{
 const f=fixture(it,{producer:true,beginReplyLost:true,payload:JSON.stringify(board),status:done}),r=await f.request();assert.equal(r.status,200);
 const begins=f.calls.filter(c=>c.path.endsWith('begin'));assert.equal(begins.length,2);assert.equal(begins[0].body.p_request,begins[1].body.p_request);
 assert.deepEqual(f.calls.filter(c=>c.path.endsWith('finish')).map(c=>c.body.p_run),[recordId]);assert.equal(f.sources.length,3);
});
test('queued follow-up lease granted but unanswered: recovered with the same token and given a producer',async()=>{
 const f=fixture(owner,{producer:true,followUp:true,forceRefused:true,beginReplyLost:true,payload:JSON.stringify(board),status:calls=>{const begun=calls.filter(c=>c.path.endsWith('begin')&&c.body.p_force===false).length,ended=calls.some(c=>c.path.endsWith('finish'));return status(ended?'completed':begun?'running':'queued',followId);}});
 const r=await f.request();assert.equal(r.status,200);
 const follow=f.calls.filter(c=>c.path.endsWith('begin')&&c.body.p_force===false);assert.equal(follow.length,2);assert.equal(follow[0].body.p_request,follow[1].body.p_request);
 assert.ok(f.claims[followId],'the recovered lease has a producer');assert.deepEqual(f.calls.filter(c=>c.path.endsWith('finish')).map(c=>c.body.p_run),[followId]);assert.equal(f.sources.length,3);
});
test('the worker reads sources against the lease it was told remains, and bounds its publish request',async()=>{
 const f=fixture(owner,{leaseRemainingMs:150000}),r=await f.request();assert.equal(r.status,200);
 const finish=f.calls.find(c=>c.path.endsWith('finish'));assert.equal(finish.body.p_diagnostics.budgetMs,150000);assert.ok(finish.signal,'the publish request carries a time limit');
});

test('truncated 200 on the worker claim: not treated as refused; the worker keeps the run it won and no second producer starts',async()=>{
 const f=fixture(owner,{producer:true,truncated:{claim:true},payload:JSON.stringify(board),status:done}),r=await f.request();assert.equal(r.status,200);
 const rpcs=f.calls.filter(c=>c.path.includes('/rpc/')),claims=rpcs.filter(c=>c.path.endsWith('claim')),worker=claims[0].body.p_producer;
 assert.ok(claims.filter(c=>c.body.p_producer===worker).length>=2,'asked again with the same token');assert.equal(f.claims[recordId],worker);
 assert.deepEqual(f.sources,['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 const finishes=rpcs.filter(c=>c.path.endsWith('finish'));assert.equal(finishes.length,1);assert.equal(finishes[0].body.p_producer,worker);assert.ok(rpcs.every(c=>!c.path.endsWith('fail')));
 const direct=fixture(it,{truncated:{claim:true},payload:JSON.stringify(board),status:done}),answer=await direct.request('/api/fleet-saved-board/produce','POST',{run:recordId});
 assert.equal(answer.status,503,'an unreadable claim reply is never acknowledged as accepted or reported as refused');assert.equal(direct.calls.filter(c=>c.path.endsWith('finish')).length,1);
});
test('truncated 200 on the lease request: not treated as "no lease"; the same token recovers it and the batch runs once',async()=>{
 const f=fixture(it,{producer:true,truncated:{begin:true},payload:JSON.stringify(board),status:done}),r=await f.request();assert.equal(r.status,200);
 const begins=f.calls.filter(c=>c.path.endsWith('begin'));assert.equal(begins.length,2);assert.equal(begins[0].body.p_request,begins[1].body.p_request);
 assert.deepEqual(f.calls.filter(c=>c.path.endsWith('finish')).map(c=>c.body.p_run),[recordId]);assert.equal(f.sources.length,3);
});
test('truncated 200 on publish: not treated as success; recorded as unconfirmed',async()=>{
 const f=fixture(owner,{truncated:{finish:true}}),r=await f.request();assert.equal(r.status,200);
 const failed=f.calls.find(c=>c.path.endsWith('fail'));assert.ok(failed,'an unreadable publish reply must not pass as published');
 assert.equal(failed.body.p_diagnostics.failedStep,'commit');assert.equal(failed.body.p_diagnostics.steps.at(-1).kind,'commit_unreadable');assert.equal(failed.body.p_producer,f.claims[recordId]);
});
test('truncated 200 on status: the stored board is still returned, never an empty record',async()=>{
 const f=fixture(it,{truncated:{status:true},status:()=>status(),payload:JSON.stringify(board)}),r=await f.request('/api/fleet-saved-board','GET');
 assert.equal(r.status,200);assert.equal(r.body.contract,'COS_DURABLE_FLEET_RESPONSE_V1');assert.deepEqual(r.body.latest.payload,board);assert.equal(f.tasks.length,0);
});
