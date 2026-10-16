/** Private, reviewed upload projection. Product records are not asserted physical
 * units, camera identities, live API observations, or verified installation GPS. */
import {placementIdentityConcernKey} from './placementProjection.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const id=(v:unknown)=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
const safe=(v:unknown,max=600)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&/(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(v)?Date.parse(v.replace(/([+-]\d\d)$/,'$1:00')):NaN;
const source='owner_supplied_mhelp_export';
function checked(receipt:unknown,now:number):Row|null{
 if(receipt==null)return null;
 if(!object(receipt)||receipt.contract!=='COS_MHELP_UPLOAD_V1'||receipt.reviewed!==true||!hash(receipt.sourceSha256)||!hash(receipt.payloadSha256)
  ||!Number.isFinite(stamp(receipt.receivedAt))||stamp(receipt.receivedAt)>now||!['minute','second'].includes(receipt.receivedAtPrecision)
  ||receipt.exportAsOf!==null||!Array.isArray(receipt.records)||!receipt.records.length||receipt.records.length>10000)throw Error('Invalid reviewed mHelp upload receipt');
 const seen=new Set<string>(),targets=new Set<string>();
 for(const r of receipt.records){
  if(!object(r)||!id(r.productId)||seen.has(r.productId)||!safe(r.unitNumber,250)||!r.unitNumber||!safe(r.category,250)||!id(r.customerId)||!safe(r.customer,250)||!r.customer
   ||!['FIELD','SHOP'].includes(r.placement)||!['UNFLAGGED','DO_NOT_USE','MISSING'].includes(r.lifecycle)||!object(r.sourceAddress)
   ||Object.values(r.sourceAddress).some(v=>typeof v!=='string'||v.length>600||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v))||!Number.isInteger(r.sourceRow)||r.sourceRow<2)throw Error('Invalid mHelp upload source record');
  if(r.scopedAuthority!=null){const a=r.scopedAuthority;
   if(!object(a)||a.contract!=='COS_SCOPED_INVENTORY_AUTHORITY_V1'||!uuid(a.revisionId)||a.evidenceKind!=='derived_mapping'||!hash(a.evidenceSha256)
    ||!Number.isSafeInteger(receipt.scopedRevision)||receipt.scopedRevision<1||!Number.isFinite(stamp(a.receivedAt))||stamp(a.receivedAt)<stamp(receipt.receivedAt)||stamp(a.receivedAt)>now)throw Error('Invalid scoped inventory authority');
  }
  seen.add(r.productId);
  if(r.inventoryOnlyReason!==undefined&&(r.inventoryOnlyReason!=='no_sim'||r.placement!=='SHOP'||r.binding!==null||r.placementHeld!==true))throw Error('Invalid inventory-only connection restriction');
  if(r.displayUnitNumber!=null&&(!safe(r.displayUnitNumber,250)||!r.displayUnitNumber||!hash(r.displayAuthorizationSha256)))throw Error('Invalid approved display alias');
  if(r.binding!=null){const b=r.binding;
   if(!object(b)||b.productId!==r.productId||!['reviewed_product_id','exact_family_unit','archived_alias','owner_confirmed_alias'].includes(b.matchMethod)||!hash(b.evidenceSha256)||!hash(b.expectedGuard)
    ||!(b.trackerId===null||uuid(b.trackerId))||!(b.trackerLabel===null||safe(b.trackerLabel,250))||!(b.nativeUnitId===null||uuid(b.nativeUnitId))||(!b.trackerId&&!b.nativeUnitId)||!(b.nativeLabel===null||safe(b.nativeLabel,250))
    ||typeof b.guardCurrent!=='boolean'||b.fullLabel!==r.unitNumber)throw Error('Invalid mHelp upload identity binding');
   for(const target of [b.trackerId,b.nativeUnitId].filter(Boolean)){if(targets.has(target))throw Error('Conflicting mHelp upload identities');targets.add(target);}
  }
 }
 return receipt;
}
const historicalOnly=(row:Row)=>({
 historicalLatitude:row.latitude??row.historicalLatitude??null,historicalLongitude:row.longitude??row.historicalLongitude??null,
 historicalCoordinateSource:row.coordinateSource??row.historicalCoordinateSource??null,
 historicalHasUnitGps:row.hasUnitGps??row.historicalHasUnitGps??false,hasUnitGps:false,latitude:null,longitude:null,coordinateSource:null,locationVerification:'coordinates_unverified',locationVerifiedAt:null,locationHistoryId:null,
 importedInstallation:null,locationImportedGeocode:null,locationSourceRecorded:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null,
});
function blockingReason(row:Row,b:Row,audits:Row[],identity:Row|undefined,cutoff:number,groupRows:Row[]):string|null{
 if(row.placementReviewReason||row.placementStatus==='needs_identity_review'||row.representationStatus==='conflict'||(identity?.identityWarnings||[]).some((w:Row)=>w.unitId===row.id))return 'identity_conflict';
 const proofs=[...(identity?.unitIdentities||[]),...(identity?.ownerConfirmedUnitIdentities||[])].filter(p=>p.unitId===row.id);
 const concerns=[row.unitNumber,b.trackerLabel,b.nativeLabel,...proofs.flatMap(p=>p.unitKeys||[])].filter(Boolean).map(placementIdentityConcernKey);
 const devices=proofs.flatMap(p=>p.deviceIds||[]);
 const related=audits.filter(a=>[row.id,b.trackerId,b.nativeUnitId].filter(Boolean).includes(a.control_id)||concerns.includes(placementIdentityConcernKey(a.unit_key))||Array.isArray(a.device_ids)&&a.device_ids.some((v:unknown)=>devices.includes(String(v))));
 const confirmed=row.mhelpConfirmedAssignment,sourceTime=stamp(confirmed?.observedAt);
 const protectedTimes=[...related.map(a=>stamp(a.created_at)),...groupRows.flatMap(member=>[...(member.placementSource==='owner'?[stamp(member.placementUpdatedAt)]:[]),...(member.hasUnitGps===true?[stamp(member.gpsRecordedAt)]:[]),...(member.installedSiteId?[stamp(member.placementUpdatedAt)]:[])])];
 const protectedAfterSource=protectedTimes.some(t=>!Number.isFinite(t)||t>=cutoff&&(!Number.isFinite(sourceTime)||t>=sourceTime));
 if(confirmed?.contract==='COS_MHELP_CONFIRMED_ASSIGNMENT_V1'&&confirmed.unitId===row.id&&confirmed.unitNumber===row.unitNumber
  &&(!Number.isFinite(sourceTime)||sourceTime>=cutoff)&&!protectedAfterSource){
  const corroborated=groupRows.every(member=>{const current=member.mhelpConfirmedAssignment;return current?.contract==='COS_MHELP_CONFIRMED_ASSIGNMENT_V1'&&current.unitId===member.id&&current.unitNumber===member.unitNumber
   &&Number.isFinite(stamp(current.observedAt))&&stamp(current.observedAt)>=cutoff&&current.assignmentChanged===false&&['FIELD','SHOP'].includes(current.placement)&&current.placement===member.placement;})&&new Set(groupRows.map(member=>member.placement)).size===1;
  return corroborated?'newer_source_assignment':'newer_or_undated_source_assignment';
 }
 if(related.some(a=>!Number.isFinite(stamp(a.created_at))||stamp(a.created_at)>=cutoff))return 'newer_or_undated_owner_history';
 if(row.placementSource==='owner'&&(!Number.isFinite(stamp(row.placementUpdatedAt))||stamp(row.placementUpdatedAt)>=cutoff))return 'newer_or_undated_owner_placement';
 const evidence=row.placementEvidence;
 if(['mhelpdesk','mhelpdesk_upload'].includes(row.placementSource)&&['FIELD','SHOP'].includes(row.placement)&&evidence?.state!=='review'&&Math.max(stamp(row.mhelpObservedAt)||0,stamp(evidence?.observedAt)||0)>=cutoff)return 'newer_source_assignment';
 if(row.hasUnitGps===true&&(!Number.isFinite(stamp(row.gpsRecordedAt))||stamp(row.gpsRecordedAt)>=cutoff)||row.installedSiteId&&(!Number.isFinite(stamp(row.placementUpdatedAt))||stamp(row.placementUpdatedAt)>=cutoff))return 'newer_or_undated_verified_native_location';
 return null;
}
/** Proofs come only from the independently validated pre-projection map, never
 * from upload metadata. A customer postal address is not a service installation. */
