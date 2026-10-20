import {attachMhelpReliabilityStatus} from './mhelpReliabilityStatus.ts';
import {exactLocationProof} from './validatedLocationProofs.ts';
/** Placement presentation only. No provider status, native equipment, GPS or address writes. */
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const safe=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=250&&!/[\x00-\x1f\x7f<>]/.test(v);
const concern=(v:unknown)=>typeof v==='string'?v.toLowerCase().replace(/[^a-z0-9]/g,''):'';
export function checkedMhelpPlacements(value:unknown,now=Date.now()):Row[] {
 if(!object(value)||value.contract!=='COS_MHELP_PLACEMENT_V1'||!Array.isArray(value.items)||value.items.length>1000)throw Error('Invalid placement receipt');
 const seen=new Set<string>();
 for(const r of value.items){
  if(!object(r)||!uuid(r.trackerId)||!(r.nativeUnitId===null||uuid(r.nativeUnitId))||!safe(r.trackerLabel)||!(r.nativeLabel===null||safe(r.nativeLabel))||!['confirmed','held'].includes(r.state)||seen.has(r.trackerId))throw Error('Invalid placement identity');
  seen.add(r.trackerId);if(r.assignmentChanged!==undefined&&typeof r.assignmentChanged!=='boolean')throw Error('Invalid assignment change evidence');
  if(r.state==='confirmed'&&(!['FIELD','SHOP'].includes(r.placement)||!safe(r.customerLabel)||!safe(r.siteLabel)||typeof r.locationReview!=='boolean'||typeof r.observedAt!=='string'||!Number.isFinite(Date.parse(r.observedAt))))throw Error('Invalid placement observation');
 }
 const native=value.items.filter((r:Row)=>r.nativeUnitId!==null).map((r:Row)=>r.nativeUnitId);
 if(new Set(native).size!==native.length)throw Error('Duplicate placement identity');
 if(value.enabled===false)return [];
 return value.items.filter((r:Row)=>r.state==='confirmed'&&r.guardCurrent===true&&Date.parse(r.observedAt)<=now&&now-Date.parse(r.observedAt)<=40*60*1000);
}
const unavailableLocationReasons=new Set(['service_location_unverified','mhelp_location_read_unavailable','service_location_read_timeout','service_location_refresh_unavailable']);
const recordedPlacement=(row:Row,fieldIds:Set<string>)=>{
 const value=String(row.placement||row.currentLocationType||'').toUpperCase();
 if(['SHOP','ROOT','WAREHOUSE','YARD'].includes(value))return 'SHOP';
 if(value==='UNKNOWN'||row.placementStatus==='needs_identity_review'||row.placementReviewReason||row.representationStatus==='conflict')return null;
 return ['FIELD','SITE'].includes(value)||fieldIds.has(row.id)?'FIELD':null;
};
/** A failed observation is not a move. The exact identity guard and original
 * observation time remain mandatory; this does not renew location or health. */
