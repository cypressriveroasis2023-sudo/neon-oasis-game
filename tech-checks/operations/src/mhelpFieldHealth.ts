import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {readRecordedRoster,type RecordedRoster} from './fleetRecordedRoster';
import {isSupportEquipment,unitHealthLabel} from './fieldCameraHealth';
import type {FleetDashboardRow} from './fleetDashboardModel';
import {fieldProductEvidence,type FieldProductEvidence} from './fieldProductEvidence';
import {readExactProductConnections} from './exactProductConnection';
import {fieldProductFollowUp} from './fieldProductFollowUp';

export const PROVIDER_REPORTED='Provider-reported, not direct-connection verified. ';
export const DIRECT_SOURCE_GAP='No direct connection check is available (the Product-ID connection source is unavailable, stale or does not match the current inventory). ';
export const fieldHealthLabels={online:'Online',offline:'Offline',unverified:'Health unverified',support:'Solar / support — no cameras',unlinked:'Health not linked',review:'Identity / placement review',inactive:'Do Not Use / Missing / inactive'};
export type FieldProductHealth=keyof typeof fieldHealthLabels;
export type FieldProduct={productId:string;unitNumber:string;state:FieldProductHealth;reason:string;unitId:string|null;recordId:string|null;evidence?:FieldProductEvidence};

/** One result per reviewed Field Product ID. Reuse the existing health result
 * only through the server-reviewed product/registry association, never a name,
 * IP, candidate identity or historical tracker join. This is a read-only view. */
export function mhelpFieldHealth(value:unknown,roster:RecordedRoster|null,rows:FleetDashboardRow[],now=Date.now(),exactConnectionReceipt:unknown=undefined){
 const authority=readMhelpInventoryAuthority(value,now);
 if(!authority||!roster||!readRecordedRoster(roster).roster)return null;
 const products=(value as {records:Record<string,any>[]}).records.filter(item=>item.placement==='FIELD');
 const counts=Object.fromEntries(Object.keys(fieldHealthLabels).map(key=>[key,0])) as Record<FieldProductHealth,number>;
 // An absent or partial Product-ID IP receipt never weakens existing checks.
 const connections=readExactProductConnections(exactConnectionReceipt,authority.sourceSha256,products.map(product=>product.productId),now);
 const items:FieldProduct[]=products.map(product=>{
  const related=roster.items.filter(item=>item.productIds.includes(product.productId));
  const record=related.length===1?related[0]:null;
  const matches=record?.unitId?rows.filter(row=>row.id===record.unitId):[];
  const row=matches.length===1?matches[0]:null;
  const binding=product.binding;
  const label=typeof product.unitNumber==='string'&&product.unitNumber.trim()?product.unitNumber:'Product '+product.productId;
  const exact=connections?.get(product.productId);
  const support=Boolean(row?.support)||isSupportEquipment({id:product.recordId,unitNumber:label,modelName:typeof product.category==='string'?product.category:undefined});
  // Connection does not depend on provider/channel acceptance, but still
  // respects current Product-ID ownership, placement, support and holds.
  const exactAllowed=Boolean(exact&&exact.status!=='unknown'&&!support&&related.length<=1
   &&(!record?binding?.state!=='linked':record.kind!=='identity_review'&&record.placement==='field'
     &&record.active&&record.lifecycle==='active'
     &&record.productIds.length===1&&record.productIds[0]===product.productId)
   &&(record?.kind!=='unit'||Boolean(row&&row.placement==='field'&&!row.retired&&record.productIds.length===1
     &&record.productIds[0]===product.productId&&binding?.state==='linked'&&binding.unitIds?.includes(record.unitId))));
  const directSourceUnavailable=exactConnectionReceipt!==undefined&&!connections;
  let state:FieldProductHealth,reason:string;
  if(product.uploadLifecycle!=='UNFLAGGED'){
   state='inactive';reason=product.uploadLifecycle==='MISSING'?'Marked Missing in the reviewed mHelpDesk source.':'Marked Do Not Use in the reviewed mHelpDesk source.';
  }else if(record?.kind==='identity_review'||record&&record.placement!=='field'||binding?.state==='held'||binding?.placementHeld===true||binding?.candidateUnitIds?.length){
   state='review';reason=record?.reviewReason||'The saved identity or physical placement needs review. Health from a possible match is not assigned to this product.';
  }else if(record&&(!record.active||record.lifecycle!=='active'||row?.retired)){
   state='inactive';reason='The associated COS inventory is inactive. A successful connection does not reactivate it.';
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
   const reviewedProvider=record?.kind==='unit'&&row&&row.camera.association&&['online','offline'].includes(row.cameraState);
   if(reviewedProvider){
    state=row!.cameraState==='online'?'online':'offline';
    reason=PROVIDER_REPORTED+(directSourceUnavailable?DIRECT_SOURCE_GAP:'No direct connection result: '+exact!.reason+' ')+unitHealthLabel(row!.camera)+'. '+row!.camera.reason;
   }else{
    state='unverified';reason=directSourceUnavailable?'The exact Product-ID TCP source is unavailable, stale or does not match the current inventory. Connection status is Unknown.':exact!.reason;
   }
  }else if(exactAllowed&&exact){
   state=exact.status==='online'?'online':'offline';
   reason=exact.reason;
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
  counts[state]++;
  const useExactEvidence=Boolean(exact&&(exactAllowed&&state===exact.status
    ||state==='unverified'&&exact.status==='unknown'));
  const evidence=fieldProductEvidence(state==='review'||record?.kind!=='unit'?null:row,state,now,useExactEvidence&&exact?exact:null,exactConnectionReceipt!==undefined&&!connections);
  const followUp=fieldProductFollowUp(state,reason,exact?.status==='unknown'?exact.reason:undefined,directSourceUnavailable);
  if(followUp)evidence.followUp=followUp;
  return {productId:product.productId,unitNumber:label,state,reason,unitId:state!=='review'&&record?.kind==='unit'&&row?row.id:null,recordId:record?.kind!=='unit'?record?.id||null:null,evidence};
 });
 return {total:authority.field,counts,items,receivedAt:authority.receivedAt,sourceSha256:authority.sourceSha256};
}
