/**
 * Pure proposal for the original Tech Check database. This never calls a database,
 * creates a prep, sets a Ticket Lead, claims work, or changes vendor/local status.
 * `ready` means source-complete routing proposal, not permission to execute it.
 * A future adapter must verify the live RPC contract, Owner identity, Ticket Lead
 * semantics, and atomically deduplicate before using the proposed arguments.
 *
 * Repository evidence (main ca125da): technician-wizard-owner-dashboard-v5.js
 * 8092-8114: Owner flow selection; 9168-9202: owner_assign_job_bundle_v1 shape;
 * 2342-2367: handoff/return gates; 3416-3422: Swap includes return IT Intake.
 * tech-check-rules.js 9-19: supported canonical equipment labels/categories.
 * Targeted live metadata verification (2026-10-10) confirms the Owner bundle does
 * not set Ticket Lead, claim work or provide durable source-identity deduplication.
 */
export const LEGACY_TECH_CHECK_PROJECT = 'goqrnolcvqnirjmzaeyk';
export const LEGACY_ROUTE_CONTRACT = 'cos-mhelp-legacy-route-plan-v1';
export type LegacyWorkType = 'service' | 'delivery' | 'swap' | 'pickup';
export type LegacyDepartment = 'it' | 'service';
export const LEGACY_PART_FIELDS = [
  'solar_panel_qty', 'battery_replacement_qty', 'camera_replacement_qty',
  'sim_replacement_qty', 'micro_sd_qty',
] as const;
type PartField = typeof LEGACY_PART_FIELDS[number];
type Row = Record<string, unknown>;
export type AssignmentFact = {
  state: 'assigned' | 'unassigned' | 'unknown';
  identities: string[];
  evidence: string;
};
export type LegacyRouteInput = {
  source: {
    portalId: string; ticketId: string; ticketNumber: string; typeId: string;
    statusId: string; customStatusId: string | null; deleted: boolean;
    assignment: AssignmentFact;
  };
  typeMappings: Array<{
    portalId: string; typeId: string; workType: LegacyWorkType;
    reviewed: boolean; evidence: string;
  }>;
  identityCrosswalk: Array<{
    portalId: string; sourceIdentity: string; legacyProjectId: string;
    legacyUserId: string; department: LegacyDepartment;
    active: boolean; archived: boolean; verified: boolean; evidence: string;
  }>;
  /** These must reflect explicit source facts, never an inferred empty department. */
  departmentAssignments?: Array<AssignmentFact & {department: LegacyDepartment}>;
  site: {reviewed: boolean; value: string; evidence: string};
  description: {reviewed: boolean; value: string; evidence: string};
  schedule: {reviewed: boolean; date: string; time: string | null; evidence: string};
  equipment: {
    complete: boolean; reviewed: boolean; evidence: string;
    items: Array<{category: 'device' | 'stand'; label: string; qty: number}>;
  };
  parts: {complete: boolean; reviewed: boolean; evidence: string; quantities: Record<PartField, number>};
  notes: string;
  unitSummary: string;
};
export type LegacyBundleRequest = {
  ticket_no: string; site: string; work_type: LegacyWorkType;
  targets: Array<{role: LegacyDepartment; assignee_user_id: string | null; requires_it_handoff: boolean}>;
  requested_unit_count: number; unit_summary: string; job_description: string; notes: string;
  equipment_manifest: Array<{category: 'device' | 'stand'; label: string; qty: number}>;
  scheduled_for: string; scheduled_time: string | null;
} & Record<PartField, number>;
export type LegacyRoutePlan = {
  contract: typeof LEGACY_ROUTE_CONTRACT;
  state: 'ready' | 'review_needed';
  reasonCodes: string[];
  originalSource: {
    portalId: string | null; ticketId: string | null; ticketNumber: string | null;
    typeId: string | null; statusId: string | null; customStatusId: string | null;
    deleted: boolean | null; assignment: AssignmentFact | null;
  };
  workType: LegacyWorkType | null;
  firstDepartment: LegacyDepartment | null;
  intakeRequired: boolean;
  /** The Owner bundle does not assign the lead needed for the IT MHelp view. */
  ticketLead: 'requires_verified_it_lead' | 'not_assigned_by_plan';
  requiresAtomicDuplicateCheck: true;
  executionEnabled: false;
  request: {p_request: LegacyBundleRequest} | null;
};
const EQUIPMENT: Record<string, 'device' | 'stand'> = {
  Sniper: 'device', Ranger: 'device', Helios: 'device', 'Solar Spotter': 'device',
  Spotter: 'device', 'Recon 2': 'device', '110V Stand': 'stand', 'Solar Stand': 'stand', Pole: 'stand',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown, max = 500, empty = false): value is string => typeof value === 'string' && value.length <= max &&
  value === value.trim() && (empty || value.length > 0) && !/[\x00-\x1f\x7f]/.test(value);
