import {importedDigestFixture} from './fixtures/imported-digest-fixture.mjs';
import {projectImportedGeocodes} from '../../supabase/functions/cos-operations-pages/importedSourceProjectionV2.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {prepare} from '../scripts/prepare-startup-cpu-v124.mjs';
const file=process.env.COS_CPU_V124_CAPTURE;
const hash=v=>createHash('sha256').update(v).digest('hex');
test('v124 preparation rejects an unverified capture',()=>{for(const v of [null,{}, {name:'cos-operations-pages',version:125}])assert.throws(()=>prepare(v));});
test('exact v124 closure has reversible source-only edits and rejects every base/config drift',{skip:!file},async()=>{
 const capture=JSON.parse(fs.readFileSync(file)),original=structuredClone(capture),packet=prepare(capture),before=capture.files.find(f=>f.name.endsWith('serve.ts')).content,after=packet.payload.files.find(f=>f.name.endsWith('serve.ts')).content;
 assert.deepEqual(capture,original);assert.equal(packet.edits.length,15);assert.equal(hash(after),packet.sourceSha256);
 const sorted=[...packet.edits].sort((a,b)=>a.start-b.start);let offset=0;
 const located=sorted.map(e=>{assert.equal(before.slice(e.start,e.end),e.before);const at=e.start+offset;offset+=e.text.length-(e.end-e.start);return {...e,at};});
 let restored=after;for(const e of located.reverse()){assert.equal(restored.slice(e.at,e.at+e.text.length),e.text);restored=restored.slice(0,e.at)+e.before+restored.slice(e.at+e.text.length);}assert.equal(restored,before);
 assert.deepEqual(packet.payload.files.filter(f=>!f.name.endsWith('serve.ts')),capture.files.filter(f=>!f.name.endsWith('serve.ts')));assert.equal(packet.payload.verify_jwt,false);assert.equal(packet.payload.entrypoint_path,'cos-operations-pages/serve.ts');assert.equal(packet.payload.import_map_path,'cos-operations-pages/deno.json');
 for(const change of [v=>v.version++,v=>v.ezbr_sha256='bad',v=>v.files[0].content+=' ',v=>v.files[1].content+=' ',v=>v.files.pop(),v=>v.verify_jwt=true,v=>v.import_map=false,v=>v.entrypoint_path='/other',v=>v.import_map_path='/other']){const v=structuredClone(capture);change(v);assert.throws(()=>prepare(v));}
 assert.throws(()=>prepare({...capture,files:packet.payload.files}));
 const boot=code=>{let handler;const ctx=vm.createContext({console,crypto,structuredClone,TextEncoder,TextDecoder,URL,URLSearchParams,Request,Response,Headers,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:()=>{throw Error('Network forbidden')},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://platform.example':undefined},serve:fn=>{handler=fn}}});vm.runInContext(code.replace('import{importPKCS8,SignJWT}from"jose";','const importPKCS8=()=>{throw Error("Signing forbidden")};const SignJWT=class {};'),ctx);return {handler,context:ctx};};
 const old=boot(before),next=boot(after);const f=importedDigestFixture();assert.deepEqual(JSON.parse(JSON.stringify(await next.context.projectImportedGeocodes(f.snapshot,f.records,[],[]))),await projectImportedGeocodes(f.snapshot,f.records,[],[]));for(const path of ['/api/field-map','/api/camera-health/summary-v3']){const request=()=>new Request('https://platform.example',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,method:'GET'})});const a=await old.handler(request()),b=await next.handler(request());assert.equal(a.status,b.status);assert.ok(b.status>=400);assert.equal(await a.text(),await b.text());}
});
test('expanded complete closure preserves responses through source mutations, failures, retry and auth denial',{skip:!file},()=>{
 const output=execFileSync(process.execPath,['tests/startup-v124-profile.mjs'],{cwd:new URL('..',import.meta.url),env:process.env,timeout:120000,encoding:'utf8'});assert.equal(JSON.parse(output).responses,64);
});
