import {checkedArchivedRepresentations} from './archivedRepresentationProjection.ts';
import {checkedSourcePrecedence,sourcePrecedenceAuditSha256,type SourcePrecedence} from '../_shared/sourcePrecedence.ts';
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

export type ImportedProjectionContext={nativeUnits:unknown;identity:unknown;currentSources?:unknown;archivedRepresentations?:unknown;previousArchivedRepresentations?:unknown;confirmedPrecedenceBindings?:unknown};
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
 const archives=checkedArchivedRepresentations(rows,context.archivedRepresentations,history,cameras,context);
 const inventoryById=new Map(rows.map(r=>[r.id,r]));
 const archivedNativeCounts=new Map<string,number>(),archivedInventoryCounts=new Map<string,number>();
 for(const proof of archives){
  const base=concern(proof.canonicalUnitNumber);
  for(const archivedId of [proof.archivedNativeId,proof.archivedTrackerId]){
   const nativeRow=nativeById.get(archivedId),inventoryRow=inventoryById.get(archivedId);
   if(nativeRow&&concern(nativeRow.unitNumber)===base)archivedNativeCounts.set(proof.canonicalNativeId,(archivedNativeCounts.get(proof.canonicalNativeId)||0)+1);
   if(inventoryRow&&concern(inventoryRow.unitNumber)===base)archivedInventoryCounts.set(proof.canonicalNativeId,(archivedInventoryCounts.get(proof.canonicalNativeId)||0)+1);
  }
 }
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
   ||(nativeConcerns.get(base)||0)>1+(archivedNativeCounts.get(row.id)||0)||(inventoryConcerns.get(base)||0)>1+(archivedInventoryCounts.get(row.id)||0))continue;
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
const trackerRecordId=(v:unknown):v is string=>typeof v==='string'&&v.length<=400&&/^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
const validSourceType=(v:Row)=>v.schemaVersion===1&&v.sourceSystem==='mhelpdesk_product_import'&&decimal(v.productId)&&!Object.hasOwn(v,'sourceRecordId')
 ||v.schemaVersion===2&&v.sourceSystem==='google_sheet_tracker'&&v.entityKind==='tracker'&&trackerRecordId(v.sourceRecordId)&&!Object.hasOwn(v,'productId');
