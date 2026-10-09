import {addressDigest} from './censusAddress.ts';
import {placementMatchKey} from './placementProjection.ts';
import {checkedReviewedAddressEstimate,reviewedLegacyEvidenceSha256,reviewedEstimatePrefix,reviewedEstimateSource} from './reviewedAddressEstimates.ts';
import {validInstallation,installationAddress,suppliedComponents,matchesInstallation,safeGeocodeRejectionReason,type Installation} from './importedAddressContract.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const coord=(v:unknown,limit:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
const identity=(r:Row)=>(r.readOnly===true?'tracker':'equipment_unit')+'|'+r.id;
const concern=(v:unknown)=>placementMatchKey(v).replace(/\|(?:HD4|HDC[24]S?)$/,'');
// Caches contain only pure label normalization, scoped to one projection read.
// Source, audit, roster and authorization decisions are never shared across reads.
function labelKeys(){
 const matches=new Map<string,string>(),concerns=new Map<string,string>();
 const match=(value:unknown):string=>{if(typeof value!=='string')return placementMatchKey(value);let key=matches.get(value);if(key===undefined){key=placementMatchKey(value);matches.set(value,key);}return key;};
 const concern=(value:unknown):string=>{if(typeof value!=='string')return match(value).replace(/\|(?:HD4|HDC[24]S?)$/,'');let key=concerns.get(value);if(key===undefined){key=match(value).replace(/\|(?:HD4|HDC[24]S?)$/,'');concerns.set(value,key);}return key;};
 return {match,concern};
}

