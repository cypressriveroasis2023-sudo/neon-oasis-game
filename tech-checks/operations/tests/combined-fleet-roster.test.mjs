import test from 'node:test';import assert from 'node:assert/strict';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {projectCurrentTrackerPlacement,projectCombinedFleetRoster} from '../../supabase/functions/cos-operations-pages/combinedFleetRoster.ts';
import {readRecordedRoster} from '../src/fleetRecordedRoster.ts';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {snapshot as health,resource} from './fixtures/camera-evidence-fixtures.mjs';
const now=Date.parse('2026-10-13T19:00:00Z'),cutoff='2026-10-13T18:22:00Z',sha='a'.repeat(64),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const unit=(n,extra={})=>({id:id(n),unitNumber:'Sniper '+n,placement:'FIELD',status:'field',latitude:null,longitude:null,readOnly:false,...extra});
const product=(n,ids=[],extra={})=>({productId:String(n),unitNumber:'Sniper '+n,category:'Snipers',customerId:'11',customer:'Synthetic customer',sourceAddress:{},sourceRow:n+1,placement:'FIELD',lifecycle:'UNFLAGGED',binding:ids.length?{productId:String(n),trackerId:ids[1]?id(ids[1]):null,trackerLabel:ids[1]?'Sniper '+ids[1]:null,nativeUnitId:id(ids[0]),nativeLabel:'Sniper '+ids[0],fullLabel:'Sniper '+n,matchMethod:'reviewed_product_id',evidenceSha256:sha,expectedGuard:sha,guardCurrent:true}:null,...extra});
const tracker=(n,ids=[],extra={})=>({recordId:'tracker_row:'+n,unitNumber:'Sniper '+n,category:'Snipers',customer:'Synthetic tracker',site:'Synthetic site',placement:'FIELD',lifecycle:'ACTIVE',matchedProductId:null,binding:{state:ids.length?'linked':'unlinked',unitIds:ids.map(id),unitLabels:Object.fromEntries(ids.map(x=>[id(x),'Sniper '+x])),guardCurrent:true},...extra});
function combined(units,products,trackers=[],audits=[]){
 const input={items:units.filter(r=>r.placement==='FIELD'),inventoryItems:units,generatedAt:cutoff,summary:{fieldUnits:units.filter(r=>r.placement==='FIELD').length,mappedUnits:0,unitGps:0,missingGps:units.length}};
 const receipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha,payloadSha256:'b'.repeat(64),receivedAt:cutoff,receivedAtPrecision:'minute',exportAsOf:null,records:products,trackerRecords:trackers,trackerSource:{contract:'COS_CURRENT_TRACKER_CENSUS_V1',complete:true,sourceSha256:'c'.repeat(64),observedAt:'2026-10-13T18:13:00Z',totalSourceRecords:trackers.length}};
 const applied=projectMhelpUploadPlacement(input,receipt,audits,undefined,now),current=projectCurrentTrackerPlacement(applied.snapshot,audits),effective=projectEffectiveFleetPlacement(current,audits,{authorizedUploadPlacements:applied.authorities});
 return projectCombinedFleetRoster(effective,audits);
}
test('one proven ProductId collapses tracker/native representations while source-only rows remain health-unlinked',()=>{
 const result=combined([unit(1),unit(2,{readOnly:true})],[product(1,[1,2]),product(3)]);
 assert.equal(result.fleetRoster.summary.field,2);assert.equal(result.inventoryItems.length,1);assert.equal(result.items.length,1);assert.equal(result.fleetRoster.items[1].unitId,null);assert.equal(result.fleetRoster.items[1].id,'mhelp_product:3');assert.deepEqual(result.fleetRoster.items[0].representedUnitIds,[id(2),id(1)]);assert.equal(readRecordedRoster(result.fleetRoster).error,null);
 assert.equal(reconcileFleetSnapshot(health([resource(1)]),result,now).fieldMap.items.length,1);
});
test('uncertain registry candidates form one explicit identity review group with recorded assignment',()=>{
 const p=product(1,[],{possibleAliasUnitIds:[id(1),id(2)],holdReason:'multiple_registry_candidates'});const result=combined([unit(1),unit(2)],[p]);assert.equal(result.fleetRoster.summary.field,0);assert.equal(result.fleetRoster.summary.review,1);assert.equal(result.fleetRoster.items[0].kind,'identity_review');assert.equal(result.fleetRoster.items[0].recordedSourcePlacement,'field');assert.equal(readRecordedRoster(result.fleetRoster).error,null);assert.equal(result.items.length,0);assert.equal(result.inventoryItems.length,0);
});
test('actual unresolved source alias holds one source count and suppresses its possible duplicate',()=>{
 const result=combined([unit(1)],[product(1,[],{possibleAliasUnitIds:[id(1)],placementHeld:true,holdReason:'unresolved_source_alias'})]);assert.equal(result.fleetRoster.summary.field,0);assert.equal(result.fleetRoster.summary.review,1);assert.equal(result.fleetRoster.items.length,1);
});
test('current tracker-only records fill source gaps and lifecycle exclusions survive all projections',()=>{
 const result=combined([unit(2),unit(3)],[product(1)], [tracker(2,[2],{placement:'SHOP'}),tracker(3,[3],{placement:'UNKNOWN',lifecycle:'DECOMMISSIONED'}),tracker(4)]);
 assert.equal(result.fleetRoster.summary.field,2);assert.equal(result.fleetRoster.summary.shop,1);assert.equal(result.fleetRoster.summary.excludedLifecycle,1);assert.equal(result.items.length,0);assert.equal(result.inventoryItems.find(r=>r.id===id(3)).activeInventoryEligible,false);assert.equal(readRecordedRoster(result.fleetRoster).error,null);
});
test('saved-only registry becomes review but newer Owner history remains current and wins a bound group',()=>{
 const old=unit(8),owner=unit(9,{placement:'SHOP',placementSource:'owner',placementAuditId:'audit9',placementUpdatedAt:'2026-10-13T18:30:00Z'});const result=combined([old,owner],[product(1)]);
 assert.equal(result.inventoryItems.find(r=>r.id===old.id).placement,'UNKNOWN');assert.equal(result.inventoryItems.find(r=>r.id===owner.id).placement,'SHOP');assert.equal(result.fleetRoster.summary.field,1);assert.equal(result.fleetRoster.summary.shop,1);
 const bound=combined([unit(1),unit(2,{readOnly:true,placement:'SHOP',placementSource:'owner',placementAuditId:'audit2',placementUpdatedAt:'2026-10-13T18:30:00Z'})],[product(1,[1,2])]);assert.equal(bound.fleetRoster.summary.field,0);assert.equal(bound.fleetRoster.summary.shop,1);assert.equal(bound.inventoryItems[0].id,id(2));
});
test('tracker observation cannot supersede Owner placement or clear a historical ROOT concern',()=>{
 const u=unit(2),audits=[{unit_key:u.unitNumber,action:'MOVE_TO_ROOT',created_at:'2026-09-30T08:00:00Z'}];const result=combined([u],[product(1)],[tracker(2,[2])],audits);assert.equal(result.inventoryItems[0].placement,'UNKNOWN');assert.equal(result.fleetRoster.summary.review,1);
});
test('DNU and missing Field product records are shown only in excluded lifecycle and never active membership',()=>{
 for(const lifecycle of ['DO_NOT_USE','MISSING']){const result=combined([unit(1)],[product(1,[1],{lifecycle})]);assert.equal(result.fleetRoster.summary.field,0);assert.equal(result.fleetRoster.summary.excludedLifecycle,1);assert.equal(result.items.length,0);assert.equal(result.inventoryItems[0].placement,'FIELD');assert.equal(readRecordedRoster(result.fleetRoster).error,null);}
});
test('duplicate source/registry claims and missing primary ProductIds fail closed',()=>{
 assert.throws(()=>combined([unit(1)],[product(1,[1])],[tracker(2,[1])]),/Conflicting combined/);
 assert.throws(()=>combined([unit(1)],[product(1)],[tracker(2,[1],{matchedProductId:'999'})]),/unavailable primary/);
 const snap=combined([unit(1)],[product(1)]);snap.uploadInventory.trackerSource.complete=false;assert.throws(()=>projectCombinedFleetRoster(snap,[]),/Incomplete/);
});

