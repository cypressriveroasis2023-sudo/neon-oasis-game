/** Read-only Field Product-ID vs accepted-pin and saved-address evidence audit.
 * A source-only address estimate does NOT establish native equipment identity,
 * verified GPS, camera health, or live/installed camera position.
 * This helper never publishes points and its counts are NOT Fleet roster counts.
 */
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim()?x.trim():null;
const norm=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const product=s=>typeof s==='string'&&/^[1-9]\d{0,14}$/.test(s);
const coord=(lat,lon)=>typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&!(lat===0&&lon===0);
const validAddress=a=>obj(a)&&[a.street,a.city,a.state,a.zip].every(text)&&/^\d{5}(-\d{4})?$/.test(a.zip)&&/^[a-z]{2}$/i.test(a.state);
const equalAddress=(a,b)=>validAddress(a)&&validAddress(b)&&['street','city','state','zip'].every(k=>norm(a[k])===norm(b[k]));
const timestamp=(v,now)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now&&/(Z|[+-]\d\d:\d\d)$/.test(v);
const sourceHold=r=>r.placementHeld===true||r.placementHeld===null||r.placementHeld!==undefined&&r.placementHeld!==false||r.possibleAliasUnitIds!==undefined&&(!Array.isArray(r.possibleAliasUnitIds)||r.possibleAliasUnitIds.length>0)||text(r.holdReason)||r.supersedesProductId!==undefined;
/** Independently approved receipt required even for *candidate* status.
 * Native association evidence is a separate boolean; not a prerequisite for
 * a clearly labeled Product-ID source-only address estimate.
 */
const validSaved=(v,r,sourceSha,payloadSha,now)=>obj(v)
 &&v.contract==='COS_SAVED_ADDRESS_CACHE_V1'&&uuid(v.receiptId)
 &&v.productId===r.productId&&v.sourceSha256===sourceSha
 &&v.payloadSha256===payloadSha&&hash(v.uploadRecordSha256)
 &&hash(v.linkageGraphSha256)&&hash(v.addressSha256)
 &&v.status==='success'&&v.verified===false&&v.liveGps===false
 &&equalAddress(v.sourceAddress,r.sourceAddress)
 &&coord(v.latitude,v.longitude)&&timestamp(v.geocodedAt,now)
 &&text(v.matchedAddress)&&(
  v.provider==='us_census_address_range'&&v.benchmark==='Public_AR_Current'&&v.accuracyType==='range_interpolation'
  ||v.provider==='geocodio'&&['rooftop','range_interpolation'].includes(v.accuracyType)
   &&typeof v.accuracy==='number'&&v.accuracy>=.9&&v.accuracy<=1
   &&(v.matchType===null||['building_centroid','parcel_centroid'].includes(v.matchType)&&v.accuracyType==='rooftop')
 );
export function auditFieldSavedLocations({sourceSha256,payloadSha256,records,acceptedProductPins=[],savedLookups=[],identityProofProductIds=[],now=Date.now()}={}){
 if(!hash(sourceSha256)||!hash(payloadSha256)||!Array.isArray(records)||!Array.isArray(acceptedProductPins)||!Array.isArray(savedLookups)||!Array.isArray(identityProofProductIds))throw Error('Complete active-source and accepted-pin evidence required');
 const seen=new Set(),pins=new Set(acceptedProductPins),identities=new Set(identityProofProductIds),review=[];
 for(const r of records){
  if(!obj(r)||!product(r.productId)||seen.has(r.productId)||!['FIELD','SHOP'].includes(r.placement))throw Error('Duplicate or invalid Product-ID source');
  seen.add(r.productId);
  if(r.placement!=='FIELD')continue;
  const isMapped=pins.has(r.productId);
  let reason;
  if(isMapped)reason='already_mapped';
  else if(r.lifecycle!=='UNFLAGGED')reason='inactive_lifecycle';
  else if(!validAddress(r.sourceAddress))reason='invalid_service_address';
  else if(sourceHold(r))reason='identity_or_placement_held';
  else {
   const saved=savedLookups.filter(x=>validSaved(x,r,sourceSha256,payloadSha256,now));
   reason=!saved.length?'no_current_approved_saved_lookup':
    new Set(saved.map(x=>x.latitude+'|'+x.longitude)).size>1?'conflicting_saved_coordinates':
     identities.has(r.productId)?'reviewed_address_candidate_linked_identity':'reviewed_address_candidate_source_only';
  }
  review.push({productId:r.productId,unitNumber:r.unitNumber,recordId:'mhelp_product:'+r.productId,reason,isMapped,nativeIdentityVerified:identities.has(r.productId)});
 }
 return {sourceSha256,payloadSha256,fieldProductRecords:review.length,mappedProductIds:review.filter(r=>r.isMapped).length,
  unmappedActiveProductIds:review.filter(r=>!r.isMapped&&r.reason!=='inactive_lifecycle').length,
  countBasis:'distinct_mhelp_product_ids_not_combined_fleet_locations',review};
}
