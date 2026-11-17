// Offline proof that the producer entry admits only POST /api/fleet-saved-board/produce.
// The imported handler is not loaded. No live session, database, or deployment is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {preparePayload} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const patch=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-fleet-board-producer/restrict-to-produce-v9.json'),'utf8'));
const rollback=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-fleet-board-producer/rollback-to-v9-entry.json'),'utf8'));
const read=name=>readFileSync(join(root,patch.sourceDir,name));
const prepared=preparePayload(patch,read);
const entry=prepared.find(file=>file.recordName==='index.ts').content.toString('utf8');
const live=read('index.ts').toString('utf8');
const id='11111111-1111-4111-8111-111111111111';
const importUrl='https://raw.githubusercontent.com/cypressriveroasis2023-sudo/neon-oasis-game/b5b188229346182d9a4e29da42415a1b9d3b9d53/tech-checks/docs/vision-native-preview-20261107/source/serve.ts';
const gonePaths=[
  ['GET','/api/jobs'],
  ['POST','/api/jobs/'+id+'/schedule'],
  ['POST','/api/owner/jobs/manual'],
  ['GET','/api/owner/control-data'],
  ['POST','/api/owner/truck-checks/'+id+'/approve'],
  ['GET','/api/quotes'],
  ['GET','/api/ar'],
  ['GET','/api/purchasing'],
  ['GET','/api/financial-summary'],
  ['GET','/api/customers'],
  ['GET','/api/sites'],
  ['POST','/api/work-requests'],
  ['GET','/api/owner-review'],
  ['GET','/api/owner-review/signatures'],
  ['POST','/api/owner-tasks'],
  ['POST','/api/mhelpdesk/imports/commit'],
  ['GET','/api/mhelpdesk/intake/status'],
  ['GET','/api/team'],
];
const keepPaths=[
  ['GET','/api/session'],
  ['GET','/api/daily-board'],
  ['GET','/api/camera-health/summary-v3'],
  ['GET','/api/team-production'],
  ['GET','/api/field-map'],
  ['POST','/api/fleet-saved-board/refresh'],
  ['GET','/api/fleet-saved-board'],
  ['GET','/api/tech/session'],
  ['POST','/api/sim-cancel'],
];

test('the producer patch keeps the live v9 bytes and gates every route except produce',()=>{
  assert.equal(patch.requireLiveBeforeDeploy.version,9);
  assert.equal(patch.verifyJwt,false);
  assert.equal(patch.entrypointPath,'cos-fleet-board-producer/index.ts');
  assert.equal(live.includes(importUrl),true);
  assert.equal(live.includes('producerRouteAllowed'),false);
  assert.equal(entry.includes(importUrl),true);
  assert.equal(entry.includes('await import("'+importUrl+'");'),true);
  assert.equal(entry.split('function producerRouteAllowed').length-1,1);
  const rolled=preparePayload(rollback,read);
  assert.equal(rollback.edits.length,0);
  assert.equal(rolled.find(file=>file.recordName==='index.ts').content.toString('utf8'),live);
});

function boot(){
  const source=entry.replace(
    'await import("'+importUrl+'");',
    'Deno.serve(async()=>new Response(JSON.stringify({served:true}),{status:200,headers:{"Content-Type":"application/json"}}));',
  );
  const seen=[];
  const Deno={serve(handler){seen.push(handler);return handler;}};
  vm.runInNewContext(source,{Deno,URL,Request,Response,JSON},{filename:'cos-fleet-board-producer/index.ts'});
  assert.equal(seen.length,1);
  return {restricted:seen[0],innerCalls:[] ,note(){}};
}

async function call(restricted,method,path,{urlPath=false,httpMethod='POST'}={}){
  const url=urlPath
    ?'https://platform.example/functions/v1/cos-fleet-board-producer'+path
    :'https://platform.example/functions/v1/cos-fleet-board-producer';
  const response=await restricted(new Request(url,{
    method:httpMethod,
    headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-token'},
    body:httpMethod==='GET'||httpMethod==='OPTIONS'?undefined:JSON.stringify(urlPath?{run:true}:{path,method,body:{run:true}}),
  }));
  let body=null;try{body=await response.json();}catch{body=null;}
  return {status:response.status,body};
}

test('POST /api/fleet-saved-board/produce still reaches the existing handler',async()=>{
  const {restricted}=boot();
  const envelope=await call(restricted,'POST','/api/fleet-saved-board/produce');
  const direct=await call(restricted,'POST','/api/fleet-saved-board/produce/',{urlPath:true});
  assert.equal(envelope.status,200);
  assert.deepEqual(envelope.body,{served:true});
  assert.equal(direct.status,200);
  assert.deepEqual(direct.body,{served:true});
});

test('the producer returns 404 for retired routes and other kept routes',async()=>{
  const {restricted}=boot();
  for(const [method,path] of [...gonePaths,...keepPaths]){
    const result=await call(restricted,method,path);
    assert.equal(result.status,404,method+' '+path+' '+JSON.stringify(result.body));
    assert.deepEqual(result.body,{error:'COS endpoint not found.'});
  }
  const urlJobs=await call(restricted,'GET','/api/jobs',{urlPath:true,httpMethod:'GET'});
  assert.equal(urlJobs.status,404);
  const options=await restricted(new Request('https://platform.example/functions/v1/cos-fleet-board-producer',{method:'OPTIONS'}));
  assert.equal(options.status,200);
});
