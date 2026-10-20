import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {prepareMhelpCsvBaselineRuntime} from '../scripts/prepareMhelpCsvBaselineRuntime.mjs';
const original=`function validPrior(v){if(v.contract!=='COS_MHELP_UPLOAD_V1')throw Error('old baseline');return v;}
function prepareMhelpEquipmentAdmission(rows,previous,guards){if(previous.contract!=='COS_MHELP_UPLOAD_V1'||previous.sourceSha256!==guards.expectedActiveSourceSha256)throw Error('source CAS');if(previous.records[0].binding?.guardCurrent===false)throw Error('identity held');return {held:true,canCommit:false};}
Deno.serve({preview:v=>validPrior(v),plan:(v,g)=>prepareMhelpEquipmentAdmission([],v,g)});`;
const receipt={contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',reviewed:true,complete:true,recordCount:1,sourceSha256:'a'.repeat(64),payloadSha256:'b'.repeat(64),apiMissingRecords:[],records:[{productId:'1',placement:'FIELD',sourceAddress:{}}]};
test('compiled patch preserves every original byte/config and delegates protected planner',async()=>{
 const native={slug:'cos-operations-pages',verify_jwt:false,files:[{name:'cos-operations-pages/serve.ts',content:original},{name:'cos-operations-pages/deno.json',content:'{"imports":{"jose":"unchanged"}}'}]};
 const candidate=await prepareMhelpCsvBaselineRuntime(native);assert.deepEqual(candidate.files[1],native.files[1]);assert.equal(candidate.verify_jwt,false);
 const code=candidate.files[0].content;const start=code.indexOf('\nvar CosMhelpCsvBaselineRelease'),end=code.indexOf('Deno.serve(');assert(start>=0);assert.equal(code.slice(0,start)+code.slice(end),original);
 let handler;vm.runInNewContext(code,{Deno:{serve:v=>{handler=v}}});assert.equal(handler.preview(receipt).sourceSha256,receipt.sourceSha256);assert.equal(handler.plan(receipt,{expectedActiveSourceSha256:receipt.sourceSha256}).canCommit,false);
 assert.throws(()=>handler.preview({...receipt,complete:false}),/complete reviewed/);assert.throws(()=>handler.plan(receipt,{expectedActiveSourceSha256:'c'.repeat(64)}),/source CAS/);
 assert.throws(()=>handler.plan({...receipt,records:[{...receipt.records[0],binding:{guardCurrent:false}}]},{expectedActiveSourceSha256:receipt.sourceSha256}),/identity held/);
 await assert.rejects(prepareMhelpCsvBaselineRuntime(candidate),/runtime changed/);
});
