// Bridge existing machine identities, never source_label/unitNumber/display names.
// Only exact six-family legacy encodings with a reviewed native Product binding.
const families=new Set(['Sniper','Ranger','Spotter','Solar Spotter','Helios','Recon 2']);
const hash=/^[a-f0-9]{64}$/;
const tag=v=>typeof v==='string'&&/^[0-9]{1,6}(?:\.[0-9]+)?$/.test(v)&&Number(v.split('.')[0])>0?String(Number(v.split('.')[0]))+(v.includes('.')?'.'+v.split('.')[1]:''):null;
const identity=e=>families.has(e.canonical_family)&&tag(e.unit_tag)?e.canonical_family.toUpperCase()+':'+tag(e.unit_tag):null;
export function inspectEncodingBridge(native,legacy){
 const records=[],held=[];
 for(const e of legacy){
  const key=identity(e);
  if(!key||e.source_family!==e.canonical_family||e.workflow_type!==e.canonical_family||e.equipment_key!==e.source_family.toLowerCase().replaceAll(' ','_')+':'+e.unit_tag){held.push({equipmentKey:e.equipment_key,reason:'unsupported_or_inconsistent_legacy_encoding'});continue;}
  if(legacy.filter(other=>identity(other)===key).length!==1){held.push({equipmentKey:e.equipment_key,reason:'ambiguous_legacy_identity'});continue;}
  const matches=native.filter(r=>r.binding?.canonicalKey===key);
  if(matches.length!==1){held.push({equipmentKey:e.equipment_key,reason:matches.length?'ambiguous_product_identity':'no_reviewed_canonical_binding'});continue;}
  const r=matches[0],b=r.binding;
  if(b.matchMethod!=='reviewed_product_id'||b.productId!==r.productId||!b.nativeUnitId||b.guardCurrent!==true||!hash.test(b.evidenceSha256)||!hash.test(b.expectedGuard)||native.filter(other=>other.binding?.nativeUnitId===b.nativeUnitId).length!==1||r.possibleAliasUnitIds?.length||r.holdReason||r.placementHeld){held.push({equipmentKey:e.equipment_key,productId:r.productId,reason:'binding_not_current_unique_reviewed_product'});continue;}
  records.push({productId:r.productId,nativeUnitId:b.nativeUnitId,equipmentKey:e.equipment_key,family:e.canonical_family,unitTag:e.unit_tag,reviewedNativeCanonicalKey:key,bindingEvidenceSha256:b.evidenceSha256});
 }
 return {records,held};
}