function retainedLocation(row:Row,r:Row,b:Row,proof:Row|undefined,customerIds:Map<string,Set<string>>):Row|null{
 if(!proof||proof.contract!=='COS_VALIDATED_LOCATION_PROOF_V1'||proof.unitId!==row.id||proof.unitNumber!==row.unitNumber
  ||!['owner_verified','address_estimate'].includes(proof.kind)||!object(proof.locationFields)||typeof proof.address!=='string'||!proof.address.trim()||r.placement!=='FIELD')return null;
 if(proof.productId!==null&&proof.productId!==r.productId)return null;
 const change=row.mhelpAssignmentChange;
 if(change?.contract==='COS_MHELP_ASSIGNMENT_CHANGE_V1'&&change.unitId===row.id&&change.unitNumber===row.unitNumber&&['customer_or_service_location_changed','assignment_change_status_unavailable'].includes(change.reason)){
  const observed=stamp(change.observedAt),installed=proof.kind==='owner_verified'?Math.max(stamp(proof.locationFields.locationVerifiedAt)||0,stamp(proof.locationFields.gpsRecordedAt)||0):stamp(proof.ownerPlacementFields?.placementUpdatedAt);
  // Only a later independently validated Owner installation can supersede a
  // confirmed assignment move. A geocode timestamp is not installation evidence.
  if(!Number.isFinite(observed)||!Number.isFinite(installed)||installed<=observed)return null;
 }
 const prior=b.previousAssignment;
 if(prior&&(prior.productId!==r.productId||prior.placement!=='FIELD'||prior.customerId!==r.customerId))return null;
 const priorSame=prior?.productId===r.productId&&prior?.placement==='FIELD'&&prior?.customerId===r.customerId;
 const normalized=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').toLowerCase():'';
 const original=proof.originalAssignment;
 // The helper carries this only from the same raw UUID/immutable label and an
 // unchanged service address. Do not use an unrelated row's customer identity.
 const assignment=original?.unitId===row.id&&original?.unitNumber===row.unitNumber?original:proof;
 const proofCustomer=normalized(assignment.customer),currentCustomer=normalized(r.customer),proofSite=normalized(assignment.site);
 const composite=proofCustomer&&proofSite?proofCustomer+': '+proofSite:'';
 const customerCandidates=[proofCustomer,composite].filter(Boolean);
 const sameCustomerIdentity=customerCandidates.some(label=>{const ids=customerIds.get(label);return label===currentCustomer&&ids?.size===1&&ids.has(r.customerId);});
 // A stable CustomerId does not prove a stable installation. This bounded
 // delimiter check only rejects explicit movement; it never grants a match.
 const delimiterNormalized=(label:string)=>label.replace(/\s*:\s*/g,': ');
 if(composite&&delimiterNormalized(currentCustomer).startsWith(delimiterNormalized(proofCustomer)+': ')&&delimiterNormalized(currentCustomer)!==delimiterNormalized(composite))return null;
 if(!priorSame&&proofCustomer&&!customerCandidates.includes(currentCustomer))return null;
 const exactOwnerIdentity=proof.ownerPlacementFields?.placementSource==='owner'&&proof.ownerPlacementFields?.placementAuditId!=null;
 if(proof.kind==='address_estimate'&&!priorSame&&!((proof.productId===r.productId||exactOwnerIdentity)&&sameCustomerIdentity))return null;
 // An explicit later service-address change or assignment hold remains a denial.
 if(row.locationVerification==='address_changed'&&(proof.locationFields.locationVerification!=='address_changed'||typeof row.address!=='string'||normalized(row.address)!==normalized(proof.address))
  ||typeof row.address==='string'&&row.address.trim()&&normalized(row.address)!==normalized(proof.address))return null;
 const service=row.mhelpLocation;if(service?.contract==='COS_MHELP_FLEET_LOCATIONS_V1'&&service.unitId===row.id&&service.unitNumber===row.unitNumber&&typeof service.address==='string'&&service.address.trim()&&normalized(service.address)!==normalized(proof.address))return null;
 return proof;
}
/** Call after the API placement/location projections and before the finalizer.
 * Missing ProductIds never delete, retire, or change existing inventory rows. */
