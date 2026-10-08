import {OwnerIdentityError,OWNER_IDENTITY_CONTRACT,prepareOwnerIdentityReview,validateOwnerIdentitySnapshot,type OwnerIdentitySources} from './ownerIdentityCrosswalk.ts';
type Row=Record<string,any>;
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
function fail(message:string,status=409):never{throw new OwnerIdentityError(message,status);}
export function createOwnerIdentityReview(deps:{read:(key?:string)=>Promise<{sources:OwnerIdentitySources;identity:Row}>;rpc:(name:string,payload:Row)=>Promise<Row>;actorId:string;organizationId:string}){
 const payload={p_actor_user_id:deps.actorId,p_organization_id:deps.organizationId};
 return async(path:string,method:string,body:unknown)=>{
  if(path==='/api/owner-identity/review'&&method==='GET'){
   const {sources,identity}=await deps.read();validateOwnerIdentitySnapshot(sources.crosswalk);
   // Exact list only. No automatically recommended candidate based on a number or suffix.
   const reservedUnits=new Set(sources.crosswalk.claims.map(c=>c.native_unit_id));
   const nativeUnits=sources.units.filter(u=>!reservedUnits.has(u.id)&&!['retired','deleted'].includes(u.status)&&!sources.matches.some(m=>m.equipment_unit_id===u.id)&&!identity.unitIdentities.some((p:Row)=>p.unitId===u.id)&&!identity.identityWarnings.some((p:Row)=>p.unitId===u.id)).map(u=>({id:u.id,unitNumber:u.unit_number}));
   const rawKeys=[...new Set(sources.devices.map(d=>d.unit_key))].filter(k=>text(k,250)&&!sources.crosswalk.claims.some(c=>c.legacy_unit_key===k)&&![...identity.unitIdentities,...identity.identityWarnings].some(p=>p.unitKeys.includes(k)));
   if(nativeUnits.length>1000||rawKeys.length>1000)fail('Identity review inventory exceeds the safe review limit.',503);
   return {contract:OWNER_IDENTITY_CONTRACT,nativeUnits,rawKeys,confirmations:sources.crosswalk.claims.map(c=>({id:c.id,unitId:c.native_unit_id,unitNumber:c.native_unit_label,unitKey:c.legacy_unit_key,status:c.status,revision:c.revision,provenance:c.provenance}))};
  }
  if(!['/api/owner-identity/preview','/api/owner-identity/confirm','/api/owner-identity/revoke'].includes(path))fail('Identity review endpoint not found.',404);
  if(method!=='POST'||!body||typeof body!=='object'||Array.isArray(body))fail('Identity review requires an explicit request.',400);
  const b=body as Row;
  const allowed=path==='/api/owner-identity/preview'?['unitId','unitKey']:path==='/api/owner-identity/confirm'?['unitId','unitKey','reviewToken','requestId','confirmationText']:path==='/api/owner-identity/revoke'?['claimId','expectedRevision','requestId','reason']:[];
  if(!allowed.length||Object.keys(b).some(k=>!allowed.includes(k)))fail('Unsupported identity review fields.',400);
  if(path==='/api/owner-identity/revoke'){
   if(!uuid(b.claimId)||!uuid(b.requestId)||b.expectedRevision!=='1'||!text(b.reason,4000))fail('Current confirmation and revocation reason required.',400);
   const receipt=await deps.rpc('cos_owner_identity_revoke',{...payload,p_claim_id:b.claimId,p_expected_revision:b.expectedRevision,p_request_id:b.requestId,p_reason:b.reason});
   const {sources}=await deps.read();
   if(receipt.claimId!==b.claimId||receipt.revision!=='2'||!sources.crosswalk.claims.some(c=>c.id===b.claimId&&c.status==='revoked'))fail('Revocation receipt is uncertain. Reload; do not replay automatically.',503);
   return receipt;
  }
  if(!uuid(b.unitId)||!text(b.unitKey,250))fail('Choose an exact native unit and source group.',400);
  const {sources,identity}=await deps.read(b.unitKey);
  const evidence=await prepareOwnerIdentityReview(sources,b.unitId,b.unitKey,identity as any);
  if(path==='/api/owner-identity/preview')return {contract:OWNER_IDENTITY_CONTRACT,unitId:evidence.unitId,unitNumber:evidence.unitNumber,unitKey:evidence.unitKey,deviceIds:evidence.deviceIds,reviewToken:evidence.reviewToken,provenance:'owner_confirmation'};
  if(!uuid(b.requestId)||!text(b.confirmationText,4000)||b.reviewToken!==evidence.reviewToken)fail('The reviewed identity changed or confirmation is missing. Preview it again.');
  const receipt=await deps.rpc('cos_owner_identity_confirm',{...payload,p_expected_revision:evidence.revision,p_request_id:b.requestId,p_claim:{unitId:evidence.unitId,unitNumber:evidence.unitNumber,unitKey:evidence.unitKey,deviceIds:evidence.deviceIds,resourceEpoch:evidence.resourceEpoch,nativeEpoch:evidence.nativeEpoch,physicalDigest:evidence.physicalDigest,physicalResources:evidence.physicalResources,provenance:'owner_confirmation',confirmationText:b.confirmationText,evidenceRef:'owner-ui:'+b.requestId}});
  // Separate post-commit source read; never replay an uncertain confirmation.
  const fresh=await deps.read();
  if(!uuid(receipt.claimId)||receipt.revision!=='1'||!fresh.sources.crosswalk.claims.some(c=>c.id===receipt.claimId&&c.status==='active')||!fresh.identity.ownerConfirmedUnitIdentities?.some((p:Row)=>p.unitId===b.unitId&&p.kind==='owner_confirmed_native'&&p.unitKeys.length===1&&p.unitKeys[0]===b.unitKey))fail('Confirmation saved but its current source readback is uncertain. Reload; do not replay automatically.',503);
  return {...receipt,provenance:'owner_confirmation'};
 };
}
