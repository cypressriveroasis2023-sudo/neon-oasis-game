import {checkedImportedBinding} from './importedSourceProjection.ts';
import {placementMatchKey} from './placementProjection.ts';
import {type IdentitySources,type UnitHealthIdentity} from './verifiedHealthIdentity.ts';
import {cameraTimestamp} from './cameraEvidence.ts';

type Row=Record<string,any>;
// Existing complete physical-association commitments. No label, IP or suffix alias.
export const REVIEWED_FIELD_RECORDER_PROOFS:ReadonlySet<string>=new Set([
 'c19c04d90adc7af303a04f5eec18fd2faa2c0a2186cc2a2a8b78ee03a0c0c049',
 '8b70641b61303ca36e59129273eb5145e843e1c9a840898ad634023d596d59d6',
 '1557c13a24c2e6d20fa98dec65e2a8ccba602c7186bb3b12693af783e8a96816',
 'ce08cf570c9289b116e519755ff678ef12f7efa7c8052005f595967bd4d6c80c',
 '3e2dc6a323a6b8e3d9353d2cd1967d57675f605ab10d788885850e5f2959553a',
]);
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const id=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:null;
const same=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(v=>b.includes(v));
export type FieldRecorderGuard={unitId:string;unitNumber:string;identityProof:string;deviceIds:string[];unitKeys:string[];checkedAt:string;providerSyncAt?:string};
export type FieldRecorderGuards={fieldRecorderObservationVersion:1;fieldRecorderObservationGuards:FieldRecorderGuard[]};

/** A fresh negative Owner-history guard, independent of legacy provider folders.
 * Only the five already-reviewed complete NVR associations can be candidates.
 * The separate map authority below supplies the current installation proof. */
export function fieldRecorderObservationGuards(sources:IdentitySources,identity:Row,now=Date.now(),reviewed=REVIEWED_FIELD_RECORDER_PROOFS):FieldRecorderGuards {
 const result:FieldRecorderGuards={fieldRecorderObservationVersion:1,fieldRecorderObservationGuards:[]};
 if(!Number.isFinite(now)||![sources.units,sources.devices,sources.audits].every(v=>Array.isArray(v)&&v.length<=100000&&v.every(object))
  ||identity?.identityVersion!==1||!Array.isArray(identity.unitIdentities)||!Array.isArray(identity.identityWarnings))return result;
 const {units,devices,audits}=sources;
 if(new Set(units.map(u=>u.id)).size!==units.length||new Set(devices.map(d=>id(d.id))).size!==devices.length
  ||devices.some(d=>!id(d.id)||typeof d.unit_key!=='string')
  ||audits.some(a=>!id(a.id)||typeof a.unit_key!=='string'||!Array.isArray(a.device_ids)||a.device_ids.some((v:unknown)=>!id(v)))
  ||new Set(audits.map(a=>id(a.id))).size!==audits.length)return result;
 for(const proof of identity.unitIdentities as UnitHealthIdentity[]){
  if(!object(proof)||proof.kind!=='native_provider'||!reviewed.has(proof.proof)||!Array.isArray(proof.deviceIds)||!proof.deviceIds.length||!Array.isArray(proof.unitKeys)||!proof.unitKeys.length)continue;
  const native=units.filter(u=>u.id===proof.unitId),rows=devices.filter(d=>proof.deviceIds.includes(String(d.id)));
  // The reviewed native rows retain inventory status available. That status is
  // not Field placement; only the guarded imported installation below proves it.
  if(native.length!==1||native[0].unit_number!==proof.unitNumber||native[0].status!=='available'
   ||identity.unitIdentities.filter((p:Row)=>p.unitId===proof.unitId).length!==1
   ||!same(rows.map(d=>String(d.id)),proof.deviceIds)||!same([...new Set(rows.map(d=>d.unit_key))],proof.unitKeys)
   ||!same(devices.filter(d=>proof.unitKeys.includes(d.unit_key)).map(d=>String(d.id)),proof.deviceIds)
   ||rows.some(d=>d.source!=='vigilant_control_center'||d.device_type!=='NVR'))continue;
  const related=(p:Row)=>p.unitId===proof.unitId||p.deviceIds?.some((v:string)=>proof.deviceIds.includes(v))||p.unitKeys?.some((v:string)=>proof.unitKeys.includes(v));
  if(identity.identityWarnings.some(related)||[...(identity.unitIdentities||[]),...(identity.ownerConfirmedUnitIdentities||[])].some(p=>p!==proof&&related(p)))continue;
  const labels=new Set([proof.unitNumber,...proof.unitKeys].map(placementMatchKey));
  // Any relevant historical Owner record remains a hold. This repair does not
  // decide precedence or clear a Shop/Root move, including a newer one.
  if(audits.some(a=>labels.has(placementMatchKey(a.unit_key))||a.device_ids.some((v:unknown)=>proof.deviceIds.includes(id(v)!))))continue;
  result.fieldRecorderObservationGuards.push({unitId:proof.unitId,unitNumber:proof.unitNumber,identityProof:proof.proof,deviceIds:[...proof.deviceIds],unitKeys:[...proof.unitKeys],checkedAt:new Date(now).toISOString()});
 }
 return result;
}

