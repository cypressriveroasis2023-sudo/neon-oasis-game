/** Reconcile reviewed source-equipment records with registry representations.
 * Source IDs are never camera identities, installation pins, or writable UUIDs. */
import {exactLocationProof} from './validatedLocationProofs.ts';
import {placementIdentityConcernKey} from './placementProjection.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=(v:unknown)=>typeof v==='string'&&/(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(v)?Date.parse(v.replace(/([+-]\d\d)$/,'$1:00')):NaN;
const placement=(v:unknown):'field'|'shop'|'unknown'=>['FIELD','SITE'].includes(String(v).toUpperCase())?'field':['SHOP','ROOT','YARD','WAREHOUSE'].includes(String(v).toUpperCase())?'shop':'unknown';
const life=(v:unknown)=>({UNFLAGGED:'active',ACTIVE:'active',DO_NOT_USE:'do_not_use',MISSING:'missing',RETIRED:'retired',DECOMMISSIONED:'decommissioned'}[String(v).toUpperCase()]||'active');
const newerPrimary=(row:Row,cutoff:number)=>['mhelpdesk','mhelpdesk_upload'].includes(row.placementSource)&&placement(row.placement||row.currentLocationType)!=='unknown'&&row.placementEvidence?.state!=='review'&&Math.max(time(row.mhelpObservedAt)||0,time(row.placementEvidence?.observedAt)||0)>cutoff;
const confirmedAssignment=(row:Row)=>{const c=row.mhelpConfirmedAssignment;return c?.contract==='COS_MHELP_CONFIRMED_ASSIGNMENT_V1'&&c.unitId===row.id&&c.unitNumber===row.unitNumber&&['FIELD','SHOP'].includes(c.placement)&&Number.isFinite(time(c.observedAt))&&time(c.observedAt)<=Date.now()?c:null;};
const currentSourceMarker=(row:Row,cutoff:number)=>{const c=confirmedAssignment(row);return c&&time(c.observedAt)>=cutoff?c:null;};
function unseenSourceConflict(row:Row,cutoff:number,audits:Row[],identity?:Row):boolean{
 const c=currentSourceMarker(row,cutoff);if(!c)return false;const observed=time(c.observedAt);
 if(placement(c.placement)===placement(row.placement||row.currentLocationType)&&c.assignmentChanged===false)return false;
 if(row.placementSource==='owner'&&(!Number.isFinite(time(row.placementUpdatedAt))||time(row.placementUpdatedAt)>observed)||protectedHistory(row,audits,observed+1,identity))return false;
 if(['mhelpdesk','mhelpdesk_upload'].includes(row.placementSource)&&Math.max(time(row.mhelpObservedAt)||0,time(row.placementEvidence?.observedAt)||0)>=observed)return false;
 if(time(row.uploadPlacementEvidence?.observedAt)>observed||row.hasUnitGps===true&&Math.max(time(row.gpsRecordedAt)||0,time(row.locationVerifiedAt)||0)>observed)return false;
 return true;
}
const rowLife=(r:Row)=>life(r.uploadLifecycle||r.inventoryLifecycle||(r.activeInventoryEligible===false?'RETIRED':'ACTIVE'));
function withoutPoint(row:Row):Row{return {...row,historicalLatitude:row.latitude??row.historicalLatitude??null,historicalLongitude:row.longitude??row.historicalLongitude??null,historicalCoordinateSource:row.coordinateSource??row.historicalCoordinateSource??null,latitude:null,longitude:null,coordinateSource:null,hasUnitGps:false,importedInstallation:null,locationImportedGeocode:null,locationSourceRecorded:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null,locationVerification:'coordinates_unverified',locationVerifiedAt:null,locationHistoryId:null};}
function checkedTracker(upload:Row):{source:Row;records:Row[]}|null{
 const s=upload.trackerSource,records=upload.trackerRecords;
 if(s==null&&(!Array.isArray(records)||records.length===0))return null;
 if(!object(s)||s.contract!=='COS_CURRENT_TRACKER_CENSUS_V1'||s.complete!==true||!hash(s.sourceSha256)||!Number.isFinite(time(s.observedAt))||!Array.isArray(records)||s.totalSourceRecords!==records.length||records.length>10000)throw Error('Incomplete current tracker census');
 const seen=new Set<string>(),claimed=new Map<string,string>();
 for(const r of records){
  if(!object(r)||typeof r.recordId!=='string'||!r.recordId||seen.has(r.recordId)||typeof r.unitNumber!=='string'||!r.unitNumber||!['FIELD','SHOP','UNKNOWN'].includes(r.placement)||!['ACTIVE','UNFLAGGED','UNKNOWN','DECOMMISSIONED','RETIRED','MISSING','DO_NOT_USE'].includes(r.lifecycle)||!(r.matchedProductId===null||typeof r.matchedProductId==='string'&&/^[1-9][0-9]*$/.test(r.matchedProductId)))throw Error('Invalid current tracker record');
  seen.add(r.recordId);
  const b=r.binding;
  if(!object(b)||!['linked','bound','owner_confirmed_alias','unlinked','unbound','held'].includes(b.state)||!Array.isArray(b.unitIds)||b.unitIds.some((id:unknown)=>!uuid(id))||new Set(b.unitIds).size!==b.unitIds.length||!object(b.unitLabels)||!(typeof b.guardCurrent==='boolean'||b.guardCurrent===null))throw Error('Invalid tracker registry binding');
  for(const id of b.unitIds){if(typeof b.unitLabels[id]!=='string'||claimed.has(id))throw Error('Conflicting tracker registry bindings');claimed.set(id,r.recordId);}
 }
 return {source:s,records};
}
function protectedHistory(row:Row,audits:Row[],cutoff:number,identity?:Row):boolean{
 const proofs=[...(identity?.unitIdentities||[]),...(identity?.ownerConfirmedUnitIdentities||[])].filter((p:Row)=>p.unitId===row.id);
 const keys=[row.unitNumber,...proofs.flatMap((p:Row)=>p.unitKeys||[])].map(placementIdentityConcernKey),devices=proofs.flatMap((p:Row)=>p.deviceIds||[]);
 return audits.some(a=>(a.control_id===row.id||keys.includes(placementIdentityConcernKey(a.unit_key))||Array.isArray(a.device_ids)&&a.device_ids.some((v:unknown)=>devices.includes(String(v))))&&(!Number.isFinite(time(a.created_at))||time(a.created_at)>=cutoff));
}
function trackerTargets(r:Row,byId:Map<string,Row>):Row[]{
 const b=r.binding;if(!['linked','bound','owner_confirmed_alias'].includes(b.state)||b.guardCurrent!==true)return [];
 const ids=b.representedUnitIds||b.unitIds;
 if(!Array.isArray(ids)||ids.some((id:string)=>!b.unitIds.includes(id))||new Set(ids).size!==ids.length)throw Error('Invalid tracker represented inventory');
 const present=b.unitIds.filter((id:string)=>byId.has(id));
 if(ids.length!==present.length||ids.some((id:string)=>!present.includes(id))||present.some((id:string)=>byId.get(id)!.unitNumber!==b.unitLabels[id]))return [];
 return present.map((id:string)=>byId.get(id)!);
}
/** Tracker-only placement never displaces Owner history or fresh native evidence.
 * A current spreadsheet observation is not a current installation/GPS proof. */