function durablePlacementLinks(receipt:Row,now:number,fresh:Row[]){
 return receipt.enabled===false?[]:receipt.items.filter((r:Row)=>fresh.includes(r)||r.state==='confirmed'&&r.guardCurrent===true
  &&Number.isFinite(Date.parse(r.observedAt))&&Date.parse(r.observedAt)<=now);
}
const clearUnverifiedPoint=(row:Row)=>({
 // Placement precedence is independently rechecked by the finalizer. Retaining
 // this binding never makes it an eligible address/geocode lookup again.
 placementPrecedenceBinding:row.importedInstallation?.sourcePrecedence?row.importedInstallation:row.placementPrecedenceBinding,
 historicalLatitude:row.latitude??row.historicalLatitude,historicalLongitude:row.longitude??row.historicalLongitude,
 historicalCoordinateSource:row.coordinateSource??row.historicalCoordinateSource,
 latitude:null,longitude:null,coordinateSource:null,importedInstallation:null,locationImportedGeocode:null,locationSourceRecorded:null,
 addressEstimateTrackerId:null,addressEstimateUnitNumber:null,locationVerification:'coordinates_unverified',locationVerifiedAt:null,locationHistoryId:null,
});
function protectedByHistory(r:Row,audits:Row[],identity?:Row){
 const proof=[...(identity?.unitIdentities||[]),...(identity?.ownerConfirmedUnitIdentities||[])].filter(p=>p.unitId===r.nativeUnitId);
 const labels=[r.nativeLabel,r.trackerLabel,...proof.flatMap(p=>p.unitKeys||[])].filter(Boolean).map(concern);
 const devices=proof.flatMap(p=>p.deviceIds||[]);
 return audits.some(a=>labels.includes(concern(a.unit_key))||uuid(a.control_id)&&(a.control_id===r.nativeUnitId||a.control_id===r.trackerId)||Array.isArray(a.device_ids)&&a.device_ids.some((id:unknown)=>devices.includes(String(id))));
}
export function projectMhelpFieldPlacement(snapshot:Row,receipt:unknown,audits:Row[],identity?:Row,now=Date.now(),options:{validatedLocationProofs?:Map<string,Row>}={}):Row {
 const freshLinks=checkedMhelpPlacements(receipt,now),links=durablePlacementLinks(receipt as Row,now,freshLinks);
 if(!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!object(snapshot.summary)||!Array.isArray(audits))throw Error('Invalid placement inputs');
 const byId=new Map<string,Row>(),assignmentChanges=new Map<string,Row>(),confirmedAssignments=new Map<string,Row>();
 // Source chronology must survive presentation protection. This marker is not
 // an identity override, assignment application, or eligible location proof.
 for(const link of links){if(link.guardCurrent===true){confirmedAssignments.set(link.trackerId,link);if(link.nativeUnitId)confirmedAssignments.set(link.nativeUnitId,link);}}
 for(const link of links){if(link.guardCurrent===true&&(link.assignmentChanged===true||link.locationReview===true&&link.assignmentChanged===undefined)){assignmentChanges.set(link.trackerId,link);if(link.nativeUnitId)assignmentChanges.set(link.nativeUnitId,link);}}
 for(const link of links){if(protectedByHistory(link,audits,identity))continue;byId.set(link.trackerId,link);if(link.nativeUnitId)byId.set(link.nativeUnitId,link);}
 // Missing identity/assignment evidence stays held. An explicit service-location
 // read failure may retain prior placement, but cannot retain its active pin.
 if((receipt as Row).enabled!==false)for(const r of (receipt as Row).items){
  if(links.includes(r)||protectedByHistory(r,audits,identity))continue;
  const held={...r,uncertain:true,retainRecorded:r.guardCurrent===true&&r.state==='held'&&unavailableLocationReasons.has(r.reason)
   &&Number.isFinite(Date.parse(r.observedAt))&&Date.parse(r.observedAt)<=now};byId.set(r.trackerId,held);if(r.nativeUnitId)byId.set(r.nativeUnitId,held);
 }
 const fieldIds=new Set(snapshot.items.map((r:Row)=>r.id));
 const inventoryItems=snapshot.inventoryItems.map((raw:Row)=>{
  const {mhelpConfirmedAssignment:_priorConfirmedAssignment,...initial}=raw;let row:Row=initial;
  const link=byId.get(row.id),label=link&&(row.id===link.nativeUnitId?link.nativeLabel:link.trackerLabel);
  const confirmed=confirmedAssignments.get(row.id),confirmedLabel=confirmed&&(row.id===confirmed.nativeUnitId?confirmed.nativeLabel:confirmed.trackerLabel);
  if(confirmed&&row.unitNumber===confirmedLabel)row={...row,mhelpConfirmedAssignment:{contract:'COS_MHELP_CONFIRMED_ASSIGNMENT_V1',unitId:row.id,unitNumber:row.unitNumber,observedAt:confirmed.observedAt,placement:confirmed.placement,assignmentChanged:typeof confirmed.assignmentChanged==='boolean'?confirmed.assignmentChanged:null}};
  const change=assignmentChanges.get(row.id),changeLabel=change&&(row.id===change.nativeUnitId?change.nativeLabel:change.trackerLabel);
  if(change&&row.unitNumber===changeLabel)row={...row,mhelpAssignmentChange:{contract:'COS_MHELP_ASSIGNMENT_CHANGE_V1',unitId:row.id,unitNumber:row.unitNumber,observedAt:change.observedAt,reason:change.assignmentChanged===true?'customer_or_service_location_changed':'assignment_change_status_unavailable'}};
  if(!link||row.unitNumber!==label||row.placementSource==='owner'||row.placementReviewReason||row.hasUnitGps||row.installedSiteId)return row;
  if(row.placementSource==='mhelpdesk'&&Number.isFinite(Date.parse(row.mhelpObservedAt))&&Date.parse(row.mhelpObservedAt)>Date.parse(link.observedAt))return row;
  if(link.uncertain){
   const prior=link.retainRecorded?recordedPlacement(row,fieldIds):null;
   const keepLocation=prior==='FIELD'&&exactLocationProof(options.validatedLocationProofs,row);
   return {...row,...(keepLocation?{}:clearUnverifiedPoint(row)),placement:prior||'UNKNOWN',placementSource:prior?(row.placementSource||'recorded_inventory'):'mhelpdesk',currentLocationType:prior?prior.toLowerCase():'unknown',
    mhelpPlacementReview:prior?'Recorded placement retained; current service location could not be read.':'Current mHelpDesk assignment or identity is unavailable; verify placement',
    placementEvidence:{source:prior?'recorded_inventory':'mhelpdesk',state:prior?'recorded':'review',observedAt:prior?(row.mhelpObservedAt||row.placementUpdatedAt||row.sourceVerifiedAt||null):link.observedAt??null,latestAttemptAt:link.observedAt??null,reason:link.reason||'placement_reason_unavailable',fresh:false}};
  }
  const fresh=freshLinks.includes(link)&&(!(receipt as Row).errorCode||Date.parse(link.observedAt)>=Date.parse((receipt as Row).lastAttemptAt));
  const locationReview=link.locationReview,assignmentReview=locationReview&&link.assignmentChanged!==false;
  const keepLocation=link.placement==='FIELD'&&link.guardCurrent===true&&!assignmentReview&&exactLocationProof(options.validatedLocationProofs,row);
  return {...row,placement:link.placement,placementSource:'mhelpdesk',currentLocationType:link.placement.toLowerCase(),
   site:link.siteLabel,customer:link.customerLabel,mhelpObservedAt:link.observedAt,mhelpLocationReview:locationReview,
   placementEvidence:{source:'mhelpdesk',state:fresh?'current':'recorded',observedAt:link.observedAt,fresh,reason:fresh?null:'placement_refresh_unavailable'},
   ...(!fresh?{...(keepLocation?{}:clearUnverifiedPoint(row)),mhelpPlacementReview:'Last confirmed placement retained; the source refresh is delayed. Location needs current verification.'}:{}),
   _sourceField:link.placement==='FIELD',...(assignmentReview?{address:null,addressSource:'mHelpDesk assignment changed; verify installation address',latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_changed',locationVerifiedAt:null,locationHistoryId:null,importedInstallation:null,addressEstimateTrackerId:null,addressEstimateUnitNumber:null}:{}),
   ...(link.placement==='SHOP'?{latitude:null,longitude:null,coordinateSource:null}:{} )};
 });
 const items=inventoryItems.filter((r:Row)=>r.placementSource==='mhelpdesk'?r.placement==='FIELD':fieldIds.has(r.id)).map((r:Row)=>{const{_sourceField,_placementProof,...item}=r;return item;});
 return attachMhelpReliabilityStatus({...snapshot,inventoryItems,items,mhelpPlacementSync:{contract:'COS_MHELP_PLACEMENT_V1',confirmedLinks:freshLinks.length,recordedConfirmedLinks:links.length,lastSuccessAt:(receipt as Row).lastSuccessAt,lastAttemptAt:(receipt as Row).lastAttemptAt,errorCode:(receipt as Row).errorCode,nextReadAt:(receipt as Row).readBackoff?.retryAt||null,sheetsPublisher:false},
  summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length}},receipt);
}
/** Only complete, current provider/native UUID proofs can carry placement onto camera cards. */
export function projectMhelpCameraPlacement(devices:Row[],receipt:unknown,audits:Row[],identity:Row,now=Date.now()):Row[] {
 const links=checkedMhelpPlacements(receipt,now),changes=new Map<string,Row>();
 const proofs=[...(identity.unitIdentities||[]),...(identity.ownerConfirmedUnitIdentities||[])];
 for(const link of links){
  if(!link.nativeUnitId||protectedByHistory(link,audits,identity)||(identity.identityWarnings||[]).some((w:Row)=>w.unitId===link.nativeUnitId))continue;
  const matches=proofs.filter(p=>p.unitId===link.nativeUnitId&&p.unitNumber===link.nativeLabel&&['native_provider','owner_confirmed_native'].includes(p.kind));
  if(matches.length!==1)continue;
  const proof=matches[0],ids=proof.deviceIds;
  if(!Array.isArray(ids)||!ids.length||!Array.isArray(proof.unitKeys)||proofs.some(p=>p!==proof&&p.deviceIds.some((id:string)=>ids.includes(id))))continue;
  const group=devices.filter(d=>proof.unitKeys.includes(d.unit_key));
  if(group.length!==ids.length||new Set(group.map(d=>String(d.id))).size!==ids.length||group.some(d=>!ids.includes(String(d.id))))continue;
  for(const d of group)if(d.activation_state==='active'&&!/^(?:RETIRED|STOLEN|NOT IN USE)$/i.test(d.organization||''))changes.set(String(d.id),link);
 }
 return devices.map(d=>{const link=changes.get(String(d.id));return link?{...d,organization:link.placement==='SHOP'?'ROOT':'mHelpDesk Field · '+link.siteLabel,__ownerPlacement:link.placement}:d;});
}
