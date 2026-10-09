import {addressDigest} from './censusAddress.ts';
import {placementMatchKey,placementIdentityConcernKey} from './placementProjection.ts';
import {matchesInstallation} from './importedAddressContract.ts';
import {checkedImportedBinding,importedLegacyConcern} from './importedSourceProjection.ts';
import {reviewedLegacyEvidenceSha256,reviewedEstimatePrefix,reviewedEstimateSource} from './reviewedAddressEstimates.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown,max=160):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u001f<>]/.test(v);
const coordinate=(v:unknown,limit:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
const date=(v:unknown,now:number):v is string=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)>now)return false;
 // Check the supplied calendar date independently of its timezone offset.
 // A valid evening offset timestamp may fall on the next UTC calendar day.
 const calendar=Date.parse(v.slice(0,10)+'T00:00:00Z');
 return Number.isFinite(calendar)&&new Date(calendar).toISOString().slice(0,10)===v.slice(0,10);
};
const identity=(r:Row)=>(r.readOnly===true?'tracker':'equipment_unit')+'|'+r.id;
// Bounded source-category aliases. Full typed unit identity is never shortened.
export function recordedCoordinateFamilyKey(family:string):string{
 const raw=family.toUpperCase().replace(/[^A-Z0-9]/g,'');
 return ({SOLARSTANDS72:'SOLARSTAND72',SOLARPOLES72:'SOLARPOLE72',SOLARSKIDS144:'SOLARSKID144'} as Record<string,string>)[raw]||raw;
}
export type SourceRecordedPoint={
 latitude:number;longitude:number;matchedAddress:string;confidence:'source_recorded_unverified';source:'tracker_recorded_coordinates';
 sourceObservedAt:string;coordinateRecordedAt:null;sourceSpreadsheetId:string;sourceSheetId:string;coordinateCell:string;coordinateCellSha256:string;
};
/** Shared server/client validator. Source observation is never a GPS measurement timestamp. */
async function checkedRecordedProvenance(row:Row,now=Date.now()):Promise<SourceRecordedPoint|null>{
 try{
  const r=row.locationSourceRecorded,b=r?.binding;
  if(!object(r)||!object(b)||r.schemaVersion!==1||r.organizationId!==ORG||r.source!=='tracker_recorded_coordinates'||r.confidence!=='source_recorded_unverified'
   ||r.verified!==false||r.liveGps!==false||r.coordinateRecordedAt!==null||r.appliedByDatabaseRole!=='postgres'||!uuid(r.recordId)||!uuid(r.nativeUnitId)||!uuid(r.trackerId)
   ||r.entityKind!==(row.readOnly===true?'tracker':'equipment_unit')||r.nativeUnitId!==row.id||r.unitNumber!==row.unitNumber||r.entityKind==='tracker'&&r.trackerId!==row.id
   ||!text(r.unitNumber)||!text(r.trackerUnitNumber)||!text(r.family)||!text(r.productId,19)||!/^[1-9]\d*$/.test(r.productId)
   ||r.typedIdentity!==placementMatchKey(row.unitNumber)||r.typedIdentity!==placementMatchKey(r.trackerUnitNumber)||!r.typedIdentity.startsWith('typed:')
   ||r.typedIdentity.split('|')[0].slice(6)!==recordedCoordinateFamilyKey(r.family)||b.trackerFamily!==r.family
   ||typeof r.sourceSpreadsheetId!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(r.sourceSpreadsheetId)||typeof r.sourceSheetId!=='string'||!/^\d{1,12}$/.test(r.sourceSheetId)
   ||typeof r.coordinateCell!=='string'||!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(r.coordinateCell)
   ||!['coordinateCellSha256','sourceFileSha256','sourceRowSha256','sourceAddressSha256','legacyEvidenceSha256'].every(k=>sha(r[k]))
   ||!['nativeGuardSha256','addressSha256','trackerAddressSha256'].every(k=>sha(b[k]))||r.sourceAddressSha256!==b.trackerAddressSha256
   ||!(b.productSourceEventId===null||typeof b.productSourceEventId==='string'&&/^[1-9]\d*$/.test(b.productSourceEventId))
   ||!date(r.sourceObservedAt,now)||!date(r.appliedAt,now)||Date.parse(r.sourceObservedAt)>Date.parse(r.appliedAt)
   ||!coordinate(r.latitude,90)||!coordinate(r.longitude,180)||!text(b.installationAddress,600)||row.address!==b.installationAddress||await addressDigest(row.address)!==b.addressSha256)return null;
  if(row.placementSource==='owner'||row.placementAuditId!=null||row.placement==='SHOP'||row.placement==='UNKNOWN'||row.placementStatus==='needs_identity_review'
   ||row.locationVerification==='owner_verified'||row.locationVerification==='address_changed'||row.hasUnitGps===true||row.installedSiteId!=null
   ||row.currentLocationType!=='field'||!['field','assigned','installed','returning','in_transit'].includes(row.status)
   ||row.importedPlacement!=null&&row.importedPlacement!=='FIELD')return null;
  // Reviewed property records remain authoritative even if their own validation
  // is temporarily unavailable; never replace a review marker with a new source.
  if(row.locationNote?.startsWith?.(reviewedEstimatePrefix)||row.coordinateSource===reviewedEstimateSource||row.historicalCoordinateSource===reviewedEstimateSource)return null;
  const current=b.currentSource;
  if(current===null){if(row.importedInstallation!=null||row.importedPlacement!=null)return null;}
  else{
   const s=row.importedInstallation;
   if(!object(current)||!object(s)||!uuid(current.sourceRevision)||typeof current.eventId!=='string'||!/^[1-9]\d*$/.test(current.eventId)
    ||s.nativeUnitId!==row.id||s.entityKind!==r.entityKind||s.productId!==r.productId||s.unitNumber!==r.unitNumber||s.eligibility!=='FIELD'
    ||!['family','sourceRevision','eventId','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256'].every(k=>current[k]===s[k])
    ||current.eventId!==b.productSourceEventId||current.nativeGuardSha256!==b.nativeGuardSha256||current.addressSha256!==b.addressSha256)return null;
  }
  return {latitude:r.latitude,longitude:r.longitude,matchedAddress:b.installationAddress,confidence:'source_recorded_unverified',source:'tracker_recorded_coordinates',
   sourceObservedAt:r.sourceObservedAt,coordinateRecordedAt:null,sourceSpreadsheetId:r.sourceSpreadsheetId,sourceSheetId:r.sourceSheetId,coordinateCell:r.coordinateCell,coordinateCellSha256:r.coordinateCellSha256};
 }catch{return null;}
}
// A large contradiction is a reason to withhold an unverified source point,
// not evidence that an interpolated address point is the precise installation.
const CONFLICT_DISTANCE_KM=20;
function distanceKm(a:Row,b:Row):number{
 const rad=(v:number)=>v*Math.PI/180,lat=rad(b.latitude-a.latitude),lon=rad(b.longitude-a.longitude);
 const h=Math.sin(lat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(lon/2)**2;
 return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
async function acceptedCurrentAddressPoint(row:Row,now:number):Promise<Row|null>{
 const r=row.locationImportedGeocode,s=await checkedImportedBinding(row.importedInstallation);
 if(!s||!object(r)||r.status!=='success'||r.jobKind!=='native_import'||r.verified!==false||r.liveGps!==false||!sha(r.legacyGuardSha256)
  ||!coordinate(r.latitude,90)||!coordinate(r.longitude,180)||r.latitude===0&&r.longitude===0||!date(r.geocodedAt,now)||!matchesInstallation(s.installation,r.matchedAddress))return null;
 const returned=await checkedImportedBinding(r.binding);
 if(!returned||JSON.stringify(s)!==JSON.stringify(returned))return null;
 if(r.provider==='us_census_address_range'&&r.benchmark==='Public_AR_Current')return r;
 if(r.provider!=='geocodio'||!['rooftop','range_interpolation'].includes(r.accuracyType)||typeof r.accuracy!=='number'||!Number.isFinite(r.accuracy)||r.accuracy<0.9||r.accuracy>1
  ||![null,'building_centroid','parcel_centroid'].includes(r.matchType??null)||r.accuracyType==='range_interpolation'&&r.matchType!=null)return null;
 return r;
}
function conflict(record:Row,kind:string,km:number):Row{
 return {kind,recordId:record.recordId,recordedLatitude:record.latitude,recordedLongitude:record.longitude,
  distanceKm:Math.round(km*1000)/1000,source:'tracker_recorded_coordinates',verified:false,liveGps:false,
  coordinateCell:record.coordinateCell,sourceObservedAt:record.sourceObservedAt,coordinateRecordedAt:null};
}
export async function checkedSourceRecordedCoordinates(row:Row,now=Date.now()):Promise<SourceRecordedPoint|null>{
 const point=await checkedRecordedProvenance(row,now);if(!point)return null;
 const estimate=await acceptedCurrentAddressPoint(row,now);
 return estimate&&distanceKm(point,estimate)>CONFLICT_DISTANCE_KM?null:point;
}
/** Called last, with a fresh native read and fresh legacy identity evidence. No placement, coordinates, health or address writes. */
export async function projectSourceRecordedCoordinates(snapshot:Row,records:unknown,audits:unknown,devices:unknown,now=Date.now()):Promise<Row>{
 if(!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems))throw Error('Field Map snapshot unavailable.');
 const clear=(row:Row)=>{const {locationSourceRecorded:_stale,locationSourceRecordedConflict:_oldConflict,...clean}=row;return clean;};
 const withoutSource=()=>({...snapshot,items:snapshot.items.map(clear),inventoryItems:snapshot.inventoryItems.map(clear)});
 if(!Array.isArray(records))return withoutSource();
 try{
 const byId=new Map<string,Row>();for(const r of records){if(!object(r)||!uuid(r.nativeUnitId)||!['tracker','equipment_unit'].includes(r.entityKind))return withoutSource();const key=r.entityKind+'|'+r.nativeUnitId;if(byId.has(key))return withoutSource();byId.set(key,r);}
 const concerns=new Map<string,number>();for(const row of snapshot.inventoryItems){const key=placementIdentityConcernKey(row.unitNumber);concerns.set(key,(concerns.get(key)||0)+1);}
 const apply=async(raw:Row):Promise<Row>=>{
  const {locationSourceRecorded:_stale,locationSourceRecordedConflict:_oldConflict,...row}=raw,r=byId.get(identity(raw));
  if(!r||concerns.get(placementIdentityConcernKey(row.unitNumber))!==1||importedLegacyConcern(row.unitNumber,audits,devices))return row;
  const evidence=await reviewedLegacyEvidenceSha256(row.unitNumber,audits,devices,placementMatchKey);
  if(!evidence||evidence!==r.legacyEvidenceSha256)return row;
  const candidate={...row,locationSourceRecorded:r};
  return await checkedRecordedProvenance(candidate,now)?candidate:row;
 };
 const [inventory,items]=await Promise.all([Promise.all(snapshot.inventoryItems.map(apply)),Promise.all(snapshot.items.map(apply))]),conflicts=new Map<string,Row>();
 const candidates=inventory.filter(row=>row.locationSourceRecorded);
 await Promise.all(candidates.map(async row=>{const estimate=await acceptedCurrentAddressPoint(row,now),r=row.locationSourceRecorded;
  if(estimate){const km=distanceKm(r,estimate);if(km>CONFLICT_DISTANCE_KM)conflicts.set(identity(row),conflict(r,'current_address_disagreement',km));}
 }));
 const installations=new Map<string,Row[]>();
 for(const row of candidates){
  if(!text(row.customer,600)||!text(row.site,600))continue;
  const key=JSON.stringify([row.locationSourceRecorded.binding.addressSha256,row.customer,row.site]),group=installations.get(key);
  if(group)group.push(row);else installations.set(key,[row]);
 }
 for(const group of installations.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
  const a=group[i],b=group[j],ar=a.locationSourceRecorded,br=b.locationSourceRecorded;
  // Same complete installation evidence only; this is not an equipment identity join.
  if(identity(a)===identity(b)||ar.recordId===br.recordId)continue;
  const km=distanceKm(ar,br);if(km>CONFLICT_DISTANCE_KM){
   if(!conflicts.has(identity(a)))conflicts.set(identity(a),conflict(ar,'same_installation_disagreement',km));
   if(!conflicts.has(identity(b)))conflicts.set(identity(b),conflict(br,'same_installation_disagreement',km));
  }
 }
 const withhold=(row:Row)=>{const issue=conflicts.get(identity(row));if(!row.locationSourceRecorded||!issue||issue.recordId!==row.locationSourceRecorded.recordId)return row;
  const {locationSourceRecorded:_point,...rest}=row;return {...rest,locationSourceRecordedConflict:issue};};
 return {...snapshot,items:items.map(withhold),inventoryItems:inventory.map(withhold)};
 }catch{return withoutSource();}
}
/** Native RPC injection only; never uses the legacy provider bridge or a geocoder. */
export async function readSourceRecordedCoordinates(inventory:Row[],nativeRpc:(name:string,args:Row)=>Promise<unknown>):Promise<Row[]>{
 try{
  if(!Array.isArray(inventory))return [];
  const identities=inventory.map(row=>({entityKind:row.readOnly===true?'tracker':'equipment_unit',nativeUnitId:row.id}));
  if(identities.some(row=>!uuid(row.nativeUnitId))||new Set(identities.map(row=>row.nativeUnitId)).size!==identities.length)return [];
  const records:Row[]=[],seen=new Set<string>(),requested=new Set(identities.map(r=>r.entityKind+'|'+r.nativeUnitId));
  for(let offset=0;offset<identities.length;offset+=250){
   const page=await nativeRpc('cos_source_recorded_coordinates_read_many',{p_organization_id:ORG,p_identities:identities.slice(offset,offset+250)});
   if(!Array.isArray(page))return [];
   for(const r of page){if(!object(r)||!uuid(r.nativeUnitId)||!['tracker','equipment_unit'].includes(r.entityKind))return [];const key=r.entityKind+'|'+r.nativeUnitId;if(!requested.has(key)||seen.has(key))return [];seen.add(key);records.push(r);}
  }
  return records;
 }catch{return [];}
}
