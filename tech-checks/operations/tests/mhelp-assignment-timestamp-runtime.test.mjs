import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareOwnerAssignmentTimestampRuntime,replaceAssignmentReviewHelper} from '../scripts/prepareOwnerAssignmentTimestampRuntime.mjs';

const prefix='/* existing Owner authorization, session and renewal implementation */\n';
const suffix='Deno.serve(existingHandler);\n/* existing routes and error handling */';
const oldHelper='var CosOwnerAssignmentReviewRelease=(()=>{var stdin_exports={old:true};return __toCommonJS(stdin_exports);})();\n\n';
const newHelper='var CosOwnerAssignmentReviewRelease=(()=>{var stdin_exports={timestampSupport:true};return __toCommonJS(stdin_exports);})();\n\n';
const original=prefix+oldHelper+suffix;

test('review helper replacement preserves every byte of unrelated runtime and refuses ambiguous boundaries',()=>{
 const result=replaceAssignmentReviewHelper(original,newHelper);
 assert.equal(result,prefix+'// COS_OWNER_ASSIGNMENT_TIMESTAMP_RUNTIME_V1\n'+newHelper+suffix);
 assert.throws(()=>replaceAssignmentReviewHelper(result,newHelper),/anchors changed/);
 assert.throws(()=>replaceAssignmentReviewHelper(original+oldHelper,newHelper),/anchors changed/);
 assert.throws(()=>replaceAssignmentReviewHelper(original.replace('Deno.serve(','Deno.changed('),newHelper),/anchors changed/);
 assert.throws(()=>replaceAssignmentReviewHelper(original.replace('})();\n\n','})();\n'),newHelper),/boundary changed/);
 assert.throws(()=>replaceAssignmentReviewHelper(original,newHelper+'Deno.serve(other);'),/anchors changed/);
 assert.throws(()=>replaceAssignmentReviewHelper(original,newHelper.replace('CosOwnerAssignmentReviewRelease','OtherRelease')),/anchors changed/);
});

test('production builder refuses stale versions, authorization changes, configuration drift and unreviewed runtime bytes',async()=>{
 const candidate={slug:'cos-operations-pages',version:114,verify_jwt:false,import_map:true,files:[{name:'cos-operations-pages/serve.ts',content:original},{name:'cos-operations-pages/deno.json',content:'{}'}]};
 for(const changed of [candidate,{...candidate,version:115},{...candidate,slug:'different-function'},{...candidate,verify_jwt:true},{...candidate,import_map:false},{...candidate,files:[...candidate.files,candidate.files[0]]},{...candidate,files:[]}]){
  await assert.rejects(prepareOwnerAssignmentTimestampRuntime(changed),/Expected exact reviewed v114 runtime and configuration/);
 }
});
