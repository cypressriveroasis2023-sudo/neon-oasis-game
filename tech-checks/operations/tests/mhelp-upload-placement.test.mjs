import {projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
import {createHash} from 'node:crypto';
import {validatedLocationProofs} from '../../supabase/functions/cos-operations-pages/validatedLocationProofs.ts';
import {checkedAddressEstimate} from '../src/fieldAddressEstimates.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {projectMhelpFleetLocations} from '../../supabase/functions/cos-operations-pages/mhelpFleetLocationProjection.ts';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
const tracker='11111111-1111-4111-8111-111111111111',native='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-10-13T19:00:00Z'),cutoff='2026-10-13T18:22:00Z',hash='a'.repeat(64);
const row=()=>({id:tracker,unitNumber:'Sniper 2 017',placement:'FIELD',currentLocationType:'field',readOnly:true,latitude:30,longitude:-95,historicalLatitude:29,historicalLongitude:-94,coordinateSource:'prior'});
const record=()=>({productId:'101',unitNumber:'Sniper 2 017',category:'Sniper 2',customerId:'11',customer:'Synthetic Company',sourceAddress:{street:'Synthetic street',city:'Test',state:'TX',zip:'00000'},sourceRow:2,placement:'SHOP',lifecycle:'UNFLAGGED',binding:{productId:'101',trackerId:tracker,nativeUnitId:null,trackerLabel:'Sniper 2 017',nativeLabel:null,fullLabel:'Sniper 2 017',matchMethod:'reviewed_product_id',evidenceSha256:hash,expectedGuard:hash,guardCurrent:true}});
const receipt=(records=[record()])=>({contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:hash,payloadSha256:'b'.repeat(64),receivedAt:cutoff,receivedAtPrecision:'minute',exportAsOf:null,records});
const snapshot=(r=row())=>({inventoryItems:[r,{id:other,unitNumber:'Recon 028.1',placement:'FIELD',readOnly:true}],items:[r,{id:other,unitNumber:'Recon 028.1',placement:'FIELD',readOnly:true}],summary:{fieldUnits:2},mhelpPlacementSync:{lastSuccessAt:'2026-10-13T08:09:00Z',errorCode:'rate_limited',nextReadAt:'2026-10-13T21:00:00Z'}});
const project=(snap=snapshot(),r=receipt(),audits=[])=>projectMhelpUploadPlacement(snap,r,audits,undefined,now);
test('exact reviewed upload corrects assignment; preserves missing tracker records, API state and historical points',()=>{
 const before=snapshot(),result=project(before),r=result.snapshot.inventoryItems[0];
 assert.equal(r.placement,'SHOP');assert.equal(r.placementEvidence.fresh,false);assert.equal(r.placementEvidence.timestampKind,'upload_received');assert.equal(r.latitude,null);assert.equal(r.historicalLatitude,30);
 assert.equal(r.uploadSourceAddress.street,'Synthetic street');assert.equal(r.address,null);assert.deepEqual(result.snapshot.mhelpPlacementSync,before.mhelpPlacementSync);assert.deepEqual(before,snapshot());
 assert.deepEqual(result.snapshot.items.map(r=>r.id),[other]);assert.equal(result.snapshot.uploadInventory.records[0].binding.state,'linked');
 assert.deepEqual(result.authorities,[{unitId:tracker,unitNumber:'Sniper 2 017',productId:'101',placement:'SHOP',sourceSha256:hash,observedAt:cutoff,source:'owner_supplied_mhelp_export'}]);
});
test('minute cutoff protects same-minute, later and undated Owner moves; earlier explicit Postgres UTC audit is superseded',()=>{
 for(const created_at of [cutoff,'2026-10-13T18:22:31Z','2026-10-13T18:23:00Z',null,'2026-10-13 18:20:00'])assert.equal(project(snapshot(),receipt(),[{unit_key:'Sniper 2 017',created_at}]).authorities.length,0);
 assert.equal(project(snapshot(),receipt(),[{unit_key:'Sniper 2 017',created_at:'2026-10-13 08:09:49.646709+00'}]).authorities.length,1);
 for(const placementUpdatedAt of [null,cutoff,'2026-10-13T18:25:00Z'])assert.equal(project(snapshot({...row(),placementSource:'owner',placementUpdatedAt})).authorities.length,0);
});
test('identity conflicts, renamed targets, changed guards and unknown/newer native location timestamps remain held',()=>{
 for(const extra of [{placementReviewReason:'identity conflict'},{representationStatus:'conflict'},{hasUnitGps:true},{hasUnitGps:true,gpsRecordedAt:cutoff},{installedSiteId:native},{installedSiteId:native,placementUpdatedAt:cutoff}])assert.equal(project(snapshot({...row(),...extra})).authorities.length,0);
 const wrong=record();wrong.binding.guardCurrent=false;assert.equal(project(snapshot(),receipt([wrong])).snapshot.uploadInventory.records[0].binding.state,'held');
 assert.equal(project(snapshot({...row(),unitNumber:'Sniper 4 017'})).authorities.length,0);
});
test('source-only and ambiguous records remain complete; lifecycle never becomes placement or active field',()=>{
 const r=record();r.binding=null;r.placement='FIELD';r.lifecycle='DO_NOT_USE';
 const result=project(snapshot(),receipt([r]));assert.equal(result.snapshot.uploadInventory.summary.totalRecords,1);assert.equal(result.snapshot.uploadInventory.summary.fieldRecords,1);assert.equal(result.snapshot.uploadInventory.summary.unflaggedFieldRecords,0);assert.equal(result.snapshot.uploadInventory.records[0].binding.state,'unlinked');
 const bound=record();bound.placement='FIELD';bound.lifecycle='DO_NOT_USE';assert.deepEqual(project(snapshot(),receipt([bound])).snapshot.items.map(x=>x.id),[other]);
 r.possibleAliasUnitIds=[tracker];r.placementHeld=true;r.holdReason='unresolved_possible_alias';const held=project(snapshot(),receipt([r])).snapshot.uploadInventory.records[0];assert.equal(held.binding.state,'held');assert.equal(held.binding.placementHeld,true);assert.deepEqual(held.binding.candidateUnitIds,[tracker]);
});
test('no ProductId/name fallback, duplicate claims or unverified receipts',()=>{
 const r=record();r.productId='102';assert.throws(()=>project(snapshot(),receipt([r])),/identity binding/);
 const twin=record();twin.productId='102';twin.binding.productId='102';assert.throws(()=>project(snapshot(),receipt([record(),twin])),/Conflicting/);
 assert.throws(()=>project(snapshot(),{...receipt(),reviewed:false}),/receipt/);
 const unbound=record();unbound.binding=null;assert.equal(project(snapshot(),receipt([unbound])).authorities.length,0);
});
test('native-only reviewed bindings apply by exact UUID; newer MHelp reads win',()=>{
 const r=record();r.binding.trackerId=null;r.binding.trackerLabel=null;r.binding.nativeUnitId=tracker;r.binding.nativeLabel='Sniper 2 017';assert.equal(project(snapshot(),receipt([r])).authorities.length,1);
 assert.equal(project(snapshot({...row(),placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T18:23:00Z'})).authorities.length,0);
});
test('one newer member protects the entire proven ProductId representation group',()=>{
 const r=record();r.binding.nativeUnitId=native;r.binding.nativeLabel='Sniper 2 017';const snap=snapshot();snap.inventoryItems.push({...row(),id:native,readOnly:false,placementSource:'owner',placementUpdatedAt:cutoff});
 const result=project(snap,receipt([r]));assert.equal(result.authorities.length,0);assert.deepEqual(result.snapshot.inventoryItems,snap.inventoryItems);assert.equal(result.snapshot.uploadInventory.records[0].binding.reason,'newer_or_undated_owner_placement');
});
test('missing target cannot fallback; reviewed exact visible membership permits only the documented hidden representation',()=>{
 const r=record();r.binding.nativeUnitId=native;r.binding.nativeLabel='Sniper 2 017';assert.equal(project(snapshot(),receipt([r])).authorities.length,0);
 r.binding.representedUnitIds=[native];r.binding.representationEvidenceSha256=hash;assert.equal(project(snapshot(),receipt([r])).authorities.length,0);
 const snap=snapshot({...row(),id:native});assert.equal(project(snap,receipt([r])).authorities.length,1);
 delete r.binding.representedUnitIds;assert.equal(project(snap,receipt([r])).authorities.length,0);
});
test('multiline customer addresses stay plain source evidence, not map coordinates',()=>{
 const r=record();r.sourceAddress.street='123 Synthetic Street\r\nSuite 2\nGate A';const result=project(snapshot(),receipt([r]));assert.equal(result.snapshot.uploadInventory.records[0].sourceAddress.street,r.sourceAddress.street);assert.equal(result.snapshot.inventoryItems[0].address,null);assert.equal(result.snapshot.inventoryItems[0].latitude,null);
 r.sourceAddress.street='Invalid\u0000address';assert.throws(()=>project(snapshot(),receipt([r])),/source record/);
});
test('approved display alias preserves exact guarded source and existing unit labels',()=>{
 const r=record();r.displayUnitNumber='Sniper 2 017 (REVIEWED LABEL)';r.displayAuthorizationSha256=hash;const result=project(snapshot(),receipt([r]));assert.equal(result.snapshot.uploadInventory.records[0].unitNumber,r.displayUnitNumber);assert.equal(result.snapshot.uploadInventory.records[0].sourceUnitNumber,r.unitNumber);assert.equal(result.snapshot.inventoryItems[0].unitNumber,'Sniper 2 017');assert.equal(result.snapshot.inventoryItems[0].uploadDisplayUnitNumber,r.displayUnitNumber);assert.equal(result.authorities[0].unitNumber,'Sniper 2 017');
});
const locationProof=(kind='owner_verified')=>({contract:'COS_VALIDATED_LOCATION_PROOF_V1',unitId:tracker,unitNumber:'Sniper 2 017',kind,productId:kind==='owner_verified'?null:'101',address:'Verified installation street',customer:null,site:'Verified installation',locationFields:{latitude:30,longitude:-95,coordinateSource:'manual',hasUnitGps:kind==='owner_verified',locationVerification:kind==='owner_verified'?'owner_verified':'address_only',locationHistoryId:native,locationVerifiedAt:'2026-10-01T12:00:00Z',gpsRecordedAt:'2026-10-01T12:00:00Z',addressSource:'Owner verified installation'},ownerPlacementFields:null});
const preservedProject=(r,proof,extra={})=>projectMhelpUploadPlacement(snapshot({...row(),...extra}),receipt([r]),[],undefined,now,{validatedLocationProofs:new Map([[tracker,proof]])});
test('independently validated manual GPS survives absent prior CustomerId; upload does not renew it or use billing address',()=>{
 const r=record();r.placement='FIELD';const p=locationProof();const result=preservedProject(r,p),unit=result.snapshot.inventoryItems[0];
 assert.equal(unit.latitude,30);assert.equal(unit.hasUnitGps,true);assert.equal(unit.address,p.address);assert.equal(unit.site,p.site);assert.equal(unit.locationVerifiedAt,'2026-10-01T12:00:00Z');assert.equal(unit.placementEvidence.fresh,false);assert.equal(unit.uploadSourceAddress.street,'Synthetic street');
 assert.equal(project(snapshot(),receipt([r])).snapshot.inventoryItems[0].latitude,null,'row metadata alone cannot preserve a pin without separately validated proof');
});
test('SHOP, known customer movement, explicit service-address change and mismatched proof never retain old pins',()=>{
 const shop=record(),p=locationProof();assert.equal(preservedProject(shop,p).snapshot.inventoryItems[0].latitude,null);
 const moved=record();moved.placement='FIELD';moved.binding.previousAssignment={productId:'101',customerId:'99',placement:'FIELD'};assert.equal(preservedProject(moved,p).snapshot.inventoryItems[0].latitude,null);
 const same=record();same.placement='FIELD';assert.equal(preservedProject(same,p,{locationVerification:'address_changed'}).snapshot.inventoryItems[0].latitude,null);
 assert.equal(preservedProject(same,{...p,unitNumber:'Sniper 4 017'}).snapshot.inventoryItems[0].latitude,null);
 assert.equal(preservedProject(same,{...p,customer:'Different Company'}).snapshot.inventoryItems[0].latitude,null);
});
test('address estimate needs positive unchanged customer identity; original owner source fields remain intact',()=>{
 const r=record();r.placement='FIELD';const p=locationProof('address_estimate');assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
 p.customer=r.customer;assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,30);
 p.productId=null;p.customer=null;p.ownerPlacementFields={placementSource:'owner',placementAuditId:'17',placementUpdatedAt:'2026-10-01T12:00:00Z',placementEvidence:{source:'owner',observedAt:'2026-10-01T12:00:00Z',fresh:false}};
 assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
 r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};const result=preservedProject(r,p);assert.equal(result.snapshot.inventoryItems[0].latitude,30);assert.equal(result.snapshot.inventoryItems[0].placementSource,'owner');assert.equal(result.authorities.length,0);
});
test('same-customer service-address move before upload cannot restore a previously valid pin',()=>{
 const r=record();r.placement='FIELD';r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};const p=locationProof('address_estimate');p.customer=r.customer;
 const result=preservedProject(r,p,{placement:'FIELD',placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T18:00:00Z',mhelpLocationReview:false,locationVerification:'address_only',address:'A different service installation'});
 assert.equal(result.snapshot.inventoryItems[0].latitude,null);assert.equal(result.snapshot.inventoryItems[0].address,null);
 const cleared=preservedProject(r,p,{placement:'FIELD',placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T08:09:00Z',mhelpLocationReview:true,locationVerification:'coordinates_unverified',address:null});assert.equal(cleared.snapshot.inventoryItems[0].latitude,30);
});
test('actual service-location projection then later CSV retains changed-address exclusion for estimates and manual pins',()=>{
 const at=Date.parse('2026-10-13T18:23:00Z'),r=record();r.placement='FIELD';r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};
 for(const kind of ['address_estimate','owner_verified']){
  const p=locationProof(kind);p.customer=r.customer;const before=snapshot({...row(),...p.locationFields,placement:'FIELD',placementSource:kind==='owner_verified'?'owner':'recorded_inventory',address:p.address,customer:r.customer});
  const changed=projectMhelpFleetLocations(before,{contract:'COS_MHELP_FLEET_LOCATIONS_V1',items:[{unitId:tracker,unitNumber:'Sniper 2 017',state:'confirmed',guardCurrent:true,placement:'FIELD',customer:r.customer,site:'New service installation',address:'A different verified service address',point:null,coordinateSource:null,observedAt:'2026-10-13T18:20:00Z'}]},at);
  // Use a non-placement manual record: this tests address conflict independently
  // of the separate whole-group Owner mutation guard.
  changed.inventoryItems[0].placementSource='mhelpdesk';changed.inventoryItems[0].mhelpObservedAt='2026-10-13T18:20:00Z';
  const result=projectMhelpUploadPlacement(changed,receipt([r]),[],undefined,at,{validatedLocationProofs:new Map([[tracker,p]])});assert.equal(result.snapshot.inventoryItems[0].latitude,null,kind+' old pin must not return');
 }
});
test('exact customer-and-site composite supports the same ProductId; no loose colon or fuzzy match',()=>{
 const r=record();r.placement='FIELD';r.customer='Synthetic Builder: Exact Service Site';const p=locationProof('address_estimate');p.customer='Synthetic Builder';p.site='Exact Service Site';
 assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,30);
 p.site='Different Service Site';assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
 p.site='Exact Service Site';p.productId='999';assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
});
test('real-style owner proof without placementEvidence retains original Owner observation separately from upload receipt',()=>{
 const r=record();r.placement='FIELD';r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};const p=locationProof('address_estimate');p.ownerPlacementFields={placementSource:'owner',placementAuditId:'17',placementUpdatedAt:'2026-10-01T12:00:00Z'};
 const u=preservedProject(r,p).snapshot.inventoryItems[0];assert.equal(u.placementEvidence.source,'owner');assert.equal(u.placementEvidence.observedAt,'2026-10-01T12:00:00Z');assert.equal(u.uploadPlacementEvidence.observedAt,cutoff);
});
test('actual validated Owner estimate with an existing address_changed flag remains eligible through upload',async()=>{
 const address='123 Main St, Houston, TX 77002',auditAt='2026-10-01T12:00:00Z';
 const owner={...row(),placement:'FIELD',placementSource:'owner',placementAuditId:'17',placementUnitKey:'Sniper 2 017',placementUpdatedAt:auditAt,status:'field',currentLocationType:'field',address,customer:null,site:'Synthetic installation',latitude:null,longitude:null,hasUnitGps:false,locationVerification:'address_changed',locationGeocode:{status:'success',auditId:'17',unitKey:'Sniper 2 017',provider:'us_census_address_range',benchmark:'Public_AR_Current',matchedAddress:address,geocodedAt:'2026-10-02T12:00:00Z',latitude:30,longitude:-95,addressSha256:createHash('sha256').update(address.toLowerCase()).digest('hex')}};
 const before=snapshot(owner),proofs=await validatedLocationProofs(before,now);assert.equal(proofs.get(tracker)?.kind,'address_estimate');
 const r=record();r.placement='FIELD';r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};
 const result=projectMhelpUploadPlacement(before,receipt([r]),[],undefined,now,{validatedLocationProofs:proofs}),after=result.snapshot.inventoryItems[0];assert.ok(await checkedAddressEstimate(after,now));assert.equal(after.placementUpdatedAt,auditAt);assert.equal(after.locationGeocode.geocodedAt,'2026-10-02T12:00:00Z');assert.equal(after.locationVerification,'address_changed');
});
test('same CustomerId cannot preserve a pin at an explicitly changed site',()=>{
 const r=record();r.placement='FIELD';r.customer='Synthetic Company: Site B';r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};
 for(const customer of ['Synthetic Company: Site B','Synthetic Company:Site B','Synthetic Company : Site B'])for(const kind of ['owner_verified','address_estimate']){
  r.customer=customer;const p=locationProof(kind);p.customer='Synthetic Company';p.site='Site A';
  assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null,customer);
  p.originalAssignment={unitId:tracker,unitNumber:r.unitNumber,customer:'Synthetic Company',site:'Site A'};p.customer='Site A';
  assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null,customer);
 }
});
test('exact original assignment retains a validated Owner estimate without inventing a ProductId in its geocode ledger',()=>{
 const r=record();r.placement='FIELD';r.customer='Synthetic Company: Exact Service Site';const p=locationProof('address_estimate');p.productId=null;p.customer='Exact Service Site';p.site='Exact Service Site';p.ownerPlacementFields={placementSource:'owner',placementAuditId:'17',placementUpdatedAt:'2026-10-01T12:00:00Z'};
 assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
 p.originalAssignment={unitId:tracker,unitNumber:r.unitNumber,customer:'Synthetic Company',site:'Exact Service Site'};
 const after=preservedProject(r,p).snapshot.inventoryItems[0];assert.equal(after.latitude,30);assert.equal(after.site,'Exact Service Site');assert.equal(after.placementSource,'owner');
 p.originalAssignment.unitId=other;assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
 p.originalAssignment.unitId=tracker;p.originalAssignment.unitNumber='Sniper 4 017';assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
 p.originalAssignment.unitNumber=r.unitNumber;p.originalAssignment.site='Different Site';assert.equal(preservedProject(r,p).snapshot.inventoryItems[0].latitude,null);
});
test('confirmed saved assignment movement defeats old proof, but not a later validated Owner installation',()=>{
 const r=record();r.placement='FIELD';r.binding.previousAssignment={productId:'101',customerId:r.customerId,placement:'FIELD'};
 const marker={contract:'COS_MHELP_ASSIGNMENT_CHANGE_V1',unitId:tracker,unitNumber:r.unitNumber,observedAt:'2026-10-03T12:00:00Z',reason:'customer_or_service_location_changed'};
 for(const reason of ['customer_or_service_location_changed','assignment_change_status_unavailable'])for(const kind of ['owner_verified','address_estimate']){
  marker.reason=reason;const p=locationProof(kind);p.ownerPlacementFields=kind==='address_estimate'?{placementSource:'owner',placementAuditId:'17',placementUpdatedAt:'2026-10-01T12:00:00Z'}:null;
  assert.equal(preservedProject(r,p,{mhelpAssignmentChange:marker}).snapshot.inventoryItems[0].latitude,null);
  assert.equal(preservedProject(r,p,{mhelpAssignmentChange:{...marker,observedAt:'2026-09-30T12:00:00Z'}}).snapshot.inventoryItems[0].latitude,30);
  assert.equal(preservedProject(r,p,{mhelpAssignmentChange:{...marker,observedAt:null}}).snapshot.inventoryItems[0].latitude,null);
  assert.equal(preservedProject(r,p,{mhelpAssignmentChange:{...marker,unitId:other}}).snapshot.inventoryItems[0].latitude,30);
 }
});
test('protected older Owner/GPS rows cannot conceal a later confirmed API assignment from the older upload',()=>{
 const r=record();r.placement='FIELD';const old='2026-10-01T12:00:00Z',newer='2026-10-13T18:30:00Z';
 for(const placement of ['FIELD','SHOP'])for(const protection of [{placementSource:'owner',placementUpdatedAt:old},{hasUnitGps:true,gpsRecordedAt:old}]){
  const original=snapshot({...row(),...protection}),api={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[{trackerId:tracker,trackerLabel:r.unitNumber,nativeUnitId:null,nativeLabel:null,state:'confirmed',guardCurrent:true,placement,customerLabel:r.customer,siteLabel:'Synthetic installation',locationReview:false,assignmentChanged:false,observedAt:newer}]};
  const projected=projectMhelpFieldPlacement(original,api,[],undefined,now);
  assert.equal(projected.inventoryItems[0].mhelpConfirmedAssignment?.observedAt,newer);
  const after=projectMhelpUploadPlacement(projected,receipt([r]),[],undefined,now);
  assert.equal(after.authorities.length,0);assert.equal(after.snapshot.uploadInventory.records[0].binding.state,'linked');assert.equal(after.snapshot.uploadInventory.records[0].binding.reason,placement==='FIELD'?'newer_source_assignment':'newer_or_undated_source_assignment');assert.equal(after.snapshot.uploadInventory.records[0].binding.placementHeld,placement!=='FIELD');assert.deepEqual(after.snapshot.inventoryItems,projected.inventoryItems);
 }
});
test('source-observation precedence requires an exact marker and safely holds undated matching evidence',()=>{
 const r=record(),marker={contract:'COS_MHELP_CONFIRMED_ASSIGNMENT_V1',unitId:tracker,unitNumber:r.unitNumber,observedAt:null,placement:'FIELD'};
 assert.equal(project(snapshot({...row(),mhelpConfirmedAssignment:marker}),receipt([r])).authorities.length,0);
 assert.equal(project(snapshot({...row(),mhelpConfirmedAssignment:{...marker,observedAt:cutoff}}),receipt([r])).authorities.length,0);
 assert.equal(project(snapshot({...row(),placementSource:'mhelpdesk',mhelpObservedAt:cutoff}),receipt([r])).authorities.length,0);
 for(const patch of [{unitId:other},{unitNumber:'Sniper 4 017'},{contract:'untrusted'},{observedAt:'2026-10-13T18:00:00Z'}])assert.equal(project(snapshot({...row(),mhelpConfirmedAssignment:{...marker,...patch}}),receipt([r])).authorities.length,1);
});
test('genuinely later Owner and manual location evidence remains protected from both older upload and source marker',()=>{
 const r=record(),marker={contract:'COS_MHELP_CONFIRMED_ASSIGNMENT_V1',unitId:tracker,unitNumber:r.unitNumber,observedAt:'2026-10-13T18:30:00Z',placement:'SHOP'};
 for(const protection of [{placementSource:'owner',placementUpdatedAt:'2026-10-13T18:40:00Z'},{hasUnitGps:true,gpsRecordedAt:'2026-10-13T18:40:00Z'}]){
  const after=project(snapshot({...row(),...protection,mhelpConfirmedAssignment:marker}),receipt([r]));assert.equal(after.authorities.length,0);assert.equal(after.snapshot.uploadInventory.records[0].binding.placementHeld,false);assert.notEqual(after.snapshot.uploadInventory.records[0].binding.reason,'newer_or_undated_source_assignment');
 }
 const after=project(snapshot({...row(),placementSource:'owner',placementUpdatedAt:'2026-10-13T18:25:00Z',mhelpConfirmedAssignment:marker}),receipt([r]));assert.equal(after.snapshot.uploadInventory.records[0].binding.placementHeld,true);
});
test('a later Owner representation protects its complete identity group regardless of target ordering',()=>{
 const r=record();r.binding.nativeUnitId=native;r.binding.nativeLabel=r.unitNumber;
 const marker={contract:'COS_MHELP_CONFIRMED_ASSIGNMENT_V1',unitId:tracker,unitNumber:r.unitNumber,observedAt:'2026-10-13T18:30:00Z',placement:'SHOP'};
 const before=snapshot({...row(),mhelpConfirmedAssignment:marker});before.inventoryItems.push({...row(),id:native,readOnly:false,placementSource:'owner',placementUpdatedAt:'2026-10-13T18:40:00Z'});
 const after=project(before,receipt([r]));assert.equal(after.authorities.length,0);assert.equal(after.snapshot.uploadInventory.records[0].binding.reason,'newer_or_undated_owner_placement');assert.equal(after.snapshot.uploadInventory.records[0].binding.placementHeld,false);
});
test('newer exact API agreement protects confirmed Field from a contradictory older upload without inventing unknown placement',()=>{
 const r=record(),old='2026-10-01T12:00:00Z',newer='2026-10-13T18:30:00Z';
 for(const protection of [{placementSource:'owner',placementUpdatedAt:old},{hasUnitGps:true,gpsRecordedAt:old}])for(const assignmentChanged of [false,true,undefined]){
  const before=snapshot({...row(),...protection}),api={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[{trackerId:tracker,trackerLabel:r.unitNumber,nativeUnitId:null,nativeLabel:null,state:'confirmed',guardCurrent:true,placement:'FIELD',customerLabel:r.customer,siteLabel:'Synthetic installation',locationReview:assignmentChanged!==false,assignmentChanged,observedAt:newer}]};
  const current=projectMhelpFieldPlacement(before,api,[],undefined,now),after=projectMhelpUploadPlacement(current,receipt([r]),[],undefined,now);
  assert.equal(after.authorities.length,0);assert.equal(after.snapshot.inventoryItems[0].placement,'FIELD');assert.equal(after.snapshot.uploadInventory.records[0].binding.state,'linked');assert.equal(after.snapshot.uploadInventory.records[0].binding.placementHeld,assignmentChanged!==false);
 }
});
test('a newer failed review timestamp never outranks independently reviewed upload assignment',()=>{
 const r=record();for(const placement of ['UNKNOWN','FIELD']){
  const after=project(snapshot({...row(),placement,placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T18:45:00Z',placementEvidence:{state:'review',observedAt:'2026-10-13T18:45:00Z'}}),receipt([r]));assert.equal(after.authorities.length,1);assert.equal(after.snapshot.inventoryItems[0].placement,'SHOP');
 }
});