const sourceIdentity=(v:Row)=>v.sourceSystem==='google_sheet_tracker'?{sourceSystem:'google_sheet_tracker' as const,sourceRecordId:v.sourceRecordId}:{productId:v.productId};
export type ImportedBinding={sourcePrecedence?:SourcePrecedence;schemaVersion:1|2;organizationId:string;sourceSystem:'mhelpdesk_product_import'|'google_sheet_tracker';entityKind:'equipment_unit'|'tracker';nativeUnitId:string;productId?:string;sourceRecordId?:string;unitNumber:string;family:string|null;variant:string|null;sourceRevision:string;sourceFileSha256:string;sourceRowSha256:string;addressSha256:string;nativeGuardSha256:string;installation:Installation;suppliedComponents:{street:boolean;city:boolean;state:boolean;zip:boolean};eligibility:'FIELD';eventId:string};
export async function checkedImportedBinding(v:unknown):Promise<ImportedBinding|null>{
 if(!object(v)||!validSourceType(v)||v.organizationId!==ORG||!['equipment_unit','tracker'].includes(v.entityKind)||!uuid(v.nativeUnitId)||!uuid(v.sourceRevision)||!decimal(v.eventId)
  ||typeof v.unitNumber!=='string'||!v.unitNumber.trim()||v.unitNumber.length>250||!['sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256'].every(k=>sha(v[k]))||v.eligibility!=='FIELD'||!validInstallation(v.installation)||!object(v.suppliedComponents))return null;
 const precedence=checkedSourcePrecedence(v);if(Object.hasOwn(v,'sourcePrecedence')&&!precedence)return null;
 const supplied=suppliedComponents(v.installation);if(Object.keys(v.suppliedComponents).length!==4||Object.entries(supplied).some(([k,value])=>v.suppliedComponents[k]!==value)||await addressDigest(installationAddress(v.installation))!==v.addressSha256)return null;
 if(!(v.family===null||typeof v.family==='string'&&v.family.length<=160)||!(v.variant===null||typeof v.variant==='string'&&v.variant.length<=160))return null;
 return {schemaVersion:v.schemaVersion,organizationId:ORG,sourceSystem:v.sourceSystem,entityKind:v.entityKind,nativeUnitId:v.nativeUnitId,...sourceIdentity(v),unitNumber:v.unitNumber,family:v.family,variant:v.variant,sourceRevision:v.sourceRevision,
  sourceFileSha256:v.sourceFileSha256,sourceRowSha256:v.sourceRowSha256,addressSha256:v.addressSha256,nativeGuardSha256:v.nativeGuardSha256,installation:{street:v.installation.street,city:v.installation.city,state:v.installation.state,zip:v.installation.zip},suppliedComponents:supplied,eligibility:'FIELD',eventId:v.eventId,...(precedence?{sourcePrecedence:precedence}:{})};
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
/** Current SHOP and an unchanged, unmarked legacy Root placement agree. This is
 * a read-only classification allowance, never a camera/health identity or a move.
 * Native units require the verified provider association; tracker rows require a
 * complete typed-label match. Family/base keys only veto competing evidence.
 * All membership, source and history indexes are local to this projection read. */
function agreeingShopSourceIds(inventory:unknown,sources:unknown,audits:unknown,devices:unknown,context?:ImportedProjectionContext):Set<string>{
 const allowed=new Set<string>();
 if(!context||![inventory,sources,audits,devices,context.nativeUnits,context.currentSources].every(v=>Array.isArray(v)&&v.length<=100000&&v.every(object)))return allowed;
 const rows=inventory as Row[],sourceRows=sources as Row[],history=audits as Row[],cameras=devices as Row[],native=context.nativeUnits as Row[],current=context.currentSources as Row[],proof=context.identity;
 if(!object(proof)||proof.identityVersion!==1||!Array.isArray(proof.unitIdentities)||!Array.isArray(proof.identityWarnings)
  ||(proof.ownerConfirmedIdentityVersion===undefined?proof.ownerConfirmedUnitIdentities!==undefined:proof.ownerConfirmedIdentityVersion!==1||!Array.isArray(proof.ownerConfirmedUnitIdentities)))return allowed;
 const {match,concern}=labelKeys(),rowById=new Map(rows.map(r=>[r.id,r])),nativeById=new Map(native.map(r=>[r.id,r]));
 const sourceKey=(s:Row)=>s.entityKind+'|'+s.nativeUnitId,currentById=new Map(current.map(s=>[sourceKey(s),s]));
 if(rows.some(r=>!uuid(r.id)||typeof r.unitNumber!=='string'||typeof r.readOnly!=='boolean')||rowById.size!==rows.length
  ||nativeById.size!==native.length||native.some(r=>!uuid(r.id)||r.organization_id!==ORG||typeof r.unit_number!=='string')
  ||rows.filter(r=>r.readOnly===false).length!==native.length||rows.some(r=>r.readOnly===false&&nativeById.get(r.id)?.unit_number!==r.unitNumber)
  ||currentById.size!==current.length||new Set(sourceRows.map(sourceKey)).size!==sourceRows.length
  ||[...sourceRows,...current].some(s=>!['equipment_unit','tracker'].includes(s.entityKind)||!uuid(s.nativeUnitId))
  ||cameras.some(d=>!deviceId(d.id)||typeof d.unit_key!=='string')||new Set(cameras.map(d=>deviceId(d.id))).size!==cameras.length
  ||history.some(a=>!deviceId(a.id)||typeof a.unit_key!=='string'||!Array.isArray(a.device_ids)||a.device_ids.some((id:unknown)=>!deviceId(id)))
  ||new Set(history.map(a=>deviceId(a.id))).size!==history.length)return allowed;
 const claims=[...proof.unitIdentities,...(proof.ownerConfirmedUnitIdentities||[])],warnings=proof.identityWarnings;
 const validResources=(p:Row)=>Array.isArray(p.deviceIds)&&p.deviceIds.length<=100000&&p.deviceIds.every((id:unknown)=>typeof id==='string'&&deviceId(id))&&new Set(p.deviceIds).size===p.deviceIds.length
  &&Array.isArray(p.unitKeys)&&p.unitKeys.length<=100000&&p.unitKeys.every((k:unknown)=>typeof k==='string'&&k.trim())&&new Set(p.unitKeys).size===p.unitKeys.length;
 if(claims.length>100000||warnings.length>100000||claims.some(p=>!object(p)||!uuid(p.unitId)||typeof p.unitNumber!=='string'||!['native_provider','owner_placement','owner_confirmed_native'].includes(p.kind)||!sha(p.proof)||!validResources(p)||!p.deviceIds.length||!p.unitKeys.length)
  ||warnings.some((p:unknown)=>!object(p)||typeof p.unitId!=='string'||!validResources(p)))return allowed;
 const counts=new Map<string,number>(),products=new Map<string,number>(),groups=new Map<string,Row[]>(),groupsByMatch=new Map<string,Set<string>>();
 type Index=Map<string,Set<Row>>;
 const byConcern:Index=new Map(),byDevice:Index=new Map(),claimsByUnit:Index=new Map(),claimsByConcern:Index=new Map(),claimsByDevice:Index=new Map(),warningsByUnit:Index=new Map(),warningsByConcern:Index=new Map(),warningsByDevice:Index=new Map();
 const add=(index:Index,key:string,row:Row)=>{let group=index.get(key);if(!group){group=new Set();index.set(key,group);}group.add(row);};
 for(const row of rows){const key=concern(row.unitNumber);counts.set(key,(counts.get(key)||0)+1);}
 for(const s of current)if(s.sourceSystem==='mhelpdesk_product_import'){products.set(s.productId,(products.get(s.productId)||0)+1);}
 for(const d of cameras){let group=groups.get(d.unit_key);if(!group){group=[];groups.set(d.unit_key,group);}group.push(d);const key=match(d.unit_key),labels=groupsByMatch.get(key)||new Set<string>();labels.add(d.unit_key);groupsByMatch.set(key,labels);}
 // Include every sibling label and device reference as a veto, including history
 // under another family. Neither index is used to establish the positive join.
 for(const a of history){add(byConcern,concern(a.unit_key),a);for(const id of a.device_ids)add(byDevice,deviceId(id)!,a);}
 const indexClaims=(records:Row[],units:Index,labels:Index,ids:Index)=>{for(const p of records){add(units,p.unitId,p);for(const k of p.unitKeys)add(labels,concern(k),p);for(const id of p.deviceIds)add(ids,id,p);}};
 indexClaims(claims,claimsByUnit,claimsByConcern,claimsByDevice);indexClaims(warnings,warningsByUnit,warningsByConcern,warningsByDevice);
 const cameraConcerns=new Map<string,Set<string>>();for(const key of groups.keys()){const base=concern(key),labels=cameraConcerns.get(base)||new Set<string>();labels.add(key);cameraConcerns.set(base,labels);}
 const related=(units:Index,labels:Index,resources:Index,row:Row,base:string,ids:string[])=>{const found=new Set([...(units.get(row.id)||[]),...(labels.get(base)||[])]);for(const id of ids)for(const item of resources.get(id)||[])found.add(item);return found;};
 const rosterAgrees=(values:unknown[],ids:Set<string>)=>values.length===ids.size&&new Set(values.map(deviceId)).size===values.length&&values.every(v=>ids.has(deviceId(v)!));
 const validShop=(s:Row)=>s.schemaVersion===1&&s.organizationId===ORG&&s.sourceSystem==='mhelpdesk_product_import'&&decimal(s.productId)&&uuid(s.sourceRevision)&&decimal(s.eventId)
  &&s.placement==='SHOP'&&s.eligibility==='tombstone'&&s.installation===null&&s.addressSha256===null&&s.suppliedComponents===null
  &&['sourceFileSha256','sourceRowSha256','nativeGuardSha256'].every(k=>sha(s[k]))&&!Object.hasOwn(s,'sourcePrecedence')&&!Object.hasOwn(s,'sourceRecordId');
 const sourceFields=['schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','unitNumber','sourceRevision','eventId','sourceFileSha256','sourceRowSha256','nativeGuardSha256','placement','eligibility','siteLabel'];
 for(const source of sourceRows){
  const fresh=currentById.get(sourceKey(source)),row=rowById.get(source.nativeUnitId);
  if(!row||row._sourceField!==true||!fresh||!validShop(source)||!validShop(fresh)||sourceFields.some(k=>source[k]!==fresh[k])||products.get(source.productId)!==1
   ||sourceKey(source)!==identity(row)||row.unitNumber!==source.unitNumber||!match(row.unitNumber).startsWith('typed:')||row.placementAuditId!=null)continue;
  const base=concern(row.unitNumber);if(counts.get(base)!==1)continue;
  let key:string;
  if(row.readOnly===false){
   const own=[...(claimsByUnit.get(row.id)||[])];
   if(!currentNativeSourceIdentity(source)||!currentNativeSourceIdentity(fresh)||source.nativeSourceIdentity.trackerId!==fresh.nativeSourceIdentity.trackerId
    ||source.nativeSourceIdentity.trackerUnitNumber!==fresh.nativeSourceIdentity.trackerUnitNumber||own.length!==1||own[0].kind!=='native_provider'||own[0].unitNumber!==row.unitNumber||own[0].unitKeys.length!==1)continue;
   key=own[0].unitKeys[0];
  }else{
   if(source.nativeSourceIdentity!=null||fresh.nativeSourceIdentity!=null)continue;
   const labels=groupsByMatch.get(match(row.unitNumber));if(labels?.size!==1)continue;key=[...labels][0];
  }
  if(concern(key)!==base||cameraConcerns.get(base)?.size!==1)continue;
  const group=groups.get(key)||[],ids=group.map(d=>deviceId(d.id)!),idSet=new Set(ids);
  if(!group.length||group.some(d=>d.organization!=='root'||d.activation_state!=='deactivated'))continue;
  const associations=related(claimsByUnit,claimsByConcern,claimsByDevice,row,base,ids);
  if(related(warningsByUnit,warningsByConcern,warningsByDevice,row,base,ids).size
   ||(row.readOnly?associations.size!==0:associations.size!==1||![...associations].every(p=>p.unitId===row.id&&p.kind==='native_provider'&&p.unitNumber===row.unitNumber&&p.unitKeys.length===1&&p.unitKeys[0]===key&&rosterAgrees(p.deviceIds,idSet))))continue;
  const relatedHistory=new Set(byConcern.get(base)||[]);for(const id of ids)for(const a of byDevice.get(id)||[])relatedHistory.add(a);
  let latest:Row|undefined,invalid=false;
  for(const a of relatedHistory){
   if(a.unit_key!==key||!['MOVE_TO_ROOT','MOVE_TO_FIELD'].includes(a.action)||['contract','control_id','request_id','placement','site_label','street_address'].some(k=>a[k]!=null)
    ||!rosterAgrees(a.device_ids,idSet)||typeof a.created_at!=='string'||!Number.isFinite(Date.parse(a.created_at))){invalid=true;break;}
   if(!latest||BigInt(deviceId(a.id)!)>BigInt(deviceId(latest.id)!))latest=a;
  }
  if(invalid||!latest||latest.action!=='MOVE_TO_ROOT'||[...relatedHistory].some(a=>Date.parse(a.created_at)>Date.parse(latest!.created_at)))continue;
  allowed.add(row.id);
 }
 return allowed;
}
/** A separately reviewed import may supersede exactly one unmarked historical
 * Root audit. Every other audit/identity change holds it; no health alias is made.
 * Indexes live for this read only, and absent decisions add no roster scans. */
async function reviewedSourcePrecedenceIds(inventory:unknown,sources:unknown,audits:unknown,devices:unknown,context?:ImportedProjectionContext):Promise<Set<string>>{
 const allowed=new Set<string>();
 if(!Array.isArray(sources)||!sources.some(s=>object(s)&&Object.hasOwn(s,'sourcePrecedence')))return allowed;
 if(!context||![inventory,audits,devices,context.nativeUnits].every(v=>Array.isArray(v)&&v.length<=100000&&v.every(object)))return allowed;
 const rows=inventory as Row[],history=audits as Row[],cameras=devices as Row[],native=context.nativeUnits as Row[],proof=context.identity;
 if(!object(proof)||proof.identityVersion!==1||!Array.isArray(proof.unitIdentities)||!Array.isArray(proof.identityWarnings)
  ||(proof.ownerConfirmedIdentityVersion===undefined?proof.ownerConfirmedUnitIdentities!==undefined:proof.ownerConfirmedIdentityVersion!==1||!Array.isArray(proof.ownerConfirmedUnitIdentities)))return allowed;
 const {match,concern}=labelKeys(),rowById=new Map(rows.map(r=>[r.id,r])),nativeById=new Map(native.map(r=>[r.id,r]));
 if(rowById.size!==rows.length||nativeById.size!==native.length||native.some(r=>!uuid(r.id)||r.organization_id!==ORG||typeof r.unit_number!=='string')
  ||rows.filter(r=>r.readOnly===false).length!==native.length||rows.some(r=>r.readOnly===false&&nativeById.get(r.id)?.unit_number!==r.unitNumber)
  ||cameras.some(d=>!deviceId(d.id)||typeof d.unit_key!=='string')||new Set(cameras.map(d=>deviceId(d.id))).size!==cameras.length
  ||history.some(a=>!deviceId(a.id)||typeof a.unit_key!=='string'||!Array.isArray(a.device_ids)||a.device_ids.some((id:unknown)=>!deviceId(id)))||new Set(history.map(a=>deviceId(a.id))).size!==history.length)return allowed;
 const counts=new Map<string,number>(),groups=new Map<string,Row[]>(),auditsByConcern=new Map<string,Set<Row>>(),auditsByDevice=new Map<string,Set<Row>>();
 for(const r of rows){const key=concern(r.unitNumber);counts.set(key,(counts.get(key)||0)+1);}
 for(const d of cameras){const key=concern(d.unit_key),group=groups.get(key)||[];group.push(d);groups.set(key,group);}
 for(const a of history){const key=concern(a.unit_key),group=auditsByConcern.get(key)||new Set<Row>();group.add(a);auditsByConcern.set(key,group);for(const id of a.device_ids){const key=deviceId(id)!,group=auditsByDevice.get(key)||new Set<Row>();group.add(a);auditsByDevice.set(key,group);}}
 const confirmed=new Set(Array.isArray(context.confirmedPrecedenceBindings)?context.confirmedPrecedenceBindings.filter(object).map(b=>JSON.stringify(b)):[]);
 const claims=[...proof.unitIdentities,...(proof.ownerConfirmedUnitIdentities||[])];
 if([...claims,...proof.identityWarnings].some(p=>!object(p)||!Array.isArray(p.unitKeys)||!Array.isArray(p.deviceIds)))return allowed;
 for(const source of sources){
  const p=checkedSourcePrecedence(source);if(!p||!currentNativeSourceIdentity(source))continue;
  const binding=await checkedImportedBinding(source);if(!binding||!confirmed.has(JSON.stringify(binding)))continue;
  const row=rowById.get(source.nativeUnitId),base=concern(source.unitNumber),group=groups.get(base)||[],ids=group.map(d=>deviceId(d.id)!);
  if(!row||row.readOnly!==false||row.unitNumber!==source.unitNumber||!nativeById.has(row.id)||counts.get(base)!==1
   ||match(source.unitNumber)!==match(p.unitKey)||group.some(d=>d.unit_key!==p.unitKey)||!sameSet(ids,p.deviceIds))continue;
  const related=new Set(auditsByConcern.get(base)||[]);for(const id of ids)for(const a of auditsByDevice.get(id)||[])related.add(a);
  if(related.size!==1)continue;const a=[...related][0];
  if(deviceId(a.id)!==p.legacyAuditId||a.unit_key!==p.unitKey||a.action!=='MOVE_TO_ROOT'||a.contract!=null||a.control_id!=null||a.request_id!=null||a.placement!=null||a.site_label!=null||a.street_address!=null
   ||!sameSet(a.device_ids.map(deviceId),p.deviceIds)||!(Date.parse(a.created_at)<Date.parse(p.reviewedAt))||await sourcePrecedenceAuditSha256(a)!==p.legacyAuditSha256)continue;
  const relatedClaim=(v:Row)=>v.unitId===row.id||v.unitKeys.some((k:string)=>concern(k)===base)||v.deviceIds.some((id:string)=>ids.includes(id));
  if(proof.identityWarnings.some(relatedClaim))continue;
  const associations=claims.filter(relatedClaim);
  if(associations.length&&(associations.length!==1||!['native_provider','owner_confirmed_native'].includes(associations[0].kind)||associations[0].unitId!==row.id||associations[0].unitNumber!==row.unitNumber||!sha(associations[0].proof)||!sameSet(associations[0].unitKeys,[p.unitKey])||!sameSet(associations[0].deviceIds,ids)))continue;
  allowed.add(row.id);
 }
 return allowed;
}
/** Effective imported presentation/classification only, before Owner placement projection. No GPS or health writes. */
export async function projectImportedSourceAddresses(snapshot:Row,sources:unknown,audits:unknown,devices:unknown,previousSources:Row[]=[],context?:ImportedProjectionContext):Promise<Row>{
 if(!Array.isArray(sources)||!Array.isArray(snapshot.inventoryItems)||!Array.isArray(snapshot.items)||!object(snapshot.summary))throw Error('Imported source projection unavailable');
 const byId=new Map<string,Row>();for(const s of sources){if(!object(s)||!['equipment_unit','tracker'].includes(s.entityKind)||!uuid(s.nativeUnitId)||byId.has(s.entityKind+'|'+s.nativeUnitId))throw Error('Imported source identity invalid');byId.set(s.entityKind+'|'+s.nativeUnitId,s);}
 const previouslyImported=new Set(previousSources.map(s=>s.entityKind+'|'+s.nativeUnitId));
 const sourceOnly=sourceOnlyOverlayIds(snapshot.inventoryItems,sources,audits,devices,context);
 const agreeingShop=agreeingShopSourceIds(snapshot.inventoryItems,sources,audits,devices,context);
 const reviewed=await reviewedSourcePrecedenceIds(snapshot.inventoryItems,sources,audits,devices,context);
 const legacyConcernForUnit=legacyConcernReader(audits,devices);
 const inventoryItems=await Promise.all(snapshot.inventoryItems.map(async(raw:Row)=>{
  const s=byId.get(identity(raw));
  if(!s&&previouslyImported.has(identity(raw))&&raw.locationVerification!=='owner_verified'&&raw.hasUnitGps!==true&&raw.placementSource!=='owner')return {...raw,_sourceField:false,currentLocationType:'unknown',importedSourceState:'source_changed',importedInstallation:null,latitude:null,longitude:null,coordinateSource:null};
  if(!s||Object.hasOwn(s,'sourcePrecedence')&&!reviewed.has(raw.id)||s.unitNumber!==raw.unitNumber||raw.placementSource==='owner'||raw.placementStatus==='needs_identity_review'||raw.placement==='UNKNOWN'||raw.hasUnitGps===true||raw.locationVerification==='owner_verified'||raw.installedSiteId!=null||legacyConcernForUnit(raw.unitNumber)&&!sourceOnly.has(raw.id)&&!reviewed.has(raw.id)&&!agreeingShop.has(raw.id))return raw;
  // Native-only, sanitized mHelp CustomerName path. It is display text, not a
  // CRM identity or a customer/site parser; keep the complete label intact.
  const sourceLabel=typeof s.siteLabel==='string'&&s.siteLabel.trim()&&s.siteLabel.length<=250?s.siteLabel:null;
  const customerLabel=s.sourceSystem==='google_sheet_tracker'?(typeof s.customerLabel==='string'&&s.customerLabel.trim()&&s.customerLabel.length<=250?s.customerLabel:null):sourceLabel;
  if(s.placement==='SHOP'){
   if(!uuid(s.sourceRevision)||!(validSourceType(s)||s.schemaVersion===undefined&&s.sourceSystem===undefined&&!Object.hasOwn(s,'sourceRecordId')&&decimal(s.productId))||!decimal(s.eventId)||!sha(s.nativeGuardSha256)||!sha(s.sourceFileSha256)||!sha(s.sourceRowSha256))return raw;
   return {...raw,customer:customerLabel,site:'SHOP / ROOT',address:null,addressSource:null,addressUpdatedAt:null,_sourceField:false,status:'readiness_unverified',currentLocationType:'shop',placement:null,placementSource:null,placementUnitKey:null,placementAuditId:null,placementUpdatedAt:null,importedPlacement:'SHOP',importedInstallation:{entityKind:s.entityKind,nativeUnitId:s.nativeUnitId,...sourceIdentity(s),sourceRevision:s.sourceRevision,eventId:s.eventId,nativeGuardSha256:s.nativeGuardSha256,sourceFileSha256:s.sourceFileSha256,sourceRowSha256:s.sourceRowSha256,placement:'SHOP'},latitude:null,longitude:null,coordinateSource:null};
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
  return {...raw,customer:customerLabel,site:sourceLabel??'Installation site',_sourceField:true,placement:null,placementSource:null,placementUnitKey:null,placementAuditId:null,placementUpdatedAt:null,importedPlacement:'FIELD',status:['assigned','in_transit','installed','returning'].includes(raw.status)?raw.status:'field',currentLocationType:'field',address:installationAddress(binding.installation),addressSource:binding.sourceSystem==='google_sheet_tracker'?'Tracker imported installation address':'mHelpDesk imported installation address',recordSource:binding.sourceSystem==='google_sheet_tracker'?'Tracker imported installation address':'mHelpDesk imported installation address',
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
 const reviewed=await reviewedSourcePrecedenceIds(snapshot.inventoryItems,currentSources,audits,devices,context);
 const legacyConcernForUnit=legacyConcernReader(audits,devices);
 const apply=async(raw:Row)=>{
  // Re-project from the current read; a previously displayed lookup is never a
  // fallback when its source proof, identity context or lookup record disappears.
  const {locationImportedGeocode:_previousImportedGeocode,...row}=raw;
  const legacyConcern=legacyConcernForUnit(row.unitNumber);
  if(object(row.importedInstallation)&&Object.hasOwn(row.importedInstallation,'sourcePrecedence')&&!reviewed.has(row.id)||row.placementSource==='owner'||row.placementAuditId!=null||row.placement==='SHOP'||row.placement==='UNKNOWN'||row.placementStatus==='needs_identity_review'||row.locationVerification==='owner_verified'||row.hasUnitGps===true||row.installedSiteId!=null||row.currentLocationType!=='field'||legacyConcern&&!sourceOnly.has(row.id)&&!reviewed.has(row.id))return row;
  const binding=await checkedImportedBinding(row.importedInstallation),r=byId.get(identity(row));if(!binding||!r||row.id!==binding.nativeUnitId||row.unitNumber!==binding.unitNumber||typeof row.address!=='string'||await addressDigest(row.address)!==binding.addressSha256)return row;
  if(legacyConcern||binding.sourcePrecedence){const current=await checkedImportedBinding(currentSources.find(s=>object(s)&&s.entityKind===binding.entityKind&&s.nativeUnitId===binding.nativeUnitId));if(!current||JSON.stringify(current)!==JSON.stringify(binding))return row;}
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
