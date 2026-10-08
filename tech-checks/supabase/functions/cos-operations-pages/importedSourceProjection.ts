import {addressDigest} from './censusAddress.ts';
import {placementMatchKey} from './placementProjection.ts';
import {validInstallation,installationAddress,suppliedComponents,matchesInstallation,type Installation} from './importedAddressContract.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const coord=(v:unknown,limit:number)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
const identity=(r:Row)=>(r.readOnly===true?'tracker':'equipment_unit')+'|'+r.id;
const concern=(v:unknown)=>placementMatchKey(v).replace(/\|(?:HD4|HDC[24]S?)$/,'');
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
export function importedLegacyConcern(unitNumber:string,audits:unknown,devices:unknown):boolean{
 if(!Array.isArray(audits)||!Array.isArray(devices)||audits.length>100000||devices.length>100000)return true;
 const key=concern(unitNumber);if(!key)return true;
 const relevant=devices.filter(d=>object(d)&&concern(d.unit_key)===key),ids=new Set(relevant.map(d=>String(d.id)));
 const labels=new Set(relevant.map(d=>placementMatchKey(d.unit_key)));labels.add(placementMatchKey(unitNumber));
 if(labels.size>1)return true;
 return audits.some(a=>!object(a)||!Array.isArray(a.device_ids)||
  (concern(a.unit_key)===key||a.device_ids.some((id:unknown)=>ids.has(String(id))))&&
  (a.contract==='COS_CAMERA_PLACEMENT_V2'||['MOVE_TO_FIELD','MOVE_TO_ROOT'].includes(a.action)||concern(a.unit_key)!==key));
}
/** Effective imported address/classification only, before Owner placement projection. No GPS or health writes. */
export async function projectImportedSourceAddresses(snapshot:Row,sources:unknown,audits:unknown,devices:unknown,previousSources:Row[]=[]):Promise<Row>{
 if(!Array.isArray(sources)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!object(snapshot.summary))throw Error('Imported source projection unavailable');
 const byId=new Map<string,Row>();for(const s of sources){if(!object(s)||!['equipment_unit','tracker'].includes(s.entityKind)||!uuid(s.nativeUnitId)||byId.has(s.entityKind+'|'+s.nativeUnitId))throw Error('Imported source identity invalid');byId.set(s.entityKind+'|'+s.nativeUnitId,s);}
 const previouslyImported=new Set(previousSources.map(s=>s.entityKind+'|'+s.nativeUnitId));
 const inventoryItems=await Promise.all(snapshot.inventoryItems.map(async(raw:Row)=>{
  const s=byId.get(identity(raw));
  if(!s&&previouslyImported.has(identity(raw))&&raw.locationVerification!=='owner_verified'&&raw.hasUnitGps!==true&&raw.placementSource!=='owner')return {...raw,_sourceField:false,currentLocationType:'unknown',importedSourceState:'source_changed',importedInstallation:null,latitude:null,longitude:null,coordinateSource:null};
  if(!s||s.unitNumber!==raw.unitNumber||raw.placementSource==='owner'||raw.placementStatus==='needs_identity_review'||raw.placement==='UNKNOWN'||raw.hasUnitGps===true||raw.locationVerification==='owner_verified'||raw.installedSiteId!=null||importedLegacyConcern(raw.unitNumber,audits,devices))return raw;
  if(s.placement==='SHOP'){
   if(!uuid(s.sourceRevision)||!decimal(s.productId)||!decimal(s.eventId)||!sha(s.nativeGuardSha256)||!sha(s.sourceFileSha256)||!sha(s.sourceRowSha256))return raw;
   return {...raw,site:'SHOP / ROOT',_sourceField:false,status:'readiness_unverified',currentLocationType:'shop',placement:null,placementSource:null,placementUnitKey:null,placementAuditId:null,placementUpdatedAt:null,importedPlacement:'SHOP',importedInstallation:{entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,productId:s.productId,sourceRevision:s.sourceRevision,eventId:s.eventId,nativeGuardSha256:s.nativeGuardSha256,sourceFileSha256:s.sourceFileSha256,sourceRowSha256:s.sourceRowSha256,placement:'SHOP'},latitude:null,longitude:null,coordinateSource:null};
  }
  const binding=await checkedImportedBinding(s);if(s.placement!=='FIELD'||!binding)return raw;
  return {...raw,site:typeof s.siteLabel==='string'&&s.siteLabel.trim()?s.siteLabel:'Installation site',_sourceField:true,placement:null,placementSource:null,placementUnitKey:null,placementAuditId:null,placementUpdatedAt:null,importedPlacement:'FIELD',status:['assigned','in_transit','installed','returning'].includes(raw.status)?raw.status:'field',currentLocationType:'field',address:installationAddress(binding.installation),addressSource:'mHelpDesk imported installation address',recordSource:'mHelpDesk imported installation address',
   importedInstallation:binding,latitude:null,longitude:null,coordinateSource:null,locationVerification:'address_only',locationVerifiedAt:null,locationHistoryId:null};
 }));
 const items=inventoryItems.filter((r:Row)=>r._sourceField===true);
 return {...snapshot,items,inventoryItems,summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length}};
}
export async function projectImportedGeocodes(snapshot:Row,records:unknown,audits:unknown,devices:unknown):Promise<Row>{
 if(!Array.isArray(records))throw Error('Imported address estimates unavailable');const byId=new Map<string,Row>();
 for(const r of records){if(!object(r)||!object(r.binding))throw Error('Imported estimate identity invalid');const key=r.binding.entityKind+'|'+r.binding.nativeUnitId;if(byId.has(key))throw Error('Duplicate imported estimate');byId.set(key,r);}
 const apply=async(row:Row)=>{
  if(row.placementSource==='owner'||row.placementAuditId!=null||row.placement==='SHOP'||row.placement==='UNKNOWN'||row.placementStatus==='needs_identity_review'||row.locationVerification==='owner_verified'||row.hasUnitGps===true||row.currentLocationType!=='field'||importedLegacyConcern(row.unitNumber,audits,devices))return row;
  const binding=await checkedImportedBinding(row.importedInstallation),r=byId.get(identity(row));if(!binding||!r||row.id!==binding.nativeUnitId||row.unitNumber!==binding.unitNumber||typeof row.address!=='string'||await addressDigest(row.address)!==binding.addressSha256)return row;
  const returned=await checkedImportedBinding(r.binding);
  if(!returned||JSON.stringify(returned)!==JSON.stringify(binding)||r.jobKind!=='native_import'||r.verified!==false||r.liveGps!==false||!sha(r.legacyGuardSha256)||!['pending','deferred','success','no_match','provider_error','held'].includes(r.status))return row;
  const geocode:Row={jobKind:'native_import',binding,legacyGuardSha256:r.legacyGuardSha256,status:r.status,verified:false,liveGps:false};
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
