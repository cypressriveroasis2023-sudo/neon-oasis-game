import {placementMatchKey} from './placementProjection.ts';
type Row=Record<string,any>;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const base=(v:unknown)=>placementMatchKey(v).replace(/\|(?:HD4|HDC[24]S?)$/,'');
const id=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
const array=(v:unknown):v is Row[]=>Array.isArray(v)&&v.length<=100000&&v.every(object);
export type ArchiveProjectionContext={nativeUnits:unknown;identity:unknown;archivedRepresentations?:unknown;previousArchivedRepresentations?:unknown};
const protectedRow=(r:Row)=>r.hasUnitGps===true||r.installedSiteId!=null||r.placementSource==='owner'||r.placementAuditId!=null||r.locationVerification==='owner_verified'||r.locationHistoryId!=null||r.placementStatus==='needs_identity_review'||r.placement==='UNKNOWN';
/** The RPC has revalidated database evidence. This second guard validates the
 * complete unfiltered roster and current cross-project authority. It confers no
 * camera, provider, Owner-placement, or health identity on either endpoint. */
export function checkedArchivedRepresentations(inventory:unknown,proofs:unknown,audits:unknown,devices:unknown,context?:ArchiveProjectionContext):Row[]{
 if(!context||!array(inventory)||!array(proofs)||proofs.length>50||!array(audits)||!array(devices)||!array(context.nativeUnits))return [];
 const units=context.nativeUnits,identity=context.identity;
 if(!object(identity)||identity.identityVersion!==1||!array(identity.unitIdentities)||!array(identity.identityWarnings)
  ||(identity.ownerConfirmedIdentityVersion===undefined?identity.ownerConfirmedUnitIdentities!==undefined:identity.ownerConfirmedIdentityVersion!==1||!array(identity.ownerConfirmedUnitIdentities)))return [];
 const native=inventory.filter(r=>r.readOnly===false),nativeIds=new Set(native.map(r=>r.id));
 if(new Set(inventory.map(r=>r.id)).size!==inventory.length||nativeIds.size!==units.length||new Set(units.map(u=>u.id)).size!==units.length
  ||units.some(u=>!uuid(u.id)||u.organization_id!==ORG||typeof u.unit_number!=='string'||!nativeIds.has(u.id)||native.find(r=>r.id===u.id)?.unitNumber!==u.unit_number)
  ||audits.some(a=>!id(a.id)||typeof a.unit_key!=='string'||!Array.isArray(a.device_ids)||a.device_ids.some((v:unknown)=>!id(v)))
  ||devices.some(d=>!id(d.id)||typeof d.unit_key!=='string')||new Set(devices.map(d=>id(d.id))).size!==devices.length||new Set(audits.map(a=>id(a.id))).size!==audits.length)return [];
 const claims=[...identity.unitIdentities,...(identity.ownerConfirmedUnitIdentities||[])];
 if(claims.some(p=>!uuid(p.unitId)||typeof p.unitNumber!=='string'||!['native_provider','owner_placement','owner_confirmed_native'].includes(p.kind)||!sha(p.proof)||!Array.isArray(p.unitKeys)||!p.unitKeys.length||p.unitKeys.some((k:unknown)=>typeof k!=='string')||!Array.isArray(p.deviceIds)||!p.deviceIds.length||p.deviceIds.some((v:unknown)=>typeof v!=='string'||!id(v)))
  ||identity.identityWarnings.some((w:Row)=>typeof w.unitId!=='string'||!Array.isArray(w.unitKeys)||w.unitKeys.some((k:unknown)=>typeof k!=='string')||!Array.isArray(w.deviceIds)||w.deviceIds.some((v:unknown)=>typeof v!=='string'||!id(v))))return [];
 const endpoints=proofs.flatMap(p=>[p.archivedNativeId,p.canonicalNativeId,p.archivedTrackerId,p.canonicalTrackerId]);
 if(new Set(endpoints).size!==endpoints.length)return []; // Chains, cycles, shared canonical endpoints.
 const previous=context.previousArchivedRepresentations;
 if(previous!==undefined&&!array(previous))return [];
 return proofs.filter(p=>{
  if(p.state!=='active'||p.contract!=='COS_ARCHIVED_REPRESENTATION_V1'||p.organizationId!==ORG||p.provenance!=='postgres_admin_reviewed_source_archive'||p.recordedByDatabaseRole!=='postgres'
   ||!['id','revision','archivedNativeId','canonicalNativeId','archivedTrackerId','canonicalTrackerId'].every(k=>uuid(p[k]))
   ||!['reviewSha256','evidenceSha256','beforeSha256'].every(k=>sha(p[k]))||typeof p.archivedUnitNumber!=='string'||typeof p.canonicalUnitNumber!=='string')return false;
  if(previous!==undefined&&!previous.some((v:Row)=>JSON.stringify(v)===JSON.stringify(p)))return false;
  const old=native.find(r=>r.id===p.archivedNativeId),canonical=native.find(r=>r.id===p.canonicalNativeId),key=base(p.archivedUnitNumber);
  if(!old||!canonical||old.unitNumber!==p.archivedUnitNumber||canonical.unitNumber!==p.canonicalUnitNumber||!key.startsWith('typed:')||key!==base(p.canonicalUnitNumber)
   ||protectedRow(old)||['retired','deleted'].includes(old.status)||['retired','deleted'].includes(canonical.status))return false;
  // Tracker-only projections, when present, must still carry their exact label.
  if(inventory.some(r=>(r.id===p.archivedTrackerId&&(r.readOnly!==true||r.unitNumber!==p.archivedUnitNumber||protectedRow(r)))||(r.id===p.canonicalTrackerId&&(r.readOnly!==true||r.unitNumber!==p.canonicalUnitNumber))))return false;
  const group=devices.filter(d=>base(d.unit_key)===key),ids=new Set(group.map(d=>id(d.id)));
  // A camera bearing the archived complete label is competing evidence. Generic
  // family/base labels are not assigned to either representation by this helper.
  if(group.some(d=>placementMatchKey(d.unit_key)===placementMatchKey(p.archivedUnitNumber)))return false;
  const related=(v:Row)=>v.unitId===p.archivedNativeId||v.unitId===p.canonicalNativeId||v.unitKeys.some((k:unknown)=>base(k)===key)||v.deviceIds.some((v:unknown)=>ids.has(id(v)));
  if(identity.identityWarnings.some(related))return false;
  const canonicalClaims=claims.filter(c=>c.unitId===p.canonicalNativeId&&c.unitNumber===p.canonicalUnitNumber&&['native_provider','owner_confirmed_native'].includes(c.kind));
  // Keep the deployed verifier's no-overlap policy. A current Owner audit may
  // operate the exact canonical association; a second control identity cannot.
  if(claims.some(c=>related(c)&&!canonicalClaims.includes(c)))return false;
  // A current verified canonical association may carry legitimate Owner/IT
  // operations. A generic or archived-label audit never creates that association.
  if(audits.some(a=>(base(a.unit_key)===key||a.device_ids.some((v:unknown)=>ids.has(id(v))))&&
   (placementMatchKey(a.unit_key)===placementMatchKey(p.archivedUnitNumber)||!canonicalClaims.some(c=>c.unitKeys.includes(a.unit_key)&&a.device_ids.length>0&&a.device_ids.every((v:unknown)=>c.deviceIds.includes(id(v)))))))return false;
  return true;
 });
}
/** Conflict rows remain visible for review but never make duplicate FIELD pins.
 * This metadata concerns representation only; it is not a health identity proof. */
