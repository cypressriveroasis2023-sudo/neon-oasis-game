import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {projectCombinedFleetRoster} from '../../supabase/functions/cos-operations-pages/combinedFleetRoster.ts';
import {readRecordedRoster} from '../src/fleetRecordedRoster.ts';
import {readMhelpInventoryAuthority} from '../src/mhelpInventoryAuthority.ts';
const unit='11111111-1111-4111-8111-111111111111',hash='a'.repeat(64),at='2026-10-19T00:00:00Z',now=Date.parse(at)+1000;
const row=()=>({id:unit,unitNumber:'Ranger 029.2',placement:'FIELD',currentLocationType:'field',customer:'Old Customer',latitude:30,longitude:-95,readOnly:true});
const record=(productId='101')=>({productId,unitNumber:productId==='101'?'Ranger 029.2':'Solar Stand 001',category:'Ranger',customerId:'3',customer:'Customer: Site',sourceAddress:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},sourceRow:2,placement:'FIELD',lifecycle:'UNFLAGGED',binding:productId==='101'?{productId,trackerId:null,nativeUnitId:unit,nativeLabel:'Ranger 029.2',trackerLabel:null,fullLabel:'Ranger 029.2',guardCurrent:true,matchMethod:'reviewed_product_id',evidenceSha256:hash,expectedGuard:hash}:null});
const receipt=(records=[record()])=>({contract:'COS_MHELP_API_V1',origin:'mhelpdesk_api',portalId:'224643',complete:true,reviewed:true,sourceSha256:hash,payloadSha256:'b'.repeat(64),receivedAt:at,receivedAtPrecision:'second',exportAsOf:null,recordCount:records.length,records,apiMissingRecords:[],apiSync:{enabled:true,lastSuccessAt:at,errorCode:null}});
const snapshot=()=>({inventoryItems:[row()],items:[row()],summary:{}});
function project(source=receipt(),base=snapshot()){
 const uploaded=projectMhelpUploadPlacement(base,source,[],undefined,now);
 const effective=projectEffectiveFleetPlacement(uploaded.snapshot,[],{authorizedUploadPlacements:uploaded.authorities});
 return {uploaded,effective,combined:projectCombinedFleetRoster(effective,[])};
}
test('API provenance survives the full roster and client validation without being labeled an Owner file',()=>{const r=project(receipt([record(),record('102')]));assert.equal(r.uploaded.authorities[0].source,'mhelpdesk_api');assert.equal(r.combined.uploadInventory.source,'mhelpdesk_api');assert.equal(r.combined.fleetRoster.items.find(x=>x.kind==='source_equipment').source,'mhelpdesk_api');assert.equal(readRecordedRoster(r.combined.fleetRoster,r.combined.inventoryItems).error,null);const p=readMhelpInventoryAuthority(r.combined.uploadInventory,now);assert.equal(p.live,true);assert.equal(p.total,2);assert.equal(p.field,2);});
test('a verified Shop move updates visible placement without mutating native input or transferring coordinates',()=>{const r=record();r.placement='SHOP';const base=snapshot(),before=structuredClone(base);const result=project(receipt([r]),base);assert.deepEqual(base,before);assert.equal(result.combined.items.length,0);assert.equal(result.combined.inventoryItems[0].latitude,null);assert.equal(result.combined.uploadInventory.summary.shopRecords,1);});
test('missing API Product IDs retain historical native records but stop active Field membership',()=>{const source=receipt([record('102')]);source.apiMissingRecords=[record()];const result=project(source);assert.equal(result.combined.uploadInventory.summary.totalRecords,1);assert.equal(result.combined.inventoryItems[0].activeInventoryEligible,false);assert.equal(result.combined.fleetRoster.items.find(x=>x.kind==='unit').lifecycle,'missing');assert.equal(result.combined.items.length,0);});
test('wrong-portal, incomplete and mislabeled live receipts reject',()=>{for(const change of [{portalId:'9'},{complete:false},{origin:'owner_file'},{apiMissingRecords:null},{recordCount:2}])assert.throws(()=>project({...receipt(),...change}));});
test('a failed full-inventory sync is visible even when placement reads succeed',()=>{const source=receipt();source.apiSync.errorCode='inventory_source_unavailable';const result=project(source);assert.equal(result.combined.mhelpPlacementSync.errorCode,'inventory_source_unavailable');assert.equal(result.combined.mhelpPlacementSync.inventoryEnabled,true);});
