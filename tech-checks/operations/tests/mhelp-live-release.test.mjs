import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {extendLiveInventoryBridge,releaseFunctions} from '../scripts/build-mhelp-live-release.mjs';
const helper='var CosMhelpLiveInventoryRelease={'+releaseFunctions.map(n=>n+':()=>"new"').join(',')+'};';
const original={version:103,verify_jwt:false,files:[{name:'cos-operations-pages/serve.ts',content:releaseFunctions.map(n=>'function '+n+'(){return "old"}').join('\n')+'\nvar captured=projectMhelpUploadPlacement();'},{name:'cos-operations-pages/deno.json',content:'{"imports":{}}'}]};
test('extension retains every original byte and runtime file and changes only the selected helper bindings',()=>{const before=structuredClone(original),result=extendLiveInventoryBridge(original,helper);assert.deepEqual(original,before);assert(result.files[0].content.endsWith(original.files[0].content));assert.equal(result.proof.originalBytesPreserved,true);assert.deepEqual(result.files[1],original.files[1]);const context={};vm.runInNewContext(result.files[0].content,context);assert.equal(context.captured,'new');});
test('changed interfaces and already extended bundles reject rather than overwriting',()=>{assert.throws(()=>extendLiveInventoryBridge({...original,files:[{...original.files[0],content:'function unrelated(){}'}]},helper));const result=extendLiveInventoryBridge(original,helper);assert.throws(()=>extendLiveInventoryBridge({...original,files:result.files},helper));});
