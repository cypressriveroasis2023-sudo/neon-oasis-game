import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {validatedLocationProofs,exactLocationProof} from '../../supabase/functions/cos-operations-pages/validatedLocationProofs.ts';
import {projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
import {checkedAddressEstimate,addressEstimatePrefix,addressEstimateSource} from '../src/fieldAddressEstimates.ts';
import {isCurrentFieldPin} from '../src/fieldLocations.ts';
const id='11111111-1111-4111-8111-111111111111',at='2026-10-07T12:00:00Z',now=Date.parse('2026-10-13T19:00:00Z'),address='100 Example Road, Test City, TX 77001';
function estimate(){const marker={schemaVersion:1,trackerId:id,unitNumber:'Sniper 901',addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex'),latitude:30,longitude:-95,provider:'us_census_address_range',benchmark:'Public_AR_Current',providerMatchQuality:'Exact',matchedAddress:'100 EXAMPLE RD, TEST CITY, TX, 77001',geocodedAt:at,confidence:'address_range_interpolation',verified:false,liveGps:false,requiresOwnerConfirmation:true,batchId:'synthetic-batch',approvalReference:'synthetic-approval',appliedByDatabaseRole:'synthetic-role',appliedAt:at};return {id,unitNumber:'Sniper 901',placement:'FIELD',address,customer:'Example Builder',site:'Example site',status:'field',currentLocationType:'field',readOnly:true,hasUnitGps:false,locationVerification:'coordinates_unverified',latitude:null,longitude:null,historicalLatitude:30,historicalLongitude:-95,historicalCoordinateSource:addressEstimateSource,locationNote:addressEstimatePrefix+JSON.stringify(marker)};}
const snapshot=row=>({inventoryItems:[row],items:[row],summary:{fieldUnits:1}});
const receipt=(patch={})=>({contract:'COS_MHELP_PLACEMENT_V1',enabled:true,errorCode:'source_rate_limited',lastSuccessAt:at,items:[{trackerId:id,nativeUnitId:null,trackerLabel:'Sniper 901',nativeLabel:null,guardCurrent:true,state:'confirmed',placement:'FIELD',customerLabel:'Example Builder',siteLabel:'Example site',locationReview:false,observedAt:at,...patch}]});
test('location retention proof accepts exact validated points without upgrading precision or observation time',async()=>{
 const row=estimate(),proofs=await validatedLocationProofs(snapshot(row),now);assert.equal(proofs.size,1);assert.equal(proofs.get(id).kind,'address_estimate');assert.equal(proofs.get(id).locationFields.locationNote,row.locationNote);assert.equal(exactLocationProof(proofs,{...row,unitNumber:'Sniper 902'}),null);assert.equal(exactLocationProof(proofs,{...row,address:'changed'}),null);
 const gps={...row,readOnly:false,hasUnitGps:true,latitude:30,longitude:-95,locationVerification:'owner_verified',locationVerifiedAt:at,gpsRecordedAt:at};assert.equal((await validatedLocationProofs(snapshot(gps),now)).get(id).kind,'owner_verified');assert.equal(isCurrentFieldPin(gps),true);
 for(const extra of [{placement:'SHOP'},{placement:'UNKNOWN'},{placementStatus:'needs_identity_review'},{address:'changed'},{locationVerification:'address_changed'}])assert.equal((await validatedLocationProofs(snapshot({...row,...extra}),now)).size,0);
});
test('stale same-assignment receipt and unavailable service read retain independently accepted estimate',async()=>{
 const row=estimate(),proofs=await validatedLocationProofs(snapshot(row),now);
 for(const patch of [{},{state:'held',placement:null,reason:'service_location_unverified'}]){const result=projectMhelpFieldPlacement(snapshot(row),receipt(patch),[],undefined,now,{validatedLocationProofs:proofs});assert.deepEqual(await checkedAddressEstimate(result.items[0],now),await checkedAddressEstimate(row,now));assert.equal(result.items[0].placementEvidence.fresh,false);}
 for(const patch of [{placement:'SHOP'},{state:'held',placement:null,reason:'identity_or_lifecycle_changed'},{locationReview:true}]){const result=projectMhelpFieldPlacement(snapshot(row),receipt(patch),[],undefined,now,{validatedLocationProofs:proofs});assert.equal(await checkedAddressEstimate(result.inventoryItems[0],now),null);}
});

test('actual helper to upload to finalizer preserves older Owner observation provenance',async()=>{
 const row={...estimate(),placementSource:'owner',placementAuditId:'44',placementUnitKey:'Sniper 901',placementUpdatedAt:at},proofs=await validatedLocationProofs(snapshot(row),now),sha='a'.repeat(64),receivedAt='2026-10-13T18:22:00Z';
 assert.equal(proofs.get(id).ownerPlacementFields.placementEvidence,null);
 const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha,payloadSha256:'b'.repeat(64),receivedAt,receivedAtPrecision:'minute',exportAsOf:null,records:[{productId:'101',unitNumber:row.unitNumber,category:'Sniper',customerId:'11',customer:row.customer,sourceAddress:{},sourceRow:2,placement:'FIELD',lifecycle:'UNFLAGGED',binding:{productId:'101',trackerId:id,trackerLabel:row.unitNumber,nativeUnitId:null,nativeLabel:null,fullLabel:row.unitNumber,matchMethod:'reviewed_product_id',evidenceSha256:sha,expectedGuard:sha,guardCurrent:true,previousAssignment:{productId:'101',customerId:'11',placement:'FIELD',observedAt:at,serviceLocationId:'11'}}}]};
 const projected=projectMhelpUploadPlacement(snapshot(row),upload,[],undefined,now,{validatedLocationProofs:proofs}),final=projectEffectiveFleetPlacement(projected.snapshot,[],{authorizedUploadPlacements:projected.authorities});
 assert.equal(final.items[0].effectivePlacement.source,'owner');assert.equal(final.items[0].effectivePlacement.observedAt,at);assert.equal(final.items[0].placementEvidence,null);assert.ok(await checkedAddressEstimate(final.items[0],now));
});
test('known assignment-change marker reaches protected older Owner history; first-known service ID does not invent a move',async()=>{
 const row={...estimate(),placementSource:'owner',placementAuditId:'44',placementUnitKey:'Sniper 901',placementUpdatedAt:at},proofs=await validatedLocationProofs(snapshot(row),now),sha='a'.repeat(64),receivedAt='2026-10-13T18:22:00Z',changedAt='2026-10-13T08:09:00Z',audits=[{unit_key:row.unitNumber,action:'MOVE_TO_FIELD',created_at:at}];
 const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha,payloadSha256:'b'.repeat(64),receivedAt,receivedAtPrecision:'minute',exportAsOf:null,records:[{productId:'101',unitNumber:row.unitNumber,category:'Sniper',customerId:'11',customer:row.customer,sourceAddress:{},sourceRow:2,placement:'FIELD',lifecycle:'UNFLAGGED',binding:{productId:'101',trackerId:id,trackerLabel:row.unitNumber,nativeUnitId:null,nativeLabel:null,fullLabel:row.unitNumber,matchMethod:'reviewed_product_id',evidenceSha256:sha,expectedGuard:sha,guardCurrent:true,previousAssignment:{productId:'101',customerId:'11',placement:'FIELD',observedAt:changedAt,serviceLocationId:'11'}}}]};
 for(const assignmentChanged of [true,false,undefined]){
  const saved=projectMhelpFieldPlacement(snapshot(row),receipt({observedAt:changedAt,locationReview:true,assignmentChanged}),audits,undefined,now,{validatedLocationProofs:proofs});
  assert.equal(saved.inventoryItems[0].mhelpAssignmentChange?.contract,assignmentChanged!==false?'COS_MHELP_ASSIGNMENT_CHANGE_V1':undefined);
  const projected=projectMhelpUploadPlacement(saved,upload,audits,undefined,now,{validatedLocationProofs:proofs});
  assert.equal(Boolean(await checkedAddressEstimate(projected.snapshot.inventoryItems[0],now)),assignmentChanged===false);
 }
 const unprotected=estimate(),rawProofs=await validatedLocationProofs(snapshot(unprotected),now);
 const firstKnown=projectMhelpFieldPlacement(snapshot(unprotected),receipt({locationReview:true,assignmentChanged:false}),[],undefined,now,{validatedLocationProofs:rawProofs});assert.ok(await checkedAddressEstimate(firstKnown.items[0],now));
});

test('confirmed-source chronology is exact, guarded and emitted before protected placement exits',()=>{
 const observation='2026-10-13T18:30:00Z';
 for(const extra of [{placementSource:'owner',placementAuditId:'44',placementUpdatedAt:at},{hasUnitGps:true,gpsRecordedAt:at},{installedSiteId:id},{}])for(const placement of ['FIELD','SHOP']){
  const row={...estimate(),...extra},input=snapshot(row),saved=structuredClone(input),audits=[{unit_key:row.unitNumber,action:'MOVE_TO_FIELD',created_at:at}];
  const result=projectMhelpFieldPlacement(input,receipt({observedAt:observation,placement}),audits,undefined,now);
  assert.deepEqual(result.inventoryItems[0].mhelpConfirmedAssignment,{contract:'COS_MHELP_CONFIRMED_ASSIGNMENT_V1',unitId:id,unitNumber:row.unitNumber,observedAt:observation,placement,assignmentChanged:null});
  assert.deepEqual(input,saved);assert.notEqual(result.inventoryItems[0].placementEvidence?.observedAt,observation);
 }
 const row={...estimate(),placementSource:'owner',placementAuditId:'44',placementUpdatedAt:at,mhelpConfirmedAssignment:{contract:'stale'}};
 for(const patch of [{guardCurrent:false},{guardCurrent:undefined},{trackerLabel:'different'},{observedAt:'2026-10-14T00:00:00Z'},{state:'held',reason:'identity_or_lifecycle_changed'},{state:'held',reason:'service_location_unverified'}])assert.equal(projectMhelpFieldPlacement(snapshot(row),receipt(patch),[],undefined,now).inventoryItems[0].mhelpConfirmedAssignment,undefined);
 assert.equal(projectMhelpFieldPlacement(snapshot(row),{...receipt(),enabled:false},[],undefined,now).inventoryItems[0].mhelpConfirmedAssignment,undefined);
 assert.throws(()=>projectMhelpFieldPlacement(snapshot(row),receipt({observedAt:'invalid'}),[],undefined,now),/observation/);
 const duplicate=receipt();duplicate.items.push({...duplicate.items[0]});assert.throws(()=>projectMhelpFieldPlacement(snapshot(row),duplicate,[],undefined,now),/identity/);
});
