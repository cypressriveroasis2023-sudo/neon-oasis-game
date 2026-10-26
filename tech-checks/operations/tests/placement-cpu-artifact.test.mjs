import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {prepare,declaration,expected} from '../scripts/prepare-placement-cpu.mjs';
import {fixture} from './fixtures/placement-cpu-population.mjs';
const file=process.env.COS_CPU_DEPLOYED_CAPTURE;
const boot=code=>{
 let handler;const context=vm.createContext({console,crypto:webcrypto,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:()=>{throw Error('Network forbidden in artifact proof')},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://platform.example':undefined},serve:fn=>{handler=fn}}});
 // Only the external jose import is stubbed; no proof path uses signing.
 const importLine='import{importPKCS8,SignJWT}from"jose";';assert.equal(code.split(importLine).length,2);
 vm.runInContext(code.replace(importLine,'const importPKCS8=()=>{throw Error("Signing forbidden")};const SignJWT=class {};'),context);
 assert.equal(typeof handler,'function');return {context,handler};
};
test('release builder rejects unreviewed deployment identity',()=>{for(const value of [null,{}, {...expected,name:'cos-operations-pages',version:124}])assert.throws(()=>prepare(value));});
test('complete freshly captured v123 artifact boots and preserves only-function delta, errors and projections',{skip:!file},async()=>{
 const deployed=JSON.parse(fs.readFileSync(file)),saved=structuredClone(deployed),packet=prepare(deployed);
 assert.deepEqual(deployed,saved);const before=deployed.files.find(f=>f.name.endsWith('serve.ts')).content,after=packet.payload.files.find(f=>f.name.endsWith('serve.ts')).content;
 const b=declaration(before),a=declaration(after);assert.equal(before.slice(0,b.start),after.slice(0,a.start));assert.equal(before.slice(b.end),after.slice(a.end));
 assert.deepEqual(deployed.files.filter(f=>!f.name.endsWith('serve.ts')),packet.payload.files.filter(f=>!f.name.endsWith('serve.ts')));
 const old=boot(before),next=boot(after);
 for(const size of [0,2,1001]){
  const f=fixture(size);old.context.fixture=f;next.context.fixture=f;
  const run=c=>JSON.stringify(vm.runInContext('currentOwnerPlacements(fixture.audits,fixture.devices)',c));assert.equal(run(old.context),run(next.context));
  if(size){f.devices[0].id='bad';assert.equal(run(old.context),run(next.context));}
 }
 for(const path of ['/api/field-map','/api/camera-health/summary-v3']){
  const request=()=>new Request('https://platform.example',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,method:'GET'})});
  const b=await old.handler(request()),a=await next.handler(request());assert.equal(a.status,b.status);assert.ok(a.status>=400);assert.equal(await a.text(),await b.text());
 }
 for(const change of [d=>d.version++,d=>d.files[0].content+=' ',d=>d.files[1].content+=' ',d=>d.files.pop(),d=>d.verify_jwt=true,d=>d.import_map=false,d=>d.import_map_path='/other',d=>d.entrypoint_path='/other',d=>d.files.reverse()]){
  const d=structuredClone(deployed);change(d);if(d.files.length===2&&d.files[0].name!==deployed.files[0].name)assert.deepEqual(prepare(d).manifest.slice().sort((a,b)=>a.name.localeCompare(b.name)),packet.manifest.slice().sort((a,b)=>a.name.localeCompare(b.name)));else assert.throws(()=>prepare(d));
 }
 assert.throws(()=>prepare({...deployed,files:packet.payload.files}));
});
