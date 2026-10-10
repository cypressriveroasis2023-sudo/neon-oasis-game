import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {scheduleCameraMhelpIntake,INTAKE_BACKGROUND_INVOCATION_MS} from '../intake/mhelpIntakeBackground.ts';

const LEGACY='https://goqrnolcvqnirjmzaeyk.supabase.co',started=Date.parse('2026-10-10T06:03:00Z');
const request=(headers={},method='POST')=>new Request('https://synthetic.invalid/provider',{method,
  headers:{'x-camera-cron-secret':'synthetic-cron',...headers},...(method==='POST'?{body:'{"mode":"witness"}'}:{})});
const aggregate=()=>({contract:'cos-mhelp-ticket-intake-run-v1',state:'idle',scanned:0,created:0,existing:0,reviewNeeded:0,watermarkAdvanced:false});
function setup(patch={}){
  const tasks=[],calls=[];
  const options={request:request(),cronAuthenticated:true,projectUrl:LEGACY,startedAt:started,now:()=>started,
    db:{rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});return {data:{state:'disabled'},error:null};}})},
    fetch:async()=>{throw Error('Vendor access must not occur');},waitUntil:task=>tasks.push(task),
    run:async input=>{calls.push({input});return aggregate();},...patch};
  return {options,tasks,calls};
}

test('only the already verified server cron path schedules intake; Owner and mixed/origin paths are excluded',async()=>{
  for(const patch of [{cronAuthenticated:false},{projectUrl:'https://other.invalid'},
    {request:request({authorization:'Bearer synthetic-owner'})},{request:request({authorization:''})},
    {request:request({origin:'https://synthetic.invalid'})},{request:request({origin:'null'})},
    {request:request({'x-camera-cron-secret':''})},{request:request({'x-camera-cron-secret':'two words'})},
    {request:request({'x-camera-cron-secret':'x'.repeat(1025)})},{request:request({},'GET')},
    {startedAt:NaN},{now:()=>started-1}]){
    const f=setup(patch);assert.equal(scheduleCameraMhelpIntake(f.options),false);await Promise.resolve();assert.deepEqual(f.tasks,[]);assert.deepEqual(f.calls,[]);
  }
  const controller=new AbortController();controller.abort();const f=setup({request:new Request(request(),{signal:controller.signal})});assert.equal(scheduleCameraMhelpIntake(f.options),false);
  const good=setup();assert.equal(scheduleCameraMhelpIntake(good.options),true);assert.equal(good.tasks.length,1);await good.tasks[0];assert.equal(good.calls.length,1);
});

test('background uses existing SDK RPC and never forwards the provider request body or service credential',async()=>{
  const f=setup({run:undefined});assert.equal(scheduleCameraMhelpIntake(f.options),true);await f.tasks[0];
  assert.deepEqual(f.calls,[{name:'camera_mhelp_ticket_intake_v1',args:{p_request:{action:'begin'}}}]);
  assert.equal(f.options.request.bodyUsed,false);
});

test('one 120-second budget retains invocation headroom and is rechecked when the task starts',async()=>{
  assert.equal(INTAKE_BACKGROUND_INVOCATION_MS,140000);
  for(const [elapsed,expected] of [[0,120000],[25000,115000],[137000,3000]]){
    const f=setup({now:()=>started+elapsed});assert.equal(scheduleCameraMhelpIntake(f.options),true);await f.tasks[0];assert.equal(f.calls[0].input.deadlineMs,expected);
  }
  for(const elapsed of [138000,150000]){const f=setup({now:()=>started+elapsed});assert.equal(scheduleCameraMhelpIntake(f.options),false);assert.equal(f.tasks.length,0);}
  let time=started;const delayed=setup({now:()=>time});assert.equal(scheduleCameraMhelpIntake(delayed.options),true);time=started+140000;await delayed.tasks[0];assert.equal(delayed.calls.length,0);
});

test('registration and background failures are caught without doing untracked work',async()=>{
  const failed=setup({run:async()=>{throw Error('private source failure');}});assert.equal(scheduleCameraMhelpIntake(failed.options),true);assert.equal(await failed.tasks[0],undefined);
  const sync=setup({run:()=>{throw Error('private synchronous failure');}});assert.equal(scheduleCameraMhelpIntake(sync.options),true);await sync.tasks[0];
  const registration=setup({waitUntil:()=>{throw Error('runtime unavailable');}});assert.equal(scheduleCameraMhelpIntake(registration.options),false);await Promise.resolve();assert.equal(registration.calls.length,0);
});

test('background lifetime does not inherit request cancellation after provider response',async()=>{
  const controller=new AbortController();const f=setup({request:new Request(request(),{signal:controller.signal})});
  assert.equal(scheduleCameraMhelpIntake(f.options),true);controller.abort();await f.tasks[0];assert.equal(f.calls.length,1);assert.equal(f.calls[0].input.deadlineMs,120000);
});

