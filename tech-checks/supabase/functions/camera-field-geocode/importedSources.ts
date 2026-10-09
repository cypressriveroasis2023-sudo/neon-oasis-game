import {checkedSourcePrecedence,type SourcePrecedence} from '../_shared/sourcePrecedence.ts';
import {checkedAppAddressAuthority,type AppAddressAuthority} from '../_shared/appUnitAddressContract.ts';
import {addressDigest} from './censusAddress.ts';
import {validInstallation,installationAddress,suppliedComponents,type Installation} from './importedAddress.ts';
const dependencyCodes=['rpc_transport','rpc_http','rpc_json','source_transport','source_http','source_body','source_json','source_shape'] as const;
type DependencyCode=typeof dependencyCodes[number];
/** Carries only a fixed code. Never retain the underlying error, body, URL, or credentials. */
export class GeocodeDependencyError extends Error{
 readonly code:DependencyCode;
 constructor(code:DependencyCode){super('Geocode dependency unavailable');this.code=code;}
}
export function geocodeDependencyCode(error:unknown):DependencyCode|null{
 try{if(error instanceof GeocodeDependencyError){const code=error.code;return dependencyCodes.find(allowed=>allowed===code)??null;}}catch{}
 return null;
}
export const SOURCE_ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export type ImportedIdentity={entityKind:'equipment_unit'|'tracker';nativeUnitId:string;productId?:string;sourceSystem?:'mhelpdesk_product_import'|'google_sheet_tracker';sourceRecordId?:string;sourceRevision:string};
export type ImportedSource=ImportedIdentity&{sourcePrecedence?:SourcePrecedence;addressAuthority?:AppAddressAuthority;schemaVersion:1|2;organizationId:string;sourceSystem:'mhelpdesk_product_import'|'google_sheet_tracker';unitNumber:string;family:string|null;variant:string|null;sourceFileSha256:string;sourceRowSha256:string;addressSha256:string;nativeGuardSha256:string;installation:Installation;suppliedComponents:{street:true;city:boolean;state:true;zip:boolean};eligibility:'FIELD';eventId:string};
export type SourceEvent=ImportedIdentity&{eventId:string;kind:'upsert'|'tombstone'};
const object=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown,zero=false)=>typeof v==='string'&&(zero?/^(0|[1-9]\d{0,18})$/:/^[1-9]\d{0,18}$/).test(v)&&BigInt(v)<=9223372036854775807n;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v);
const exact=(v:Record<string,any>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const trackerRecordId=(v:unknown):v is string=>typeof v==='string'&&v.length<=400&&/^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
export const validSourceType=(v:Record<string,any>)=>v.schemaVersion===1&&v.sourceSystem==='mhelpdesk_product_import'&&decimal(v.productId)&&!Object.hasOwn(v,'sourceRecordId')
 ||v.schemaVersion===2&&v.sourceSystem==='google_sheet_tracker'&&v.entityKind==='tracker'&&trackerRecordId(v.sourceRecordId)&&!Object.hasOwn(v,'productId');
export const sourceIdentity=(s:ImportedIdentity):ImportedIdentity=>({entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,
 ...(s.sourceSystem==='google_sheet_tracker'?{sourceSystem:s.sourceSystem,sourceRecordId:s.sourceRecordId}:{productId:s.productId}),sourceRevision:s.sourceRevision});
export const sourceAddress=(s:ImportedSource)=>installationAddress(s.installation);
export function validIdentity(value:unknown):value is ImportedIdentity&Record<string,any>{return object(value)&&['equipment_unit','tracker'].includes(value.entityKind)&&uuid(value.nativeUnitId)&&uuid(value.sourceRevision)&&(value.sourceSystem==='google_sheet_tracker'?value.entityKind==='tracker'&&trackerRecordId(value.sourceRecordId)&&!Object.hasOwn(value,'productId'):decimal(value.productId)&&!Object.hasOwn(value,'sourceRecordId')&&(value.sourceSystem===undefined||value.sourceSystem==='mhelpdesk_product_import'));}
export async function checkedImportedSource(value:unknown,expected?:ImportedIdentity):Promise<ImportedSource|null>{
 if(!object(value)||!validIdentity(value)||!validSourceType(value)||value.organizationId!==SOURCE_ORG||value.eligibility!=='FIELD'||!decimal(value.eventId)||!text(value.unitNumber,250)
  ||!(value.family===null||text(value.family,160))||!(value.variant===null||text(value.variant,160))||!['sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256'].every(k=>sha(value[k]))
  ||!object(value.installation)||!exact(value.installation,['street','city','state','zip'])||!validInstallation(value.installation)||!object(value.suppliedComponents)||!exact(value.suppliedComponents,['street','city','state','zip'])||value.suppliedComponents.street!==true||value.suppliedComponents.state!==true||value.suppliedComponents.city!==(value.installation.city!==null)||value.suppliedComponents.zip!==(value.installation.zip!==null))return null;
 const precedence=checkedSourcePrecedence(value);if(Object.hasOwn(value,'sourcePrecedence')&&!precedence)return null;
 const authority=checkedAppAddressAuthority(value.addressAuthority,value.sourceRevision);if(Object.hasOwn(value,'addressAuthority')&&(!authority||value.entityKind!=='tracker'||precedence))return null;
 if(expected&&JSON.stringify(sourceIdentity(value))!==JSON.stringify(sourceIdentity(expected)))return null;
 const candidate:ImportedSource={schemaVersion:value.schemaVersion,organizationId:SOURCE_ORG,sourceSystem:value.sourceSystem,...sourceIdentity(value),unitNumber:value.unitNumber,family:value.family,variant:value.variant,
  sourceFileSha256:value.sourceFileSha256,sourceRowSha256:value.sourceRowSha256,addressSha256:value.addressSha256,nativeGuardSha256:value.nativeGuardSha256,
  installation:{street:value.installation.street,city:value.installation.city,state:value.installation.state,zip:value.installation.zip},suppliedComponents:suppliedComponents(value.installation) as ImportedSource['suppliedComponents'],eligibility:'FIELD',eventId:value.eventId,...(precedence?{sourcePrecedence:precedence}:{}),...(authority?{addressAuthority:authority}:{})};
 const address=sourceAddress(candidate);
 if(await addressDigest(address)!==candidate.addressSha256)return null;
 return candidate;
}
export function sameSource(a:ImportedSource,b:ImportedSource|null):boolean{return b!==null&&JSON.stringify(a)===JSON.stringify(b);}
/** Fixed redacted read endpoint. No user bearer, service key, arbitrary URL, or secret is persisted. */
export function createSourceReader(key:string|undefined,requestFetch:typeof fetch=fetch){
 key=key?.trim();
 const configured=typeof key==='string'&&/^[a-f0-9]{64}$/i.test(key);
 const request=async(body:Record<string,unknown>):Promise<any>=>{
  if(!configured)throw new GeocodeDependencyError('source_shape');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await requestFetch('https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-geocode-sources',{method:'POST',headers:{'x-cos-geocode-source-key':key!,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw new GeocodeDependencyError('source_http');
   const reader=response.body?.getReader();if(!reader)throw new GeocodeDependencyError('source_body');let size=0;const chunks:Uint8Array[]=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288){await reader.cancel();throw new GeocodeDependencyError('source_body');}chunks.push(value);}
   const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
   try{return JSON.parse(new TextDecoder().decode(joined));}catch{throw new GeocodeDependencyError('source_json');}
  }catch(error){throw new GeocodeDependencyError(geocodeDependencyCode(error)??'source_transport');}finally{clearTimeout(timer);controller.abort();}
 };
 return {configured,
  async changes(afterEventId:string,limit=100):Promise<{events:SourceEvent[];nextEventId:string}>{
   if(!decimal(afterEventId,true)||!Number.isInteger(limit)||limit<1||limit>100)throw new GeocodeDependencyError('source_shape');
   const data=await request({action:'list_changes',afterEventId,limit});
   if(!object(data)||!Array.isArray(data.events)||data.events.length>limit||!decimal(data.nextEventId,true)||BigInt(data.nextEventId)<BigInt(afterEventId))throw new GeocodeDependencyError('source_shape');
   let previous=BigInt(afterEventId);const events:SourceEvent[]=[];
   for(const raw of data.events){if(!validIdentity(raw)||!decimal(raw.eventId)||BigInt(raw.eventId)<=previous||!['upsert','tombstone'].includes(raw.kind))throw new GeocodeDependencyError('source_shape');previous=BigInt(raw.eventId);events.push({...sourceIdentity(raw),eventId:raw.eventId,kind:raw.kind});}
   if(events.length?data.nextEventId!==events.at(-1)!.eventId:data.nextEventId!==afterEventId)throw new GeocodeDependencyError('source_shape');
   return {events,nextEventId:data.nextEventId};
  },
  async currentMany(identities:ImportedIdentity[]):Promise<(ImportedSource|null)[]>{
   if(!Array.isArray(identities)||!identities.length||identities.length>100||identities.some(i=>!validIdentity(i)))throw new GeocodeDependencyError('source_shape');
   const requested=identities.map(sourceIdentity),body={action:'read_current',sources:requested};
   // Long typed keys still obey the existing 32-KiB bridge request boundary.
   // At most two bounded requests; preserve input order and fail the whole read.
   const groups=new TextEncoder().encode(JSON.stringify(body)).length<=32768?[requested]:[requested.slice(0,50),requested.slice(50)];
   const results=await Promise.all(groups.map(async(group)=>{
    const data=await request({action:'read_current',sources:group});
    if(!object(data)||!Array.isArray(data.sources)||data.sources.length!==group.length)throw new GeocodeDependencyError('source_shape');
    return Promise.all(data.sources.map(async(s:unknown,i:number)=>{if(s===null)return null;if(object(s)&&s.eligibility==='tombstone'&&validSourceType(s)&&s.organizationId===SOURCE_ORG&&validIdentity(s)&&JSON.stringify(sourceIdentity(s))===JSON.stringify(sourceIdentity(group[i])))return null;const checked=await checkedImportedSource(s,group[i]);if(!checked)throw new GeocodeDependencyError('source_shape');return checked;}));
   }));
   return results.flat();
  },
 };
}
