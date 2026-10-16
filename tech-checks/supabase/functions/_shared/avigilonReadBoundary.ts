/** One native authority token brackets every dependent source read. This is a
 * read fence, not a cross-project transaction; source writers must participate. */
export type AvigilonAuthorityToken={contract:'COS_AVIGILON_AUTHORITY_V1';tenantId:string;generation:string;rosterRevision:string;admitted:true};
export function authorityToken(value:any,tenantId?:string):AvigilonAuthorityToken{
 if(value?.contract!=='COS_AVIGILON_AUTHORITY_V1'||typeof value.tenantId!=='string'||!value.tenantId||tenantId&&value.tenantId!==tenantId||typeof value.generation!=='string'||!/^[1-9]\d*$/.test(value.generation)||typeof value.rosterRevision!=='string'||!value.rosterRevision||value.admitted!==true)throw Error('Admitted Avigilon authority unavailable');
 return {contract:value.contract,tenantId:value.tenantId,generation:value.generation,rosterRevision:value.rosterRevision,admitted:true};
}
export function sameAuthority(before:any,after:any){const a=authorityToken(before),b=authorityToken(after,a.tenantId);if(a.generation!==b.generation||a.rosterRevision!==b.rosterRevision)throw Error('Avigilon authority changed during read');return a;}
export async function withStableAvigilonRead<T>(tenantId:string,read:()=>Promise<any>,work:(envelope:any)=>Promise<T>):Promise<{value:T;token:AvigilonAuthorityToken}>{
 const before=await read(),token=authorityToken(before?.authority,tenantId);
 const value=await work(before);
 const after=await read();sameAuthority(token,after?.authority);
 return {value,token};
}
export function validateReceiptMembership(summary:any,envelope:any,item:any){
 const units=envelope.roster?.units;
 if(envelope.roster?.tenantId!==envelope.tenantId||envelope.roster?.revision!==envelope.authority?.rosterRevision||!Array.isArray(units))throw Error('Avigilon authority mapping unavailable');
 const owners=units.filter((u:any)=>u.endpoint?.deviceId===item.deviceId);
 const owner=owners[0],receipt=item.receipt;
 const claims=[...(summary.unitIdentities||[]),...(summary.ownerConfirmedUnitIdentities||[])].filter((i:any)=>Array.isArray(i.deviceIds)&&i.deviceIds.includes(item.deviceId));
 if(owners.length!==1||!owner.nativeUnitId||owner.id!==receipt.unitId||owner.placement!=='FIELD'||owner.restricted!==false||owner.identityVerified!==true||['deviceId','revision','ip','profile','ports'].some(key=>JSON.stringify(owner.endpoint?.[key])!==JSON.stringify(item.endpoint?.[key]))||claims.length!==1||claims[0].unitId!==owner.nativeUnitId)throw Error('Avigilon receipt unit membership changed');
 return owner;
}
