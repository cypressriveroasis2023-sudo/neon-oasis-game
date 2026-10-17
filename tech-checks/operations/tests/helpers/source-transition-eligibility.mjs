/** Review-only preflight. NEVER performs or authorizes admission itself. */
const text=x=>typeof x==='string'&&x.trim()?x.trim():null;
const canonical=x=>JSON.stringify(x&&typeof x==='object'?(Array.isArray(x)?x.map(y=>JSON.parse(canonical(y))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))]))):x);
const variant=x=>(/(HDC[24]S?|HD4)\b/i.exec(String(x||''))||[])[1]?.toUpperCase()||null;
const label=x=>String(x||'').toUpperCase().replace(/\s+/g,' ').trim();
/** Exact known source families; decimal suffix preserved, not collapsed. */
const familyUnit=x=>{
 const m=/^(SOLAR SPOTTER|SPOTTER|RANGER)\s+0*([0-9]+)(?:\s*\.\s*([0-9]+))?\s*$/i.exec(label(x));
 return m?m[1].toUpperCase()+':'+String(Number(m[2]))+(m[3]!==undefined?'.'+m[3]:''):null;
};
export function reviewSourceTransition(previous,current,{beforeGuard,afterGuard,currentGuard,onlyGeocodeAdded=false,sourceChanged=false,payloadCurrent=false,registryIdentityCurrent=false,representedIdentityCurrent=false,serialCurrent=false}={}){
 if(!previous||!current||!text(previous.productId)||current.productId!==previous.productId)return {eligible:false,reason:'product_id_changed_or_missing'};
 if(current.binding!==null)return {eligible:false,reason:'current_binding_not_null'};
 if(previous.placement!=='FIELD'||current.placement!=='FIELD'||current.lifecycle!=='UNFLAGGED'||previous.lifecycle!=='UNFLAGGED')return {eligible:false,reason:'placement_or_lifecycle_hold'};
 if(current.holdReason||current.placementHeld||current.possibleAliasUnitIds?.length||previous.holdReason||previous.placementHeld)return {eligible:false,reason:'current_identity_or_placement_hold'};
 if(label(previous.unitNumber)!==label(current.unitNumber))return {eligible:false,reason:'unit_identity_changed'};
 if(canonical(previous.sourceAddress)!==canonical(current.sourceAddress)||previous.customerId!==current.customerId||previous.customer!==current.customer||previous.category!==current.category)return {eligible:false,reason:'customer_or_service_address_changed'};
 if(!previous.binding?.nativeUnitId||!previous.binding?.trackerId||!registryIdentityCurrent)return {eligible:false,reason:'registry_identity_unproven'};
 if(/\d\s*\.\s*\d/.test(current.unitNumber)&&!serialCurrent)return {eligible:false,reason:'decimal_identity_needs_serial_proof'};
 if(!familyUnit(current.unitNumber)||previous.binding.canonicalKey!==familyUnit(current.unitNumber))return {eligible:false,reason:'source_canonical_identity_conflict'};
 const n=variant(previous.binding.nativeLabel),t=variant(previous.binding.trackerLabel),categoryVariant=variant(current.category);
 if(n!==t||!representedIdentityCurrent)return {eligible:false,reason:'native_tracker_variant_or_representation_dispute'};
 if(categoryVariant&&categoryVariant!==n||n&&variant(current.unitNumber)&&variant(current.unitNumber)!==n)return {eligible:false,reason:'variant_discrepancy'};
 if(!onlyGeocodeAdded||!text(beforeGuard)||!text(afterGuard)||currentGuard!==afterGuard)return {eligible:false,reason:'protected_graph_unproven_or_drifted'};
 if(!sourceChanged||!payloadCurrent)return {eligible:false,reason:'source_transition_or_payload_fence_unproven'};
 return {eligible:true,reason:'preflight_only_requires_transactional_source_transition_review'};
}
