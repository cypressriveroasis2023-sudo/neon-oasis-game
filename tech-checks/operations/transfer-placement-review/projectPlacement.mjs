const hash=/^[a-f0-9]{64}$/;
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export function projectTransferPlacement(baseline,crosswalk,now=Date.now()){
 const saved=Date.parse(baseline?.apiSync?.lastSuccessAt);
 if(baseline?.contract!=='COS_MHELP_API_V1'||baseline.origin!=='mhelpdesk_api'||baseline.complete!==true||baseline.reviewed!==true||baseline.apiSync?.enabled!==true||!hash.test(baseline.sourceSha256)||!Number.isFinite(saved)||saved>now||now-saved>2700000||!Array.isArray(baseline.records)||baseline.records.length>10000)throw Error('Current complete inventory required');
 if(crosswalk?.reviewed!==true||!hash.test(crosswalk.revision)||!Array.isArray(crosswalk.records)||crosswalk.records.length>10000)throw Error('Reviewed transfer crosswalk required');
 const unique=(rows,key)=>new Set(rows.map(r=>r[key])).size===rows.length;
 if(!unique(baseline.records,'productId')||!unique(crosswalk.records,'productId')||!unique(crosswalk.records,'equipmentKey')||!unique(crosswalk.records,'nativeUnitId'))throw Error('Ambiguous identity');
 const rows=crosswalk.records.map(c=>{
  if(!/^[1-9][0-9]*$/.test(c.productId)||!c.equipmentKey||!c.nativeUnitId||!c.family||!c.unitTag)throw Error('Incomplete crosswalk');
  const r=baseline.records.find(r=>r.productId===c.productId),b=r?.binding;
  const eligible=!!r&&r.placement==='SHOP'&&r.lifecycle==='UNFLAGGED'&&!r.holdReason&&!r.placementHeld&&!r.possibleAliasUnitIds?.length&&b?.guardCurrent===true&&b.productId===r.productId&&b.nativeUnitId===c.nativeUnitId&&hash.test(b.expectedGuard)&&baseline.records.filter(other=>other.binding?.nativeUnitId===c.nativeUnitId).length===1
   &&(!c.reviewedNativeCanonicalKey||b.canonicalKey===c.reviewedNativeCanonicalKey)
   &&(!c.bindingEvidenceSha256||b.evidenceSha256===c.bindingEvidenceSha256);
  return {equipment_key:c.equipmentKey,product_id:c.productId,native_unit_id:c.nativeUnitId,family:c.family,unit_tag:c.unitTag,placement:r?.placement==='FIELD'?'FIELD':eligible?'SHOP':'UNKNOWN',binding_guard:eligible?b.expectedGuard:null,eligible};
 });
 return {source_sha:baseline.sourceSha256,crosswalk_sha:crosswalk.revision,saved_at:baseline.apiSync.lastSuccessAt,rows};
}
// The caller supplies existing server-only read/admission adapters. Never infer
// a crosswalk from a label, IP, ordinal or browser-provided placement assertion.
export async function publishTransferPlacement({readBaseline,readCrosswalk,publish,expectedGeneration,signal,now=Date.now}){
 const a=await readBaseline(signal),c=await readCrosswalk(signal);
 const packet=projectTransferPlacement(a,c,now());
 const afterC=await readCrosswalk(signal),after=await readBaseline(signal);
 if(signal?.aborted||canonical(a)!==canonical(after)||canonical(c)!==canonical(afterC))throw Error('Placement changed during read');
 projectTransferPlacement(after,afterC,now());
 return publish({p_expected_generation:expectedGeneration,p_packet:packet},signal);
}
