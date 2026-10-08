import {addressDigest} from './censusAddress.ts';
import {fullMatchedParts,matchesInstallation,geocodeRejectionReasons} from './importedAddressContract.ts';
type Row=Record<string,any>;
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const statuses=new Set(['pending','deferred','success','no_match','provider_error']);
const reasons=new Set([null,...geocodeRejectionReasons,'no_match','provider_timeout','provider_unavailable','invalid_response','provider_forbidden','provider_rate_limited','configuration_unavailable','budget_exhausted','duplicate_inflight','attempts_exhausted','daily_attempt_limit','invalid_address','lease_expired','reset_guard']);
const coord=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=max;
/** Provider projection is independent of Census and reviewed rooftop V2; current Owner GPS wins. */
export async function projectFallbackGeocodes(snapshot:Row,records:unknown):Promise<Row>{
 if(!Array.isArray(records))throw Error('Address fallback unavailable');
 const byAudit=new Map<string,Row>();
 for(const r of records){if(!object(r)||typeof r.auditId!=='string'||byAudit.has(r.auditId))throw Error('Address fallback identity invalid');byAudit.set(r.auditId,r);}
 const apply=async(row:Row)=>{
  if(row.placement!=='FIELD'||row.placementSource!=='owner'||row.placementStatus==='needs_identity_review'||typeof row.placementAuditId!=='string'||typeof row.placementUnitKey!=='string'||typeof row.address!=='string'||row.locationVerification==='owner_verified'||row.locationGeocode?.status==='success')return row;
  const r=byAudit.get(row.placementAuditId);
  if(!r||r.unitKey!==row.placementUnitKey||r.addressSha256!==await addressDigest(row.address)||!statuses.has(r.status)||r.provider!=='geocodio'||r.verified!==false||r.liveGps!==false||r.confidence!=='estimate')return row;
  if(r.status==='success'){
   const original=fullMatchedParts(row.address);
   if(!original||!matchesInstallation(original,r.matchedAddress)||!coord(r.latitude,90)||!coord(r.longitude,180)||typeof r.geocodedAt!=='string'||!Number.isFinite(Date.parse(r.geocodedAt))||Date.parse(r.geocodedAt)>Date.now()
    ||!['rooftop','range_interpolation'].includes(r.accuracyType)||typeof r.accuracy!=='number'||!Number.isFinite(r.accuracy)||r.accuracy<0.9||r.accuracy>1||![null,'building_centroid','parcel_centroid'].includes(r.matchType??null)||r.accuracyType==='range_interpolation'&&r.matchType!=null)return row;
  }
  return {...row,locationGeocode:{status:r.status,auditId:r.auditId,unitKey:r.unitKey,addressSha256:r.addressSha256,provider:'geocodio',source:'geocodio_automatic_address_estimate',confidence:'estimate',verified:false,liveGps:false,
   reason:reasons.has(r.reason)?r.reason:null,attempts:Number.isInteger(r.attempts)&&r.attempts>=0?r.attempts:0,nextAttemptAt:typeof r.nextAttemptAt==='string'&&Number.isFinite(Date.parse(r.nextAttemptAt))?r.nextAttemptAt:null,
   ...(r.status==='success'?{latitude:r.latitude,longitude:r.longitude,matchedAddress:r.matchedAddress,geocodedAt:r.geocodedAt,accuracyType:r.accuracyType,accuracy:r.accuracy,matchType:r.matchType??null}:{})}};
 };
 return {...snapshot,items:await Promise.all(snapshot.items.map(apply)),inventoryItems:await Promise.all(snapshot.inventoryItems.map(apply))};
}
