import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEffectiveFleetPlacement} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {projectMhelpUploadPlacement} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectMhelpFieldPlacement} from '../../supabase/functions/cos-operations-pages/mhelpPlacementProjection.ts';
import {inventoryPlacement,reconcileFleetSnapshot} from '../src/fleetSnapshot.ts';
import {snapshot as health,resource,now,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const unit=(n,patch={})=>({id:id(n),unitNumber:'Helios '+n,status:'field',readOnly:false,currentLocationType:null,latitude:null,longitude:null,...patch});
const map=rows=>({inventoryItems:rows,items:rows.filter(r=>!['SHOP','UNKNOWN'].includes(r.placement)),generatedAt:fresh,summary:{fieldUnits:rows.filter(r=>!['SHOP','UNKNOWN'].includes(r.placement)).length,mappedUnits:0,unitGps:0,missingGps:rows.length}});
const link=(u,patch={})=>({trackerId:id(999),nativeUnitId:u.id,trackerLabel:u.unitNumber,nativeLabel:u.unitNumber,guardCurrent:true,state:'confirmed',placement:'FIELD',customerLabel:'Synthetic builder',siteLabel:'Synthetic job',locationReview:false,observedAt:new Date(now-3*3600000).toISOString(),...patch});
const receipt=r=>({contract:'COS_MHELP_PLACEMENT_V1',enabled:true,lastSuccessAt:r.observedAt,errorCode:'source_rate_limited',lastAttemptAt:fresh,items:[r]});
test('final effective placement fills safe missing fields and partitions one unique roster',()=>{
 const rows=[unit(1),unit(2,{placement:'SHOP'}),unit(3,{placement:'UNKNOWN'})];const result=projectEffectiveFleetPlacement(map(rows),[]);
 assert.deepEqual(result.placementSummary,{totalUnits:3,fieldUnits:1,shopUnits:1,reviewUnits:1,excludedLifecycleUnits:0});assert.equal(result.items[0].id,rows[0].id);assert.equal(inventoryPlacement(result.items[0]),'field');assert.equal(result.items[0].effectivePlacement.freshness,'recorded');assert.equal(result.items[0].effectivePlacement.observedAt,null);assert.equal(rows[0].currentLocationType,null);
});
test('forty-three safe missing placements return while five historical ROOT concerns remain review',()=>{
 const rows=Array.from({length:48},(_,i)=>unit(i+1));const audits=rows.slice(-5).map(r=>({unit_key:r.unitNumber,action:'MOVE_TO_ROOT'}));const result=projectEffectiveFleetPlacement(map(rows),audits);
 assert.equal(result.placementSummary.fieldUnits,43);assert.equal(result.placementSummary.reviewUnits,5);assert(result.inventoryItems.slice(-5).every(r=>r.placementStatus==='needs_identity_review'));
});
test('a prior ROOT concern is superseded only by explicit Owner projection or exact reviewed source binding',()=>{
 const u=unit(1),binding={nativeUnitId:u.id,unitNumber:u.unitNumber,sourcePrecedence:{decisionId:'synthetic'}},audits=[{unit_key:u.unitNumber,action:'MOVE_TO_ROOT'}];
 assert.equal(projectEffectiveFleetPlacement(map([{...u,importedInstallation:binding}]),audits).items.length,0);
 assert.equal(projectEffectiveFleetPlacement(map([{...u,importedInstallation:binding}]),audits,{confirmedPrecedenceBindings:[binding]}).items.length,1);
 assert.equal(projectEffectiveFleetPlacement(map([{...u,placementSource:'owner',placementAuditId:'1',placement:'FIELD'}]),audits).items.length,1);
 assert.equal(projectEffectiveFleetPlacement(map([{...u,placement:'UNKNOWN',placementReviewReason:'Identity conflict'}]),audits,{confirmedPrecedenceBindings:[binding]}).items.length,0);
});
test('stale location clearing preserves separately revalidated placement precedence for the exact unit',()=>{
 const u=unit(1),binding={nativeUnitId:u.id,unitNumber:u.unitNumber,sourcePrecedence:{decisionId:'synthetic'}},audits=[{unit_key:u.unitNumber+'HDC2',action:'MOVE_TO_ROOT'}];
 const current={...u,currentLocationType:'field',importedInstallation:binding};
 for(const patch of [{state:'confirmed'},{state:'held',placement:null,reason:'service_location_unverified'}]){
  const stale=projectMhelpFieldPlacement(map([current]),receipt(link(current,patch)),audits,undefined,now);
  assert.equal(stale.inventoryItems[0].importedInstallation,null);assert.deepEqual(stale.inventoryItems[0].placementPrecedenceBinding,binding);
  assert.equal(projectEffectiveFleetPlacement(stale,audits,{confirmedPrecedenceBindings:[binding]}).items.length,1);
  assert.equal(projectEffectiveFleetPlacement(stale,audits).items.length,0);
  assert.equal(stale.inventoryItems[0].latitude,null);
 }
 const borrowed={...unit(2),placementPrecedenceBinding:binding};assert.equal(projectEffectiveFleetPlacement(map([borrowed]),[{unit_key:borrowed.unitNumber,action:'MOVE_TO_ROOT'}],{confirmedPrecedenceBindings:[binding]}).items.length,0);
});
test('duplicate IDs and missing authoritative membership fail closed instead of multiplying units',()=>{
 const u=unit(1);assert.throws(()=>projectEffectiveFleetPlacement(map([u,u]),[]),/identities/);assert.throws(()=>projectEffectiveFleetPlacement({...map([u]),items:[unit(2)]},[]),/membership/);
 const h=health([resource(1)]);assert.throws(()=>reconcileFleetSnapshot(h,{...map([u]),inventoryItems:[u,u]},now),/duplicate/);
});
test('only exact separately validated upload authority supersedes older ROOT, never metadata or identity conflicts',()=>{
 const u=unit(1,{placement:'FIELD',placementSource:'mhelpdesk_upload'}),authority={unitId:u.id,unitNumber:u.unitNumber,placement:'FIELD',productId:'123',sourceSha256:'a'.repeat(64),observedAt:fresh,source:'owner_supplied_mhelp_export'};
 const row={...u,placementEvidence:{source:authority.source,sourceSha256:authority.sourceSha256,productId:authority.productId,observedAt:fresh,state:'recorded',fresh:false}},audits=[{unit_key:u.unitNumber,action:'MOVE_TO_ROOT'}];
 assert.equal(projectEffectiveFleetPlacement(map([row]),audits).items.length,0);
 assert.equal(projectEffectiveFleetPlacement(map([row]),audits,{authorizedUploadPlacements:[authority]}).items.length,1);
 for(const patch of [{productId:'124'},{sourceSha256:'b'.repeat(64)},{unitId:id(2)},{unitNumber:'Helios 2'},{placement:'SHOP'}])assert.equal(projectEffectiveFleetPlacement(map([row]),audits,{authorizedUploadPlacements:[{...authority,...patch}]}).items.length,0);
 assert.equal(projectEffectiveFleetPlacement(map([row]),audits,{authorizedUploadPlacements:[authority,authority]}).items.length,0);
 for(const patch of [{productId:'124'},{placement:'SHOP'},{sourceSha256:'b'.repeat(64)}])assert.equal(projectEffectiveFleetPlacement(map([row]),audits,{authorizedUploadPlacements:[authority,{...authority,...patch}]}).items.length,0);
 assert.equal(projectEffectiveFleetPlacement(map([{...row,placementReviewReason:'Identity conflict'}]),audits,{authorizedUploadPlacements:[authority]}).items.length,0);
});
test('stale confirmed FIELD and SHOP retain exact observation times but never old active coordinates',()=>{
 for(const placement of ['FIELD','SHOP']){const u=unit(1,{latitude:29,longitude:-95,address:'Old installation',locationImportedGeocode:{status:'success'},locationSourceRecorded:{point:[29,-95]}}),r=link(u,{placement});const result=projectMhelpFieldPlacement(map([u]),receipt(r),[],undefined,now),row=result.inventoryItems[0];
  assert.equal(row.placement,placement);assert.equal(result.items.length,placement==='FIELD'?1:0);assert.equal(row.placementEvidence.fresh,false);assert.equal(row.placementEvidence.observedAt,r.observedAt);assert.equal(row.latitude,null);assert.equal(row.locationImportedGeocode,null);assert.equal(row.locationSourceRecorded,null);assert.equal(row.historicalLatitude,29);
 }
});
test('held service read reasons may retain only existing placement; absent or identity/assignment holds cannot',()=>{
 const u=unit(1,{currentLocationType:'field'});
 for(const reason of ['service_location_unverified','mhelp_location_read_unavailable',undefined,'identity_or_lifecycle_changed','equipment_missing','customer_unverified','assignment_changed']){
  const r=link(u,{state:'held',placement:null,reason}),row=projectMhelpFieldPlacement(map([u]),receipt(r),[],undefined,now).inventoryItems[0];
  assert.equal(row.placement,['service_location_unverified','mhelp_location_read_unavailable'].includes(reason)?'FIELD':'UNKNOWN');assert.equal(row.placementEvidence.fresh,false);
 }
 const r=link(u,{state:'held',placement:null,reason:'service_location_unverified',guardCurrent:false});assert.equal(projectMhelpFieldPlacement(map([u]),receipt(r),[],undefined,now).inventoryItems[0].placement,'UNKNOWN');
 const unknown=unit(1,{placement:'UNKNOWN'});assert.equal(projectMhelpFieldPlacement(map([unknown]),receipt(link(unknown,{state:'held',placement:null,reason:'service_location_unverified'})),[],undefined,now).inventoryItems[0].placement,'UNKNOWN');
});
test('newer SHOP and protected manual installation cannot be undone by stale FIELD evidence',()=>{
 const withoutMarker=({mhelpConfirmedAssignment,...row})=>row;
 const shop=unit(1,{placement:'SHOP',placementSource:'mhelpdesk',mhelpObservedAt:fresh}),r=link(shop);assert.deepEqual(withoutMarker(projectMhelpFieldPlacement(map([shop]),receipt(r),[],undefined,now).inventoryItems[0]),shop);
 for(const protectedValue of [{placementSource:'owner'},{hasUnitGps:true},{installedSiteId:id(8)},{placementReviewReason:'Identity held'}]){const u=unit(1,protectedValue);assert.deepEqual(withoutMarker(projectMhelpFieldPlacement(map([u]),receipt(link(u)),[],undefined,now).inventoryItems[0]),u);}
 const u=unit(1),future=link(u,{observedAt:new Date(now+60000).toISOString()});assert.equal(projectMhelpFieldPlacement(map([u]),receipt(future),[],undefined,now).inventoryItems[0].placement,'UNKNOWN');
});
test('effective contract rejects partial client rosters and preserves telemetry',()=>{
 const u=unit(1),m=projectEffectiveFleetPlacement(map([u]),[]),h=health([resource(1)]),before=structuredClone(h),pair=reconcileFleetSnapshot(h,m,now);assert.deepEqual(h,before);assert.equal(pair.fieldMap.placementSummary.fieldUnits,1);
 assert.throws(()=>reconcileFleetSnapshot(h,{...m,inventoryItems:[{...m.inventoryItems[0],effectivePlacement:undefined}]},now),/placement evidence/);
});

test('uploaded inactive lifecycle survives finalizer and client reconciliation without restoring Field membership',()=>{
 for(const lifecycle of ['DO_NOT_USE','MISSING']){
 const u=unit(1),sha='a'.repeat(64),receivedAt=new Date(now-60000).toISOString();
 const upload={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:sha,payloadSha256:'b'.repeat(64),receivedAt,receivedAtPrecision:'second',exportAsOf:null,records:[{productId:'101',unitNumber:u.unitNumber,category:'Helios',customerId:'11',customer:'Synthetic',sourceAddress:{},sourceRow:2,placement:'FIELD',lifecycle,binding:{productId:'101',trackerId:null,trackerLabel:null,nativeUnitId:u.id,nativeLabel:u.unitNumber,fullLabel:u.unitNumber,matchMethod:'reviewed_product_id',evidenceSha256:sha,expectedGuard:sha,guardCurrent:true}}]};
 const applied=projectMhelpUploadPlacement(map([u]),upload,[],undefined,now);const final=projectEffectiveFleetPlacement(applied.snapshot,[],{authorizedUploadPlacements:applied.authorities});
 assert.equal(final.inventoryItems[0].placement,'FIELD');assert.equal(final.inventoryItems[0].activeInventoryEligible,false);assert.equal(final.items.length,0);assert.equal(final.placementSummary.fieldUnits,0);assert.equal(final.placementSummary.excludedLifecycleUnits,1);
 assert.equal(reconcileFleetSnapshot(health([resource(1)]),final,now).fieldMap.items.length,0);
 }
});
