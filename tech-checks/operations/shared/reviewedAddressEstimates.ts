/** Reviewed property estimates are independent of Census and verified GPS. No writes or lookups. */
export const reviewedEstimatePrefix = 'COS_ADDRESS_ESTIMATE_V2|';
export const reviewedEstimateSource = 'geocodio_reviewed_property_estimate';
export type ReviewedDifference = 'approved_city_label_equivalence'|'approved_state_route_alias'|'approved_missing_street_suffix';
export type ReviewedAddressEstimate = {
  latitude:number; longitude:number; matchedAddress:string; originalAddress:string; retrievedAt:string;
  confidence:'approximate_property_location'; source:typeof reviewedEstimateSource; provider:'geocodio';
  providerAccuracy:number; providerAccuracyType:'rooftop'; providerMatchType:string|null; providerDataSource:string;
  approvedDifference:ReviewedDifference;
};
type Row = Record<string,any>;
const object = (v:unknown):v is Row => Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const text = (v:unknown,max:number):v is string => typeof v==='string'&&v.trim().length>0&&v.length<=max;
const uuid = (v:unknown):v is string => typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const exactKeys = (v:Row,keys:string[]) => Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const payloadKeys = 'schemaVersion organizationId trackerId unitNumber source originalAddress originalAddressSha256 matchedAddress latitude longitude provider providerAccuracy providerAccuracyType providerMatchType providerDataSource providerResultSha256 confidence verified liveGps requiresOwnerConfirmation approvalReference batchId approvedAt retrievedAt appliedAt appliedByDatabaseRole addressMatchReview binding approvalSha256 applicationSha256'.split(' ');
const sha = (v:unknown):v is string => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const coordinate = (v:unknown,limit:number):v is number => typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
const date = (v:unknown,now:number):v is string => {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)>now)return false;
  return new Date(v).toISOString().slice(0,10)===v.slice(0,10);
};
export async function reviewedEstimateSha256(value:string):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
}
/** Only opaque digests are shipped. No private addresses or unit roster are committed. */
const approvedReviewDigests:ReadonlySet<string> = new Set([
  'cd11a546a2fd9ddb49beb7f21121f0a6446945d52aad569a9d22a5bbad2849b0',
  '6b7cd74a1ab7318d3fb6c7a3e4e417b123d98b1be790e530553a0d31252e7a5d',
  'cc0f22f00b2774d987bd2106f4dfe60fbc921befd1172fd537f522e2bdcb0e59',
  'e4f38f1db4d0994f137316e710c122d8ddd6061509a45ed14ef6d93ca952a7cb',
  '7e9ac92896828482ffc92d61d8f20ab4121e69127890071d77eb75fa5b03c052',
  '8bad9553255d9b38fe5680aed6afaf04a903d0477266aed7ba7ca38f15e6d673',
  '8377d48ad723fa00f1d0e823086434e0754b4501f8caadc0f965d3865a5e016a',
  'b086108e5dfaccec990fdacc6ddb70ea1205a7a2efb4830b188e4b41b2a71a98',
  '700ce176acf196bb8d7c5ab998a1c7cb25514b3367df3845bd6d10b323e1b211',
  '91e83bc904d563a1b69c0154c8e44f6f0c6aac99c51b2f9e2ec92dfa59f24c46',
  '618bc3919ba4401ec41aa4022c797548e8396371a77fac77bb7b7fe4b43bdd1d',
  'f34b60b81736ef05adb82d913b108ac99cf73269263a50d921ee3bc248c17a1c',
  'fd4df74c6fa4e2c63345ed5109319a45dc1e09b3f56c3e0c7f90b3560d1186d9',
  '8b9d97ea1f60705e42f63ed1dd67541755f2d018b4aa238024ea8d3756cf7d7d',
]);
// Application bindings are frozen separately after the current server-issued epochs and evidence are reviewed.
const approvedApplicationDigests:ReadonlySet<string> = new Set([
  '39fe5d15f8b6e475fbb77db70f425660527bb3c44e11a0dbd589c8b461a0913d',
  'ba8e1fa4788946ce245bed8beb659aafcdcf194ed1fa29414907f61d6c6277b8',
  '287e49c83d16a12898676c8adb1e907714ce069d06cac9c18a366129208c7363',
  '14dc47e75f830540edbddbd4adf2538471f486b4437dd98e2cd95895987342ab',
  'b3370ae2e93a3c62cf5458337c62099da3f73284c7ce09a7d97384e2b2976cb8',
  '693759f814cf4fce261bfa99d01cd4cf81b102ac51401fa453c0820c2b40f205',
  '3e0f137d802a42ef1e0f0b3f118a91387d7248ee12ec2b4904cc5c7d1b2b1dad',
  '5e8a033c48879a35ae06ef910d777f3ed4943a1cc3d37fa9963163e08fcb1db6',
  '2a6886e790b45575d75d2ed2eb35e4d1d2bf6f69056b6f3691f33587af6e8f89',
  '5490ee615a7653f914c0164d4bff6bc4b5ef352513b1b1cba3dce6d87432c700',
  '30a6afaac7efa13a23b96564c27c1ceec8430dfdd43953411c5bfa7d8e682cd4',
  '802898cec1c8d1d0f1580f9d075d2dc992408974a8be2010215a8257f7571b35',
  '519c083868cbf472121126cce38502517aedd7584e2c54ff5c57f9808e6655bf',
  '234a2c95d96c80d9e582a59de195eeff01c8303c87416bf716d83887774f95ea',
]);
export async function reviewedApplicationDigest(p:Row):Promise<string> {
  return reviewedEstimateSha256(JSON.stringify([p.approvalSha256,p.binding?.trackerSourceEpoch,p.binding?.nativeId,p.binding?.nativeUnitNumber,p.binding?.nativeAuditIdsSha256,p.binding?.legacyEvidenceSha256]));
}
/** Canonical UTF-8 JSON array; all immutable reviewed facts and exact unit identities are sealed. */
export async function reviewedApprovalDigest(p:Row):Promise<string> {
  return reviewedEstimateSha256(JSON.stringify([
    'COS_ADDRESS_ESTIMATE_REVIEW_V2',p.organizationId,p.trackerId,p.unitNumber,p.binding?.nativeId,p.binding?.nativeUnitNumber,
    p.originalAddressSha256,p.originalAddress,p.matchedAddress,p.latitude,p.longitude,p.source,p.provider,
    p.providerAccuracy,p.providerAccuracyType,p.providerMatchType,p.providerDataSource,p.confidence,p.providerResultSha256,
    p.approvalReference,p.batchId,p.approvedAt,p.retrievedAt,p.addressMatchReview?.kind,
  ]));
}
const aliases:Record<string,string> = {COUNTY:'CO',ROAD:'RD',STREET:'ST',AVENUE:'AVE',BOULEVARD:'BLVD',DRIVE:'DR',LANE:'LN',COURT:'CT',PLACE:'PL',PARKWAY:'PKWY',HIGHWAY:'HWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W'};
function parts(value:string) {
  const m=/^(.+),\s*([^,]+),\s*([A-Z]{2})(?:\s*,\s*|\s+)(\d{5})(-\d{4})?\s*$/i.exec(value);
  if(!m||!/^\d+[A-Z]?\s/i.test(m[1]))return null;
  const street=m[1].toUpperCase().replace(/\./g,'').replace(/\b[A-Z]+\b/g,w=>aliases[w]||w).replace(/\s+/g,' ').trim();
  return {street,city:m[2].trim().replace(/\s+/g,' ').toUpperCase(),state:m[3].toUpperCase(),zip:m[4]+(m[5]||'')};
}
/** These checks narrow a sealed exact approved pair; they never authorize a new pair. */
export function reviewedAddressPairMatches(original:string,matched:string,kind:unknown):boolean {
  const a=parts(original),b=parts(matched);
  if(!a||!b||a.state!==b.state||a.zip!==b.zip)return false;
  if(kind==='approved_city_label_equivalence')return a.street===b.street&&a.city!==b.city;
  if(a.city!==b.city)return false;
  if(kind==='approved_missing_street_suffix')return !/\b(?:RD|ST|AVE|BLVD|DR|LN|CT|PL|PKWY|HWY|TER|CIR|TRL)$/.test(a.street)&&new RegExp('^'+a.street.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' (?:RD|ST|AVE|BLVD|DR|LN|CT|PL|PKWY|TER|CIR|TRL)$').test(b.street);
  if(kind==='approved_state_route_alias'){
    const x=/^(\d+[A-Z]?) HWY (\d+)$/.exec(a.street),y=new RegExp('^(\\d+[A-Z]?) '+a.state+'-(\\d+)$').exec(b.street);
    return Boolean(x&&y&&x[1]===y[1]&&x[2]===y[2]);
  }
  return false;
}
export function readReviewedEstimate(note:unknown):Row|null {
  if(typeof note!=='string')return null;
  const first=note.split('\n',1)[0];
  if(!first.startsWith(reviewedEstimatePrefix)||first.length>8192)return null;
  try {const p=JSON.parse(first.slice(reviewedEstimatePrefix.length));return object(p)?p:null;}catch{return null;}
}
/** Policy injection is only for isolated synthetic tests; production callers always use the fixed allowlist. */
export async function checkedReviewedAddressEstimate(row:Row,now=Date.now(),approvals:ReadonlySet<string>=approvedReviewDigests,applications:ReadonlySet<string>=approvedApplicationDigests):Promise<ReviewedAddressEstimate|null> {
  try {
    const p=readReviewedEstimate(row.locationNote);
    if(!p||!object(p.binding)||!object(p.addressMatchReview)||!exactKeys(p,payloadKeys)||!exactKeys(p.binding,['trackerSourceEpoch','nativeId','nativeUnitNumber','nativeAuditIdsSha256','legacyEvidenceSha256'])||!exactKeys(p.addressMatchReview,['kind','originalAddress','matchedAddress','approvedDifferencesOnly'])||p.schemaVersion!==2||p.source!==reviewedEstimateSource||p.provider!=='geocodio'
      ||p.confidence!=='approximate_property_location'||p.verified!==false||p.liveGps!==false||p.requiresOwnerConfirmation!==true
      ||p.providerAccuracy!==1||p.providerAccuracyType!=='rooftop'||!(p.providerMatchType===null||text(p.providerMatchType,100))||!text(p.providerDataSource,300)
      ||!uuid(p.organizationId)||p.organizationId!==row.addressEstimateOrganizationId||!uuid(p.trackerId)||!text(p.unitNumber,160)
      ||!text(p.originalAddress,600)||p.originalAddress!==row.address||!text(p.matchedAddress,600)
      ||!sha(p.originalAddressSha256)||!sha(p.providerResultSha256)||!sha(p.approvalSha256)||!sha(p.applicationSha256)
      ||!text(p.batchId,100)||!text(p.approvalReference,200)||!text(p.appliedByDatabaseRole,100)
      ||!date(p.retrievedAt,now)||!date(p.approvedAt,now)||!date(p.appliedAt,now)||Date.parse(p.retrievedAt)>Date.parse(p.approvedAt)||Date.parse(p.approvedAt)>Date.parse(p.appliedAt)
      ||!coordinate(p.latitude,90)||!coordinate(p.longitude,180)||p.addressMatchReview.approvedDifferencesOnly!==true
      ||p.addressMatchReview.originalAddress!==p.originalAddress||p.addressMatchReview.matchedAddress!==p.matchedAddress
      ||!reviewedAddressPairMatches(p.originalAddress,p.matchedAddress,p.addressMatchReview.kind))return null;
    if(row.status!=='field'||row.hasUnitGps===true||row.installedSiteId!=null||row.locationVerification==='owner_verified'||row.locationVerification==='address_changed'
      ||row.placementSource==='owner'||row.placementAuditId!=null||row.placementStatus==='needs_identity_review'||row.placement==='UNKNOWN'
      ||row.locationGeocode!=null)return null;
    const trackerOnly=row.readOnly===true;
    if(trackerOnly ? row.currentLocationType!=='field'||row.id!==p.trackerId||row.unitNumber!==p.unitNumber||p.binding.nativeId!==null||p.binding.nativeUnitNumber!==null||!sha(row.addressEstimateNativeRevision) :
      row.readOnly!==false||!['field',null,undefined,''].includes(row.currentLocationType)||!uuid(p.binding.nativeId)||row.id!==p.binding.nativeId||row.unitNumber!==p.binding.nativeUnitNumber
      ||row.addressEstimateTrackerId!==p.trackerId||row.addressEstimateUnitNumber!==p.unitNumber||!sha(row.addressEstimateNativeRevision))return null;
    if(!uuid(p.binding.trackerSourceEpoch)||p.binding.trackerSourceEpoch!==row.addressEstimateReviewEpoch
      ||p.binding.nativeAuditIdsSha256!==row.addressEstimateNativeRevision||!sha(p.binding.legacyEvidenceSha256)||p.binding.legacyEvidenceSha256!==row.addressEstimateLegacyEvidenceSha256)return null;
    const historical=row.historicalCoordinateSource===reviewedEstimateSource;
    const latitude=historical?row.historicalLatitude:row.latitude,longitude=historical?row.historicalLongitude:row.longitude;
    if(!historical&&row.coordinateSource!==reviewedEstimateSource||!coordinate(latitude,90)||!coordinate(longitude,180)||latitude!==p.latitude||longitude!==p.longitude)return null;
    if(await reviewedEstimateSha256(row.address.replace(/\s+/g,' ').trim().toLowerCase())!==p.originalAddressSha256||await reviewedApprovalDigest(p)!==p.approvalSha256||!approvals.has(p.approvalSha256)||await reviewedApplicationDigest(p)!==p.applicationSha256||!applications.has(p.applicationSha256))return null;
    return {latitude:p.latitude,longitude:p.longitude,matchedAddress:p.matchedAddress,originalAddress:p.originalAddress,retrievedAt:p.retrievedAt,
      confidence:'approximate_property_location',source:reviewedEstimateSource,provider:'geocodio',providerAccuracy:p.providerAccuracy,providerAccuracyType:'rooftop',providerMatchType:p.providerMatchType,providerDataSource:p.providerDataSource,approvedDifference:p.addressMatchReview.kind};
  }catch{return null;}
}
const id = (v:unknown):string|null => typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
const numericOrder = (a:string,b:string) => BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
/** Suffix-related labels are concerns for revocation only, never a join or placement decision. */
export function reviewedLegacyConcernKey(value:unknown,matchKey:(v:unknown)=>string):string {
  const key=matchKey(value);
  return key.startsWith('typed:')?key.replace(/\|(?:HD4|HDC[24]S?)$/,''):key;
}
/** Hash current exact/base-concern evidence, including audits referring to current concern device IDs. */
export async function reviewedLegacyEvidenceSha256(unitNumber:string,audits:unknown,devices:unknown,matchKey:(v:unknown)=>string):Promise<string|null> {
  try {
    if(!Array.isArray(audits)||!Array.isArray(devices)||audits.length>100000||devices.length>100000)return null;
    const key=matchKey(unitNumber),concernKey=reviewedLegacyConcernKey(unitNumber,matchKey);if(!key)return null;
    if(devices.some(d=>!object(d)||!id(d.id)||!text(d.unit_key,160))||audits.some(a=>!object(a)||!id(a.id)||!text(a.unit_key,160)))return null;
    const roster=devices.filter(d=>reviewedLegacyConcernKey(d.unit_key,matchKey)===concernKey);
    const exactRoster=roster.filter(d=>matchKey(d.unit_key)===key);
    if(new Set(roster.map(d=>id(d.id))).size!==roster.length||new Set(exactRoster.map(d=>d.unit_key.trim().toUpperCase())).size>1)return null;
    const deviceIds=new Set(roster.map(d=>id(d.id)));
    const related=audits.filter(a=>reviewedLegacyConcernKey(a.unit_key,matchKey)===concernKey||(Array.isArray(a.device_ids)&&a.device_ids.some((v:unknown)=>deviceIds.has(id(v)))));
    if(new Set(related.map(a=>id(a.id))).size!==related.length||related.some(a=>!text(a.action,100)||!(a.contract===null||text(a.contract,100))||!Array.isArray(a.device_ids)||a.device_ids.some((v:unknown)=>!id(v))||new Set(a.device_ids.map(id)).size!==a.device_ids.length))return null;
    // A cross-device audit under an unrelated family/base remains an identity conflict.
    if(related.some(a=>reviewedLegacyConcernKey(a.unit_key,matchKey)!==concernKey))return null;
    const auditTuples=related.map(a=>[id(a.id),a.unit_key,a.action,a.contract,[...a.device_ids.map(id)].sort(numericOrder)]).sort((a,b)=>numericOrder(a[0] as string,b[0] as string));
    const rosterTuples=roster.map(d=>[id(d.id),d.unit_key]).sort((a,b)=>numericOrder(a[0] as string,b[0] as string));
    return reviewedEstimateSha256(JSON.stringify(['COS_REVIEWED_ESTIMATE_LEGACY_V2',key,auditTuples,rosterTuples]));
  }catch{return null;}
}
/** Run after Owner placement and automatic Census projection. Raw marker claims never count as fresh legacy evidence. */
export async function projectReviewedAddressEstimates(snapshot:Row,audits:unknown,devices:unknown,matchKey:(v:unknown)=>string,now=Date.now(),approvals:ReadonlySet<string>=approvedReviewDigests,applications:ReadonlySet<string>=approvedApplicationDigests):Promise<Row> {
  const apply=async(row:Row)=>{
    if(!row.locationNote?.startsWith?.(reviewedEstimatePrefix)&&row.coordinateSource!==reviewedEstimateSource&&row.historicalCoordinateSource!==reviewedEstimateSource)return row;
    const evidence=await reviewedLegacyEvidenceSha256(row.unitNumber,audits,devices,matchKey);
    const candidate={...row,addressEstimateLegacyEvidenceSha256:evidence};
    if(evidence&&await checkedReviewedAddressEstimate(candidate,now,approvals,applications))return candidate;
    return {...row,addressEstimateLegacyEvidenceSha256:null,
      ...(row.coordinateSource===reviewedEstimateSource?{latitude:null,longitude:null,coordinateSource:null}:{}),
      ...(row.historicalCoordinateSource===reviewedEstimateSource?{historicalLatitude:null,historicalLongitude:null,historicalCoordinateSource:null}:{}),
    };
  };
  return {...snapshot,items:await Promise.all(snapshot.items.map(apply)),inventoryItems:await Promise.all(snapshot.inventoryItems.map(apply))};
}
