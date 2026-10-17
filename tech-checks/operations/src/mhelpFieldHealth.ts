import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {readRecordedRoster,type RecordedRoster} from './fleetRecordedRoster';
import {isSupportEquipment,unitHealthLabel} from './fieldCameraHealth';
import type {FleetDashboardRow} from './fleetDashboardModel';

export const fieldHealthLabels={online:'Online',offline:'Offline',unverified:'Health unverified',support:'Solar / support — no cameras',unlinked:'Health not linked',review:'Identity / placement review',inactive:'Do Not Use / Missing / inactive'};
export type FieldProductHealth=keyof typeof fieldHealthLabels;
export type FieldProduct={productId:string;unitNumber:string;state:FieldProductHealth;reason:string;unitId:string|null;recordId:string|null};

/** One result per reviewed Field Product ID. Reuse the existing health result
 * only through the server-reviewed product/registry association, never a name,
 * IP, candidate identity or historical tracker join. This is a read-only view. */
export function mhelpFieldHealth(value:unknown,roster:RecordedRoster|null,rows:FleetDashboardRow[],now=Date.now()){
 const authority=readMhelpInventoryAuthority(value,now);
 if(!authority||!roster||!readRecordedRoster(roster).roster)return null;
 const products=(value as {records:Record<string,any>[]}).records.filter(item=>item.placement==='FIELD');
 const counts=Object.fromEntries(Object.keys(fieldHealthLabels).map(key=>[key,0])) as Record<FieldProductHealth,number>;
 const items:FieldProduct[]=products.map(product=>{
  const related=roster.items.filter(item=>item.productIds.includes(product.productId));
  const record=related.length===1?related[0]:null;
  const matches=record?.unitId?rows.filter(row=>row.id===record.unitId):[];
  const row=matches.length===1?matches[0]:null;
  const binding=product.binding;
  const label=typeof product.unitNumber==='string'&&product.unitNumber.trim()?product.unitNumber:'Product '+product.productId;
  let state:FieldProductHealth,reason:string;
  if(product.uploadLifecycle!=='UNFLAGGED'){
   state='inactive';reason=product.uploadLifecycle==='MISSING'?'Marked Missing in the reviewed mHelpDesk source.':'Marked Do Not Use in the reviewed mHelpDesk source.';
  }else if(!record){
   state='review';reason=related.length?'Multiple COS representations claim this Product ID.':'No current COS roster representation is available for this Product ID.';
  }else if(record.kind==='identity_review'||record.placement!=='field'||binding?.state==='held'||binding?.placementHeld===true||binding?.candidateUnitIds?.length){
   state='review';reason=record.reviewReason||'The saved identity or physical placement needs review. Health from a possible match is not assigned to this product.';
  }else if(!record.active||record.lifecycle!=='active'||row?.retired){
   state='inactive';reason='The associated COS inventory is inactive. A successful connection does not reactivate it.';
  }else if(record.kind==='unit'&&(!row||matches.length!==1||record.productIds.length!==1||binding?.state!=='linked'||!Array.isArray(binding.unitIds)||!binding.unitIds.includes(record.unitId)||row.placement!=='field')){
   state='review';reason='The complete, unique product-to-unit association could not be verified.';
  }else if(row?.support||isSupportEquipment({id:product.recordId,unitNumber:label,modelName:typeof product.category==='string'?product.category:undefined})){
   state='support';reason='Solar stand or support equipment with no camera channels. Camera online/offline status does not apply.';
  }else if(record.kind!=='unit'){
   state='unlinked';reason='The Field assignment is recorded, but it has no verified COS health link. It is not counted as an outage.';
  }else{
   state=row!.cameraState==='online'?'online':row!.cameraState==='offline'?'offline':'unverified';
   reason=unitHealthLabel(row!.camera)+'. '+row!.camera.reason;
  }
  counts[state]++;
  return {productId:product.productId,unitNumber:label,state,reason,unitId:state!=='review'&&record?.kind==='unit'&&row?row.id:null,recordId:record?.kind!=='unit'?record?.id||null:null};
 });
 return {total:authority.field,counts,items,receivedAt:authority.receivedAt,sourceSha256:authority.sourceSha256};
}