const evidenceEnvelope=(p:Row)=>p.contract==='COS_ARCHIVED_REPRESENTATION_V1'&&p.organizationId===ORG&&['active','conflict'].includes(p.state)
 &&p.provenance==='postgres_admin_reviewed_source_archive'&&p.recordedByDatabaseRole==='postgres'
 &&['id','revision','archivedNativeId','canonicalNativeId','archivedTrackerId','canonicalTrackerId'].every(k=>uuid(p[k]))
 &&['reviewSha256','evidenceSha256','beforeSha256'].every(k=>sha(p[k]));
function decisions(inventory:unknown,proofs:unknown,audits:unknown,devices:unknown,context?:ArchiveProjectionContext){
 const accepted=checkedArchivedRepresentations(inventory,proofs,audits,devices,context);
 const prior=array(context?.previousArchivedRepresentations)?context!.previousArchivedRepresentations as Row[]:[];
 const candidates=[...(array(proofs)?proofs:[]),...prior].filter(evidenceEnvelope);
 const conflictMap=new Map<string,Row>();
 for(const p of candidates)if(!accepted.some(a=>a.id===p.id))conflictMap.set(p.id,p);
 return {accepted,conflicts:[...conflictMap.values()]};
}
const conflictRow=(r:Row)=>{const {locationImportedGeocode:_estimate,...row}=r;return {...row,representationStatus:'conflict',representationReason:'The archived and retained records have conflicting identity evidence. Review their association.',placement:'UNKNOWN',placementStatus:'needs_identity_review',latitude:null,longitude:null,coordinateSource:null,currentLocationType:'unknown',_sourceField:false};};
const metadata=(accepted:Row[],conflicts:Row[])=>({contract:'COS_ARCHIVED_REPRESENTATION_V1',suppressed:accepted.map(p=>({id:p.id,revision:p.revision,archivedNativeId:p.archivedNativeId,canonicalNativeId:p.canonicalNativeId})),conflicts:conflicts.map(p=>({id:p.id,archivedNativeId:p.archivedNativeId,canonicalNativeId:p.canonicalNativeId,reason:p.conflictReason||'current_authority_conflict'}))});
/** Call only at the end of Field Map presentation. Identity verifiers and source
 * overlay guards must first receive the complete original native inventory. */
