// Offline proof that cos-unit-camera-status admits only its two routes, in both
// the URL-path and path-in-body formats. The bundled handler is not executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {preparePayload} from '../../../.github/scripts/deploy-recorded-function.mjs';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const patch=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-unit-camera-status/camera-routes-only-v16.json'),'utf8'));
const rollback=JSON.parse(readFileSync(join(root,'.github/function-patches/cos-unit-camera-status/rollback-to-v16-entry.json'),'utf8'));
const read=name=>readFileSync(join(root,patch.sourceDir,name));
const prepared=preparePayload(patch,read);
const entry=prepared.find(file=>file.recordName==='index.ts').content.toString('utf8');
const live=read('index.ts').toString('utf8');
const id='11111111-1111-4111-8111-111111111111';
const marker='// tech-checks/supabase/functions/cos-unit-camera-status/servedPath.ts';
const gone=[
  ['POST','/api/owner/jobs/manual'],
  ['GET','/api/jobs'],
  ['POST','/api/jobs/'+id+'/schedule'],
  ['GET','/api/quotes'],
  ['GET','/api/customers'],
  ['GET','/api/sites'],
  ['POST','/api/owner-tasks'],
  ['GET','/api/team'],
  ['GET','/api/financial-summary'],
  ['POST','/api/fleet-saved-board/produce'],
];

test('the camera-status patch starts from the live v16 bundle and gates both request formats',()=>{
  assert.equal(patch.requireLiveBeforeDeploy.version,16);
  assert.equal(patch.requireLiveBeforeDeploy.ezbr_sha256.startsWith('47f904b7'),true);
  assert.equal(patch.expectedBefore['index.ts'],'f8de9ac5df1955803d6f37d5fbccfbdf3bce5e68079670f48418c414978830c9');
  assert.equal(patch.verifyJwt,false);
  assert.equal(live.includes('CAMERA_STATUS_ROUTES'),false);
  assert.match(entry,/CAMERA_BODY_LIMIT=65536/);
  assert.match(entry,/\/api\/unit-camera-status\/edit/);
  const rolled=preparePayload(rollback,read);
  assert.equal(rollback.edits.length,0);
  assert.equal(rolled.find(file=>file.recordName==='index.ts').content.equals(read('index.ts')),true);
});

function boot(){
  const calls=[];
  const tail=entry.slice(entry.indexOf(marker));
  const source=[
    'function createOperationsHandler(){return async request=>{const body=request.body?await request.text():"";calls.push({url:request.url,method:request.method,body});return new Response(JSON.stringify({reached:true}),{status:200,headers:{"Content-Type":"application/json"}});};}',
    tail,
  ].join('\n');
  const seen=[];
  vm.runInNewContext(source,{
    calls,Deno:{env:{get:()=>undefined},serve(handler){seen.push(handler);return handler;}},
    URL,Request,Response,JSON,TextDecoder,Uint8Array,
  },{filename:'cos-unit-camera-status/index.ts'});
  assert.equal(seen.length,1);
  return {restricted:seen[0],calls};
}

async function call(restricted,{httpMethod='POST',urlPath='',envelope=null,raw=null}={}){
  const url='https://platform.example/functions/v1/cos-unit-camera-status'+(urlPath||'');
  const body=raw??(envelope===null?undefined:JSON.stringify(envelope));
  const response=await restricted(new Request(url,{method:httpMethod,headers:body===undefined?{}:{'Content-Type':'application/json'},body}));
  let parsed=null;try{parsed=await response.json();}catch{parsed=null;}
  return {status:response.status,body:parsed};
}

test('camera status is served for the URL path and the envelope, and retired routes are not',async()=>{
  const {restricted,calls}=boot();
  assert.equal((await call(restricted,{httpMethod:'GET',urlPath:'/api/unit-camera-status'})).status,200);
  assert.equal(calls.at(-1).url.includes('/api/unit-camera-status'),true);
  assert.equal((await call(restricted,{envelope:{path:'/api/unit-camera-status/edit',method:'POST',body:{unitKey:'Helios 1'}}})).status,200);
  assert.equal(calls.at(-1).body.includes('/api/unit-camera-status/edit'),true);
  assert.equal((await call(restricted,{urlPath:'/api/unit-camera-status',raw:'not-an-envelope'})).status,200);
  assert.equal(calls.at(-1).url.includes('/cos-operations-pages/api/unit-camera-status'),true);
  for(const [method,path] of gone){
    assert.equal((await call(restricted,{envelope:{path,method,body:null}})).status,404,'envelope '+method+' '+path);
    assert.equal((await call(restricted,{httpMethod:method==='GET'?'GET':'POST',urlPath:path,raw:method==='GET'?undefined:'{}'})).status,404,'url '+method+' '+path);
  }
  const doubled=await call(restricted,{urlPath:'/api/unit-tracker/cos-unit-camera-status/api/unit-camera-status/edit',raw:'{}'});
  const doubledPages=await call(restricted,{urlPath:'/api/unit-tracker/cos-operations-pages/api/unit-camera-status/edit',raw:'{}'});
  assert.equal(doubled.status,404);
  assert.deepEqual(doubled.body,{error:'COS endpoint not found.'});
  assert.equal(doubledPages.status,404);
  assert.equal(calls.length,3);
  const bulky=await call(restricted,{raw:JSON.stringify({path:'/api/unit-camera-status',method:'GET',pad:'x'.repeat(70000)})});
  assert.equal(bulky.status,413);
  assert.deepEqual(bulky.body,{error:'Request body is too large.'});
  assert.equal(calls.length,3);
});