export function projectCurrentTrackerPlacement(snapshot:Row,audits:Row[],identity?:Row,options:{validatedLocationProofs?:Map<string,Row>}={}):Row{
 const upload=snapshot.uploadInventory;if(!upload)return snapshot;const tracker=checkedTracker(upload);if(!tracker)return snapshot;
 const byId=new Map<string,Row>(snapshot.inventoryItems.map((r:Row)=>[r.id,r])),changes=new Map<string,Row>();
 for(const r of tracker.records){
  if(r.matchedProductId!==null)continue;
  const targets=trackerTargets(r,byId);
  if(!targets.length||targets.some(row=>row.placementSource==='owner'||row.placementReviewReason||row.placementStatus==='needs_identity_review'||row.representationStatus==='conflict'||row.hasUnitGps===true||row.installedSiteId||newerPrimary(row,time(tracker.source.observedAt))||currentSourceMarker(row,time(tracker.source.observedAt))||protectedHistory(row,audits,0,identity)))continue;
  for(const row of targets){const lifecycle=life(r.lifecycle),proof=exactLocationProof(options.validatedLocationProofs,row);
   const normalize=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toLowerCase():'';
   const sameAssignment=proof&&r.placement==='FIELD'&&normalize(r.customer)&&normalize(r.customer)===normalize(proof.customer)&&normalize(r.site)===normalize(proof.site);
   changes.set(row.id,{...(sameAssignment?row:withoutPoint(row)),placement:r.placement,currentLocationType:r.placement.toLowerCase(),placementSource:'current_tracker',currentTrackerRecordId:r.recordId,inventoryLifecycle:r.lifecycle,activeInventoryEligible:lifecycle==='active',customer:r.customer||null,site:r.site||null,address:sameAssignment?row.address:null,placementEvidence:{source:'current_tracker',observedAt:tracker.source.observedAt,timestampKind:'tracker_read',state:'recorded',fresh:false,reason:'current_tracker_assignment_location_unverified'}});}
 }
 const inventoryItems=snapshot.inventoryItems.map((r:Row)=>changes.get(r.id)||r),prior=new Set(snapshot.items.map((r:Row)=>r.id));
 return {...snapshot,inventoryItems,items:inventoryItems.filter((r:Row)=>changes.has(r.id)?r.placement==='FIELD'&&r.activeInventoryEligible!==false:prior.has(r.id))};
}
function preferred(rows:Row[]):Row|null{
 if(!rows.length)return null;
 const owners=rows.filter(r=>r.placementSource==='owner');if(owners.length===1)return owners[0];
 if(owners.length>1){const ordered=owners.sort((a,b)=>time(b.placementUpdatedAt)-time(a.placementUpdatedAt));if(Number.isFinite(time(ordered[0].placementUpdatedAt))&&time(ordered[0].placementUpdatedAt)>time(ordered[1].placementUpdatedAt))return ordered[0];return null;}
 const native=rows.filter(r=>r.readOnly!==true);if(native.length===1)return native[0];return rows.length===1?rows[0]:null;
}
/** Call after the final placement projection. Canonical UUID inventory and Field
 * membership are rebuilt from the same roster; source-only records stay separate. */
