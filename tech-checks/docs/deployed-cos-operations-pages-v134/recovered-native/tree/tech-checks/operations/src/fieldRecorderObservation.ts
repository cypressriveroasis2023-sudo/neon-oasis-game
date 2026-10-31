import {cameraTimestamp,combinedState,providerRecord,resourceKind,type CameraRow,type EvidenceState} from './cameraEvidence';
import {type VerifiedUnitIdentity,type LinkedUnitObservation} from './verifiedUnitIdentity';

type Row=Record<string,any>;
export type FieldRecorderAuthority={schemaVersion:1;unitId:string;unitNumber:string;identityProof:string;deviceIds:string[];unitKeys:string[];checkedAt:string;sourceRevision:string;sourceFileSha256:string;sourceRowSha256:string;addressSha256:string;nativeGuardSha256:string;eventId:string;productId:string};
export type FieldRecorderContext={id:string;unitNumber:string;readOnly?:boolean;status?:string;currentLocationType?:string;importedPlacement?:string;placementSource?:string;placementAuditId?:string;importedInstallation?:Row;fieldRecorderAuthority?:FieldRecorderAuthority};
export type FieldRecorderGuardEnvelope={fieldRecorderObservationVersion?:number;fieldRecorderObservationGuards?:unknown};
const object=(v:unknown):v is Row=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const same=(a:unknown,b:string[])=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&a.every(v=>typeof v==='string'&&b.includes(v));
const validGuard=(v:unknown):v is Row=>object(v)&&typeof v.unitId==='string'&&typeof v.unitNumber==='string'&&v.unitNumber.trim()!==''&&sha(v.identityProof)
 &&Array.isArray(v.deviceIds)&&v.deviceIds.length>0&&v.deviceIds.length<=1000&&new Set(v.deviceIds).size===v.deviceIds.length&&v.deviceIds.every((id:unknown)=>typeof id==='string'&&/^[1-9]\d*$/.test(id))
 &&Array.isArray(v.unitKeys)&&v.unitKeys.length>0&&new Set(v.unitKeys).size===v.unitKeys.length&&v.unitKeys.every((key:unknown)=>typeof key==='string'&&key.trim()!=='')&&typeof v.checkedAt==='string'&&typeof v.providerSyncAt==='string';

/** The map proves current Field installation; the independently refreshed health
 * envelope proves exact recorder identity and absence of an Owner placement hold.
 * This never changes source rows, activation, service state or camera channels. */
export function fieldRecorderObservation(unit:FieldRecorderContext,identity:VerifiedUnitIdentity,rows:CameraRow[],health:FieldRecorderGuardEnvelope,now=Date.now()):LinkedUnitObservation|null {
 const authority=unit.fieldRecorderAuthority,binding=unit.importedInstallation,guards=health.fieldRecorderObservationGuards;
 if(identity.kind!=='native_provider'||health.fieldRecorderObservationVersion!==1||!Array.isArray(guards)||guards.length>5||guards.some(g=>!validGuard(g))
  ||!object(authority)||authority.schemaVersion!==1||!object(binding)||unit.readOnly!==false||unit.status!=='field'||unit.currentLocationType!=='field'||unit.importedPlacement!=='FIELD'
  ||unit.placementSource==='owner'||unit.placementAuditId||binding.sourcePrecedence
  ||binding.schemaVersion!==1||binding.sourceSystem!=='mhelpdesk_product_import'||binding.entityKind!=='equipment_unit'||binding.eligibility!=='FIELD'
  ||binding.nativeUnitId!==unit.id||binding.unitNumber!==unit.unitNumber||identity.unitId!==unit.id||identity.unitNumber!==unit.unitNumber
  ||!cameraTimestamp(authority.checkedAt,now).fresh)return null;
 const selected=guards.filter(g=>g.unitId===unit.id);
 if(selected.length!==1)return null;
 const guard=selected[0],sync=cameraTimestamp(selected[0].providerSyncAt,now);if(!sync.fresh||!sync.at)return null;
 for(const proof of [authority,guard])if(proof.unitId!==unit.id||proof.unitNumber!==unit.unitNumber||proof.identityProof!==identity.proof||!sha(proof.identityProof)
  ||!same(proof.deviceIds,identity.deviceIds)||!same(proof.unitKeys,identity.unitKeys)||!cameraTimestamp(proof.checkedAt,now).fresh)return null;
 if(guards.some(g=>g!==guard&&(g.deviceIds.some((v:string)=>identity.deviceIds.includes(v))||g.unitKeys.some((v:string)=>identity.unitKeys.includes(v)))))return null;
 for(const key of ['sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','eventId','productId'])if(typeof authority[key as keyof FieldRecorderAuthority]!=='string'||authority[key as keyof FieldRecorderAuthority]!==binding[key])return null;
 if(!['sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256'].every(k=>sha(binding[k]))
  ||!same(rows.map(r=>String(r.id)),identity.deviceIds)||!same([...new Set(rows.map(r=>r.unit))],identity.unitKeys)
  ||rows.some(r=>resourceKind(r)!=='recorders'||!providerRecord(r)||r.evidence?.source!=='Star4Live'||cameraTimestamp(r.evidence?.observedAt,now).at!==sync.at))return null;
 const states=rows.map(r=>cameraTimestamp(r.evidence?.observedAt,now).fresh&&['online','offline'].includes(r.evidence?.status||'')?r.evidence!.status as EvidenceState:'verifying' as const);
 const state=combinedState(states) as EvidenceState,times=rows.map(r=>cameraTimestamp(r.evidence?.observedAt,now).at).filter((v):v is string=>Boolean(v)).sort();
 return {state,basis:'recorder',label:'RECORDER '+({online:'ONLINE',offline:'OFFLINE',degraded:'MIXED / PARTLY VERIFIED',verifying:'UNVERIFIED'}[state]),checkedAt:times.at(-1)||null,providerState:state,cameraState:'mapping',serviceState:'verifying'};
}
