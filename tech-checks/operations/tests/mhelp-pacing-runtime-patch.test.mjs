import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {patchMhelpPacingRuntime} from '../scripts/patch-mhelp-pacing-runtime.mjs';
const before=await readFile(new URL('./fixtures/mhelp-budget-before-20261023.js',import.meta.url),'utf8');
const entry='var CosMhelpReliabilityRuntime=(()=>{\n'+before+'\nreturn {createMhelpRequestBudget};})();\nconst untouched="Owner assignment/CSV/session/Shop/camera";\nDeno.serve(()=>{});';
test('compiled pacing patch preserves every surrounding byte/file and makes a fresh bounded admission',async()=>{
 for(const slug of ['cos-operations-pages','cos-mhelp-placement-sync']){
  const original={version:118,files:[{name:slug+'/serve.ts',content:entry},{name:slug+'/import_map.json',content:'{"imports":{}}'}]};
  const result=patchMhelpPacingRuntime(original,slug),after=result.files[0].content;
  assert.equal(after.replace(/gate.reason === "pacing" && delay <= 1e3 && tries < 79/,'gate.reason === "pacing" && delay > 0 && delay <= 1e3 && tries < 79').replace('await wait(Math.max(1, delay), signal);','await wait(delay, signal);'),entry);
  assert.deepEqual(result.files[1],original.files[1]);assert.equal(original.files[0].content,entry);assert.equal(result.proof.unownedBytesPreserved,true);
  let handlers=0;const factory=new Function('Deno','mhelpRequestClass','checked2','Response',after+'\nreturn CosMhelpReliabilityRuntime.createMhelpRequestBudget;')({serve:()=>handlers++},()=> 'data',v=>v,Response);
  let admissions=0,starts=0;const waits=[];const b=factory({now:()=>400,wait:async ms=>waits.push(ms),admit:async()=>++admissions===1?{allowed:false,reason:'pacing',retryAt:'1970-01-01T00:00:00.400500Z'}:{allowed:true,reason:null,retryAt:null},fetch:async()=>{starts++;return new Response();}});
  assert.equal((await b.fetch('https://synthetic.invalid')).status,200);assert.equal(admissions,2);assert.equal(starts,1);assert.deepEqual(waits,[1]);assert.equal(handlers,1);
  assert.throws(()=>patchMhelpPacingRuntime({files:result.files},slug),/allowance changed/);
 }
});
test('unknown, changed or ambiguous compiled factories cannot overwrite newer runtime work',()=>{
 const slug='cos-operations-pages';
 for(const content of [entry.replace('tries < 79','tries < 78'),entry+'\n'+before,entry.replace('var CosMhelpReliabilityRuntime','var DifferentRuntime')])assert.throws(()=>patchMhelpPacingRuntime({files:[{name:slug+'/serve.ts',content}]},slug));
 assert.throws(()=>patchMhelpPacingRuntime({files:[]},'unrelated-worker'));
});