test('real intake deadline settles the background even when an SDK transport ignores cancellation',async()=>{
  let signal;
  const f=setup({run:undefined,now:()=>started+137990,db:{rpc:()=>({abortSignal:value=>{signal=value;return new Promise(()=>{});}})}});
  const began=Date.now();assert.equal(scheduleCameraMhelpIntake(f.options),true);await f.tasks[0];
  assert.equal(signal.aborted,true);assert(Date.now()-began<1000);
});

// Execute the actual deployed-provider handler shape after stripping TypeScript,
// with all external/provider transports replaced by synthetic callbacks.
const source=await readFile(new URL('../../supabase/functions/camera-provider-reconcile/index.ts',import.meta.url),'utf8');
const handlerSource=source.slice(source.lastIndexOf('Deno.serve(')+'Deno.serve('.length).replace(/\);\s*$/,'');
const handlerJs=ts.transpileModule(`const handler=${handlerSource};handler;`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function provider({cronValid=true,role='owner',active=true,providerFailure=false,intakeRun=async()=>aggregate()}={}){
  const tasks=[],calls=[],profiles=[];
  const db={rpc:async()=>({data:cronValid}),auth:{getUser:async()=>{profiles.push('getUser');return {data:{user:{id:'synthetic-owner'}}};}},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{profiles.push('profile');return {data:{role,active}};}})}),update:()=>({eq:async()=>calls.push('provider-failure-recorded')})})};
  const inventory=async()=>{calls.push('provider');if(providerFailure)throw Error('synthetic provider failed');return {unchanged:true};};
  const context={Date,Response,fetch:async()=>{throw Error('Unexpected synthetic transport');},
    Deno:{env:{get:()=>LEGACY}},EdgeRuntime:{waitUntil:task=>tasks.push(task)},
    createClient:()=>db,cors:{'Content-Type':'application/json'},json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
    console:{error:()=>{}},starInventory:inventory,reconInventory:inventory,avigilonInventory:inventory,witnessInventory:inventory,
    scheduleCameraMhelpIntake:options=>scheduleCameraMhelpIntake({...options,run:async input=>{calls.push('intake');return intakeRun(input);}})};
  return {handler:vm.runInNewContext(handlerJs,context),tasks,calls,profiles};
}

test('actual provider handler response and failure are unchanged and never await background work',async()=>{
  for(const providerFailure of [false,true]){
    let release;const f=provider({providerFailure,intakeRun:()=>new Promise(resolve=>{release=()=>resolve(aggregate());})});
    const response=await f.handler(request());assert.equal(response.status,providerFailure?500:200);const body=await response.json();
    if(providerFailure)assert.deepEqual(body,{ok:false,error:'synthetic provider failed'});
    else{assert.equal(body.ok,true);assert.deepEqual(body.witness,{unchanged:true});assert.equal(typeof body.reconciled_at,'string');assert.deepEqual(Object.keys(body).sort(),['ok','reconciled_at','witness']);}
    assert.equal(f.tasks.length,1);assert.equal(f.calls.filter(x=>x==='provider').length,1);assert.equal(f.calls.filter(x=>x==='intake').length,1);release();await f.tasks[0];
  }
});

test('actual provider preserves Owner/IT fallback and rejects other users without scheduling intake',async()=>{
  for(const role of ['owner','it']){const f=provider({cronValid:false,role});assert.equal((await f.handler(request({authorization:'Bearer synthetic-user'}))).status,200);assert.deepEqual(f.profiles,['getUser','profile']);assert.equal(f.tasks.length,0);assert.deepEqual(f.calls,['provider']);}
  for(const patch of [{role:'technician'},{active:false}]){const f=provider({cronValid:false,...patch});assert.equal((await f.handler(request({authorization:'Bearer synthetic-user'}))).status,403);assert.equal(f.tasks.length,0);assert.deepEqual(f.calls,[]);}
  for(const headers of [{origin:'https://synthetic.invalid'},{authorization:'Bearer synthetic-user'}]){const f=provider();assert.equal((await f.handler(request(headers))).status,200);assert.equal(f.tasks.length,0);assert.deepEqual(f.calls,['provider']);}
  const rejected=provider({cronValid:false});assert.equal((await rejected.handler(request())).status,403);assert.equal(rejected.tasks.length,0);
});

test('provider integration and CI retain existing camera/technician protection boundaries',async()=>{
  assert.match(source,/cronAuthenticated:valid===true/);assert.match(source,/waitUntil:task=>EdgeRuntime\.waitUntil\(task\)/);
  assert.match(source,/projectUrl:Deno\.env\.get\("SUPABASE_URL"\),db,fetch,startedAt:requestStarted/);
  const helper=await readFile(new URL('../intake/mhelpIntakeBackground.ts',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/SUPABASE_SERVICE_ROLE_KEY|vault\.|net\.http_post|console\.|setSession|createClient/);
  const yaml=await readFile(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');
  assert.equal(yaml.split("'tech-checks/supabase/functions/camera-provider-reconcile/**'").length-1,2);
  for(const value of ['Confirm existing technician workflows are unchanged','f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3','../supabase/migrations','npm test','npm run typecheck','npm run build','npm run test:browser'])assert(yaml.includes(value));
});