export function projectMhelpUploadPlacement(snapshot:Row,value:unknown,audits:Row[],identity?:Row,now=Date.now(),options:{validatedLocationProofs?:Map<string,Row>}={}):{snapshot:Row;authorities:Row[]}{
 const receipt=checked(value,now);if(!receipt)return {snapshot,authorities:[]};
 if(!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(audits))throw Error('Invalid upload placement inputs');
 const byId=new Map<string,Row>();for(const row of snapshot.inventoryItems){if(!object(row)||!uuid(row.id)||byId.has(row.id))throw Error('Invalid upload target inventory');byId.set(row.id,row);}
 const changes=new Map<string,Row>(),authorities:Row[]=[],customerIds=new Map<string,Set<string>>();
 for(const r of receipt.records){const key=r.customer.trim().replace(/\s+/g,' ').toLowerCase();customerIds.set(key,new Set([...(customerIds.get(key)||[]),r.customerId]));}
 const records=receipt.records.map((r:Row)=>{
  const observedAt=r.scopedAuthority?.receivedAt||receipt.receivedAt,cutoff=stamp(observedAt),evidenceSha256=r.scopedAuthority?.evidenceSha256||receipt.sourceSha256;
  const b=r.binding;let state=!b&&r.possibleAliasUnitIds?.length?'held':'unlinked',reason=r.holdReason||'no_reviewed_inventory_binding',applied=false;const unitIds:string[]=[];
  if(b){
   const expected=[{id:b.trackerId,label:b.trackerLabel},{id:b.nativeUnitId,label:b.nativeLabel}].filter(t=>t.id);
   const targets=expected.filter(t=>byId.has(t.id));
   const represented=Array.isArray(b.representedUnitIds)?b.representedUnitIds:expected.map(t=>t.id);
   const membershipMatches=represented.length>0&&new Set(represented).size===represented.length&&represented.every((id:string)=>expected.some(t=>t.id===id))&&represented.length===targets.length&&targets.every(t=>represented.includes(t.id));
   if(!b.guardCurrent){state='held';reason='identity_guard_changed';}
   else if(!targets.length||!membershipMatches||targets.some(t=>byId.get(t.id)!.unitNumber!==t.label)){state='held';reason='bound_inventory_unavailable_or_renamed';}
   else{
    state='linked';reason=null;unitIds.push(...targets.map(t=>t.id));
    const groupRows=targets.map(t=>byId.get(t.id)!);
    const groupBlock=groupRows.map(row=>blockingReason(row,b,audits,identity,cutoff,groupRows)).find(Boolean);
    if(groupBlock){reason=groupBlock;if(groupBlock==='identity_conflict')state='held';}
    for(const target of groupBlock?[]:targets){
     const row=byId.get(target.id)!,preserved=retainedLocation(row,r,b,options.validatedLocationProofs?.get(row.id),customerIds);
     const evidence={source,...(r.scopedAuthority?{evidenceKind:'derived_mapping',scopedRevisionId:r.scopedAuthority.revisionId}:{}),productId:r.productId,sourceSha256:evidenceSha256,observedAt,timestampKind:r.scopedAuthority?'scoped_source_received':'upload_received',timestampPrecision:r.scopedAuthority?'second':receipt.receivedAtPrecision,state:'recorded',fresh:false,reason:'owner_supplied_export_not_live_api'};
     changes.set(row.id,{...row,...(preserved?preserved.locationFields:historicalOnly(row)),placement:r.placement,currentLocationType:r.placement.toLowerCase(),placementSource:'mhelpdesk_upload',
      customer:r.customer,site:r.placement==='SHOP'?'SHOP':preserved?.site||null,address:preserved?.address||null,addressSource:preserved?(preserved.locationFields.addressSource||row.addressSource):'Uploaded customer address is source-only; verify installation',
      uploadLifecycle:r.lifecycle,uploadActiveInventoryEligible:r.lifecycle==='UNFLAGGED',uploadProductId:r.productId,uploadSourceAddress:r.sourceAddress,...(r.displayUnitNumber?{uploadDisplayUnitNumber:r.displayUnitNumber}:{}),
      placementEvidence:preserved?.ownerPlacementFields?(preserved.ownerPlacementFields.placementEvidence||{source:'owner',state:'recorded',observedAt:preserved.ownerPlacementFields.placementUpdatedAt||row.placementUpdatedAt||null,fresh:false}):evidence,uploadPlacementEvidence:evidence,mhelpPlacementReview:null,mhelpLocationReview:!preserved,...(preserved?.ownerPlacementFields||{})});
     if(!preserved?.ownerPlacementFields)authorities.push({unitId:row.id,unitNumber:row.unitNumber,productId:r.productId,placement:r.placement,sourceSha256:evidenceSha256,observedAt,source});applied=true;
    }
   }
  }
  return {recordId:'mhelp_product:'+r.productId,productId:r.productId,unitNumber:r.displayUnitNumber||r.unitNumber,sourceUnitNumber:r.unitNumber,observedAt,category:r.category,placement:r.placement,uploadLifecycle:r.lifecycle,...(r.inventoryOnlyReason?{inventoryOnlyReason:r.inventoryOnlyReason}:{}),
   customer:r.customer,sourceAddress:r.sourceAddress,binding:{state,unitIds,candidateUnitIds:[...new Set([...(r.possibleAliasUnitIds||[]),...(state==='held'&&b?[b.trackerId,b.nativeUnitId].filter(Boolean):[])])],placementHeld:r.placementHeld===true||reason==='newer_or_undated_source_assignment',matchMethod:b?.matchMethod||null,reason},overlayApplied:applied};
 });
 const inventoryItems=snapshot.inventoryItems.map((r:Row)=>changes.get(r.id)||r),priorField=new Set(snapshot.items.map((r:Row)=>r.id));
 const items=inventoryItems.filter((r:Row)=>changes.has(r.id)?r.placement==='FIELD'&&r.uploadActiveInventoryEligible!==false:priorField.has(r.id));
 const count=(fn:(r:Row)=>boolean)=>records.filter(fn).length;
 const uploadInventory={contract:'COS_MHELP_UPLOAD_INVENTORY_V1',source,sourceSha256:receipt.sourceSha256,payloadSha256:receipt.payloadSha256,scopedRevision:receipt.scopedRevision??0,receivedAt:receipt.receivedAt,receivedAtPrecision:receipt.receivedAtPrecision,
  exportAsOf:null,trackerRecords:receipt.trackerRecords||[],trackerSource:receipt.trackerSource||null,countBasis:'mhelp_product_records_not_unique_physical_units',physicalDeduplication:'incomplete',
  summary:{totalRecords:records.length,fieldRecords:count(r=>r.placement==='FIELD'),shopRecords:count(r=>r.placement==='SHOP'),unflaggedFieldRecords:count(r=>r.placement==='FIELD'&&r.uploadLifecycle==='UNFLAGGED'),unflaggedShopRecords:count(r=>r.placement==='SHOP'&&r.uploadLifecycle==='UNFLAGGED'),doNotUseRecords:count(r=>r.uploadLifecycle==='DO_NOT_USE'),missingRecords:count(r=>r.uploadLifecycle==='MISSING'),linkedRecords:count(r=>r.binding.state==='linked'),unlinkedRecords:count(r=>r.binding.state==='unlinked'),heldRecords:count(r=>r.binding.state==='held'),appliedRecords:count(r=>r.overlayApplied)},records};
 return {snapshot:{...snapshot,inventoryItems,items,uploadInventory},authorities};
}
