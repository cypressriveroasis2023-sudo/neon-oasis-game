import {addressDigest} from './censusAddress.ts';
import {matchesOwnerCensusProof,matchesOwnerCensusReceipt} from './ownerCensusProof.ts';
type Row=Record<string,any>;
const safeStatus=new Set(['pending','success','invalid_address','no_match','provider_error']);
export async function projectFieldGeocodes(snapshot:Row,records:unknown,unavailable=false,sourceReceipts:unknown=[],allowPreparation=false):Promise<Row>{
 if(!Array.isArray(records))throw Error('Address lookup results unavailable');
 const byAudit=new Map<string,Row>();
 for(const r of records){if(!r||typeof r!=='object'||typeof r.auditId!=='string'||byAudit.has(r.auditId))throw Error('Address lookup identity invalid');byAudit.set(r.auditId,r);}
 const apply=async(row:Row)=>{
  if(row.placement!=='FIELD'||row.placementSource!=='owner'||!row.placementAuditId||typeof row.address!=='string'||row.locationVerification==='owner_verified')return row;
  const r=byAudit.get(row.placementAuditId);
  if(!r&&unavailable)return {...row,locationGeocode:{status:'unavailable',reason:'Saved address lookup results are temporarily unavailable. Existing verified locations are unchanged.'}};
  if(!r)return {...row,locationGeocode:{status:'not_requested',reason:'This placement predates automatic address lookup. Review and save its complete installation address to locate it.'}};
  let executionMatched=false;
  if(r.censusOnly===true){
   const proofs=Array.isArray(snapshot.ownerCensusProofs)?snapshot.ownerCensusProofs.filter((p:Row)=>p.nativeUnitId===row.id):[];
   executionMatched=proofs.length===1&&matchesOwnerCensusProof(proofs[0],r,row.id);
   const receipts=Array.isArray(sourceReceipts)?sourceReceipts.filter(p=>p?.nativeUnitId===row.id):[];
   const admitted=r.censusOnlyState==='consumed'&&r.status==='success'?receipts.length===1&&matchesOwnerCensusReceipt(receipts[0],r,row.id):executionMatched;
   if(!admitted)return {...row,locationGeocode:{status:'held',auditId:r.auditId,censusOnly:true,censusOnlyState:['draining','ready','consumed'].includes(r.censusOnlyState)?r.censusOnlyState:'unknown',reason:'Current native source proof is unavailable. The one-Census hold remains in place.'}};
  }
  if(r.unitKey.trim().toUpperCase()!==row.unitNumber.trim().toUpperCase()&&r.unitKey!==row.placementUnitKey)return row;
  if(r.addressSha256!==await addressDigest(row.address)||!safeStatus.has(r.status))return row;
  const marker=r.censusPreparation;
  const preparation=allowPreparation&&r.status==='invalid_address'&&r.censusOnly!==true&&!Object.hasOwn(r,'censusOnlyGuard')&&!Object.hasOwn(r,'censusOnlyState')
   &&marker&&typeof marker==='object'&&!Array.isArray(marker)&&Object.keys(marker).length===1&&marker.nativeUnitId===row.id&&r.unitKey===row.placementUnitKey;
  const geocode={status:r.status,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256,provider:'us_census_address_range',benchmark:'Public_AR_Current',reason:r.reason,attempts:r.attempts,latitude:r.latitude,longitude:r.longitude,matchedAddress:r.matchedAddress,geocodedAt:r.geocodedAt,nextAttemptAt:r.nextAttemptAt,...(preparation?{censusPreparation:{nativeUnitId:row.id}}:{})};
  return {...row,locationGeocode:{...geocode,...(r.censusOnly===true?{censusOnly:true,censusOnlyState:r.censusOnlyState,...(executionMatched?{censusOnlyGuard:{nativeUnitId:r.censusOnlyGuard.nativeUnitId,nativeGuardSha256:r.censusOnlyGuard.nativeGuardSha256}}:{}),...(typeof r.censusOnlyNotBefore==='string'&&Number.isFinite(Date.parse(r.censusOnlyNotBefore))?{censusOnlyNotBefore:r.censusOnlyNotBefore}:{})}:{})}};
 };
 return {...snapshot,items:await Promise.all(snapshot.items.map(apply)),inventoryItems:await Promise.all(snapshot.inventoryItems.map(apply))};
}

