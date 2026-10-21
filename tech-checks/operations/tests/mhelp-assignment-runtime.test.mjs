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

test('continuity successor replaces only installed review helper and 409 handler, preserving v113 renewal and configuration',async()=>{
 const {prepareOwnerAssignmentContinuityRuntime}=await import('../scripts/prepareOwnerAssignmentReviewRuntime.mjs');
 const previous=await prepareOwnerAssignmentReviewRuntime(native);
 const anchor='e instanceof Error&&e.message.startsWith("Invalid mHelpDesk equipment CSV:")&&fail16(e.message,422),e instanceof Error&&e.message.startsWith("Protected COS equipment admission:")&&fail16(e.message,409),fail16("Current Owner equipment guards could not be verified. No source update was authorized.",503)';
 const saved='var CosMhelpReliabilityRuntime = (()=>({renewal:"unrelated-v113-renewal"}))();\n'+previous.files[0].content.replace('requireExistingOwner();','requireExistingOwner();'+anchor+';');
 const installed={...previous,version:113,files:[{...previous.files[0],content:saved},previous.files[1]]};
 const updated=await prepareOwnerAssignmentContinuityRuntime(installed),content=updated.files[0].content;
 assert.equal(updated.version,113);assert.equal(updated.verify_jwt,installed.verify_jwt);assert.equal(updated.import_map,installed.import_map);assert.deepEqual(updated.files[1],installed.files[1]);assert.equal(installed.files[0].content,saved);
 assert.ok(content.includes('unrelated-v113-renewal'));assert.ok(content.includes('sourceAssignmentChanged'));assert.ok(content.includes('timestamp_only'));assert.ok(content.includes('e instanceof HttpError&&e.status===409&&'));
 assert.equal(content.split('var CosOwnerAssignmentReviewRelease=').length,2);
 const strip=s=>s.replace(/\/\/ COS_OWNER_ASSIGNMENT_CONTINUITY_RUNTIME_V1\n/,'').replace(/var CosOwnerAssignmentReviewRelease=[\s\S]*?\n\n(?=Deno\.serve\()/,'').replace('e instanceof HttpError&&e.status===409&&fail16("The equipment source or assignment evidence changed. Refresh the Owner review before continuing.",409),','');
 assert.equal(strip(content),strip(saved));
 await assert.rejects(prepareOwnerAssignmentContinuityRuntime(updated),/Expected fresh verified v113/);
 await assert.rejects(prepareOwnerAssignmentContinuityRuntime({...installed,version:114}),/Expected fresh verified v113/);
 await assert.rejects(prepareOwnerAssignmentContinuityRuntime({...installed,files:[{...installed.files[0],content:saved.replace(anchor,'changed anchor')}]}),/anchors changed/);
});
