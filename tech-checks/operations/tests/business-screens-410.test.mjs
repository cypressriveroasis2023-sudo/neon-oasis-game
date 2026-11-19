// Offline proof of the v168 function patch. Authentication, Owner and IT gates
// stay in front of the 410. No live session, database or deployment is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {buildSync} from 'esbuild';
import {preparePayload,readPatchFile} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const patch=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-operations-pages/business-screens-410-v168.json'),'utf8'));
const rollback=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-operations-pages/rollback-business-410-to-v168.json'),'utf8'));
const read=name=>readPatchFile(patch,name,root);
const prepared=preparePayload(patch,read);
const serve=prepared.find(file=>file.recordName==='serve.ts').content.toString('utf8');
const original=read('serve.ts').toString('utf8');
const id='11111111-1111-4111-8111-111111111111';
const goneBody={error:'gone',reason:'COS is cameras, locations, troubleshooting and equipment handoff only'};
const gonePaths=[
  ['GET','/api/jobs'],
  ['POST','/api/jobs'],
  ['GET','/api/jobs/'+id],
  ['POST','/api/jobs/'+id+'/schedule'],
  ['POST','/api/jobs/'+id+'/assign'],
  ['POST','/api/jobs/'+id+'/release-it'],
  ['POST','/api/jobs/'+id+'/dispatch'],
  ['POST','/api/jobs/'+id+'/close'],
  ['POST','/api/jobs/'+id+'/remove'],
  ['POST','/api/jobs/'+id+'/owner-review'],
  ['POST','/api/jobs/'+id+'/go-back'],
  ['POST','/api/owner/jobs/manual'],
  ['POST','/api/owner/jobs/'+id+'/advance-it'],
  ['GET','/api/owner/control-data'],
  ['POST','/api/owner/truck-checks/'+id+'/approve'],
  ['GET','/api/quotes'],
  ['POST','/api/quotes/'+id+'/action'],
  ['GET','/api/ar'],
  ['POST','/api/ar/'+id+'/action'],
  ['GET','/api/purchasing'],
  ['POST','/api/purchasing/'+id+'/approve'],
  ['GET','/api/financial-summary'],
  ['GET','/api/customers'],
  ['GET','/api/customers/'+id+'/contacts'],
  ['GET','/api/sites'],
  ['POST','/api/sites/'+id],
  ['GET','/api/work-requests'],
  ['POST','/api/work-requests'],
  ['GET','/api/owner-review'],
  ['POST','/api/owner-review'],
  ['GET','/api/owner-review/signatures'],
  ['POST','/api/owner-review/signatures'],
  ['GET','/api/owner-tasks'],
  ['POST','/api/owner-tasks'],
  ['GET','/api/mhelpdesk/imports'],
  ['POST','/api/mhelpdesk/imports/commit'],
  ['GET','/api/mhelpdesk/intake/status'],
  ['GET','/api/mhelpdesk/intake/status?capability=pending_schedule_v1'],
  ['GET','/api/team'],
  ['POST','/api/team'],
];
// These stay out of the 410 list. Several are absent from v168 and currently
// answer 404 or 405; this test only requires that the patch does not turn them into 410.
const keepPaths=[
  ['GET','/api/session'],
  ['GET','/api/field-map'],
  ['GET','/api/field-map/'+id+'/history'],
  ['POST','/api/field-map/'+id+'/gps'],
  ['GET','/api/handoffs'],
  ['GET','/api/daily-board'],
  ['GET','/api/owner-review/legacy-evidence'],
  ['GET','/api/team-production'],
  ['GET','/api/tv-board/settings'],
  ['GET','/api/tech/session'],
  ['POST','/api/tech/jobs/'+id+'/field-gps'],
  ['GET','/api/tech/jobs/'+id+'/field-gps'],
  ['GET','/api/equipment'],
  ['POST','/api/mhelpdesk/equipment/preview'],
  ['GET','/api/mhelpdesk/partner/status'],
  ['POST','/api/mhelpdesk/unit-location'],
  ['GET','/api/camera-health/summary-v3'],
  ['GET','/api/unit-camera-status'],
  ['POST','/api/unit-camera-status/edit'],
  ['GET','/api/routers'],
  ['POST','/api/inhand-pilot/run'],
  ['GET','/api/vrm-fleet'],
  ['POST','/api/vrm-fleet/refresh'],
  ['GET','/api/vrm-portal'],
  ['GET','/api/product-connections'],
  ['POST','/api/product-connections/verify'],
  ['POST','/api/product-tcp-preview'],
  ['POST','/api/product-tcp-proof'],
  ['GET','/api/unit-tracker'],
  ['GET','/api/fleet-saved-board'],
  ['POST','/api/fleet-saved-board/refresh'],
  ['POST','/api/fleet-saved-board/produce'],
  ['GET','/api/fleet-saved-board/history/'+id],
  ['POST','/api/fleet/units/'+id+'/shop-placement'],
  ['GET','/api/fleet-map-source'],
  ['POST','/api/owner-identity/confirm'],
  ['GET','/api/units'],
  ['POST','/api/sim-cancel'],
  ['GET','/api/sim-cancel'],
  ['GET','/api/jobs-extra'],
  ['GET','/api/archive'],
  ['GET','/api/team-production'],
];

