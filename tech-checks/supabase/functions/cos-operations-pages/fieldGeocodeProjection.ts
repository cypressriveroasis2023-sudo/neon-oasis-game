import {addressDigest} from './censusAddress.ts';
type Row=Record<string,any>;
const safeStatus=new Set(['pending','success','invalid_address','no_match','provider_error']);
export async function projectFieldGeocodes(snapshot:Row,records:unknown,unavailable=false):Promise<Row>{
 if(!Array.isArray(records))throw Error('Address lookup results unavailable');
 const byAudit=new Map<string,Row>();
 for(const r of records){if(!r||typeof r!=='object'||typeof r.auditId!=='string'||byAudit.has(r.auditId))throw Error('Address lookup identity invalid');byAudit.set(r.auditId,r);}
 const apply=async(row:Row)=>{
  if(row.placement!=='FIELD'||row.placementSource!=='owner'||!row.placementAuditId||typeof row.address!=='string'||row.locationVerification==='owner_verified')return row;
  const r=byAudit.get(row.placementAuditId);
  if(!r&&unavailable)return {...row,locationGeocode:{status:'unavailable',reason:'Saved address lookup results are temporarily unavailable. Existing verified locations are unchanged.'}};
  if(!r)return {...row,locationGeocode:{status:'not_requested',reason:'This placement predates automatic address lookup. Review and save its complete installation address to locate it.'}};
  if(r.unitKey.trim().toUpperCase()!==row.unitNumber.trim().toUpperCase()&&r.unitKey!==row.placementUnitKey)return row;
  if(r.addressSha256!==await addressDigest(row.address)||!safeStatus.has(r.status))return row;
  const geocode={status:r.status,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256,provider:'us_census_address_range',benchmark:'Public_AR_Current',reason:r.reason,attempts:r.attempts,latitude:r.latitude,longitude:r.longitude,matchedAddress:r.matchedAddress,geocodedAt:r.geocodedAt,nextAttemptAt:r.nextAttemptAt};
  return {...row,locationGeocode:geocode};
 };
 return {...snapshot,items:await Promise.all(snapshot.items.map(apply)),inventoryItems:await Promise.all(snapshot.inventoryItems.map(apply))};
}

