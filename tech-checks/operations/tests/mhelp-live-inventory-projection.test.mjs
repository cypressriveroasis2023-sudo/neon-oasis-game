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

// A daily assignment is inventory authority, regardless of device reachability.
import {readInventorySource} from '../../supabase/functions/cos-mhelp-inventory-sync/source.ts';
import {fieldInventoryCensus} from '../src/fieldInventoryCensus.ts';
import {planPublishing,snapshotCell,cellText} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
test('exact Product ID moves Shop to Field and back through API, COS census and guarded tracker planning without health or GPS',async()=>{
 const cell=s=>snapshotCell({userEnteredValue:{stringValue:s}});
 let prior={...record(),placement:'SHOP',customerId:'11',customer:'Cameras Onsite LLC'};
 let baseline={sourceSha256:hash,companyCustomerIds:['11'],records:[prior]};
 let cells=['Ranger 029.2','SHOP','Cameras Onsite LLC','SHOP'].map(cell);
 const native={...row(),ip:'192.0.2.7',sim:'synthetic-sim',cameraIdentity:'synthetic-resource',latitude:null,longitude:null,status:'offline',history:[{at:'2026-10-18T00:00:00Z',placement:'SHOP'}]};
 const base={items:[native],inventoryItems:[native],summary:{}},before=structuredClone(base),history=[];
 for(const [i,placement] of ['SHOP','FIELD','SHOP'].entries()){
  const stamp=new Date(Date.parse(at)+i*60000).toISOString(),customerId=placement==='SHOP'?'11':'3';
  const equipment={equipmentId:'101',portalId:'224643',name:'Ranger 029.2',model:null,active:true,equipmentTypeId:'2',customerId,serviceLocationId:placement==='SHOP'?'11':'4',updatedAt:stamp};
  const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:1,items:[equipment]};
  const source=await readInventorySource({review,baseline,now:()=>stamp,observedAt:()=>stamp,verifyEquipment:async()=>review,read:async path=>path.startsWith('/equipmentTypes')?{results:[{equipmentTypeId:2,portalId:224643,category:'Ranger'}]}:path.includes('/servicelocations')?{totalRows:1,results:[{customerId:3,serviceLocationId:4,portalId:224643,name:'Current site',address1:'123 Current Service St',city:'Houston',state:'TX',zip:'77002'}]}:{customerId:Number(customerId),portalId:224643,name:placement==='SHOP'?'Cameras Onsite LLC':'Current customer',isServiceLocation:false}});
  // The admitted snapshot rechecks the unchanged synthetic identity guard.
  const admittedRecords=source.records.map(r=>({...r,binding:r.binding?{...r.binding,guardCurrent:r.binding.expectedGuard===hash}:null}));
  const received={...receipt(admittedRecords),sourceSha256:String(i+1).repeat(64),receivedAt:stamp,apiSync:{enabled:true,lastSuccessAt:stamp,errorCode:null}};
  const uploaded=projectMhelpUploadPlacement(base,received,[],undefined,Date.parse(stamp)+1000);
  const authority=readMhelpInventoryAuthority(uploaded.snapshot.uploadInventory,Date.parse(stamp)+1000);
  assert.equal(authority.total,1);assert.equal(authority.field,placement==='FIELD'?1:0);assert.equal(authority.shop,placement==='SHOP'?1:0);
  const census=fieldInventoryCensus(uploaded.snapshot.uploadInventory,null,false,Date.parse(stamp)+1000);
  assert.deepEqual(census.items.map(p=>p.productId),placement==='FIELD'?['101']:[]);assert.equal(census.counts.offline,0);
  const projected=uploaded.snapshot.uploadInventory.records[0];assert.equal(projected.placement,placement);assert.equal(projected.customer,placement==='SHOP'?'Cameras Onsite LLC':'Current customer: Current site');assert.equal(projected.sourceAddress.street,placement==='SHOP'?'':'123 Current Service St');
  const observation={equipmentId:'101',state:'confirmed',placement,customerId,serviceLocationId:placement==='SHOP'?null:'4',customerLabel:placement==='SHOP'?'Cameras Onsite LLC':'Current customer',siteLabel:placement==='SHOP'?'SHOP':'Current site'};
  const binding={equipmentId:'101',sheetId:2017346590,row:2,label:'Ranger 029.2',baseline:cells,pending:null,observation,sourceCurrent:true};
  const tracker={sheetId:binding.sheetId,row:2,label:binding.label,unique:true,cells};
  const planned=planPublishing([binding],[tracker]);assert.equal(planned.results.some(r=>r.state==='held'),false);
  if(planned.intents.length)cells=planned.intents[0].cells;
  assert.equal(cellText(cells[1]),placement);assert.equal(cellText(cells[2]),observation.customerLabel);assert.equal(cellText(cells[3]),observation.siteLabel);
  assert(planned.requests.every(r=>r.updateCells.fields==='userEnteredValue'&&[1,3,4].includes(r.updateCells.range.startColumnIndex)));
  // A manual tracker edit stays protected even when mHelp legitimately moves.
  const manual={...tracker,cells:[...tracker.cells.slice(0,3),cell('Manual technician note')]};assert.equal(planPublishing([binding],[manual]).requests.length,0);
  history.push(structuredClone({at:stamp,sourceSha256:received.sourceSha256,record:source.records[0]}));
  baseline={...baseline,sourceSha256:received.sourceSha256,records:source.records.map(r=>({...r,binding:r.binding?{...r.binding,guardCurrent:true}:null}))};
 }
 assert.deepEqual(history.map(r=>r.record.placement),['SHOP','FIELD','SHOP']);assert.equal(new Set(history.map(r=>r.sourceSha256)).size,3);assert.deepEqual(base,before);
});