test('the deployed entry is the patched serve.ts and the 410 sits after sign-in and the Owner gate',()=>{
  assert.equal(patch.entrypointPath,'cos-operations-pages/serve.ts');
  assert.equal(patch.requireLiveBeforeDeploy.version,168);
  assert.equal(patch.requireLiveBeforeDeploy.ezbr_sha256,'ea649429a36f21ef8272911615a802e3ccc6d2a6c21ac6ea6718eeb68ddf02af');
  assert.equal(patch.expectedBefore['savedFleetBoard.mjs'],'f93b82b3c9aee80bb7921617fb1cca50ad72758dcd0a86d29e578cc796f2957a');
  assert.equal(patch.expectedAfter['savedFleetBoard.mjs'],patch.expectedBefore['savedFleetBoard.mjs']);
  assert.equal(prepared.find(file=>file.recordName==='savedFleetBoard.mjs').content.includes('supersededShopDetail'),false);
  assert.equal(patch.sourceCommit,'b5b188229346182d9a4e29da42415a1b9d3b9d53');
  const entry=prepared.find(file=>file.name===patch.entrypointPath);
  assert.ok(entry);
  assert.equal(entry.content.toString('utf8'),serve);
  assert.match(serve,/if\(cosBusinessGone\(path\)\)return json\(\{error:"gone",reason:"COS is cameras, locations, troubleshooting and equipment handoff only"\},410\)/);
  const auth=serve.indexOf('Sign in to Tech Check to continue.');
  const gate=serve.indexOf('An active COS Owner account is required.');
  const call=serve.indexOf('if(cosBusinessGone(path))return json');
  assert.ok(auth>0&&gate>auth&&call>gate);
  assert.equal(serve.split('function cosBusinessGone').length-1,1);
  assert.equal(serve.split('/api/sim-cancel').length,original.split('/api/sim-cancel').length);
  assert.equal(serve.split('/api/tech').length,original.split('/api/tech').length);
  for(const file of prepared)if(file.recordName!=='serve.ts')assert.equal(file.content.equals(read(file.recordName)),true);
});

test('rollback redeploys the v168 import of the frozen serve.ts and has no 410 handler',()=>{
  const files=preparePayload(rollback,name=>readFileSync(join(root,rollback.sourceDir,name)));
  const entry=files.find(file=>file.name===rollback.entrypointPath).content.toString('utf8');
  assert.equal(rollback.edits.length,0);
  assert.equal(rollback.entrypointPath,'cos-operations-pages/index.ts');
  assert.match(entry,/b5b188229346182d9a4e29da42415a1b9d3b9d53\/tech-checks\/docs\/vision-native-preview-20261107\/source\/serve\.ts/);
  assert.equal(entry.includes('cosBusinessGone'),false);
  assert.equal(entry.includes('"gone"'),false);
  assert.equal(rollback.expectedBefore['index.ts'],'4340eb2f772cf4e7c0bc26475f1c7ca164f2ca0e9ae321fe6f6ce21ef1fdb7c3');
});

