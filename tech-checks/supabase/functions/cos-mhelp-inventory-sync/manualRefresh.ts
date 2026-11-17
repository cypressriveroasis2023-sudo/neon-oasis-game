/** Explicit evidence reads only. Never changes publisher eligibility or admission. */
type Row=Record<string,any>;
export type EvidenceRefresh={equipmentIds:string[];sourceSha256:string};
export function validateEvidenceRefresh(value:Row):EvidenceRefresh {
 if(Object.keys(value).some(k=>!['action','equipmentIds','sourceSha256'].includes(k))
  ||!Array.isArray(value.equipmentIds)||value.equipmentIds.length<1||value.equipmentIds.length>6
  ||value.equipmentIds.some((id:unknown)=>typeof id!=='string'||!/^\d{1,15}$/.test(id)||id.startsWith('0'))
  ||new Set(value.equipmentIds).size!==value.equipmentIds.length
  ||typeof value.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceSha256))throw Error('Invalid evidence refresh');
 return {equipmentIds:[...value.equipmentIds],sourceSha256:value.sourceSha256};
}
export function evidenceRefreshSelection(request:EvidenceRefresh,review:Row,baseline:Row):string[] {
 if(request.sourceSha256!==baseline.sourceSha256)throw Error('Evidence baseline changed');
 for(const id of request.equipmentIds){
  const old=baseline.records.filter((r:Row)=>r.productId===id),live=review.items.filter((r:Row)=>r.equipmentId===id);
  if(old.length!==1||live.length!==1||old[0].unitNumber!==live[0].name.trim()
   ||live[0].active===false||old[0].holdReason||old[0].lifecycle!=='UNFLAGGED'
   ||/\b(?:DO NOT USE|MISSING|RETIRED|DECOMMISSIONED|STOLEN)\b/i.test(live[0].name))throw Error('Evidence identity held');
 }
 return [...request.equipmentIds];
}
export function evidenceRefreshReceipt(request:EvidenceRefresh,source:Row,startedAt:number,now=Date.now()) {
 if(source.complete!==true||!Array.isArray(source.records))throw Error('Incomplete refresh evidence');
 const observations=request.equipmentIds.map(equipmentId=>{
  const rows=source.records.filter((r:Row)=>r.productId===equipmentId),r=rows[0],proof=r?.apiAssignment?.placementProof;
  const customer=r?.sourceDates?.apiCustomerObservedAt,site=r?.sourceDates?.apiAddressObservedAt;
  const current=(at:unknown)=>typeof at==='string'&&Number.isFinite(Date.parse(at))&&Date.parse(at)>=startedAt&&Date.parse(at)<=now+30000;
  if(rows.length!==1||r.holdReason||r.lifecycle!=='UNFLAGGED'||proof?.version!==1||proof.parentIsServiceLocation!==false||proof.parentActive===false
   ||!current(customer)||!['FIELD','SHOP'].includes(r.placement)
   ||r.placement==='FIELD'&&(proof.serviceVerified!==true||proof.serviceActive===false||!current(site)))throw Error('Incomplete refresh evidence');
  return {equipmentId,customerObservedAt:customer,siteObservedAt:r.placement==='FIELD'?site:null};
 });
 return {equipmentIds:request.equipmentIds,sourceSha256:request.sourceSha256,observations,acceptedSourceChanged:false,publisherBindingsChanged:false};
}
