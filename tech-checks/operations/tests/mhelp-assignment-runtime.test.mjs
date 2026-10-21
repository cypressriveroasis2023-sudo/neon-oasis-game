import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareOwnerAssignmentReviewRuntime} from '../scripts/prepareOwnerAssignmentReviewRuntime.mjs';
const original='/* CosMhelpShopAddressRelease; existing auth and saved health remain */\n'+
 '["/api/mhelpdesk/equipment/commit"].includes(envelope.path);'+
 'if(path==="/api/mhelpdesk/equipment/stage"||path==="/api/mhelpdesk/equipment/commit"){requireExistingOwner();let allowed=path.endsWith("/stage")?[]:[];return json(path.endsWith("/stage")?await stageOwnerEquipmentCsv({...common2,requestId:body.requestId}):await commitOwnerEquipmentCsv({...common2}));}Deno.serve(handler);';
const native={slug:'cos-operations-pages',verify_jwt:false,import_map:true,files:[{name:'cos-operations-pages/serve.ts',content:original},{name:'cos-operations-pages/deno.json',content:'{}'}]};
test('assignment runtime preserves unrelated v111 code and authentication/config while adding the bounded route',async()=>{
 const result=await prepareOwnerAssignmentReviewRuntime(native);assert.equal(result.verify_jwt,false);assert.equal(result.import_map,true);assert.deepEqual(result.files[1],native.files[1]);assert.ok(result.files[0].content.includes('requireExistingOwner();'));assert.ok(result.files[0].content.includes('CosOwnerAssignmentReviewRelease.reviewOwnerEquipmentAssignments'));assert.equal(native.files[0].content,original);
 await assert.rejects(prepareOwnerAssignmentReviewRuntime(result),/Expected verified Shop runtime/);
 await assert.rejects(prepareOwnerAssignmentReviewRuntime({...native,files:[{...native.files[0],content:original.replace('let allowed=','const allowed=')}]}),/anchors changed/);
});
