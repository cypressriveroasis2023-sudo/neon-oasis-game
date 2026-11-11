import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {readRecordedRoster,type RecordedRoster} from './fleetRecordedRoster';
import {isSupportEquipment,unitHealthLabel} from './fieldCameraHealth';
import type {FleetDashboardRow} from './fleetDashboardModel';
import {fieldProductEvidence,type FieldProductEvidence} from './fieldProductEvidence';
import {readExactProductConnections} from './exactProductConnection';
import {fieldProductFollowUp} from './fieldProductFollowUp';
import {cameraTimestamp,resourceKind,type CameraRow} from './cameraEvidence';
import {vccUnitGroups,vccProductNameKey,vccSummary,VCC_REPORTED,type FieldProductCameras} from './vccUnitCameras';

export const PROVIDER_REPORTED='Provider-reported, not direct-connection verified. ';
export const DIRECT_SOURCE_GAP='No direct connection check is available (the Product-ID connection source is unavailable, stale or does not match the current inventory). ';
export const CURRENT_SOURCE_CONFLICT='Current direct connection and verified provider status disagree. No outage is assigned until the sources agree. ';
export const fieldHealthLabels={online:'Online',offline:'Offline',unverified:'Health unverified',support:'Solar / support — no cameras',unlinked:'Health not linked',review:'Identity / placement review',inactive:'Do Not Use / Missing / inactive'};
export type FieldProductHealth=keyof typeof fieldHealthLabels;
export type FieldProduct={productId:string;unitNumber:string;state:FieldProductHealth;reason:string;unitId:string|null;recordId:string|null;evidence?:FieldProductEvidence};

export const DEVICE_LINK_NOT_REVIEWED=' Direct test at this unit’s tracker address; the camera device link has not been reviewed.';
/** One result per reviewed Field Product ID. Reuse the existing health result
 * only through the server-reviewed product/registry association, never a name,
 * IP, candidate identity or historical tracker join. This is a read-only view. */
