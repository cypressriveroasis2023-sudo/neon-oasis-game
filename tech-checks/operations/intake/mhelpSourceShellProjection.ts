/** Inactive, pure projection of already verified normalized facts. No vendor parser or adapter registration. */
import {
  LEGACY_PART_FIELDS, TECHNICIAN_EQUIPMENT_SELECTION_POLICY,
  type AssignmentFact, type DeferredLegacyRouteInput, type LegacyBundleRequest, type LegacyDepartment,
  type LegacyRouteInput, type LegacyWorkType,
} from '../shared/mhelpLegacyRoutePlan.ts';
import {MHELP_LEGACY_INTAKE_CONTRACT, type LegacyIntakePayload} from '../legacy/mhelpIntakeAdapter.ts';
import {exact, identity, IntakeFault, row, utc} from './mhelpIntakeRuntime.ts';

type Source = LegacyIntakePayload['source'];
type MinimumSource = Pick<Source, 'portalId' | 'ticketId' | 'ticketNumber' | 'createdAt'>;
/** Normalization/verification belongs to a future evidence-bound adapter, never this builder. */
export type NormalizedMhelpShellFacts = {
  source: MinimumSource & Partial<Omit<Source, keyof MinimumSource>>;
  description?: DeferredLegacyRouteInput['description'] | null;
  notes?: string | null;
  /** Verified original notes can be the instruction evidence when no summary exists. */
  notesEvidence?: Pick<DeferredLegacyRouteInput['description'], 'reviewed' | 'evidence'> | null;
  schedule?: DeferredLegacyRouteInput['schedule'] | null;
  site?: DeferredLegacyRouteInput['site'];
  unitSummary?: string;
  departmentAssignments?: DeferredLegacyRouteInput['departmentAssignments'];
};
export type ReviewedMhelpShellConfiguration = {
  portalId: string;
  schemaContract: string;
  /** Exact reviewed source type mapping. Never inferred from names, notes or a default route. */
  routeMapping?: LegacyRouteInput['typeMappings'][number] | null;
};
export type MhelpSourceShellEnvelope = LegacyIntakePayload | {
  contract: typeof MHELP_LEGACY_INTAKE_CONTRACT;
  schemaContract: string;
  source: NormalizedMhelpShellFacts['source'];
  request: null;
};
const text = (value: unknown, max: number): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const body = (value: unknown, max: number): value is string => typeof value === 'string' &&
  value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const factRow = (value: unknown, keys: string[]) => {
  if (value == null) return null;
  const result = row(value); exact(result, keys); return result;
};
function assignment(value: unknown): AssignmentFact | null {
  const fact = factRow(value, ['state', 'identities', 'evidence']);
  if (!fact || !text(fact.evidence, 1000) || !Array.isArray(fact.identities) ||
      fact.identities.length > 1 || !fact.identities.every(id => text(id, 128))) return null;
  if (fact.state === 'assigned' && fact.identities.length === 1 || fact.state === 'unassigned' && fact.identities.length === 0) {
    return {state: fact.state, identities: [...fact.identities], evidence: fact.evidence};
  }
  return null;
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') return false;
  const instant = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

/**
 * Null target IDs mean unresolved native projection, NOT an unassigned source.
 * Only private legacy SQL resolves the exact opaque source identities to current
 * COS profiles. This module never receives a crosswalk, COS user ID or client.
 * A complete envelope is still unapproved for execution: SQL must independently
 * revalidate route, source status, crosswalk, current profiles and immutable history.
 * Missing/ambiguous operational facts produce a pending envelope retaining only
 * independently validated source facts alongside mandatory immutable identity.
 * Invalid immutable identity/configuration or unexpected fields throw fail-closed.
 * No raw provider exceptions or partially verified containers enter a pending receipt.
 */
export function projectMhelpSourceShell(value: unknown, configuration: ReviewedMhelpShellConfiguration): MhelpSourceShellEnvelope {
  const config = row(configuration); exact(config, ['portalId', 'schemaContract', 'routeMapping']);
  identity(config.portalId);
  if (!text(config.schemaContract, 128)) throw new IntakeFault('CONFIGURATION');
  const input = row(value); exact(input, ['source', 'description', 'notes', 'notesEvidence', 'schedule', 'site', 'unitSummary', 'departmentAssignments']);
  const source = row(input.source);
  exact(source, ['portalId', 'ticketId', 'ticketNumber', 'createdAt', 'typeId', 'statusId', 'customStatusId', 'deleted', 'assignment']);
  if (identity(source.portalId) !== config.portalId || typeof source.ticketNumber !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(source.ticketNumber)) throw new IntakeFault('SOURCE_INVALID');
  const pending: Extract<MhelpSourceShellEnvelope, {request:null}> = {
    contract: MHELP_LEGACY_INTAKE_CONTRACT, schemaContract: config.schemaContract,
    source: {portalId: source.portalId as string, ticketId: identity(source.ticketId), ticketNumber: source.ticketNumber, createdAt: utc(source.createdAt)},
    request: null,
  };
  // Validate allowlists even when another fact is missing. Do not silently drop
  // a structured equipment scope, raw provider body, fake lead or caller UUID.
  const route = factRow(config.routeMapping, ['portalId', 'typeId', 'workType', 'reviewed', 'evidence']);
  const description = factRow(input.description, ['reviewed', 'value', 'evidence']);
  const notesEvidence = factRow(input.notesEvidence, ['reviewed', 'evidence']);
  const schedule = factRow(input.schedule, ['reviewed', 'date', 'time', 'evidence']);
  const site = factRow(input.site, ['reviewed', 'value', 'evidence']);
  const scheduled = assignment(source.assignment);
  // Missing scheduling or notes must not erase a separately verified source
  // status/deletion or exact assignment. Unknown/ambiguous facts stay omitted.
  if (text(source.typeId, 128)) pending.source.typeId = source.typeId;
  if (text(source.statusId, 128)) pending.source.statusId = source.statusId;
  if (source.customStatusId === null || text(source.customStatusId, 128)) pending.source.customStatusId = source.customStatusId;
  if (typeof source.deleted === 'boolean') pending.source.deleted = source.deleted;
  if (scheduled) pending.source.assignment = scheduled;
  const notesVerified = notesEvidence?.reviewed === true && text(notesEvidence.evidence, 1000);
  const descriptionVerified = description?.reviewed === true && text(description.evidence, 1000) && body(description.value, 10000);
  // Empty description here is a storage placeholder, never a vendor-summary fact.
  const instructionText = description ? description.value : '';
  const instructionEvidence = description ? description.evidence : notesEvidence?.evidence;
  const departments: Array<AssignmentFact & {department: LegacyDepartment}> = [];
  let departmentFactsValid = input.departmentAssignments === undefined || Array.isArray(input.departmentAssignments);
  if (Array.isArray(input.departmentAssignments)) {
    if (input.departmentAssignments.length > 2) throw new IntakeFault('SOURCE_INVALID');
    for (const item of input.departmentAssignments) {
      const d = row(item); exact(d, ['department', 'state', 'identities', 'evidence']);
      const fact = assignment({state:d.state, identities:d.identities, evidence:d.evidence});
      if (!fact || !['it', 'service'].some(role => role === d.department) || departments.some(old => old.department === d.department)) departmentFactsValid = false;
      else departments.push({...fact, department:d.department as LegacyDepartment});
    }
  }
  if (!text(source.typeId, 128) || !text(source.statusId, 128) ||
      !(source.customStatusId === null || text(source.customStatusId, 128)) || source.deleted !== false ||
      !scheduled || scheduled.state !== 'assigned' || !departmentFactsValid ||
      !route || route.portalId !== source.portalId || route.typeId !== source.typeId || route.reviewed !== true ||
      !text(route.evidence, 1000) || !['service', 'delivery', 'swap', 'pickup'].some(kind => kind === route.workType) ||
      (description ? !descriptionVerified : !notesVerified) ||
      (notesEvidence !== null && !notesVerified) ||
      !body(instructionText, 10000) || !text(instructionEvidence, 1000) ||
      !body(input.notes, 10000) || (!instructionText.trim() && !input.notes.trim()) ||
      !schedule || schedule.reviewed !== true || !text(schedule.evidence, 1000) || !date(schedule.date) ||
      !(schedule.time === null || typeof schedule.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(schedule.time)) ||
      site && (site.reviewed !== true || !text(site.evidence, 1000) || !text(site.value, 500)) ||
      input.unitSummary !== undefined && !body(input.unitSummary, 2000)) return pending;

  const kind = route.workType as LegacyWorkType;
  const roles: LegacyDepartment[] = kind === 'service' ? ['service'] : kind === 'pickup' ? ['service', 'it'] : ['it', 'service'];
  // Known department contradictions cannot be hidden by unresolved targets.
  // A person's actual department remains private SQL's decision, not native's.
  if (departments.some(d => d.state === 'assigned' && !roles.includes(d.department)) ||
      departments.some((d, i) => d.state === 'assigned' && departments.some((other, j) => i !== j && other.identities[0] === d.identities[0])) ||
      roles.every(role => departments.some(d => d.department === role && !d.identities.includes(scheduled.identities[0])))) return pending;
  const quantities = Object.fromEntries(LEGACY_PART_FIELDS.map(field => [field, 0])) as Record<typeof LEGACY_PART_FIELDS[number], number>;
  const request: LegacyBundleRequest = {
    ticket_no: pending.source.ticketNumber, site: site ? site.value as string : null, work_type: kind,
    targets: roles.map(role => ({role, assignee_user_id:null, requires_it_handoff:role === 'service' && roles[0] === 'it'})),
    requested_unit_count: null, unit_summary: (input.unitSummary as string | undefined) ?? '',
    job_description: instructionText, notes: input.notes, equipment_manifest: [],
    scheduled_for: schedule.date, scheduled_time: schedule.time as string | null,
    ...quantities,
  };
  return {
    ...pending,
    source: {...pending.source, typeId:source.typeId, statusId:source.statusId, customStatusId:source.customStatusId as string | null,
      deleted:false, assignment:scheduled},
    departmentAssignments:departments,
    localWorkflowPolicy:{policy:TECHNICIAN_EQUIPMENT_SELECTION_POLICY},
    sourceEvidence:{...(site ? {site:site.evidence as string} : {}), description:instructionEvidence, schedule:schedule.evidence, complete:false},
    request,
  };
}