test('possible alias cannot suppress a newer Owner or verified GPS unit; source assignment stays visibly held',()=>{
 for(const extra of [{placement:'SHOP',placementSource:'owner',placementAuditId:'move1',placementUpdatedAt:'2026-10-13T18:30:00Z'},{placement:'SHOP',hasUnitGps:true,gpsRecordedAt:'2026-10-13T18:30:00Z'}]){
 const result=combined([unit(1,extra)],[product(1,[],{possibleAliasUnitIds:[id(1)],holdReason:'multiple_registry_candidates'})]);
 assert.equal(result.inventoryItems.length,1);assert.equal(result.inventoryItems[0].placement,'SHOP');assert.equal(result.fleetRoster.summary.field,0);assert.equal(result.fleetRoster.summary.shop,1);assert.equal(result.fleetRoster.summary.review,1);assert.equal(result.fleetRoster.items[0].kind,'identity_review');
 }
});

test('resumed newer primary MHelp and verified native locations survive frozen census gaps',()=>{
 for(const extra of [{placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T18:50:00Z'},{placementSource:'mhelpdesk_upload',placementEvidence:{source:'owner_supplied_mhelp_export',observedAt:'2026-10-13T18:50:00Z'}},{hasUnitGps:true,gpsRecordedAt:'2026-10-12T18:00:00Z'},{installedSiteId:id(8)}]){
 const result=combined([unit(2,{placement:'SHOP',...extra})],[product(1)]);assert.equal(result.inventoryItems[0].placement,'SHOP');
 const withTracker=combined([unit(2,{placement:'SHOP',...extra})],[product(1)],[tracker(2,[2])]);assert.equal(withTracker.inventoryItems[0].placement,'SHOP');
 }
});

test('primary API observation newer than tracker read wins even if upload was received later',()=>{
 const result=combined([unit(2,{placement:'FIELD',placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T18:15:00Z'})],[product(1)],[tracker(2,[2],{placement:'SHOP'})]);assert.equal(result.inventoryItems[0].placement,'FIELD');
});

test('blocked older tracker lifecycle never deactivates a newer primary-source unit',()=>{
 const result=combined([unit(2,{placement:'FIELD',placementSource:'mhelpdesk',mhelpObservedAt:'2026-10-13T18:15:00Z'})],[product(1)],[tracker(2,[2],{placement:'UNKNOWN',lifecycle:'DECOMMISSIONED'})]);
 const record=result.fleetRoster.items.find(r=>r.unitId===id(2));assert.equal(record.active,true);assert.equal(record.lifecycle,'active');assert.equal(record.source,'recorded_inventory');assert.equal(result.fleetRoster.summary.field,2);assert.equal(result.items.length,1);
});

test('equal or undated conflicting Owner representations never fall back to uploaded Field assignment',()=>{
 for(const placementUpdatedAt of ['2026-10-13T18:30:00Z',null]){
 const result=combined([unit(1,{placement:'FIELD',placementSource:'owner',placementAuditId:'a',placementUpdatedAt}),unit(2,{placement:'SHOP',placementSource:'owner',placementAuditId:'b',placementUpdatedAt,readOnly:true})],[product(1,[1,2])]);
 assert.equal(result.fleetRoster.summary.field,0);assert.equal(result.fleetRoster.summary.review,1);assert.equal(result.fleetRoster.items[0].kind,'identity_review');assert.equal(result.fleetRoster.items[0].candidatePlacements.length,2);assert.equal(result.inventoryItems.length,0);
 }
});

test('tracker exact reviewed-visible membership rejects missing and newly appearing representations',()=>{
 const t=tracker(2,[2,3]);t.binding.representedUnitIds=[id(2),id(3)];
 const missing=combined([unit(2)],[product(1)],[t]);assert.equal(missing.inventoryItems[0].placement,'UNKNOWN');assert.match(missing.inventoryItems[0].placementReviewReason,/revalidation/);
 t.binding.representedUnitIds=[id(2)];const appeared=combined([unit(2),unit(3,{readOnly:true})],[product(1)],[t]);assert(appeared.inventoryItems.every(r=>r.placement==='UNKNOWN'));
 const hidden=combined([unit(2)],[product(1)],[t]);assert.equal(hidden.inventoryItems[0].placement,'FIELD');assert.equal(hidden.fleetRoster.items.filter(r=>r.source==='current_tracker').length,1);
});

test('actual protected-source chronology holds older upload, tracker, saved and ambiguous populations without freshening Owner evidence',()=>{
 const old='2026-10-12T10:00:00Z',later='2026-10-13T18:40:00Z';
 const projected=(row,observedAt,placement='SHOP',assignmentChanged=true)=>projectMhelpFieldPlacement({items:[row],inventoryItems:[row],summary:{fieldUnits:1}},{contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[{trackerId:row.id,trackerLabel:row.unitNumber,nativeUnitId:null,nativeLabel:null,state:'confirmed',guardCurrent:true,placement,customerLabel:'Synthetic customer',siteLabel:'Synthetic site',locationReview:assignmentChanged,assignmentChanged,observedAt}]},[{unit_key:row.unitNumber,action:'MOVE_TO_FIELD',created_at:old}],undefined,now).inventoryItems[0];
 for(const extra of [{placementSource:'owner',placementAuditId:'a',placementUpdatedAt:old},{hasUnitGps:true,gpsRecordedAt:old}])for(const placement of ['FIELD','SHOP'])for(const observedAt of [cutoff,'2026-10-13T18:30:00Z']){
  const row=projected(unit(2,extra),observedAt,placement),copy=structuredClone(row);
  const bound=combined([row],[product(2,[2])]);assert.equal(bound.fleetRoster.summary.field,0);assert.equal(bound.fleetRoster.summary.shop,0);assert.equal(bound.fleetRoster.summary.review,1);assert.equal(bound.items.length,0);
  for(const trackers of [[],[tracker(2,[2],{placement:'SHOP',lifecycle:'DECOMMISSIONED'})]]){
   const result=combined([row],[product(1)],trackers),retained=result.inventoryItems.find(r=>r.id===row.id);assert.equal(retained.placement,'UNKNOWN');assert.equal(retained.latitude,null);assert.match(retained.effectivePlacement.reason,/newer confirmed/);assert.notEqual(retained.effectivePlacement.observedAt,observedAt);assert.equal(result.fleetRoster.items.find(r=>r.unitId===row.id).active,true);
  }
  const candidate=combined([row],[product(1,[],{possibleAliasUnitIds:[row.id],holdReason:'multiple_registry_candidates'})]);assert.equal(candidate.fleetRoster.summary.field,0);assert.equal(candidate.fleetRoster.summary.shop,0);assert.equal(candidate.fleetRoster.summary.review,2);assert.equal(readRecordedRoster(candidate.fleetRoster).error,null);assert.deepEqual(row,copy);
 }
 const olderTracker=projected(unit(2,{placementSource:'owner',placementAuditId:'a',placementUpdatedAt:old}),'2026-10-13T18:15:00Z');assert.equal(combined([olderTracker],[product(1)],[tracker(2,[2])]).inventoryItems[0].placement,'UNKNOWN');
 const newerOwner=projected(unit(2,{placement:'SHOP',placementSource:'owner',placementAuditId:'a',placementUpdatedAt:later}),'2026-10-13T18:30:00Z');const result=combined([newerOwner],[product(2,[2])]);assert.equal(result.fleetRoster.summary.shop,1);assert.equal(result.inventoryItems[0].effectivePlacement.observedAt,later);
 for(const extra of [{placementSource:'owner',placementAuditId:'a',placementUpdatedAt:old},{hasUnitGps:true,gpsRecordedAt:old}]){
  const agreed=projected(unit(2,extra),'2026-10-13T18:30:00Z','FIELD',false);
  for(const [products,trackers] of [[[product(2,[2],{placement:'SHOP'})],[]],[[product(1)],[tracker(2,[2],{placement:'SHOP'})]],[[product(1)],[]]]){
   const result=combined([agreed],products,trackers),retained=result.inventoryItems.find(r=>r.id===agreed.id);assert.equal(retained.placement,'FIELD');assert.equal(retained.effectivePlacement.observedAt,extra.placementUpdatedAt||null);assert.equal(retained.hasUnitGps,extra.hasUnitGps);
  }
 }
});

test('missing or failed fresh identity guards cannot establish API assignment or defeat reviewed upload',()=>{
 for(const guardCurrent of [false,undefined]){
  const row=unit(2,{placement:'SHOP'}),input={items:[],inventoryItems:[row],summary:{fieldUnits:0}},receipt={contract:'COS_MHELP_PLACEMENT_V1',enabled:true,items:[{trackerId:row.id,trackerLabel:row.unitNumber,nativeUnitId:null,nativeLabel:null,state:'confirmed',guardCurrent,placement:'FIELD',customerLabel:'Synthetic customer',siteLabel:'Synthetic site',locationReview:false,assignmentChanged:false,observedAt:'2026-10-13T18:45:00Z'}]};
  const saved=projectMhelpFieldPlacement(input,receipt,[],undefined,now).inventoryItems[0];assert.equal(saved.placement,'UNKNOWN');assert.equal(saved.mhelpConfirmedAssignment,undefined);
  const result=combined([saved],[product(2,[2],{placement:'SHOP'})]);assert.equal(result.fleetRoster.summary.shop,1);assert.equal(result.fleetRoster.summary.review,0);
 }
});
