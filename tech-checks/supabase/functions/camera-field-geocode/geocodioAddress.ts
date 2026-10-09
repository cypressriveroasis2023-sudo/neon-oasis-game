import {validInstallation,matchesInstallation,fullMatchedParts,usPostalCode,type Installation,type GeocodeRejectionReason} from './importedAddress.ts';
import {parseAddress, type Parts} from './censusAddress.ts';
/** Only ordinary saved installation address parts are sent. No notes, identity, or raw response is retained. */
export type GeocodioResult = {
 status:'success'|'no_match'|'provider_error'; reason:null|GeocodeRejectionReason|'no_match'|'provider_timeout'|'provider_unavailable'|'invalid_response'|'provider_forbidden'|'provider_rate_limited';
 latitude?:number;longitude?:number;matchedAddress?:string;accuracyType?:'rooftop'|'range_interpolation';accuracy?:number;matchType?:'building_centroid'|'parcel_centroid'|null;retryAfterSeconds?:number;
};
const object=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const text=(v:unknown,max=200):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>@=]/.test(v);
const coord=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=max;
export function safeGeocodioParts(value:unknown):Parts|null {
 const parts=parseAddress(value);
 // Secondary units and annotations require review rather than silently falling back to a building.
 if(!parts||/\b(?:apt|apartment|suite|ste|unit|floor|bldg|building|contact|call|customer|phone|telephone|tel|email|login|username|password|passwd|token|secret|credential|code|note|notes)\b|\d{3}[-.]\d{3}[-.]\d{4}/i.test(String(value)))return null;
 const zip=/(\d{5}(?:-\d{4})?)\s*$/.exec(String(value))?.[1];
 return zip?{...parts,zip}:null;
}
const none=(reason:GeocodeRejectionReason):GeocodioResult=>({status:'no_match',reason});
/** One unambiguous US result; exact supplied components at basic postal precision and an allowed method. */
export function selectGeocodioResult(value:string,payload:unknown):GeocodioResult {
 return selectGeocodioInstallation(safeGeocodioParts(value),payload);
}
export function selectGeocodioInstallation(expected:Installation|null,payload:unknown):GeocodioResult {
 if(!expected||!validInstallation(expected)||!object(payload)||!Array.isArray(payload.results))return none('invalid_components');
 if(payload.results.length!==1)return none(payload.results.length?'ambiguous_results':'provider_empty');
 if(payload._warnings)return none('provider_warning');
 const result=payload.results[0];
 if(!object(result)||!object(result.address_components))return none('invalid_components');
 if(result._warnings)return none('provider_warning');
 const a=result.address_components,postal=usPostalCode(a.postal_code);
 if(a.country!=='US'||!text(a.number,20)||!text(a.formatted_street)||!text(a.city,100)||!text(a.state_province,2)||postal===null
  ||a.unit_number!=null||a.unit_type!=null||result.address_components_secondary!=null)return none('invalid_components');
 const matchedAddress=`${a.number} ${a.formatted_street}, ${a.city}, ${a.state_province} ${postal}`;
 const matched=fullMatchedParts(matchedAddress);
 if(!matched)return none('invalid_components');
 if(!matchesInstallation(expected,matchedAddress))return none('component_mismatch');
 if(!text(result.formatted_address,600)||!matchesInstallation(matched,result.formatted_address)||!matchesInstallation(expected,result.formatted_address))return none('formatted_address_mismatch');
 const accuracyType=result.accuracy_type,matchType=result.match_type??null;
 if(!['rooftop','range_interpolation'].includes(accuracyType)||!([null,'building_centroid','parcel_centroid'] as unknown[]).includes(matchType)
  ||accuracyType==='range_interpolation'&&matchType!==null)return none('unsupported_method');
 if(typeof result.accuracy!=='number'||!Number.isFinite(result.accuracy)||result.accuracy<0.9||result.accuracy>1)return none('low_accuracy');
 if(!object(result.location)||!coord(result.location.lat,90)||!coord(result.location.lng,180))return none('invalid_coordinates');
 // Keep only allowlisted primitives. Never forward provider errors, raw source strings or request details.
 return {status:'success',reason:null,latitude:result.location.lat,longitude:result.location.lng,matchedAddress,accuracyType,accuracy:result.accuracy,matchType};
}
export function rateLimitSeconds(headers:Headers,now=Date.now()):number {
 const seconds=(value:string|null)=>value&&/^\d{1,6}$/.test(value)?Math.min(86400,Math.max(60,Number(value))):null;
 const retry=seconds(headers.get('retry-after'));
 const retryDate=headers.get('retry-after');
 const dateSeconds=retryDate&&Number.isFinite(Date.parse(retryDate))?Math.ceil((Date.parse(retryDate)-now)/1000):0;
 const period=seconds(headers.get('x-ratelimit-period'));
 // The period is treated conservatively as a duration; unrecognized values wait a full day.
 return Math.min(86400,Math.max(60,retry??0,dateSeconds,period??0,(!retry&&!dateSeconds&&!period)?86400:0));
}
export async function geocodioAddress(value:string,apiKey:string,requestFetch:typeof fetch=fetch,now=Date.now):Promise<GeocodioResult> {
 return geocodioInstallation(safeGeocodioParts(value),apiKey,requestFetch,now);
}
export async function geocodioInstallation(parts:Installation|null,apiKey:string,requestFetch:typeof fetch=fetch,now=Date.now):Promise<GeocodioResult> {
 if(!parts||!validInstallation(parts))return none('invalid_components');
 if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192||/[\r\n]/.test(apiKey))return {status:'provider_error',reason:'provider_unavailable'};
 const url=new URL('https://api.geocod.io/v2/geocode');
 for(const [key,val] of Object.entries({street:parts.street,city:parts.city,state_province:parts.state,postal_code:parts.zip,country:'US'}))if(val!==null)url.searchParams.set(key,val);
 // No limit=1: that would conceal a second ambiguous result. No fields, distance, lists, or paid enrichment.
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try {
  const response=await requestFetch(url.toString(),{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+apiKey},redirect:'error',cache:'no-store',signal:controller.signal});
  if(response.status===403||response.status===401)return {status:'provider_error',reason:'provider_forbidden'};
  if(response.status===429)return {status:'provider_error',reason:'provider_rate_limited',retryAfterSeconds:rateLimitSeconds(response.headers,now())};
  if(response.status===422)return none('provider_rejected');
  if(!response.ok)return {status:'provider_error',reason:'provider_unavailable'};
  const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw Error('large');}chunks.push(value);}
  const joined=new Uint8Array(size);let offset=0;for(const b of chunks){joined.set(b,offset);offset+=b.length;}
  let payload:unknown;try{payload=JSON.parse(new TextDecoder().decode(joined));}catch{return {status:'provider_error',reason:'invalid_response'};}
  if(!object(payload)||!Array.isArray(payload.results))return {status:'provider_error',reason:'invalid_response'};
  return selectGeocodioInstallation(parts,payload);
 }catch{return {status:'provider_error',reason:controller.signal.aborted?'provider_timeout':'provider_unavailable'};}
 finally{clearTimeout(timer);controller.abort();}
}
