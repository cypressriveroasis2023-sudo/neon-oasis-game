import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {build} from 'esbuild';
import {extendMhelpReliabilityRuntime} from '../scripts/build-mhelp-reliability-runtime.mjs';
const entry={name:'cos-operations-pages/serve.ts',content:'function nativeMhelpTokens(){return {version:"old"};}\nconst unrelated="concurrent Service/Fleet/map/power code";var mhelpTokens=nativeMhelpTokens(()=>{});Deno.serve(mhelpTokens);'};
const original={version:106,files:[entry,{name:'cos-operations-pages/deno.json',content:'{"preserve":"original imports"}'}]};
test('isolated runtime wins before bridge initialization and preserves every current bridge/config byte',()=>{
 const helper='var CosMhelpReliabilityRuntime={nativeMhelpTokens:()=>({version:"new"})};';const result=extendMhelpReliabilityRuntime(original,helper);let handled;vm.runInNewContext(result.files[0].content,{Deno:{serve:v=>{handled=v;}}});assert.equal(handled.version,'new');assert(result.proof.originalBytesPreserved);assert(result.files[0].content.endsWith(entry.content));assert.deepEqual(result.files[1],original.files[1]);assert.equal(original.files[0],entry);
 for(const bad of [{...original,files:[{...entry,content:entry.content.replace('function nativeMhelpTokens','function changedFactory')}]},{...original,files:result.files}])assert.throws(()=>extendMhelpReliabilityRuntime(bad,helper));
});
test('actual bundled shared manager is self-contained and performs no provider request while constructing the bridge',async()=>{
 const helper=(await build({entryPoints:[new URL('../../supabase/functions/cos-operations-pages/mhelpTokenRuntime.ts',import.meta.url).pathname],bundle:true,write:false,format:'iife',globalName:'CosMhelpReliabilityRuntime',target:'es2022',logLevel:'silent'})).outputFiles[0].text;
 const result=extendMhelpReliabilityRuntime(original,helper);let handled;vm.runInNewContext(result.files[0].content,{Deno:{serve:v=>{handled=v;}},fetch:()=>{throw Error('unexpected network');},URL,Request,Response,AbortSignal,AbortController,TextDecoder,TextEncoder,setTimeout,clearTimeout});assert.equal(typeof handled.ensureAccess,'function');assert.equal(typeof handled.getPartnerConfig,'function');assert.equal(typeof handled.reconnect.reconnect,'function');assert(result.proof.originalBytesPreserved);
});