const evidence = (value: unknown): boolean => str(value, 1000);
const id = (value: unknown): string | null => str(value, 128) ? value : null;
const bodyText = (value: unknown, max: number, required = false): value is string => typeof value === 'string' &&
  value.length <= max && (!required || value.trim().length > 0) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
};
function assignment(value: unknown): AssignmentFact | null {
  const row = obj(value);
  if (!['assigned', 'unassigned', 'unknown'].includes(String(row.state)) || !Array.isArray(row.identities) ||
      row.identities.length > 20 || !row.identities.every(v => str(v, 128)) || !evidence(row.evidence)) return null;
  if (row.state === 'unassigned' && row.identities.length !== 0) return null;
  if (row.state === 'assigned' && row.identities.length === 0) return null;
  return {state: row.state as AssignmentFact['state'], identities: [...row.identities], evidence: row.evidence as string};
}

/** Runtime validation is intentional: a TypeScript cast is not source verification. */
export function planMhelpLegacyRoute(value: unknown): LegacyRoutePlan {
  const input = obj(value), source = obj(input.source), reasons: string[] = [];
  const add = (reason: string) => { if (!reasons.includes(reason)) reasons.push(reason); };
  const globalAssignment = assignment(source.assignment);
  const originalSource: LegacyRoutePlan['originalSource'] = {
    portalId: id(source.portalId), ticketId: id(source.ticketId), ticketNumber: id(source.ticketNumber),
    typeId: id(source.typeId), statusId: id(source.statusId), customStatusId: source.customStatusId === null ? null : id(source.customStatusId),
    deleted: typeof source.deleted === 'boolean' ? source.deleted : null, assignment: globalAssignment,
  };
  if (!originalSource.portalId || !originalSource.ticketId || !originalSource.ticketNumber || !originalSource.typeId ||
      !originalSource.statusId || (source.customStatusId !== null && !originalSource.customStatusId) || originalSource.deleted === null) add('source_identity_or_status_incomplete');
  if (source.deleted === true) add('source_ticket_deleted');
  if (!globalAssignment || globalAssignment.state === 'unknown') add('source_assignment_unknown');
  if (globalAssignment && globalAssignment.identities.length > 1) add('source_assignment_ambiguous');

  const mappings = Array.isArray(input.typeMappings) ? input.typeMappings.map(obj).filter(row =>
    row.portalId === source.portalId && row.typeId === source.typeId) : [];
  let workType: LegacyWorkType | null = null;
  if (mappings.length !== 1) add(mappings.length ? 'type_mapping_ambiguous' : 'type_mapping_missing');
  else if (mappings[0].reviewed !== true || !evidence(mappings[0].evidence) ||
      !['service','delivery','swap','pickup'].includes(String(mappings[0].workType))) add('type_mapping_unverified');
  else workType = mappings[0].workType as LegacyWorkType;

  const manifest: LegacyBundleRequest['equipment_manifest'] = [], equipment = obj(input.equipment);
  if (equipment.complete !== true || equipment.reviewed !== true || !evidence(equipment.evidence) || !Array.isArray(equipment.items) || equipment.items.length > 100) add('equipment_scope_incomplete');
  else {
    const seen = new Set<string>();
    for (const raw of equipment.items) {
      const item = obj(raw), label = item.label;
      if (typeof label !== 'string' || !Object.hasOwn(EQUIPMENT, label) || item.category !== EQUIPMENT[label] ||
          typeof item.qty !== 'number' || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 1000000) { add('equipment_item_unsupported'); continue; }
      if (seen.has(label)) { add('equipment_quantity_ambiguous'); continue; }
      seen.add(label); manifest.push({category: EQUIPMENT[label], label, qty: item.qty});
    }
  }
  const parts = obj(input.parts), rawQuantities = obj(parts.quantities), quantities = {} as Record<PartField, number>;
  if (parts.complete !== true || parts.reviewed !== true || !evidence(parts.evidence) ||
      Object.keys(rawQuantities).some(key => !(LEGACY_PART_FIELDS as readonly string[]).includes(key))) add('parts_scope_incomplete');
  for (const key of LEGACY_PART_FIELDS) {
    const count = rawQuantities[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 1000000) add('part_quantity_invalid_or_missing');
    else quantities[key] = count;
  }
  const hasPrep = manifest.length > 0 || LEGACY_PART_FIELDS.some(key => quantities[key] > 0);
  if (workType && ['delivery', 'swap', 'pickup'].includes(workType) && manifest.length === 0) add('equipment_required');
  if (workType === 'delivery' && manifest.some(row => row.label === 'Solar Spotter') && manifest.some(row => row.label === 'Solar Stand')) add('automatic_service_solar_stand_conflict');
  const departments: LegacyDepartment[] = workType === 'pickup' ? ['service', 'it'] :
    workType === 'delivery' || workType === 'swap' || (workType === 'service' && hasPrep) ? ['it', 'service'] : workType === 'service' ? ['service'] : [];

  const site = obj(input.site), description = obj(input.description), schedule = obj(input.schedule);
  if (site.reviewed !== true || !evidence(site.evidence) || !str(site.value, 500)) add('site_review_required');
  if (description.reviewed !== true || !evidence(description.evidence) || !bodyText(description.value, 10000, true)) add('description_review_required');
  if (schedule.reviewed !== true || !evidence(schedule.evidence) || !date(schedule.date) ||
      !(schedule.time === null || (typeof schedule.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(schedule.time)))) add('schedule_review_required');
  if (!bodyText(input.notes, 10000) || !bodyText(input.unitSummary, 2000)) add('notes_or_unit_summary_invalid');
  const crosswalk = Array.isArray(input.identityCrosswalk) ? input.identityCrosswalk.map(obj) : [];
  const deptFacts = input.departmentAssignments === undefined ? [] : Array.isArray(input.departmentAssignments) ? input.departmentAssignments.map(obj) : null;
  if (deptFacts === null || deptFacts.some(row => !['it','service'].includes(String(row.department)))) add('department_assignment_invalid');
  const targets: LegacyBundleRequest['targets'] = [];
  const routedSourceIdentities = new Set<string>();
  for (const department of departments) {
    const candidates = (deptFacts || []).filter(row => row.department === department);
    if (candidates.length > 1) { add('department_assignment_ambiguous'); continue; }
    const fact = candidates.length ? assignment(candidates[0]) : globalAssignment;
    if (!fact || fact.state === 'unknown') { add('department_assignment_unknown'); continue; }
    if (fact.identities.length > 1) { add('department_assignment_ambiguous'); continue; }
    if (candidates.length && globalAssignment?.state === 'unassigned' && fact.state === 'assigned') {
      add('source_department_assignment_conflict'); continue;
    }
    let userId: string | null = null;
    if (fact.state === 'assigned') {
      const matches = crosswalk.filter(row => row.portalId === source.portalId && row.sourceIdentity === fact.identities[0]);
      if (matches.length !== 1) { add(matches.length ? 'assignee_identity_ambiguous' : 'assignee_identity_unmatched'); continue; }
      const match = matches[0];
      if (match.legacyProjectId !== LEGACY_TECH_CHECK_PROJECT || typeof match.legacyUserId !== 'string' || !UUID.test(match.legacyUserId) ||
          match.active !== true || match.archived !== false || match.verified !== true || !evidence(match.evidence)) { add('assignee_identity_unverified'); continue; }
      if (match.department !== department) { add('department_assignee_unresolved'); continue; }
      userId = match.legacyUserId;
      routedSourceIdentities.add(fact.identities[0]);
    }
    targets.push({role: department, assignee_user_id: userId, requires_it_handoff: department === 'service' && departments[0] === 'it'});
  }
  if (globalAssignment?.state === 'assigned' && globalAssignment.identities.some(identity => !routedSourceIdentities.has(identity))) add('source_assignee_not_routed');
  if (targets.some((target, index) => target.assignee_user_id !== null && targets.some((other, otherIndex) => otherIndex !== index &&
      other.assignee_user_id?.toLowerCase() === target.assignee_user_id?.toLowerCase()))) add('assignee_department_identity_conflict');
  if ((deptFacts || []).some(row => !departments.includes(row.department as LegacyDepartment) && assignment(row)?.state === 'assigned')) add('assignment_for_unrouted_department');
  // No name, vendor status, account creation or workflow completion enters this object.
  const request = reasons.length || !workType ? null : {p_request: {
    ticket_no: source.ticketNumber as string, site: site.value as string, work_type: workType, targets,
    requested_unit_count: manifest.filter(row => row.category === 'device').reduce((sum, row) => sum + row.qty, 0),
    unit_summary: input.unitSummary as string, job_description: description.value as string, notes: input.notes as string,
    equipment_manifest: manifest, scheduled_for: schedule.date as string, scheduled_time: schedule.time as string | null,
    ...quantities,
  }};
  return {
    contract: LEGACY_ROUTE_CONTRACT, state: request ? 'ready' : 'review_needed', reasonCodes: reasons,
    originalSource, workType, firstDepartment: departments[0] || null, intakeRequired: workType === 'swap' || workType === 'pickup',
    ticketLead: departments.includes('it') ? 'requires_verified_it_lead' : 'not_assigned_by_plan',
    requiresAtomicDuplicateCheck: true, executionEnabled: false, request,
  };
}