export function projectCombinedFleetRoster(snapshot:Row,audits:Row[],identity?:Row):Row{
 const upload=snapshot.uploadInventory;if(!upload)return snapshot;
 if(upload.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'||!Array.isArray(upload.records)||!Number.isFinite(time(upload.receivedAt)))throw Error('Invalid combined roster source');
 const tracker=checkedTracker(upload),byId=new Map<string,Row>();
 const trackerOnlyIds=new Set<string>(tracker?.records.filter(r=>r.matchedProductId===null).flatMap(r=>r.binding.unitIds)||[]);
 const rowCutoffs=new Map<string,number>();
 for(const r of upload.records){if(r.observedAt!==undefined&&!Number.isFinite(time(r.observedAt)))throw Error('Invalid source record timestamp');for(const id of r.binding?.unitIds||[])rowCutoffs.set(id,time(r.observedAt||upload.receivedAt));}
 const inventory:Row[]=snapshot.inventoryItems.map((row:Row)=>{
  const cutoff=tracker&&trackerOnlyIds.has(row.id)?time(tracker.source.observedAt):(rowCutoffs.get(row.id)??time(upload.receivedAt));
  if(!unseenSourceConflict(row,cutoff,audits,identity))return row;
  const reason='A newer confirmed primary-source assignment conflicts with protected saved placement; review the current assignment.';
  return {...withoutPoint(row),placement:'UNKNOWN',currentLocationType:'unknown',placementReviewReason:reason,effectivePlacement:{...row.effectivePlacement,state:'unknown',freshness:'review',reason}};
 });
 for(const row of inventory){if(!uuid(row.id)||byId.has(row.id)||!row.effectivePlacement)throw Error('Invalid combined registry inventory');byId.set(row.id,row);}
 const used=new Map<string,string>(),records:Row[]=[],products=new Set<string>();
 const currentMembership=new Set<string>(tracker?.records.flatMap(r=>[...r.binding.unitIds,...(r.binding.candidateUnitIds||[])])||[]);
 const cutoff=time(upload.receivedAt);
 const strongerCurrent=(row:Row,cutoff=time(upload.receivedAt))=>row.placementSource==='owner'&&(!Number.isFinite(time(row.placementUpdatedAt))||time(row.placementUpdatedAt)>=cutoff)||protectedHistory(row,audits,cutoff,identity)||row.hasUnitGps===true||Boolean(row.installedSiteId)||newerPrimary(row,cutoff)||Boolean(currentSourceMarker(row,cutoff));
 const claim=(ids:string[],recordId:string)=>{for(const id of ids){if(used.has(id)&&used.get(id)!==recordId)throw Error('Conflicting combined source identities');used.set(id,recordId);}};
 const common=(r:Row)=>({unitNumber:r.unitNumber,category:r.category||null,customer:r.customer||null,sourceAddress:r.sourceAddress||null,reviewReason:null});
 const sourceItem=(r:Row,source:string,observedAt:string|null,lifecycle:string,p:string,ids:string[]=[],reason:string|null=null)=>({...common(r),id:source==='current_tracker'&&!r.recordId.startsWith('tracker_row:')?'tracker_row:'+r.recordId.replace(/^tracker:/,''):r.recordId,kind:p==='unknown'?'identity_review':'source_equipment',unitId:null,unit:null,placement:p,lifecycle,active:lifecycle==='active',source,observedAt,productIds:r.productId?[r.productId]:[],sourceRecordIds:[r.recordId],representedUnitIds:ids,reviewReason:reason});
 const unitItem=(row:Row,r:Row,source:string,observedAt:string|null,lifecycle:string,ids:string[])=>({...common(r),id:'cos_unit:'+row.id,kind:'unit',unitId:row.id,unit:row,unitNumber:row.unitNumber,...(row.uploadDisplayUnitNumber?{displayUnitNumber:row.uploadDisplayUnitNumber}:{}),placement:row.effectivePlacement.state,lifecycle,active:lifecycle==='active'&&row.activeInventoryEligible!==false,source:row.placementSource==='owner'?'owner':row.placementSource==='mhelpdesk_upload'?'owner_supplied_mhelp_export':row.placementSource==='current_tracker'?'current_tracker':'recorded_inventory',observedAt:row.effectivePlacement.observedAt||observedAt,productIds:r.productId?[r.productId]:[],sourceRecordIds:r.recordId?[r.recordId]:[],representedUnitIds:ids,reviewReason:row.effectivePlacement.reason||null});
 for(const r of upload.records){
  if(!object(r)||typeof r.productId!=='string'||products.has(r.productId)||r.recordId!=='mhelp_product:'+r.productId||!object(r.binding)||!Array.isArray(r.binding.unitIds)||!Array.isArray(r.binding.candidateUnitIds))throw Error('Invalid combined product record');products.add(r.productId);
  const supplemental=tracker?.records.filter(t=>t.matchedProductId===r.productId)||[];
  const trackerIds=supplemental.flatMap(t=>trackerTargets(t,byId).map(row=>row.id));
  const exactIds=new Set<string>(r.binding.state==='linked'?r.binding.unitIds:[]);
  const proposed=[...new Set<string>([...r.binding.unitIds,...r.binding.candidateUnitIds,...trackerIds])].filter(id=>byId.has(id));
  const protectedCandidates=proposed.filter(id=>!exactIds.has(id)&&strongerCurrent(byId.get(id)!,time(r.observedAt||upload.receivedAt)));
  const ids=proposed.filter(id=>!protectedCandidates.includes(id));
  claim(ids,r.recordId);
  const exactRows=r.binding.state==='linked'?r.binding.unitIds.map((id:string)=>byId.get(id)).filter(Boolean):[];
  const chosen=preferred(exactRows),lifecycle=life(r.uploadLifecycle);
  const associationHeld=(!chosen&&exactRows.length>0)||r.binding.placementHeld===true||r.binding.candidateUnitIds.length>0||r.binding.state==='held'&&r.binding.unitIds.length>0;
  if(chosen&&!associationHeld&&protectedCandidates.length===0){
   const chosenLife=r.overlayApplied?lifecycle:rowLife(chosen);
   records.push(unitItem(chosen,r,'owner_supplied_mhelp_export',r.observedAt||upload.receivedAt,chosenLife,ids));
  }else records.push({...sourceItem(r,'owner_supplied_mhelp_export',r.observedAt||upload.receivedAt,lifecycle,associationHeld||protectedCandidates.length?'unknown':placement(r.placement),ids,protectedCandidates.length?'A possible registry association has newer primary-source, Owner or verified-location evidence; resolve identity before counting this source assignment.':associationHeld?r.binding.reason||'Source identity needs review':null),...(associationHeld||protectedCandidates.length?{recordedSourcePlacement:placement(r.placement),candidateUnitIds:proposed,candidatePlacements:proposed.map(id=>({unitId:id,unitNumber:byId.get(id)!.unitNumber,placement:byId.get(id)!.effectivePlacement.state,source:byId.get(id)!.effectivePlacement.source,observedAt:byId.get(id)!.effectivePlacement.observedAt})),identityAssociation:'unresolved'}:{})});
 }
 if(tracker)for(const r of tracker.records){
  if(r.matchedProductId!==null){if(!products.has(r.matchedProductId))throw Error('Tracker refers to unavailable primary product');continue;}
  const targets=trackerTargets(r,byId),ids=targets.map(row=>row.id);claim(ids,r.recordId);const chosen=preferred(targets),lifecycle=life(r.lifecycle);
  if(chosen)records.push(unitItem(chosen,r,'current_tracker',tracker.source.observedAt,chosen.currentTrackerRecordId===r.recordId?lifecycle:rowLife(chosen),ids));
  else records.push(sourceItem(r,'current_tracker',tracker.source.observedAt,lifecycle,r.binding.placementHeld===true?'unknown':placement(r.placement),ids,r.binding.placementHeld===true?'Tracker identity needs review':null));
 }
 for(const raw of inventory){if(used.has(raw.id))continue;
  let row=raw;
  const ownerCurrent=strongerCurrent(row);
  if(tracker&&!ownerCurrent){const reason=currentMembership.has(row.id)?'Current tracker association needs identity revalidation':'Saved inventory, missing from current sources';row={...withoutPoint(row),placement:'UNKNOWN',currentLocationType:'unknown',effectivePlacement:{...row.effectivePlacement,state:'unknown',freshness:'review',reason},placementReviewReason:reason};}
  records.push(unitItem(row,{unitNumber:row.unitNumber,category:row.category,customer:row.customer},row.placementSource==='owner'?'owner':'recorded_inventory',row.effectivePlacement.observedAt||null,rowLife(row),[row.id]));
 }
 const seen=new Set<string>();for(const r of records){if(seen.has(r.id))throw Error('Duplicate combined roster record');seen.add(r.id);}
 const inventoryItems=records.filter(r=>r.kind==='unit').map(r=>({...r.unit,activeInventoryEligible:r.active}));
 for(const r of records)if(r.kind==='unit')r.unit=inventoryItems.find(u=>u.id===r.unitId);
 const items=inventoryItems.filter(r=>r.effectivePlacement.state==='field'&&r.activeInventoryEligible!==false),count=(fn:(r:Row)=>boolean)=>records.filter(fn).length;
 const summary={totalRecords:records.length,activeRecords:count(r=>r.active),field:count(r=>r.active&&r.placement==='field'),shop:count(r=>r.active&&r.placement==='shop'),review:count(r=>r.active&&r.placement==='unknown'),excludedLifecycle:count(r=>!r.active),sourceOnlyRecords:count(r=>r.kind!=='unit'),linkedUnitRecords:count(r=>r.kind==='unit')};
 return {...snapshot,inventoryItems,items,fleetRoster:{contract:'COS_COMBINED_FLEET_ROSTER_V1',items:records,summary,countBasis:'equipment_records_with_reviewed_cross_source_links',physicalDeduplication:'incomplete'},placementSummary:{totalUnits:inventoryItems.length,fieldUnits:items.length,shopUnits:inventoryItems.filter(r=>r.activeInventoryEligible!==false&&r.effectivePlacement.state==='shop').length,reviewUnits:inventoryItems.filter(r=>r.activeInventoryEligible!==false&&r.effectivePlacement.state==='unknown').length,excludedLifecycleUnits:inventoryItems.filter(r=>r.activeInventoryEligible===false).length},summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter(r=>r.latitude!=null&&r.longitude!=null).length,unitGps:items.filter(r=>r.hasUnitGps===true).length,missingGps:items.filter(r=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter(r=>typeof r.address==='string'&&r.address.trim()).length}};
}