/** Producer authentication failures leave cached device observations untouched.
 * Require an enabled, complete successful sync and that exact sync's records;
 * refreshed envelope timestamps never renew historical provider evidence. */
export function fieldRecorderHealthGuards(sources:IdentitySources,identity:Row,integrations:unknown,now=Date.now(),reviewed=REVIEWED_FIELD_RECORDER_PROOFS):FieldRecorderGuards {
 const empty:FieldRecorderGuards={fieldRecorderObservationVersion:1,fieldRecorderObservationGuards:[]};
 if(!Array.isArray(integrations)||integrations.length>1000||integrations.some(v=>!object(v)))return empty;
 const matches=integrations.filter(v=>v.provider==='vigilant');if(matches.length!==1)return empty;
 const integration=matches[0],sync=cameraTimestamp(integration.last_sync_at,now);
 if(integration.enabled!==true||integration.last_sync_status!=='ok'||!sync.fresh||!sync.at)return empty;
 const guarded=fieldRecorderObservationGuards(sources,identity,now,reviewed);
 return {...guarded,fieldRecorderObservationGuards:guarded.fieldRecorderObservationGuards.filter(guard=>sources.devices.filter(d=>guard.deviceIds.includes(String(d.id)))
  .every(d=>cameraTimestamp(d.source_last_seen_at,now).at===sync.at)).map(guard=>({...guard,providerSyncAt:sync.at!}))};
}

/** Called only after the existing map projection rechecks current native/source
 * guards and Owner history. No extra request and no equipment mutation. */
export async function projectFieldRecorderAuthority(snapshot:Row,sources:IdentitySources,identity:Row,now=Date.now(),reviewed=REVIEWED_FIELD_RECORDER_PROOFS){
 const guards=fieldRecorderObservationGuards(sources,identity,now,reviewed).fieldRecorderObservationGuards;
 if(!Array.isArray(snapshot.items)||!Array.isArray(snapshot.inventoryItems))return snapshot;
 const counts=new Map<string,number>();for(const row of snapshot.inventoryItems)counts.set(row.id,(counts.get(row.id)||0)+1);
 const authorities=new Map<string,Row>();
 for(const row of snapshot.items){
  const guard=guards.find(g=>g.unitId===row.id);if(!guard||counts.get(row.id)!==1||snapshot.items.filter((r:Row)=>r.id===row.id).length!==1)continue;
  const binding=await checkedImportedBinding(row.importedInstallation);
  if(row.readOnly!==false||row.unitNumber!==guard.unitNumber||row.status!=='field'||row.currentLocationType!=='field'||row.importedPlacement!=='FIELD'
   ||row.placementSource==='owner'||row.placementAuditId||!binding||binding.sourceSystem!=='mhelpdesk_product_import'||binding.entityKind!=='equipment_unit'
   ||binding.nativeUnitId!==row.id||binding.unitNumber!==row.unitNumber||binding.sourcePrecedence)continue;
  const {sourceRevision,sourceFileSha256,sourceRowSha256,addressSha256,nativeGuardSha256,eventId,productId}=binding;
  authorities.set(row.id,{schemaVersion:1,...guard,sourceRevision,sourceFileSha256,sourceRowSha256,addressSha256,nativeGuardSha256,eventId,productId});
 }
 const project=(row:Row)=>{const {fieldRecorderAuthority:discard,...clean}=row;return authorities.has(row.id)?{...clean,fieldRecorderAuthority:authorities.get(row.id)}:clean;};
 return {...snapshot,items:snapshot.items.map(project),inventoryItems:snapshot.inventoryItems.map(project)};
}
