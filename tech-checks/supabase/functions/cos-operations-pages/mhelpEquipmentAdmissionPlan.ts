/** Owner equipment source-admission PREPARATION. This module never writes data.
 * It classifies all Product IDs without joining on unit names, serials, IP or addresses.
 * Caller must pass a SHA-verified parsed full source and a separately authenticated,
 * current native source receipt. Future commit code must RECHECK every guard inside
 * one database transaction; a plan is not permission or proof to update equipment.
 */
import type {EquipmentCsvRow} from './mhelpEquipmentCsvPreview.ts';

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]{0,14}$/;
const normalize = (v:string) => v.trim().replace(/\s+/g,' ').toLowerCase();
const own = (v:object,k:string) => Object.prototype.hasOwnProperty.call(v,k);
const sourceFields = ['street','city','state','zip'] as const;
type GuardedRecord = EquipmentCsvRow & {binding?:null|Record<string,unknown>;placementHeld?:boolean;possibleAliasUnitIds?:unknown};
export type AdmissionDisposition = 'unchanged'|'assignment_change'|'lifecycle_change'|'identity_change'|'new_source_only'|'product_id_collision'|'absent_from_source'|'held_existing_guard';
export type AdmissionDecision = {
  productId:string;unitNumber:string;placement:'FIELD'|'SHOP'|null;previousPlacement:'FIELD'|'SHOP'|null;
  disposition:AdmissionDisposition;hold:boolean;reason:string;
};
export type AdmissionGuards = {
  sourceSha256:string;expectedActiveSourceSha256:string;
  // A verified Google Sheets receipt, not caller-provided row counts alone.
  tracker?:{contract:'COS_VERIFIED_2027_PRODUCT_CENSUS_V1';sourceSha256:string;observedAt:string;productIds:readonly string[];verifiedBy:'cos_sheets_service'};
  // Explicit authenticated read of current Owner / equipment / archived associations.
  currentNativeGuardsVerified:boolean;
};
export type AdmissionPlan = {
  contract:'COS_MHELP_EQUIPMENT_ADMISSION_PLAN_V1';mode:'PREPARE_ONLY';
  sourceSha256:string;expectedActiveSourceSha256:string;
  inventory:{total:number;field:number;shop:number;inactive:number};
  counts:Record<AdmissionDisposition,number>;
  changes:AdmissionDecision[];
  holds:AdmissionDecision[];
  gates:{productIdsVerified:boolean;current2027CensusVerified:boolean;currentNativeGuardsVerified:boolean;identityHoldsClear:boolean;canCommit:boolean};
  blockers:string[];
  note:string;
};
function bad(message:string):never{throw new Error('Equipment admission plan rejected: '+message);}
function identicalAddress(a:EquipmentCsvRow['sourceAddress'],b:EquipmentCsvRow['sourceAddress']){
  return sourceFields.every(k=>typeof a[k]==='string'&&typeof b[k]==='string'&&normalize(a[k])===normalize(b[k]));
}
function isRecord(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
/** Output contains only bounded Product-ID/label/placement decisions; never addresses or IPs. */
export function prepareMhelpEquipmentAdmission(rows:EquipmentCsvRow[],previous:unknown,guards:AdmissionGuards):AdmissionPlan{
  if(!Array.isArray(rows)||!rows.length||rows.length>10000||!isRecord(previous)||previous.contract!=='COS_MHELP_UPLOAD_V1'||previous.reviewed!==true||!Array.isArray(previous.records)||previous.records.length>10000||!SHA.test(guards.sourceSha256)||!SHA.test(guards.expectedActiveSourceSha256)||previous.sourceSha256!==guards.expectedActiveSourceSha256)bad('complete source and current reviewed source guard required');
  const productIds=new Set<string>();
  for(const r of rows){if(!r||!ID.test(r.productId)||productIds.has(r.productId)||!['FIELD','SHOP'].includes(r.placement)||!['UNFLAGGED','MISSING','DO_NOT_USE'].includes(r.lifecycle)||!r.unitNumber||!r.customerId||!r.customer||!r.category||!r.sourceAddress)bad('invalid or duplicate source equipment');productIds.add(r.productId);}
  const oldRecords=previous.records as GuardedRecord[], prior=new Map<string,GuardedRecord>(),missing=new Map<string,GuardedRecord[]>();
  for(const r of oldRecords){if(!r||!ID.test(r.productId)||prior.has(r.productId)||!['FIELD','SHOP'].includes(r.placement)||!r.unitNumber||!r.category||!r.sourceAddress)bad('invalid previous authoritative source');prior.set(r.productId,r);if(!productIds.has(r.productId)){const key=normalize(r.category)+'|'+normalize(r.unitNumber);missing.set(key,[...(missing.get(key)||[]),r]);}}
  const decisions:AdmissionDecision[]=[],counts:Record<AdmissionDisposition,number>={unchanged:0,assignment_change:0,lifecycle_change:0,identity_change:0,new_source_only:0,product_id_collision:0,absent_from_source:0,held_existing_guard:0};
  const record=(row:GuardedRecord,old:GuardedRecord|null,disposition:AdmissionDisposition,hold:boolean,reason:string)=>{counts[disposition]++;decisions.push({productId:row.productId,unitNumber:row.unitNumber,placement:row===old?null:row.placement,previousPlacement:old?.placement??null,disposition,hold,reason});};
  for(const row of rows){
    const p=prior.get(row.productId);
    if(!p){const candidate=missing.get(normalize(row.category)+'|'+normalize(row.unitNumber));
      if(candidate?.length)record(row,null,'product_id_collision',true,'A different Product ID had this label; no automatic equipment or camera identity merge');
      else record(row,null,'new_source_only',true,'New Product ID; needs reviewed source-only admission and association');
      continue;
    }
    const b=p.binding;
    // This is only a snapshot guard, NOT the live DB check needed at commit.
    if(p.placementHeld===true||b&&(!isRecord(b)||b.guardCurrent!==true)){
      record(row,p,'held_existing_guard',true,'Previous source association is held or its identity guard is stale');continue;
    }
    if(normalize(p.category)!==normalize(row.category)||normalize(p.unitNumber)!==normalize(row.unitNumber)){
      record(row,p,'identity_change',true,'Unit/category identity changed; require exact Product ID evidence');continue;
    }
    if(p.lifecycle!==row.lifecycle){record(row,p,'lifecycle_change',true,'Lifecycle change requires source and owner review');continue;}
    if(p.placement!==row.placement||p.customerId!==row.customerId||normalize(p.customer)!==normalize(row.customer)||!identicalAddress(p.sourceAddress,row.sourceAddress)){
      record(row,p,'assignment_change',true,'Installation/customer movement: retain old GPS and owner records; verify current location and actor guards');continue;
    }
    record(row,p,'unchanged',false,'Same Product ID and source assignment; do not rewrite camera, IP or GPS');
  }
  for(const p of oldRecords){if(!productIds.has(p.productId))record(p,p,'absent_from_source',true,'Remove from current source membership only; preserve historical equipment and audit');}
  const tracker=guards.tracker;
  let trackerVerified=false;
  if(tracker){
    if(tracker.contract!=='COS_VERIFIED_2027_PRODUCT_CENSUS_V1'||!SHA.test(tracker.sourceSha256)||!Number.isFinite(Date.parse(tracker.observedAt))||tracker.verifiedBy!=='cos_sheets_service'||!Array.isArray(tracker.productIds)||tracker.productIds.some(id=>!ID.test(id)))bad('unverified 2027 tracker source');
    const set=new Set(tracker.productIds);
    trackerVerified=set.size===productIds.size&&set.size===tracker.productIds.length&&[...productIds].every(id=>set.has(id));
  }
  const holds=decisions.filter(d=>d.hold);
  const blockers:string[]=[];
  if(!trackerVerified)blockers.push('CURRENT_2027_PRODUCT_CENSUS_NOT_VERIFIED');
  if(guards.currentNativeGuardsVerified!==true)blockers.push('CURRENT_OWNER_NATIVE_GPS_GUARDS_NOT_VERIFIED');
  if(holds.length)blockers.push('HELD_IDENTITIES_REQUIRE_REVIEW');
  // This plan is never proof of transaction-time currentness, and cannot commit.
  blockers.push('TRANSACTIONAL_OWNER_SOURCE_ADMISSION_NOT_INSTALLED');
  return {contract:'COS_MHELP_EQUIPMENT_ADMISSION_PLAN_V1',mode:'PREPARE_ONLY',sourceSha256:guards.sourceSha256,expectedActiveSourceSha256:guards.expectedActiveSourceSha256,
    inventory:{total:rows.length,field:rows.filter(r=>r.placement==='FIELD').length,shop:rows.filter(r=>r.placement==='SHOP').length,inactive:rows.filter(r=>r.lifecycle!=='UNFLAGGED').length},
    counts,changes:decisions,holds,gates:{productIdsVerified:true,current2027CensusVerified:trackerVerified,currentNativeGuardsVerified:guards.currentNativeGuardsVerified===true,identityHoldsClear:holds.length===0,canCommit:false},blockers,
    note:'Read-only planning only. Production commit needs an independently authenticated Owner and a fresh transactional source/identity/GPS guard recheck. No raw CSV, customer addresses, IPs or GPS are emitted.'};
}
/** UI-safe summary. Never return all private product associations or addresses. */
export function summarizeMhelpAdmission(plan:AdmissionPlan){
 return {
  contract:plan.contract,mode:plan.mode,sourceSha256:plan.sourceSha256,
  inventory:plan.inventory,counts:plan.counts,gates:plan.gates,blockers:plan.blockers,
  heldSample:plan.holds.slice(0,30).map(({productId,unitNumber,disposition,reason})=>({productId,unitNumber,disposition,reason})),
  totalHeld:plan.holds.length,readyToCommit:false as const,
  note:plan.note,
 };
}
