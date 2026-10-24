/** Explicit synthetic receipt builder. Callers supply the equipment and exact
 * resource IDs; no production matching logic or provider access is involved. */
export function withReviewedResources(health,links){
 const proofs=links.map(({unit,ids,kind='native_provider',providerArea})=>({
  unitId:unit.id,unitNumber:unit.unitNumber,kind,...(providerArea?{providerArea}:{}),deviceIds:ids.map(String),
  unitKeys:[...new Set(health.rows.filter(r=>ids.map(String).includes(String(r.id))).map(r=>r.unit))],proof:'a'.repeat(64)
 }));
 return {...health,identityVersion:1,identityWarnings:[],unitIdentities:proofs.filter(p=>p.kind==='native_provider'),ownerConfirmedIdentityVersion:1,ownerConfirmedUnitIdentities:proofs.filter(p=>p.kind==='owner_confirmed_native'),reconProviderIdentityVersion:1,reconProviderUnitIdentities:proofs.filter(p=>p.kind==='reconeyez_area')};
}
