/** Read-only Field Product-ID and saved-address candidate audit.
 * This cannot create a pin, attest GPS or equate Product IDs to the combined
 * Fleet roster. Caller supplies separately proven current pin memberships.
 */
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const txt=x=>typeof x==='string'&&x.trim()?x.trim():null;
const norm=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();
const coord=(lat,lon)=>typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
const addressValid=a=>obj(a)&&[a.street,a.city,a.state,a.zip].every(txt);
const addressSame=(a,b)=>obj(a)&&obj(b)&&['street','city','state','zip'].every(k=>norm(a[k])===norm(b[k]));
const product=s=>typeof s==='string'&&/^[1-9]\d{0,18}$/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export function auditFieldSavedLocations({sourceSha256,records,acceptedProductPins=[],savedLookups=[],identityProofProductIds=[],now=Date.now()}={}){
 if(!hash(sourceSha256)||!Array.isArray(records)||!Array.isArray(acceptedProductPins)||!Array.isArray(savedLookups)||!Array.isArray(identityProofProductIds))throw Error('Complete source and accepted-pin evidence required');
 const seen=new Set(),pins=new Set(acceptedProductPins),identities=new Set(identityProofProductIds),review=[];
 for(const r of records){
  if(!obj(r)||!product(r.productId)||seen.has(r.productId)||!['FIELD','SHOP'].includes(r.placement))throw Error('Duplicate or invalid Product-ID source');
  seen.add(r.productId);
  if(r.placement!=='FIELD')continue;
  const mapped=pins.has(r.productId);
  let reason='';
  if(mapped)reason='already_mapped';
  else if(r.lifecycle!=='UNFLAGGED')reason='inactive_lifecycle';
  else if(!addressValid(r.sourceAddress))reason='invalid_service_address';
  else if(r.placementHeld===true||txt(r.holdReason))reason='identity_or_placement_held';
  else if(!identities.has(r.productId))reason='product_identity_unproven';
  else {
   const saved=savedLookups.filter(x=>obj(x)&&x.productId===r.productId&&x.sourceSha256===sourceSha256&&x.status==='success'
    &&addressSame(x.sourceAddress,r.sourceAddress)&&coord(x.latitude,x.longitude)
    &&Number.isFinite(Date.parse(x.geocodedAt))&&Date.parse(x.geocodedAt)<=now);
   reason=!saved.length?'no_current_proven_saved_lookup':
    new Set(saved.map(x=>x.latitude+'|'+x.longitude)).size>1?'conflicting_saved_coordinates':'saved_lookup_candidate_only';
  }
  review.push({productId:r.productId,unitNumber:r.unitNumber,recordId:'mhelp_product:'+r.productId,reason,isMapped:mapped});
 }
 return {sourceSha256,fieldProductRecords:review.length,mappedProductIds:review.filter(r=>r.isMapped).length,
  unmappedActiveProductIds:review.filter(r=>!r.isMapped&&r.reason!=='inactive_lifecycle').length,
  // Explicitly NOT the combined Fleet map's missing-location count.
  countBasis:'distinct_mhelp_product_ids_not_combined_fleet_locations',review};
}
