import {addressDigest} from './censusAddress.ts';
import {geocodioAddress,safeGeocodioParts} from './geocodioAddress.ts';
type Options={rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;geocodioApiKey?:string;fetch?:typeof fetch;deadlineMs?:number;now?:()=>number};
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
/** No retries here. A new network attempt always needs a freshly credited durable reservation. */
export async function processGeocodioFallback(options:Options,target:Record<string,unknown>):Promise<{auditId:string;status:string}[]> {
 if(!options.geocodioApiKey?.trim())return [];
 const rows=await options.rpc('cos_field_geocode_fallback_list_due',{p_organization_id:ORG,p_limit:5,...target});
 if(!Array.isArray(rows)||rows.length>5)throw Error('Invalid fallback queue');
 const results=[];
 for(const row of rows){
  if(options.deadlineMs!==undefined&&options.deadlineMs-(options.now||Date.now)()<35000)break;
  if(!row||typeof row.auditId!=='string'||!/^\d+$/.test(row.auditId)||typeof row.unitKey!=='string'||row.unitKey.length>250||typeof row.address!=='string'||row.addressSha256!==await addressDigest(row.address))continue;
  const key={p_organization_id:ORG,p_audit_id:row.auditId,p_unit_key:row.unitKey,p_address:row.address,p_address_sha256:row.addressSha256};
  if(!safeGeocodioParts(row.address)){await options.rpc('cos_field_geocode_fallback_reject_address',key);results.push({auditId:row.auditId,status:'invalid_address'});continue;}
  const reservation=await options.rpc('cos_field_geocode_fallback_reserve',{...key,p_request_id:crypto.randomUUID()});
  if(reservation?.reserved!==true){results.push({auditId:row.auditId,status:reservation?.record?.status||'deferred'});continue;}
  if(!uuid(reservation.reservationToken)||typeof reservation.sendBefore!=='string'||!Number.isFinite(Date.parse(reservation.sendBefore)))throw Error('Invalid reservation');
  if(Date.now()>=Date.parse(reservation.sendBefore)){results.push({auditId:row.auditId,status:'deferred'});continue;}
  const result=await geocodioAddress(row.address,options.geocodioApiKey,options.fetch||fetch);
  const saved=await options.rpc('cos_field_geocode_fallback_finish',{...key,p_reservation_token:reservation.reservationToken,p_status:result.status,
   p_latitude:result.latitude??null,p_longitude:result.longitude??null,p_matched_address:result.matchedAddress??null,p_accuracy_type:result.accuracyType??null,
   p_accuracy:result.accuracy??null,p_match_type:result.matchType??null,p_reason:result.reason,p_retry_after_seconds:result.retryAfterSeconds??null});
  results.push({auditId:row.auditId,status:saved?.accepted===true?saved.record.status:'superseded'});
 }
 return results;
}
