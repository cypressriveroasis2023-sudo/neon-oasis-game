import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {parseEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts';
import {stageOwnerEquipmentCsv,commitOwnerEquipmentCsv} from '../../supabase/functions/cos-operations-pages/mhelpEquipmentWriteBridge.ts';
globalThis.crypto??=webcrypto;
const UUID='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',org='33333333-3333-4333-8333-333333333333';
const filename='ServiceItem_List_20261016131754.csv';
const CSV=['ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip','11,Ranger 007,100,Domain Builders,Ranger,113 Main St,Houston,TX,77064','12,Ranger 024,200,Cameras OnSite,Ranger,9949 W Sam Houston,Houston,TX,77064'].join('\n');
const rows=parseEquipmentCsv(CSV);const body={sourceFilename:filename,bytesBase64:Buffer.from(CSV).toString('base64')};
const previous={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:'a'.repeat(64),records:rows};
const census=async()=>({contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1',sourceSha256:'b'.repeat(64),observedAt:'2026-10-17T01:35:00Z',verifiedBy:'cos_sheets_service',productIds:['11','12'],productRows:rows.map(r=>({productId:r.productId,unitLabel:r.unitNumber,family:r.category,placement:r.placement,customer:r.customer})),total:2,field:1,shop:1,sourceExport:filename});
const options={actorId:actor,organizationId:org,body,previous,google:{getServiceAccountJson:()=>null},verifyCensus:census};
test('Owner stage checks 2027 before invoking the dedicated guarded database action',async()=>{
 const calls=[];
 const rpc=async(name,args)=>{calls.push({name,args});assert.equal(name,'cos_owner_mhelp_equipment_stage_v1');return {contract:'COS_OWNER_EQUIPMENT_STAGE_V1',stageId:UUID,sourceSha256:args.p_source_sha256,productIdsMatched:2,previewOnly:true,readyToCommit:false,recordedField:1,recordedShop:1,expiresInMinutes:60}};
 const result=await stageOwnerEquipmentCsv({...options,requestId:UUID,rpc});
 assert.equal(result.productIdsMatched,2);assert.equal(result.readyToCommit,false);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].args.p_current_2027_rows,(await census()).productRows);
 assert.equal(calls[0].args.p_expected_active_sha256,previous.sourceSha256);
 assert.equal(calls[0].args.p_records[0].productId,'11');assert.ok(!JSON.stringify(calls[0].args.p_records).includes('166.193'));
});
test('Owner commit repeats source+Google verification before trusted transactional RPC',async()=>{
 let calls=0;
 const rpc=async(name,args)=>{calls++;assert.equal(name,'cos_owner_mhelp_equipment_commit_v1');assert.equal(args.p_current_2027_sha256,'b'.repeat(64));return {contract:'COS_OWNER_EQUIPMENT_COMMIT_V1',sourceSha256:(await import('node:crypto')).createHash('sha256').update(CSV).digest('hex'),applied:true,sourceReceiptsApplied:true,records:2,recordedField:1,recordedShop:1}};
 const out=await commitOwnerEquipmentCsv({...options,stageId:UUID,confirmationText:'I reviewed the full COS Field and Shop changes and approve this source.',rpc});
 assert.equal(out.applied,true);assert.equal(out.field,1);assert.equal(out.shop,1);assert.equal(calls,1);
});
test('missing 2027 source, invalid Owner, or suspicious approval stop before RPC',async()=>{
 let calls=0;const rpc=async()=>{calls++;throw Error('should not call')};
 await assert.rejects(stageOwnerEquipmentCsv({...options,requestId:UUID,verifyCensus:async()=>{throw Error('Sheets unavailable')},rpc}),/CENSUS_NOT_VERIFIED/);
 await assert.rejects(stageOwnerEquipmentCsv({...options,actorId:'unverified',requestId:UUID,rpc}),/authenticated actor required/);
 await assert.rejects(commitOwnerEquipmentCsv({...options,stageId:UUID,confirmationText:'Yes',rpc}),/explicit Owner stage approval/);
 assert.equal(calls,0);
});
test('mismatched database stage and commit receipts fail closed',async()=>{
 const stageRpc=async(n,args)=>({contract:'COS_OWNER_EQUIPMENT_STAGE_V1',stageId:UUID,sourceSha256:args.p_source_sha256,productIdsMatched:2,previewOnly:true,readyToCommit:false,recordedField:2,recordedShop:0});
 await assert.rejects(stageOwnerEquipmentCsv({...options,requestId:UUID,rpc:stageRpc}),/Field\/Shop count disagrees/);
 await assert.rejects(commitOwnerEquipmentCsv({...options,stageId:UUID,confirmationText:'I approve the complete current 2027 equipment source.',rpc:async()=>({contract:'COS_OWNER_EQUIPMENT_COMMIT_V1',applied:true,sourceReceiptsApplied:true,records:2,recordedField:2,recordedShop:0,sourceSha256:'x'.repeat(64)})}),/complete verified commit receipt/);
});
test('unexpected source fields and malformed expected hashes are denied before the database RPC',async()=>{
 let calls=0;const rpc=async()=>{calls++;throw Error('no database access expected')};
 await assert.rejects(stageOwnerEquipmentCsv({...options,requestId:UUID,rpc,body:{...body,expectedSha256:17}}),/invalid expected original SHA-256/);
 await assert.rejects(stageOwnerEquipmentCsv({...options,requestId:UUID,rpc,body:{...body,unexpected:true}}),/unexpected source request field/);
 assert.equal(calls,0);
});

test('assignment review rereads exact file and current Google proof, and never trusts browser census or identities',async()=>{
 const {reviewOwnerEquipmentAssignments}=await import('../../supabase/functions/cos-operations-pages/mhelpEquipmentAssignmentReview.ts');let calls=0;
 const rpc=async(name,args)=>{calls++;assert.equal(name,'cos_owner_mhelp_assignment_review_v1');assert.equal(args.p_current_2027_sha256,'b'.repeat(64));assert.equal(args.p_actor_user_id,actor);return {contract:'COS_OWNER_ASSIGNMENT_REVIEW_V1',stageId:UUID,sourceSha256:args.p_source_sha256,censusSha256:args.p_current_2027_sha256,reviewDigest:'d'.repeat(64),approved:false,items:[]};};
 await reviewOwnerEquipmentAssignments({...options,rpc,stageId:UUID,action:'read'});assert.equal(calls,1);
 await assert.rejects(reviewOwnerEquipmentAssignments({...options,rpc,stageId:UUID,action:'read',verifyCensus:async()=>{throw Error('unavailable')}}),/CENSUS_NOT_VERIFIED/);
 await assert.rejects(reviewOwnerEquipmentAssignments({...options,rpc,stageId:UUID,action:'approve',reviewDigest:'d'.repeat(64),confirmationText:'yes'}),/explicit assignment review/);
 await assert.rejects(reviewOwnerEquipmentAssignments({...options,rpc,stageId:UUID,action:'read',body:{...body,binding:{nativeUnitId:UUID}}}),/unexpected source request field/);
 assert.equal(calls,1);
});
