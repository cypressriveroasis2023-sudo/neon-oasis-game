import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {prepareHealthReadDeployment} from '../scripts/healthReadDeployment.mjs';
const baseline=JSON.parse(await readFile(new URL('./fixtures/health-read-deployment-functions.json',import.meta.url),'utf8'));
const live=()=>({name:'cos-operations-pages',version:105,verify_jwt:false,files:[{name:'cos-operations-pages/serve.ts',content:'function protectedTransfer(){return "newer-transfer";}\n'+Object.values(baseline).join('\n')+'\nDeno.serve(protectedAuthenticatedWrapper);'},{name:'cos-operations-pages/deno.json',content:'{"nodeModulesDir":"auto","protected":true}'}]});
test('only reviewed health helpers change; all newer live wrappers and runtime configuration remain exact',async()=>{
 const deployed=live(),before=structuredClone(deployed),result=await prepareHealthReadDeployment(deployed);assert.deepEqual(deployed,before);assert.equal(result.payload.verify_jwt,false);assert.deepEqual(result.payload.files[1],before.files[1]);
 assert.equal(result.helpers.length,2);assert(result.payload.files[0].content.startsWith('function protectedTransfer(){return "newer-transfer";}'));assert(result.payload.files[0].content.endsWith('Deno.serve(protectedAuthenticatedWrapper);'));assert.notEqual(result.beforeSha256,result.afterSha256);
 assert.match(result.payload.files[0].content,/trackerByLabel/);assert.match(result.payload.files[0].content,/cameraTimestamp2\(initial.mhelpReceipt.lastSuccessAt\)/);
});
test('changed, duplicate or missing live helpers refuse automatic replacement',async()=>{
 for(const change of [v=>v.files[0].content=v.files[0].content.replace('function cameraSummary2','function changedSummary'),v=>v.files[0].content+='\n'+baseline.cameraSummary2,v=>v.files[0].content=v.files[0].content.replace('timeoutMs=1e4','timeoutMs=2e4')]){const value=live();change(value);await assert.rejects(()=>prepareHealthReadDeployment(value),/changed/);}
});