export type ImportedProjectionContext={nativeUnits:unknown;identity:unknown;currentSources?:unknown};
const deviceId=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):decimal(v)?String(v):null;
const sameSet=(a:unknown[],b:unknown[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(v=>b.includes(v));
/** A source-registry commitment, returned only by the guarded native map RPC.
 * This proves the imported record's complete native/tracker identity, not a camera
 * association. Never expose it as a health proof or a placement alias. */
function currentNativeSourceIdentity(source:Row):boolean{
 const p=source.nativeSourceIdentity;
 return Boolean(source.schemaVersion===1&&source.organizationId===ORG&&source.sourceSystem==='mhelpdesk_product_import'&&source.entityKind==='equipment_unit'
  &&uuid(source.nativeUnitId)&&decimal(source.productId)&&uuid(source.sourceRevision)&&decimal(source.eventId)
  &&['sourceFileSha256','sourceRowSha256','nativeGuardSha256'].every(k=>sha(source[k]))
  &&['FIELD','SHOP'].includes(source.placement)&&source.eligibility===(source.placement==='FIELD'?'FIELD':'tombstone')
  &&object(p)&&p.contract==='COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1'&&uuid(p.trackerId)&&typeof p.trackerUnitNumber==='string'
  &&['nativeUnitId','productId','unitNumber','sourceRevision','sourceFileSha256','sourceRowSha256','nativeGuardSha256'].every(k=>p[k]===source[k])
  &&placementMatchKey(p.trackerUnitNumber)===placementMatchKey(source.unitNumber));
}
/** Narrow display-only exception to the deny-only legacy label check. Complete
 * current native membership and exact registry proof are required at each read.
 * A family/base comparison here can reject a conflict; it never assigns cameras. */
function sourceOnlyOverlayIds(inventory:unknown,sources:unknown,audits:unknown,devices:unknown,context?:ImportedProjectionContext):Set<string>{
 const allowed=new Set<string>();if(!context)return allowed;
 const {match,concern}=labelKeys();
 const units=context.nativeUnits,identity=context.identity;
 if(![inventory,sources,audits,devices,units].every(rows=>Array.isArray(rows)&&rows.length<=100000&&rows.every(object))
  ||!object(identity)||identity.identityVersion!==1||!Array.isArray(identity.unitIdentities)||!Array.isArray(identity.identityWarnings)
  ||(identity.ownerConfirmedIdentityVersion===undefined?identity.ownerConfirmedUnitIdentities!==undefined:identity.ownerConfirmedIdentityVersion!==1||!Array.isArray(identity.ownerConfirmedUnitIdentities)))return allowed;
 const rows=inventory as Row[],native=units as Row[],sourceRows=sources as Row[],history=audits as Row[],cameras=devices as Row[];
 const nativeRows=rows.filter(r=>r.readOnly===false),nativeIds=new Set(native.map(u=>u.id));
 if(native.some(u=>!uuid(u.id)||u.organization_id!==ORG||typeof u.unit_number!=='string')||nativeIds.size!==native.length
  ||!sameSet(nativeRows.map(r=>r.id),native.map(u=>u.id))||nativeRows.some(r=>native.find(u=>u.id===r.id)?.unit_number!==r.unitNumber)
  ||new Set(rows.map(r=>r.id)).size!==rows.length||new Set(sourceRows.map(s=>s.entityKind+'|'+s.nativeUnitId)).size!==sourceRows.length
  ||cameras.some(d=>!deviceId(d.id)||typeof d.unit_key!=='string')||new Set(cameras.map(d=>deviceId(d.id))).size!==cameras.length
  ||history.some(a=>!deviceId(a.id)||typeof a.unit_key!=='string'||!Array.isArray(a.device_ids)||a.device_ids.some((id:unknown)=>!deviceId(id)))
  ||new Set(history.map(a=>deviceId(a.id))).size!==history.length)return allowed;
 const nativeById=new Map(nativeRows.map(r=>[r.id,r]));
 const nativeConcerns=new Map<string,number>(),inventoryConcerns=new Map<string,number>(),cameraGroups=new Map<string,Row[]>();
 for(const u of native){const key=concern(u.unit_number);nativeConcerns.set(key,(nativeConcerns.get(key)||0)+1);}
 for(const r of rows){const key=concern(r.unitNumber);inventoryConcerns.set(key,(inventoryConcerns.get(key)||0)+1);}
 for(const d of cameras){const key=concern(d.unit_key),group=cameraGroups.get(key);if(group)group.push(d);else cameraGroups.set(key,[d]);}
 const proofs=[...identity.unitIdentities,...(identity.ownerConfirmedUnitIdentities||[])],warnings=identity.identityWarnings;
 if(proofs.some(p=>!object(p)||!uuid(p.unitId)||typeof p.unitNumber!=='string'||!['native_provider','owner_placement','owner_confirmed_native'].includes(p.kind)||!sha(p.proof)||!Array.isArray(p.deviceIds)||!p.deviceIds.length||p.deviceIds.some((id:unknown)=>typeof id!=='string'||!deviceId(id))||!Array.isArray(p.unitKeys)||!p.unitKeys.length||p.unitKeys.some((k:unknown)=>typeof k!=='string'))
  ||warnings.some(w=>!object(w)||typeof w.unitId!=='string'||!Array.isArray(w.deviceIds)||!Array.isArray(w.unitKeys)||w.deviceIds.some((id:unknown)=>typeof id!=='string'||!deviceId(id))||w.unitKeys.some((k:unknown)=>typeof k!=='string')))return allowed;
 for(const source of sourceRows){
  if(!currentNativeSourceIdentity(source))continue;
  const row=nativeById.get(source.nativeUnitId),key=match(source.unitNumber),base=concern(source.unitNumber);
  if(!row||row.unitNumber!==source.unitNumber||!key.startsWith('typed:')||!(/\|(?:HD4|HDC[24]S?)$/).test(key)
   ||(nativeConcerns.get(base)||0)>1||(inventoryConcerns.get(base)||0)>1)continue;
  const group=cameraGroups.get(base)||[],labels=[...new Set(group.map(d=>d.unit_key))],ids=group.map(d=>deviceId(d.id)!);
  if(labels.length!==1||match(labels[0])!==base)continue;
  // Even unmarked historical Root/IT moves and differently labelled device audits
  // remain holds. Chronology resolution belongs to a separate reviewed policy.
  if(history.some(a=>concern(a.unit_key)===base||a.device_ids.some((id:unknown)=>ids.includes(deviceId(id)!))))continue;
  const related=(p:Row)=>p.unitKeys.some((k:string)=>concern(k)===base)||p.deviceIds.some((id:string)=>ids.includes(id));
  if(warnings.some(w=>w.unitId===row.id||related(w)))continue;
  const claims=proofs.filter(p=>p.unitId===row.id||related(p));
  if(claims.length&&(claims.length!==1||claims[0].kind!=='native_provider'||claims[0].unitId!==row.id||claims[0].unitNumber!==row.unitNumber
   ||!sameSet(claims[0].unitKeys,labels)||!sameSet(claims[0].deviceIds,ids)))continue;
  allowed.add(row.id);
 }
 return allowed;
}
export type ImportedBinding={schemaVersion:1;organizationId:string;sourceSystem:'mhelpdesk_product_import';entityKind:'equipment_unit'|'tracker';nativeUnitId:string;productId:string;unitNumber:string;family:string|null;variant:string|null;sourceRevision:string;sourceFileSha256:string;sourceRowSha256:string;addressSha256:string;nativeGuardSha256:string;installation:Installation;suppliedComponents:{street:boolean;city:boolean;state:boolean;zip:boolean};eligibility:'FIELD';eventId:string};
export async function checkedImportedBinding(v:unknown):Promise<ImportedBinding|null>{
 if(!object(v)||v.schemaVersion!==1||v.organizationId!==ORG||v.sourceSystem!=='mhelpdesk_product_import'||!['equipment_unit','tracker'].includes(v.entityKind)||!uuid(v.nativeUnitId)||!decimal(v.productId)||!uuid(v.sourceRevision)||!decimal(v.eventId)
  ||typeof v.unitNumber!=='string'||!v.unitNumber.trim()||v.unitNumber.length>250||!['sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256'].every(k=>sha(v[k]))||v.eligibility!=='FIELD'||!validInstallation(v.installation)||!object(v.suppliedComponents))return null;
 const supplied=suppliedComponents(v.installation);if(Object.keys(v.suppliedComponents).length!==4||Object.entries(supplied).some(([k,value])=>v.suppliedComponents[k]!==value)||await addressDigest(installationAddress(v.installation))!==v.addressSha256)return null;
 if(!(v.family===null||typeof v.family==='string'&&v.family.length<=160)||!(v.variant===null||typeof v.variant==='string'&&v.variant.length<=160))return null;
 return {schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',entityKind:v.entityKind,nativeUnitId:v.nativeUnitId,productId:v.productId,unitNumber:v.unitNumber,family:v.family,variant:v.variant,sourceRevision:v.sourceRevision,
  sourceFileSha256:v.sourceFileSha256,sourceRowSha256:v.sourceRowSha256,addressSha256:v.addressSha256,nativeGuardSha256:v.nativeGuardSha256,installation:{street:v.installation.street,city:v.installation.city,state:v.installation.state,zip:v.installation.zip},suppliedComponents:supplied,eligibility:'FIELD',eventId:v.eventId};
}
/** Deny-only family/base concern; never an identity join or an assignment of an audit to a unit. */
function legacyConcernReader(audits:unknown,devices:unknown):(unitNumber:string)=>boolean{
 if(!Array.isArray(audits)||!Array.isArray(devices)||audits.length>100000||devices.length>100000)return ()=>true;
 if(audits.some(a=>!object(a)||!Array.isArray(a.device_ids)))return ()=>true;
 const {match,concern}=labelKeys(),groups=new Map<string,Row[]>(),groupData=new Map<string,{ids:Set<string>;labels:Set<string>}>();
 for(const d of devices){if(!object(d))continue;const key=concern(d.unit_key),group=groups.get(key);if(group)group.push(d);else groups.set(key,[d]);}
 const history=audits.map(a=>({row:a,key:concern(a.unit_key)})),results=new Map<string,boolean>();
 return (unitNumber:string)=>{
  const saved=results.get(unitNumber);if(saved!==undefined)return saved;
  const key=concern(unitNumber);if(!key)return true;
  let group=groupData.get(key);if(!group){const rows=groups.get(key)||[];group={ids:new Set(rows.map(d=>String(d.id))),labels:new Set(rows.map(d=>match(d.unit_key)))};groupData.set(key,group);}
  const mismatch=group.labels.size>1||group.labels.size===1&&!group.labels.has(match(unitNumber));
  const result=mismatch||history.some(({row:a,key:auditKey})=>(auditKey===key||a.device_ids.some((id:unknown)=>group!.ids.has(String(id))))&&(a.contract==='COS_CAMERA_PLACEMENT_V2'||['MOVE_TO_FIELD','MOVE_TO_ROOT'].includes(a.action)||auditKey!==key));
  results.set(unitNumber,result);return result;
 };
}
export function importedLegacyConcern(unitNumber:string,audits:unknown,devices:unknown):boolean{
 return legacyConcernReader(audits,devices)(unitNumber);
}
/** Effective imported presentation/classification only, before Owner placement projection. No GPS or health writes. */
export async function projectImportedSourceAddresses(snapshot:Row,sources:unknown,audits:unknown,devices:unknown,previousSources:Row[]=[],context?:ImportedProjectionContext):Promise<Row>{
 if(!Array.isArray(sources)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!object(snapshot.summary))throw Error('Imported source projection unavailable');
 const byId=new Map<string,Row>();for(const s of sources){if(!object(s)||!['equipment_unit','tracker'].includes(s.entityKind)||!uuid(s.nativeUnitId)||byId.has(s.entityKind+'|'+s.nativeUnitId))throw Error('Imported source identity invalid');byId.set(s.entityKind+'|'+s.nativeUnitId,s);}
 const previouslyImported=new Set(previousSources.map(s=>s.entityKind+'|'+s.nativeUnitId));
 const sourceOnly=sourceOnlyOverlayIds(snapshot.inventoryItems,sources,audits,devices,context);
 const legacyConcernForUnit=legacyConcernReader(audits,devices);
 const inventoryItems=await Promise.all(snapshot.inventoryItems.map(async(raw:Row)=>{
  const s=byId.get(identity(raw));
  if(!s&&previouslyImported.has(identity(raw))&&raw.locationVerification!=='owner_verified'&&raw.hasUnitGps!==true&&raw.placementSource!=='owner')return {...raw,_sourceField:false,currentLocationType:'unknown',importedSourceState:'source_changed',importedInstallation:null,latitude:null,longitude:null,coordinateSource:null};
  if(!s||s.unitNumber!==raw.unitNumber||raw.placementSource==='owner'||raw.placementStatus==='needs_identity_review'||raw.placement==='UNKNOWN'||raw.hasUnitGps===true||raw.locationVerification==='owner_verified'||raw.installedSiteId!=null||legacyConcernForUnit(raw.unitNumber)&&!sourceOnly.has(raw.id))return raw;
  // Native-only, sanitized mHelp CustomerName path. It is display text, not a
  // CRM identity or a customer/site parser; keep the complete label intact.
  const sourceLabel=typeof s.siteLabel==='string'&&s.siteLabel.trim()&&s.siteLabel.length<=250?s.siteLabel:null;
  if(s.placement==='SHOP'){
   if(!uuid(s.sourceRevision)||!decimal(s.productId)||!decimal(s.eventId)||!sha(s.nativeGuardSha256)||!sha(s.sourceFileSha256)||!sha(s.sourceRowSha256))return raw;
   return {...raw,customer:sourceLabel,site:'SHOP / ROOT',address:null,addressSource:null,addressUpdatedAt:null,_sourceField:false,status:'readiness_unverified',currentLocationType:'shop',placement:null,placementSource:null,placementUnitKey:null,placementAuditId:null,placementUpdatedAt:null,importedPlacement:'SHOP',importedInstallation:{entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,productId:s.productId,sourceRevision:s.sourceRevision,eventId:s.eventId,nativeGuardSha256:s.nativeGuardSha256,sourceFileSha256:s.sourceFileSha256,sourceRowSha256:s.sourceRowSha256,placement:'SHOP'},latitude:null,longitude:null,coordinateSource:null};
  }
  const binding=await checkedImportedBinding(s);if(s.placement!=='FIELD'||!binding)return raw;
  // A current approved property estimate outranks a new automatic lookup. Validate
  // BEFORE changing any placement/address guards; an old address_changed/SHOP
  // marker must never become eligible merely because an import says FIELD.
  const reviewedCandidate=(raw.locationNote?.startsWith?.(reviewedEstimatePrefix)||raw.coordinateSource===reviewedEstimateSource||raw.historicalCoordinateSource===reviewedEstimateSource)
   &&typeof raw.address==='string'&&await addressDigest(raw.address)===binding.addressSha256
   ?{...raw,addressEstimateLegacyEvidenceSha256:await reviewedLegacyEvidenceSha256(raw.unitNumber,audits,devices,placementMatchKey)}:null;
  const preserveReviewed=reviewedCandidate&&await checkedReviewedAddressEstimate(reviewedCandidate);
  const reviewedDirect=preserveReviewed&&raw.historicalCoordinateSource!==reviewedEstimateSource&&raw.coordinateSource===reviewedEstimateSource;
  const coordinates=preserveReviewed?{address:raw.address,latitude:reviewedDirect?raw.latitude:null,longitude:reviewedDirect?raw.longitude:null,coordinateSource:reviewedDirect?raw.coordinateSource:null,
   locationVerification:raw.locationVerification,locationVerifiedAt:raw.locationVerifiedAt,locationHistoryId:raw.locationHistoryId,addressEstimateLegacyEvidenceSha256:reviewedCandidate.addressEstimateLegacyEvidenceSha256}
   :{latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_only',locationVerifiedAt:null,locationHistoryId:null,
    ...(raw.historicalCoordinateSource===reviewedEstimateSource?{historicalLatitude:null,historicalLongitude:null,historicalCoordinateSource:null}:{})};
  return {...raw,customer:sourceLabel,site:sourceLabel??'Installation site',_sourceField:true,placement:null,placementSource:null,placementUnitKey:null,placementAuditId:null,placementUpdatedAt:null,importedPlacement:'FIELD',status:['assigned','in_transit','installed','returning'].includes(raw.status)?raw.status:'field',currentLocationType:'field',address:installationAddress(binding.installation),addressSource:'mHelpDesk imported installation address',recordSource:'mHelpDesk imported installation address',
   importedInstallation:binding,...coordinates};
 }));
 const items=inventoryItems.filter((r:Row)=>r._sourceField===true);
 return {...snapshot,items,inventoryItems,summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length}};
}
export async function projectImportedGeocodes(snapshot:Row,records:unknown,audits:unknown,devices:unknown,context?:ImportedProjectionContext):Promise<Row>{
 if(!Array.isArray(records))throw Error('Imported address estimates unavailable');const byId=new Map<string,Row>();
 for(const r of records){if(!object(r)||!object(r.binding))throw Error('Imported estimate identity invalid');const key=r.binding.entityKind+'|'+r.binding.nativeUnitId;if(byId.has(key))throw Error('Duplicate imported estimate');byId.set(key,r);}
 const sourceOnly=sourceOnlyOverlayIds(snapshot.inventoryItems,context?.currentSources,audits,devices,context);
 const currentSources=Array.isArray(context?.currentSources)?context.currentSources:[];
 const legacyConcernForUnit=legacyConcernReader(audits,devices);
 const apply=async(raw:Row)=>{
  // Re-project from the current read; a previously displayed lookup is never a
  // fallback when its source proof, identity context or lookup record disappears.
  const {locationImportedGeocode:_previousImportedGeocode,...row}=raw;
  const legacyConcern=legacyConcernForUnit(row.unitNumber);
  if(row.placementSource==='owner'||row.placementAuditId!=null||row.placement==='SHOP'||row.placement==='UNKNOWN'||row.placementStatus==='needs_identity_review'||row.locationVerification==='owner_verified'||row.hasUnitGps===true||row.installedSiteId!=null||row.currentLocationType!=='field'||legacyConcern&&!sourceOnly.has(row.id))return row;
  const binding=await checkedImportedBinding(row.importedInstallation),r=byId.get(identity(row));if(!binding||!r||row.id!==binding.nativeUnitId||row.unitNumber!==binding.unitNumber||typeof row.address!=='string'||await addressDigest(row.address)!==binding.addressSha256)return row;
  if(legacyConcern){const current=await checkedImportedBinding(currentSources.find(s=>object(s)&&s.entityKind===binding.entityKind&&s.nativeUnitId===binding.nativeUnitId));if(!current||JSON.stringify(current)!==JSON.stringify(binding))return row;}
  const returned=await checkedImportedBinding(r.binding);
  if(!returned||JSON.stringify(returned)!==JSON.stringify(binding)||r.jobKind!=='native_import'||r.verified!==false||r.liveGps!==false||!sha(r.legacyGuardSha256)||!['pending','deferred','success','no_match','provider_error','held'].includes(r.status))return row;
  const geocode:Row={jobKind:'native_import',binding,legacyGuardSha256:r.legacyGuardSha256,status:r.status,verified:false,liveGps:false};
  if(r.status!=='success')geocode.reason=safeGeocodeRejectionReason(r.reason);
  if(r.status==='success'){
   if(!coord(r.latitude,90)||!coord(r.longitude,180)||!matchesInstallation(binding.installation,r.matchedAddress)||typeof r.geocodedAt!=='string'||!Number.isFinite(Date.parse(r.geocodedAt))||Date.parse(r.geocodedAt)>Date.now())return row;
   if(r.provider==='geocodio'){
    if(!['rooftop','range_interpolation'].includes(r.accuracyType)||typeof r.accuracy!=='number'||!Number.isFinite(r.accuracy)||r.accuracy<0.9||r.accuracy>1||![null,'building_centroid','parcel_centroid'].includes(r.matchType??null)||r.accuracyType==='range_interpolation'&&r.matchType!=null)return row;
   }else if(r.provider!=='us_census_address_range'||r.benchmark!=='Public_AR_Current')return row;
   Object.assign(geocode,{provider:r.provider,benchmark:r.benchmark??null,latitude:r.latitude,longitude:r.longitude,matchedAddress:r.matchedAddress,geocodedAt:r.geocodedAt,accuracyType:r.provider==='geocodio'?r.accuracyType:'range_interpolation',accuracy:r.provider==='geocodio'?r.accuracy:null,matchType:r.provider==='geocodio'?r.matchType??null:null,inferredComponents:[...(binding.suppliedComponents.city?[]:['city']),...(binding.suppliedComponents.zip?[]:['zip'])]});
  }
  return {...row,locationImportedGeocode:geocode};
 };
 return {...snapshot,items:await Promise.all(snapshot.items.map(apply)),inventoryItems:await Promise.all(snapshot.inventoryItems.map(apply))};
}
