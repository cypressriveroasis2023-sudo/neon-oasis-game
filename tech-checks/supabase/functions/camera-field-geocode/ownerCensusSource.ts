import {addressDigest,normalizeAddress} from './censusAddress.ts';
import {type OwnerCensusOnlyBinding,type VerifyOwnerCensusSource} from './ownerCensusOnly.ts';

export const OWNER_CENSUS_PROOF_CONTRACT='COS_OWNER_ONE_CENSUS_NATIVE_V1';
export const OWNER_CENSUS_SOURCE_TIMEOUT_MS=45000;
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const object=(value:unknown):value is Record<string,any>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const proofKeys=['contract','nativeUnitId','auditId','unitKey','addressSha256','nativeGuardSha256','complete'];

/** Only an independently authenticated native response can attest the opaque guard. */
export async function matchesOwnerCensusSource(snapshot:unknown,binding:OwnerCensusOnlyBinding):Promise<boolean>{
 if(!object(snapshot)||snapshot.placementProjectionVersion!==2||!Array.isArray(snapshot.ownerCensusProofs)||snapshot.ownerCensusProofs.length>1000
  ||!Array.isArray(snapshot.nativePlacementAliases)||snapshot.nativePlacementAliases.length>1000
  ||!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems))return false;
 const id=binding.censusOnlyGuard.nativeUnitId,proofs=snapshot.ownerCensusProofs.filter((p:unknown)=>object(p)&&p.nativeUnitId===id);
 if(proofs.length!==1)return false;
 const proof=proofs[0];
 if(Object.keys(proof).length!==proofKeys.length||proofKeys.some(key=>!Object.hasOwn(proof,key))
  ||proof.contract!==OWNER_CENSUS_PROOF_CONTRACT||proof.complete!==true||proof.auditId!==binding.auditId||proof.unitKey!==binding.unitKey
  ||proof.addressSha256!==binding.addressSha256||!sha(proof.nativeGuardSha256)||proof.nativeGuardSha256!==binding.censusOnlyGuard.nativeGuardSha256)return false;
 const aliases=snapshot.nativePlacementAliases.filter((p:unknown)=>object(p)&&p.unitId===id);
 if(aliases.length!==1)return false;
 const alias=aliases[0];
 if(alias.contract!=='COS_NATIVE_PLACEMENT_ALIAS_V1'||alias.writerContract!=='COS_CAMERA_PLACEMENT_V2'
  ||alias.auditId!==binding.auditId||alias.unitKey!==binding.unitKey||!sha(alias.proof)||!Array.isArray(alias.deviceIds)||!alias.deviceIds.length
  ||alias.deviceIds.some((v:unknown)=>typeof v!=='string'||!/^[1-9]\d{0,18}$/.test(v))||new Set(alias.deviceIds).size!==alias.deviceIds.length)return false;
 for(const collection of [snapshot.items,snapshot.inventoryItems]){
  const rows=collection.filter((r:unknown)=>object(r)&&r.id===id);if(rows.length!==1)return false;
  const row=rows[0];
  if(row.readOnly!==false||row.unitNumber!==alias.unitNumber||row.placementSource!=='owner'||row.placement!=='FIELD'||row.status!=='field'||row.currentLocationType!=='field'
   ||row.placementStatus==='needs_identity_review'||row.locationVerification==='owner_verified'||row.placementAuditId!==binding.auditId||row.placementUnitKey!==binding.unitKey
   ||typeof row.address!=='string'||normalizeAddress(row.address)!==normalizeAddress(binding.address)||await addressDigest(row.address)!==binding.addressSha256)return false;
 }
 return true;
}

/** No service/source-read key is sent. Each exact proof read reauthenticates the original Owner. */
export function createOwnerCensusSourceVerifier(requestFetch:typeof fetch=fetch):VerifyOwnerCensusSource{
 return async(binding,authorization)=>{
  if(!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8192)return false;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),OWNER_CENSUS_SOURCE_TIMEOUT_MS);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const response=await requestFetch(endpoint,{method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,
    headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({path:'/api/field-map/'+binding.censusOnlyGuard.nativeUnitId+'/owner-census-proof',method:'POST',body:{auditId:binding.auditId,unitKey:binding.unitKey,addressSha256:binding.addressSha256,nativeGuardSha256:binding.censusOnlyGuard.nativeGuardSha256}})});
   if(!response.ok)throw Error('Owner source verification unavailable');
   reader=response.body?.getReader();if(!reader)throw Error('Owner source verification unavailable');
   const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
   while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
    if(size>4194304)throw Error('Owner source verification unavailable');text+=decoder.decode(chunk.value,{stream:true});}
   text+=decoder.decode();
   return matchesOwnerCensusSource(JSON.parse(text),binding);
  }catch{throw Error('Owner source verification unavailable');}
  finally{clearTimeout(timer);controller.abort();if(reader){await reader.cancel().catch(()=>{});reader.releaseLock();}}
 };
}