export function mhelpFieldHealth(value:unknown,roster:RecordedRoster|null,rows:FleetDashboardRow[],now=Date.now(),exactConnectionReceipt:unknown=undefined,health:{rows?:CameraRow[]}|null=null){
 const authority=readMhelpInventoryAuthority(value,now);
 if(!authority||!roster||!readRecordedRoster(roster).roster)return null;
 const products=(value as {records:Record<string,any>[]}).records.filter(item=>item.placement==='FIELD');
 const counts=Object.fromEntries(Object.keys(fieldHealthLabels).map(key=>[key,0])) as Record<FieldProductHealth,number>;
 // An absent or partial Product-ID IP receipt never weakens existing checks.
 // A unit a person placed in the Field by hand has no saved connection check
 // yet. It must not be demanded from the connection source: one missing
 // Product ID would otherwise discard every other unit's direct evidence.
 const manualField=(product:Record<string,any>)=>product.cosManualPlacementFrom==='SHOP';
 const connections=readExactProductConnections(exactConnectionReceipt,authority.sourceSha256,products.filter(product=>!manualField(product)).map(product=>product.productId),now);
 // How many Field Product IDs each tested endpoint belongs to. A direct test
 // can only be credited to a unit when its endpoint belongs to that unit alone.
 const endpointOwners=new Map<string,number>();
 for(const item of connections?.values()||[])if(item.resourceId)endpointOwners.set(String(item.resourceId),(endpointOwners.get(String(item.resourceId))||0)+1);
 // VCC camera status by unit name (owner decision 2026-11-11). A name is usable
 // only when exactly one mHelp record, Field or Shop, carries it.
 const vccGroups=vccUnitGroups(health?.rows,now);
 const nameOwners=new Map<string,number>();
 if(vccGroups.size)for(const item of (value as {records:Record<string,any>[]}).records){const name=vccProductNameKey(item.unitNumber);if(name)nameOwners.set(name,(nameOwners.get(name)||0)+1);}
 const items:FieldProduct[]=products.map(product=>{
  const related=roster.items.filter(item=>item.productIds.includes(product.productId));
  const record=related.length===1?related[0]:null;
  const matches=record?.unitId?rows.filter(row=>row.id===record.unitId):[];
  const row=matches.length===1?matches[0]:null;
  const binding=product.binding;
  const label=typeof product.unitNumber==='string'&&product.unitNumber.trim()?product.unitNumber:'Product '+product.productId;
  const exact=connections?.get(product.productId);
  const support=Boolean(row?.support)||isSupportEquipment({id:product.recordId,unitNumber:label,modelName:typeof product.category==='string'?product.category:undefined});
  const exactResourceVerified=Boolean(record?.kind==='unit'&&row?.camera.association&&exact?.resourceId
    &&row.camera.association.deviceIds.includes(String(exact.resourceId)));
  // A unique tracker IP is not enough to assign a saved endpoint to a Product ID.
  // Direct TCP can override Fleet health only when that exact resource belongs to
  // the reviewed Product-ID -> COS unit -> device association.
  // Owner decision 2026-11-11 (James Martin): a completed direct test at the
  // 2027 tracker's address for this Product ID is counted when the Product ID is
  // linked to exactly one active Field COS unit and that tested endpoint belongs
  // to no other Product ID, even if the unit's camera device list has not been
  // reviewed. It is labelled as such. Every other identity condition below still
  // applies.
  const reviewedProvider=Boolean(record?.kind==='unit'&&row&&row.camera.association&&['online','offline'].includes(row.cameraState));
  // Never applied where a reviewed provider reading already gives this unit a status:
  // this rule only gives a status to units that would otherwise have none.
  const exactEndpointUnique=Boolean(exact?.resourceId&&endpointOwners.get(String(exact.resourceId))===1&&!reviewedProvider);
  const exactAllowed=Boolean(exact&&exact.status!=='unknown'&&!support&&related.length===1
   &&record?.kind==='unit'&&row&&(exactResourceVerified||exactEndpointUnique)&&record.placement==='field'
   &&record.active&&record.lifecycle==='active'&&record.productIds.length===1
   &&record.productIds[0]===product.productId&&row.placement==='field'&&!row.retired
   &&binding?.state==='linked'&&Array.isArray(binding.unitIds)&&binding.unitIds.includes(record.unitId));
  const directSourceUnavailable=exactConnectionReceipt!==undefined&&!connections;
  let state:FieldProductHealth,reason:string,vccBlocked=support||related.length>1;
  if(product.uploadLifecycle!=='UNFLAGGED'){
   vccBlocked=true;state='inactive';reason=product.uploadLifecycle==='MISSING'?'Marked Missing in the reviewed mHelpDesk source.':'Marked Do Not Use in the reviewed mHelpDesk source.';
  }else if(manualField(product)&&!exact){
   // Stands and other no-camera equipment stay support; nothing else gets a status it has not earned.
   if(support){state='support';reason='Placed in the Field by hand in COS. Solar stand or support equipment with no camera channels; camera online/offline status does not apply.';}
   else{state='unverified';reason='Placed in the Field by hand in COS. No connection check exists for this unit yet, so no online or offline status is claimed.';}
  }else if(record?.kind==='identity_review'||record&&record.placement!=='field'||binding?.state==='held'||binding?.placementHeld===true||binding?.candidateUnitIds?.length){
   vccBlocked=true;state='review';reason=record?.reviewReason||'The saved identity or physical placement needs review. Health from a possible match is not assigned to this product.';
  }else if(record&&(!record.active||record.lifecycle!=='active'||row?.retired)){
   vccBlocked=true;state='inactive';reason='The associated COS inventory is inactive. A successful connection does not reactivate it.';
  }else if(record?.kind==='unit'&&(!row||matches.length!==1||record.productIds.length!==1||binding?.state!=='linked'||!Array.isArray(binding.unitIds)||!binding.unitIds.includes(record.unitId)||row.placement!=='field')){
   state='review';reason='The complete, unique product-to-unit association could not be verified.';
  }else if(support){
   state='support';reason='Solar stand or support equipment with no camera channels. Camera online/offline status does not apply.';

  }else if(exactConnectionReceipt!==undefined&&!connections||exact?.status==='unknown'&&connections){
   // No direct connection result is available for this Product ID. The
   // safeguard added 2026-10-26/27 was right that a guess must never be
   // inherited here, but it failed closed onto nothing at all, and the direct
   // source is unavailable almost always, so the whole fleet read Unknown.
   // Owner intent (James Martin) is two separate signals: a direct check where
   // one exists, and the provider's own reported status otherwise, labelled as
   // such. Provider status is admitted ONLY on a reviewed device association,
   // never from a name match, and never over a completed direct check.
   if(reviewedProvider){
    state=row!.cameraState==='online'?'online':'offline';
    reason=PROVIDER_REPORTED+(directSourceUnavailable?DIRECT_SOURCE_GAP:'No direct connection result: '+exact!.reason+' ')+unitHealthLabel(row!.camera)+'. '+row!.camera.reason;
   }else{
    state='unverified';reason=directSourceUnavailable?'The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown.':exact!.reason;
   }
  }else if(exactAllowed&&exact){
   if(reviewedProvider&&row!.cameraState!==exact.status){
    vccBlocked=true;state='unverified';
    reason=CURRENT_SOURCE_CONFLICT+'Direct: '+exact.reason+' Provider: '+unitHealthLabel(row!.camera)+'.';
   }else{
    state=exact.status==='online'?'online':'offline';
    reason=exact.reason+(exactResourceVerified?'':DEVICE_LINK_NOT_REVIEWED);
   }
  }else if(!record){
   state='review';reason=related.length?'Multiple COS representations claim this Product ID.':'No current COS roster representation is available for this Product ID.';
  }else if(record.kind!=='unit'){
   state='unlinked';reason='The Field assignment is recorded, but it has no verified COS health link. It is not counted as an outage.';
  }else if(!row!.camera.association){
   state='unlinked';reason='Device link needed. The Product ID has a COS inventory association, but its complete provider-resource association is not verified. A matching device name cannot supply current product health. '+row!.camera.reason;
  }else{
   state=row!.cameraState==='online'?'online':row!.cameraState==='offline'?'offline':'unverified';
   reason=unitHealthLabel(row!.camera)+'. '+row!.camera.reason;
  }
  // VCC by unit name. It gives a status only to a unit that has none, and it
  // never overrides a held identity, an inactive record or a source conflict.
  const vccName=vccBlocked?null:vccProductNameKey(product.unitNumber);
  const vcc=vccName&&nameOwners.get(vccName)===1?vccGroups.get(vccName)||null:null;
  // Every camera must have a current VCC reading; a partly read unit claims nothing.
  const vccReady=vcc&&vcc.undecided===0&&vcc.total>0
   // Devices already reviewed as another unit's can never be claimed by name.
   &&!vcc.rows.some(member=>rows.some(other=>other.id!==record?.unitId&&other.camera.association?.deviceIds.includes(String(member.id))))?vcc:null;
  let cameras:FieldProductCameras|undefined,vccDecided=false;
  if(vccReady){
   cameras={source:'VCC',link:'unit_name',total:vccReady.total,up:vccReady.up,down:vccReady.down,observedAt:vccReady.observedAt};
   if(state==='unverified'||state==='unlinked'||state==='review'){
    vccDecided=true;state=vccReady.up===0?'offline':'online';reason=VCC_REPORTED+vccSummary(vccReady);
   }else if(state==='online'&&vccReady.down.length){
    reason+=' '+VCC_REPORTED+vccSummary(vccReady);
   }
  }
  counts[state]++;
  const useExactEvidence=Boolean(exact&&(exactAllowed&&state===exact.status
    ||state==='unverified'&&exact.status==='unknown'));
  const evidence=fieldProductEvidence(state==='review'||record?.kind!=='unit'?null:row,state,now,useExactEvidence&&exact?exact:null,exactConnectionReceipt!==undefined&&!connections);
  const followUp=vccDecided?null:fieldProductFollowUp(state,reason,exact?.status==='unknown'?exact.reason:undefined,directSourceUnavailable);
  if(followUp)evidence.followUp=followUp;
  if(vccDecided&&vccReady){
   evidence.gap=null;evidence.association='vcc_unit_name';evidence.basis=vccReady.rows.every(member=>resourceKind(member)==='recorders')?'recorder':'camera';evidence.observedAt=vccReady.observedAt;
   evidence.observations=vccReady.rows.map(member=>{const status=String(member.evidence!.status);return {resourceId:String(member.id),source:'VCC',kind:member.evidence!.resource||'camera',observedAt:cameraTimestamp(member.evidence!.observedAt,now).at,fresh:true,reportedStatus:status,currentState:status};});
  }
  if(cameras&&(state==='online'||state==='offline'))evidence.cameras=cameras;
  return {productId:product.productId,unitNumber:label,state,reason,unitId:state!=='review'&&record?.kind==='unit'&&row?row.id:null,recordId:record?.kind!=='unit'?record?.id||null:null,evidence};
 });
 return {total:authority.field,counts,items,receivedAt:authority.receivedAt,sourceSha256:authority.sourceSha256};
}
