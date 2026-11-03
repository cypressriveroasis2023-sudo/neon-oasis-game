/** Candidate only: not imported by the live Board, router, or publisher.
 * Supply already-authorized, already-validated snapshots from the SAME tenant.
 * This pure projection grants no access and does not fetch, save, or classify health.
 */
type Row = Record<string, unknown>;
export type LinkReason =
  | 'invalid_record' | 'source_unavailable' | 'scope_mismatch'
  | 'no_saved_assignment' | 'multiple_saved_assignments' | 'invalid_assignment'
  | 'unit_unavailable' | 'unit_inactive' | 'product_binding_missing'
  | 'product_binding_conflict' | 'product_binding_held'
  | 'product_binding_not_reviewed' | 'product_inactive' | 'evidence_mismatch';
export type BoardUnitLink = {contract:'COS_BOARD_UNIT_LINK_V1';state:'not_linked';reason:LinkReason}
  | {contract:'COS_BOARD_UNIT_LINK_V1';state:'linked';jobId:string;unitId:string;
     productId:string;assignmentId:string;basis:'current_job_assignment';
     recordContext:'job'|'completed_visit_current_job'|'task_related_job';
     assignmentAsOf:string;fleetAsOf:string;productObservedAt:string;sourceSha256:string};
const row = (value:unknown):value is Row => !!value && typeof value==='object' && !Array.isArray(value);
const uuid = (value:unknown):value is string => typeof value==='string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value) && value!=='00000000-0000-0000-0000-000000000000';
const productId = (value:unknown):value is string => typeof value==='string' && /^[1-9][0-9]{0,14}$/.test(value);
const digest = (value:unknown):value is string => typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const stamp = (value:unknown):value is string => typeof value==='string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const rows = (value:unknown,max:number):value is Row[] => Array.isArray(value) && value.length<=max && value.every(row);
const ids = (value:unknown,max:number):value is string[] => Array.isArray(value) && value.length<=max &&
  value.every(uuid) && new Set(value).size===value.length;
const inactive = new Set(['retired','decommissioned','deleted','stolen']);
const blocked = (reason:LinkReason):BoardUnitLink => ({contract:'COS_BOARD_UNIT_LINK_V1',state:'not_linked',reason});

/** Never derive a job or unit identifier from a human label, tag, IP, or visit string. */
export function savedBoardJob(kind:unknown, record:unknown):{jobId:string;context:'job'|'completed_visit_current_job'|'task_related_job'}|null {
  if(!row(record))return null;
  if(kind==='task')return uuid(record.id)&&uuid(record.relatedJobId)?{jobId:record.relatedJobId,context:'task_related_job'}:null;
  if(kind!=='job')return null;
  if(record.completionKind==='visit')return uuid(record.jobId)&&uuid(record.visitId)&&record.id===`${record.jobId}:visit:${record.visitId}`
    ?{jobId:record.jobId,context:'completed_visit_current_job'}:null;
  if(record.completionKind!=null || !uuid(record.id) || (record.jobId!=null&&record.jobId!==record.id))return null;
  return {jobId:record.id,context:'job'};
}

/** `evidence` is a SERVER-INTERNAL envelope, never browser-supplied proof.
 * readState must come from existing freshness/availability decisions; this code
 * does not introduce a freshness timer or equate a fetch time with camera health.
 */
