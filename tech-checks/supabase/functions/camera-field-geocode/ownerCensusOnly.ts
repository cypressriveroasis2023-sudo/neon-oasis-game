import {parseOwnerInstallationAddress} from '../_shared/ownerInstallationAddress.ts';
import {addressDigest,type GeoResult} from './censusAddress.ts';
import {censusInstallation,fullMatchedParts} from './importedAddress.ts';

export type OwnerCensusOnlyGuard={nativeUnitId:string;nativeGuardSha256:string};
export type OwnerCensusOnlyBinding={auditId:string;unitKey:string;address:string;addressSha256:string;censusOnlyGuard:OwnerCensusOnlyGuard};
export type OwnerCensusOnlyRow=OwnerCensusOnlyBinding&{censusOnly:true;censusOnlyState:'draining'|'ready'|'consumed';censusOnlyNotBefore?:string};
export type VerifyOwnerCensusSource=(binding:OwnerCensusOnlyBinding,authorization:string)=>Promise<boolean>;
export const OWNER_ONE_CENSUS_PREFIX='owner_one_census_v1:';
const object=(value:unknown):value is Record<string,any>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export const validCensusClaimToken=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Only server-enrolled exact targets can enter this path. Browser flags never authorize it. */
export async function checkedOwnerCensusOnlyRow(value:unknown):Promise<OwnerCensusOnlyRow|null>{
 if(!object(value)||value.censusOnly!==true||!['draining','ready','consumed'].includes(value.censusOnlyState)
  ||value.censusOnlyNotBefore!==undefined&&(typeof value.censusOnlyNotBefore!=='string'||!Number.isFinite(Date.parse(value.censusOnlyNotBefore)))
  ||typeof value.auditId!=='string'||!/^[1-9]\d{0,18}$/.test(value.auditId)||BigInt(value.auditId)>9223372036854775807n
  ||typeof value.unitKey!=='string'||!value.unitKey.trim()||value.unitKey.length>250||/[\x00-\x1f\x7f]/.test(value.unitKey)
  ||typeof value.address!=='string'||!parseOwnerInstallationAddress(value.address,fullMatchedParts)||!sha(value.addressSha256)
  ||!object(value.censusOnlyGuard)||Object.keys(value.censusOnlyGuard).length!==2
  ||!validCensusClaimToken(value.censusOnlyGuard.nativeUnitId)||!sha(value.censusOnlyGuard.nativeGuardSha256)
  ||await addressDigest(value.address)!==value.addressSha256)return null;
 return {auditId:value.auditId,unitKey:value.unitKey,address:value.address,addressSha256:value.addressSha256,
  censusOnly:true,censusOnlyState:value.censusOnlyState,...(value.censusOnlyNotBefore!==undefined?{censusOnlyNotBefore:value.censusOnlyNotBefore}:{}),censusOnlyGuard:{nativeUnitId:value.censusOnlyGuard.nativeUnitId,nativeGuardSha256:value.censusOnlyGuard.nativeGuardSha256}};
}

export function sameOwnerCensusOnlyGuard(expected:OwnerCensusOnlyGuard,value:unknown):boolean{
 return object(value)&&Object.keys(value).length===2&&value.nativeUnitId===expected.nativeUnitId&&value.nativeGuardSha256===expected.nativeGuardSha256;
}

/** Preserve diagnosed failures in the existing SQL completion vocabulary. */
export function censusOnlyReason(result:GeoResult):string|null{
 if(result.status==='success')return null;
 if(result.status==='no_match'||result.status==='invalid_address')return result.status;
 if(!['provider_timeout','provider_unavailable','invalid_response'].includes(result.reason))throw Error('Unsafe Census-only reason');
 return result.reason;
}

/** One structured request preserves supplied ZIP+4 and removes only the parsed suite segment. */
export async function censusOnlyOwnerAddress(address:string,requestFetch:typeof fetch=fetch):Promise<GeoResult>{
 const parsed=parseOwnerInstallationAddress(address,fullMatchedParts);
 if(!parsed)return {status:'invalid_address',reason:'invalid_address'};
 let sent=false;
 const once:typeof fetch=async(input,init)=>{
  if(sent||typeof input!=='string'||new URL(input).origin!=='https://geocoding.geo.census.gov'
   ||new URL(input).pathname!=='/geocoder/locations/address'||init?.method!=='GET'||init.redirect!=='error')throw Error('Census-only request refused');
  sent=true;
  return requestFetch(input,init);
 };
 return censusInstallation(parsed.installation,once);
}