export function projectArchivedRepresentations(snapshot:Row,proofs:unknown,audits:unknown,devices:unknown,context?:ArchiveProjectionContext):Row{
 const {accepted,conflicts}=decisions(snapshot.inventoryItems,proofs,audits,devices,context);
 if(!accepted.length&&!conflicts.length)return snapshot;
 const hidden=new Set(accepted.flatMap(p=>[p.archivedNativeId,p.archivedTrackerId]));
 const held=new Set(conflicts.flatMap(p=>[p.archivedNativeId,p.archivedTrackerId,p.canonicalNativeId,p.canonicalTrackerId]));
 const inventoryItems=snapshot.inventoryItems.filter((r:Row)=>!hidden.has(r.id)).map((r:Row)=>held.has(r.id)?conflictRow(r):r);
 const items=snapshot.items.filter((r:Row)=>!hidden.has(r.id)&&!held.has(r.id));
 return {...snapshot,items,inventoryItems,placementReviews:[...(Array.isArray(snapshot.placementReviews)?snapshot.placementReviews:[]),...conflicts.map(p=>({unitNumber:p.canonicalUnitNumber||p.archivedUnitNumber,reason:'The archived and retained records have conflicting identity evidence. Their map pins are held for review.',placementAuditId:null}))],representationProjection:metadata(accepted,conflicts),
  summary:{...snapshot.summary,fieldUnits:items.length,mappedUnits:items.filter((r:Row)=>r.latitude!=null&&r.longitude!=null).length,unitGps:items.filter((r:Row)=>r.hasUnitGps===true).length,missingGps:items.filter((r:Row)=>r.latitude==null||r.longitude==null).length,addressUnits:items.filter((r:Row)=>typeof r.address==='string'&&r.address.trim()).length}};
}
/** Registry presentation shares the same full-roster guard. Historical/detail
 * read endpoints are untouched; tracker rows remain in the database. */
export function projectArchivedEquipmentRegistry(snapshot:Row,proofs:unknown,audits:unknown,devices:unknown,context?:ArchiveProjectionContext):Row{
 if(!array(snapshot.items)||!array(snapshot.trackerUnits))return snapshot;
 const inventory=[...snapshot.items.map((r:Row)=>({...r,readOnly:false})),...snapshot.trackerUnits];
 const {accepted,conflicts}=decisions(inventory,proofs,audits,devices,context);
 if(!accepted.length&&!conflicts.length)return snapshot;
 const hidden=new Set(accepted.flatMap(p=>[p.archivedNativeId,p.archivedTrackerId]));
 const held=new Set(conflicts.flatMap(p=>[p.archivedNativeId,p.archivedTrackerId,p.canonicalNativeId,p.canonicalTrackerId]));
 const apply=(rows:Row[])=>rows.filter(r=>!hidden.has(r.id)).map(r=>held.has(r.id)?{...r,representationStatus:'conflict',representationReason:'The archived and retained records have conflicting identity evidence. Review their association.'}:r);
 return {...snapshot,items:apply(snapshot.items),trackerUnits:apply(snapshot.trackerUnits),representationProjection:metadata(accepted,conflicts)};
}