export function resolveBoardUnitLink(kind:unknown,record:unknown,evidence:unknown):BoardUnitLink {
  const job=savedBoardJob(kind,record);
  if(!job)return blocked('invalid_record');
  if(!row(evidence)||!uuid(evidence.organizationId)||!stamp(evidence.asOf))return blocked('source_unavailable');
  const assignment=evidence.assignments, fleet=evidence.fleet;
  if(!row(assignment)||assignment.contract!=='COS_BOARD_ASSIGNMENTS_V1'||assignment.readState!=='current'||assignment.complete!==true||
     !stamp(assignment.asOf)||!rows(assignment.items,2000)||!ids(assignment.jobIds,500)||
     !row(fleet)||fleet.readState!=='current'||!stamp(fleet.asOf)||!row(fleet.value))return blocked('source_unavailable');
  if(assignment.organizationId!==evidence.organizationId||fleet.organizationId!==evidence.organizationId||!assignment.jobIds.includes(job.jobId))return blocked('scope_mismatch');
  if(Date.parse(assignment.asOf)>Date.parse(evidence.asOf)||Date.parse(fleet.asOf)>Date.parse(evidence.asOf))return blocked('evidence_mismatch');
  const assignmentJobIds=assignment.jobIds;
  // SQL supplies ALL active primary assignments. Never hide duplicates with LIMIT 1.
  if(assignment.items.some(a=>!uuid(a.assignmentId)||!uuid(a.jobId)||!assignmentJobIds.includes(a.jobId)||a.assignmentType!=='primary_job_unit'||a.status!=='active')||
     new Set(assignment.items.map(a=>a.assignmentId)).size!==assignment.items.length)return blocked('invalid_assignment');
  const assigned=assignment.items.filter(a=>a.jobId===job.jobId);
  if(!assigned.length)return blocked('no_saved_assignment');
  if(assigned.length!==1)return blocked('multiple_saved_assignments');
  const a=assigned[0];
  if(a.sameOrganization!==true||!uuid(a.unitId)||a.releasedAt!==null||!stamp(a.assignedAt)||Date.parse(a.assignedAt)>Date.parse(assignment.asOf))return blocked('invalid_assignment');
  if(typeof a.unitStatus!=='string'||!a.unitStatus)return blocked('unit_unavailable');
  if(a.retiredAt!==null||inactive.has(a.unitStatus.toLowerCase()))return blocked('unit_inactive');
  const value=fleet.value,inventory=value.inventoryItems,upload=value.uploadInventory;
  if(!rows(inventory,20000)||!row(upload)||upload.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'||upload.source!=='mhelpdesk_api'||
     !digest(upload.sourceSha256)||!stamp(upload.lastApiReadAt)||Date.parse(upload.lastApiReadAt)>Date.parse(fleet.asOf)||
     !rows(upload.records,10000)||!row(upload.summary)||upload.summary.totalRecords!==upload.records.length||
     !Array.isArray(upload.missingProductIds)||!upload.missingProductIds.every(productId))return blocked('source_unavailable');
  // Reject ambiguous product census rather than selecting the first plausible row.
  if(upload.records.some(r=>!productId(r.productId)||r.recordId!=='mhelp_product:'+r.productId||!row(r.binding)||!ids(r.binding.unitIds,2)||!ids(r.binding.candidateUnitIds,10000))||
     new Set(upload.records.map(r=>r.productId)).size!==upload.records.length)return blocked('product_binding_conflict');
  const units=inventory.filter(u=>u.id===a.unitId);
  if(units.length!==1)return blocked('unit_unavailable');
  const unit=units[0];
  if(unit.readOnly===true)return blocked('unit_unavailable');
  if(unit.activeInventoryEligible===false||unit.uploadActiveInventoryEligible===false||inactive.has(String(unit.status||'').toLowerCase()))return blocked('unit_inactive');
  const candidates=upload.records.filter(r=>{
    const b=r.binding as Row;
    return (b.unitIds as string[]).includes(a.unitId as string)||(b.candidateUnitIds as string[]).includes(a.unitId as string);
  });
  if(!candidates.length)return blocked('product_binding_missing');
  if(candidates.length!==1)return blocked('product_binding_conflict');
  const r=candidates[0], b=r.binding as Row;
  if(b.state!=='linked'||b.placementHeld!==false||b.reason!==null||r.overlayApplied!==true||!(b.unitIds as string[]).includes(a.unitId))return blocked('product_binding_held');
  // Name-only, archived-alias and derived mappings are not promoted into this contract.
  if(b.matchMethod!=='reviewed_product_id')return blocked('product_binding_not_reviewed');
  if(r.uploadLifecycle!=='UNFLAGGED'||upload.missingProductIds.includes(r.productId as string))return blocked('product_inactive');
  const proof=unit.uploadPlacementEvidence;
  if(unit.uploadProductId!==r.productId||unit.uploadLifecycle!=='UNFLAGGED'||unit.uploadActiveInventoryEligible!==true||
     !stamp(r.observedAt)||Date.parse(r.observedAt)>Date.parse(fleet.asOf)||!row(proof)||
     proof.source!=='mhelpdesk_api'||proof.state!=='recorded'||proof.evidenceKind==='derived_mapping'||
     proof.productId!==r.productId||proof.sourceSha256!==upload.sourceSha256||proof.observedAt!==r.observedAt||
     unit.placementStatus==='needs_identity_review'||unit.representationStatus==='conflict'||!!unit.placementReviewReason)return blocked('evidence_mismatch');
  return {contract:'COS_BOARD_UNIT_LINK_V1',state:'linked',jobId:job.jobId,unitId:a.unitId,
    productId:r.productId as string,assignmentId:a.assignmentId as string,basis:'current_job_assignment',recordContext:job.context,
    assignmentAsOf:assignment.asOf,fleetAsOf:fleet.asOf,productObservedAt:r.observedAt,sourceSha256:upload.sourceSha256};
}

/** Add only link metadata; never mutate source records or override supplied work/health fields. */
export function appendBoardUnitLinks(board:unknown,evidence:unknown):Row {
  if(!row(board)||!rows(board.jobs,10000)||!rows(board.tasks,10000))throw new TypeError('Complete authorized Board snapshot required.');
  return {...board,jobs:board.jobs.map(record=>({...record,unitLink:resolveBoardUnitLink('job',record,evidence)})),
    tasks:board.tasks.map(record=>({...record,unitLink:resolveBoardUnitLink('task',record,evidence)}))};
}