function boot(source){
  const {outputFiles}=buildSync({stdin:{contents:source+'\nglobalThis.__nativeFactory=createOperationsHandler;',resolveDir:join(root,patch.sourceDir),sourcefile:'serve.ts',loader:'ts'},bundle:true,platform:'node',format:'iife',target:'es2022',external:['jose'],write:false,logLevel:'silent'});
  const deny=()=>{throw Error('Network and signing are forbidden in this offline proof');};
  const context=vm.createContext({console,crypto:webcrypto,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:deny,require:name=>{assert.equal(name,'jose');return {importPKCS8:deny,SignJWT:class{constructor(){deny();}}};},Deno:{env:{get:()=>undefined},serve:()=>{}}});
  vm.runInContext(outputFiles[0].text,context);
  return context.__nativeFactory;
}
const factory=boot(serve);
const ownerId='e4abc521-1ef3-45a6-9829-b87faff78210';
const orgId='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const people={
  owner:{id:ownerId,actor:'3f073784-96e7-43d8-b9e0-33ab31c3c8b1',name:'Synthetic Owner',department:'owner',role:'owner'},
  it:{id:'4f7044b5-86b6-411f-8898-39bb64b4ddbc',actor:'d0757b64-9623-4adc-afff-21cc7853e88a',name:'Teddy Hopper',department:'it',role:'it_technician'},
  service:{id:'78e54fbd-c2db-4d18-8e3d-a9740adcf285',actor:'7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8',name:'Abel Cervantes',department:'service',role:'service_technician'},
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function handlerFor(who){
  const person=people[who];
  return factory({platformUrl:'https://platform.example',serviceKey:'synthetic-service-key',fetch:async(url,init={})=>{
    const href=String(url);
    if(href.includes('/auth/v1/user'))return json({id:person.id});
    if(href.includes('/rest/v1/profiles'))return json([{user_id:person.id,full_name:person.name,role:person.department,active:true,archived_at:null}]);
    if(href.includes('/rest/v1/user_profiles'))return json([{user_id:person.actor,display_name:person.name,active:true,department:person.department}]);
    if(href.includes('/rest/v1/user_roles'))return json([{role_id:id,roles:{code:person.role,organization_id:orgId}}]);
    return json({error:'synthetic'},404);
  }});
}
async function call(handler,method,path,bearer){
  const response=await handler(new Request('https://platform.example/functions/v1/cos-operations-pages',{method:'POST',headers:{...(bearer?{Authorization:'Bearer synthetic-token'}:{}),'Content-Type':'application/json',Origin:'https://cypressriveroasis2023-sudo.github.io'},body:JSON.stringify({path,method,body:null})}));
  let body=null;try{body=await response.json();}catch{body=null;}
  return {status:response.status,body};
}
const handlers={owner:handlerFor('owner'),it:handlerFor('it'),service:handlerFor('service'),anon:factory({platformUrl:'https://platform.example',serviceKey:'synthetic-service-key',fetch:async()=>{throw Error('anonymous proof must not reach transport');}})};

test('anonymous callers stay 401 on every retired route',async()=>{
  for(const [method,path] of gonePaths){
    const result=await call(handlers.anon,method,path,false);
    assert.equal(result.status,401,method+' '+path+' '+JSON.stringify(result.body));
    assert.notEqual(result.body?.error,'gone');
  }
});

test('Service stays 403 on every retired route',async()=>{
  for(const [method,path] of gonePaths){
    const result=await call(handlers.service,method,path,true);
    assert.equal(result.status,403,method+' '+path+' '+JSON.stringify(result.body));
    assert.notEqual(result.body?.error,'gone');
  }
});

test('IT stays 403 on every retired route',async()=>{
  for(const [method,path] of gonePaths){
    const result=await call(handlers.it,method,path,true);
    assert.equal(result.status,403,method+' '+path+' '+JSON.stringify(result.body));
    assert.notEqual(result.body?.error,'gone');
  }
});

test('an Owner receives the short 410 on every retired route',async()=>{
  for(const [method,path] of gonePaths){
    const result=await call(handlers.owner,method,path,true);
    assert.equal(result.status,410,method+' '+path+' '+JSON.stringify(result.body));
    assert.deepEqual(result.body,goneBody);
  }
});

test('kept routes, including ones v168 does not implement, are not 410',async()=>{
  for(const [method,path] of keepPaths){
    const result=await call(handlers.owner,method,path,true);
    assert.notEqual(result.status,410,method+' '+path+' '+JSON.stringify(result.body));
    assert.notEqual(result.body?.error,'gone');
  }
  const fieldGps=await call(handlers.it,'POST','/api/tech/jobs/'+id+'/field-gps',true);
  const sim=await call(handlers.owner,'POST','/api/sim-cancel',true);
  assert.notEqual(fieldGps.status,410);
  assert.notEqual(sim.status,410);
  assert.ok(fieldGps.status===404||fieldGps.status===405,JSON.stringify(fieldGps));
  assert.equal(sim.status,404,JSON.stringify(sim));
});

test('Owner and IT sessions still pass the gate',async()=>{
  const owner=await call(handlers.owner,'GET','/api/session',true);
  const it=await call(handlers.it,'GET','/api/session',true);
  assert.equal(owner.status,200);
  assert.equal(owner.body.role,'Owner');
  assert.equal(it.status,200);
  assert.equal(it.body.role,'IT');
});
