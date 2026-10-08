import {placementMatchKey} from './placementProjection.ts';

/** Owner testimony is its own provenance. It never becomes provider/serial proof. */
type Row=Record<string,any>;
export const OWNER_IDENTITY_ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const OWNER_IDENTITY_CONTRACT='COS_OWNER_CONFIRMED_IDENTITY_V1';
export type OwnerIdentityClaim={id:string;organization_id:string;native_unit_id:string;native_unit_label:string;legacy_unit_key:string;device_ids:string[];resource_epoch:string;physical_digest:string;provenance:'owner_confirmation';status:'active'|'revoked';revision:string;product_association?:Row|null};
export type OwnerIdentitySnapshot={revision:string;claims:OwnerIdentityClaim[];nativeEpochs:{unitId:string;epoch:string}[]};
export type ResourceEpoch={unitKey:string;epoch:string;deviceIds:string[]};
export type OwnerIdentitySources={units:Row[];devices:Row[];matches:Row[];providers:Row[];epochs:ResourceEpoch[];crosswalk:OwnerIdentitySnapshot};
const record=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const text=(v:unknown,max=250):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const id=(v:unknown):string|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n?v:null;
const revision=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>b.includes(x));
const normalized=(v:unknown)=>typeof v==='string'?v.trim().toUpperCase():'';
const sorted=(v:string[])=>[...v].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
export class OwnerIdentityError extends Error {status:number;constructor(message:string,status=409){super(message);this.status=status;this.name='OwnerIdentityError';}}
function fail(message:string):never{throw new OwnerIdentityError(message);}
export async function ownerIdentityDigest(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');}
/** Physical fields only. IP, ports, observation/health, site and placement never enter the tuple. */
export function ownerConfirmedPhysicalTuple(key:string,devices:Row[]){
 return [OWNER_IDENTITY_CONTRACT,OWNER_IDENTITY_ORG,key,devices.map(d=>[id(d.id),d.source,d.device_type,d.external_device_id??null,d.device_serial??null,d.unit_key]).sort((a,b)=>BigInt(a[0]!)<BigInt(b[0]!)?-1:1)];
}
export function validateOwnerIdentitySnapshot(value:unknown):asserts value is OwnerIdentitySnapshot{
 if(!record(value)||!digest(value.revision)||!Array.isArray(value.claims)||value.claims.length>1000)fail('Owner identity commitments are unavailable.');
 for(const c of value.claims)if(!record(c)||!uuid(c.id)||c.organization_id!==OWNER_IDENTITY_ORG||!uuid(c.native_unit_id)||!text(c.native_unit_label)||!text(c.legacy_unit_key)||!Array.isArray(c.device_ids)||!c.device_ids.length||c.device_ids.length>1000||c.device_ids.some((v:unknown)=>id(v)!==v)||new Set(c.device_ids).size!==c.device_ids.length||!digest(c.resource_epoch)||!digest(c.physical_digest)||c.provenance!=='owner_confirmation'||!['active','revoked'].includes(c.status)||!revision(c.revision))fail('Owner identity commitments are malformed.');
 if(new Set(value.claims.map((c:Row)=>c.id)).size!==value.claims.length)fail('Owner identity history contains duplicate records.');
}
export async function currentOwnerIdentityEvidence(s:OwnerIdentitySources,unitId:string,unitKey:string){
 if(![s.units,s.devices,s.matches,s.providers,s.epochs].every(rows=>Array.isArray(rows)&&rows.length<=100000&&rows.every(record)))fail('Identity source records are unavailable.');
 if(!uuid(unitId)||!text(unitKey))fail('Choose the exact equipment and camera group.');
 const units=s.units.filter(u=>u.id===unitId),unit=units[0];
 if(units.length!==1||unit.organization_id!==OWNER_IDENTITY_ORG||!text(unit.unit_number)||typeof unit.status!=='string'||['retired','deleted'].includes(unit.status))fail('The exact native equipment identity is missing or duplicated.');
 const nativeEpochs=s.crosswalk.nativeEpochs?.filter(e=>e.unitId===unitId);
 if(!Array.isArray(nativeEpochs)||nativeEpochs.length!==1||!digest(nativeEpochs[0].epoch))fail('The native identity incarnation is unavailable.');
 const group=s.devices.filter(d=>normalized(d.unit_key)===normalized(unitKey));
 if(!group.length||group.length>1000||group.some(d=>d.unit_key!==unitKey||!id(d.id)||!text(d.source,100)||!text(d.device_type,100)||[d.external_device_id,d.device_serial].some(v=>v!==null&&v!==undefined&&!text(v,500))))fail('The complete exact camera resource group is unavailable or ambiguous.');
 const ids=sorted(group.map(d=>id(d.id)!));
 if(new Set(ids).size!==ids.length||group.some(d=>s.devices.filter(other=>id(other.id)===id(d.id)).length!==1))fail('Camera resource identities are duplicated.');
 if(group.some(d=>s.devices.some(other=>other!==d&&other.source===d.source&&((text(d.external_device_id,500)&&other.external_device_id===d.external_device_id)||(text(d.device_serial,500)&&other.device_serial===d.device_serial)))))fail('A physical camera identifier is claimed by multiple resources.');
 if(s.matches.some(m=>s.providers.some(p=>p.id===m.vigilant_device_id&&group.some(d=>p.external_device_id===d.external_device_id&&p.source===d.source))))fail('A native provider association already claims a resource in this camera group.');
 const concern=[placementMatchKey(unit.unit_number),placementMatchKey(unitKey)];
 if(s.units.some(u=>u.id!==unitId&&concern.includes(placementMatchKey(u.unit_number)))||s.devices.some(d=>d.unit_key!==unitKey&&concern.includes(placementMatchKey(d.unit_key))))fail('A competing full family, number or suffix identity requires review.');
 const epochs=s.epochs.filter(e=>e.unitKey===unitKey),epoch=epochs[0];
 if(epochs.length!==1||!digest(epoch.epoch)||!Array.isArray(epoch.deviceIds)||!exact(epoch.deviceIds,ids))fail('The current camera identity incarnation is unavailable or changed.');
 return {nativeEpoch:nativeEpochs[0].epoch,unitId,unitNumber:unit.unit_number as string,unitKey,deviceIds:ids,resourceEpoch:epoch.epoch,physicalDigest:await ownerIdentityDigest(ownerConfirmedPhysicalTuple(unitKey,group)),physicalResources:group.map(d=>({id:id(d.id)!,source:d.source,type:d.device_type,externalId:d.external_device_id??null,serial:d.device_serial??null})).sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1)};
}
export function ownerClaimRelated(c:OwnerIdentityClaim,unitId:string,key:string,ids:string[]){return c.native_unit_id===unitId||normalized(c.legacy_unit_key)===normalized(key)||c.device_ids.some(d=>ids.includes(d));}
/** Bound only by exact explicit evidence; does not infer aliases from any spelling. */
export async function projectOwnerConfirmedIdentities(s:OwnerIdentitySources){
 validateOwnerIdentitySnapshot(s.crosswalk);
 const unitIdentities:Row[]=[],identityWarnings:Row[]=[];
 for(const claim of s.crosswalk.claims){
  const binding={unitId:claim.native_unit_id,deviceIds:[...claim.device_ids],unitKeys:[claim.legacy_unit_key]};
  let reason='';
  try{
   if(claim.status!=='active')fail('The Owner-confirmed identity was revoked. Its resource commitments remain reserved.');
   const evidence=await currentOwnerIdentityEvidence(s,claim.native_unit_id,claim.legacy_unit_key);
   if(claim.native_unit_label!==evidence.unitNumber||!exact(claim.device_ids,evidence.deviceIds)||claim.resource_epoch!==evidence.resourceEpoch||claim.physical_digest!==evidence.physicalDigest)fail('The Owner-confirmed source identity changed. A restored label cannot reactivate it.');
   if(s.crosswalk.claims.some(c=>c!==claim&&ownerClaimRelated(c,claim.native_unit_id,claim.legacy_unit_key,claim.device_ids)))fail('More than one identity commitment claims these resources.');
   // A new provider association cannot silently supersede Owner confirmation.
   if(s.matches.some(m=>m.equipment_unit_id===claim.native_unit_id))fail('A provider association now competes with the Owner confirmation. Review its provenance.');
   const proof=await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT,claim.id,claim.revision,claim.native_unit_id,claim.native_unit_label,claim.legacy_unit_key,sorted(claim.device_ids),claim.resource_epoch,claim.physical_digest,claim.provenance]);
   unitIdentities.push({...binding,unitNumber:claim.native_unit_label,kind:'owner_confirmed_native',proof});
  }catch(error){reason=error instanceof Error?error.message:'Owner identity evidence could not be verified.';}
  if(reason)identityWarnings.push({...binding,reason});
 }
 return {unitIdentities,identityWarnings};
}
/** No browser supplied proof/serial/actor. Review token covers the complete current sources and reservations. */
export async function prepareOwnerIdentityReview(s:OwnerIdentitySources,unitId:string,unitKey:string,existing:{unitIdentities:Row[];identityWarnings:Row[]}){
 validateOwnerIdentitySnapshot(s.crosswalk);
 const evidence=await currentOwnerIdentityEvidence(s,unitId,unitKey);
 if(s.crosswalk.claims.some(c=>ownerClaimRelated(c,unitId,unitKey,evidence.deviceIds)))fail('This identity already has a confirmation or permanent revoked commitment.');
 if(s.matches.some(m=>m.equipment_unit_id===unitId)||[...existing.unitIdentities,...existing.identityWarnings].some(c=>c.unitId===unitId||c.deviceIds?.some((d:string)=>evidence.deviceIds.includes(d))||c.unitKeys?.some((k:string)=>normalized(k)===normalized(unitKey))))fail('This is not an unlinked identity. Review the existing association first.');
 const token=await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT,s.crosswalk.revision,evidence]);
 return {...evidence,revision:s.crosswalk.revision,reviewToken:token};
}
