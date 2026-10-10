/** Local proposal only. No transport, credential handling, or activation lives here. */
import {
  LEGACY_TECH_CHECK_PROJECT, planMhelpLegacyRoute,
  type LegacyRouteInput, type DeferredLegacyRouteInput, type LegacyBundleRequest, type AssignmentFact, type LocalWorkflowPolicy,
} from '../shared/mhelpLegacyRoutePlan.ts';

export const MHELP_LEGACY_INTAKE_CONTRACT = 'cos-mhelp-legacy-intake-v1';
export const REVIEWED_LOCAL_LEAD_POLICY = 'reviewed_local_unassigned_v1';
/** A selection intent only. The UUID and review evidence stay in private legacy SQL. */
export type TicketLeadSelection = {sourceIdentity: string; evidence: string; policy?: never}
  | {policy: typeof REVIEWED_LOCAL_LEAD_POLICY; sourceIdentity?: never; evidence?: never};
export type LegacyIntakePayload = {
  contract: typeof MHELP_LEGACY_INTAKE_CONTRACT;
  schemaContract: string;
  source: LegacyRouteInput['source'] & {createdAt: string};
  departmentAssignments: Array<AssignmentFact & {department: 'it' | 'service'}>;
  ticketLead?: TicketLeadSelection;
  localWorkflowPolicy?: LocalWorkflowPolicy;
  sourceEvidence: {equipment: string; parts: string; site: string; description: string; schedule: string; complete: true}
    | {site?: string; description: string; schedule: string; complete: false};
  request: LegacyBundleRequest;
};
export type LegacyIntakePreparation = {
  state: 'ready' | 'review_needed';
  reasonCodes: string[];
  executionEnabled: false;
  payload: LegacyIntakePayload | null;
};
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && v.trim() === v && !/[\x00-\x1f\x7f]/.test(v);
const evidence = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000 && !/[\x00-\x1f\x7f]/.test(v);

/**
 * The existing planner checks reviewed source completeness. This adapter adds the
 * immutable creation instant, verified source-schema contract, and deliberate IT
 * lead selection needed by my_managed_tickets_v1. The separate explicit deferred
 * equipment policy permits a scheduled shell without a lead or selected equipment;
 * complete:false preserves that distinction. It does not authorize SQL execution.
 * A local-policy marker means
 * the envelope is prepared, not that a policy/person is configured or approved.
 * Its only authority is the private persisted policy at the SQL write boundary.
 * The database repeats all write-boundary
 * checks using persisted reviewed mappings and current profiles. A caller cannot
 * establish production authority by casting data or setting `reviewed: true`.
 */
export function prepareMhelpLegacyIntake(input: LegacyRouteInput | DeferredLegacyRouteInput, options: {
  createdAt: string;
  schemaContract: string;
  ticketLead?: TicketLeadSelection;
}): LegacyIntakePreparation {
  const plan = planMhelpLegacyRoute(input), reasonCodes = [...plan.reasonCodes];
  const deferred = Boolean(plan.localWorkflowPolicy);
  const add = (reason: string) => { if (!reasonCodes.includes(reason)) reasonCodes.push(reason); };
  // Canonical UTC only: do not guess an absent offset or silently fix invalid dates.
  if (typeof options?.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.createdAt) ||
      !Number.isFinite(Date.parse(options.createdAt)) || new Date(options.createdAt).toISOString().replace('.000Z','Z') !== options.createdAt.replace('.000Z','Z')) add('source_creation_time_invalid');
  if (!id(options?.schemaContract)) add('source_schema_unverified');
  const lead = options?.ticketLead;
  if (lead && Object.hasOwn(lead,'policy')) {
    if (lead.policy !== REVIEWED_LOCAL_LEAD_POLICY || Object.keys(lead).some(key=>key!=='policy')) add('ticket_lead_unverified');
    if (input?.source?.assignment?.state !== 'unassigned' || !Array.isArray(input.source.assignment.identities) || input.source.assignment.identities.length !== 0 ||
        (Array.isArray(input.departmentAssignments) && input.departmentAssignments.some(row=>row?.state!=='unassigned'||!Array.isArray(row?.identities)||row.identities.length!==0))) add('ticket_lead_policy_conflict');
  }
  else if (!lead && deferred && options?.ticketLead === undefined) { /* A shell need not fabricate Ticket Lead ownership. */ }
  else if (!id(lead?.sourceIdentity) || !evidence(lead?.evidence)) add('ticket_lead_unverified');
  else {
    const matches = Array.isArray(input?.identityCrosswalk) ? input.identityCrosswalk.filter(row => row.portalId === input.source.portalId && row.sourceIdentity === lead.sourceIdentity) : [];
    if (matches.length !== 1 || matches[0].legacyProjectId !== LEGACY_TECH_CHECK_PROJECT || matches[0].department !== 'it' ||
        matches[0].active !== true || matches[0].archived !== false || matches[0].verified !== true || !evidence(matches[0].evidence) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matches[0].legacyUserId)) add('ticket_lead_unverified');
  }
  if (reasonCodes.length || !plan.request) return {state:'review_needed',reasonCodes,executionEnabled:false,payload:null};
  return {
    state:'ready',reasonCodes:[],executionEnabled:false,
    payload: structuredClone({
      contract:MHELP_LEGACY_INTAKE_CONTRACT, schemaContract:options.schemaContract,
      source:{...(plan.originalSource as LegacyRouteInput['source']),createdAt:options.createdAt},
      departmentAssignments:(input.departmentAssignments || []).map(row=>({department:row.department,state:row.state,identities:[...row.identities],evidence:row.evidence})),
      ...(lead ? {ticketLead:lead.policy===REVIEWED_LOCAL_LEAD_POLICY ? {policy:REVIEWED_LOCAL_LEAD_POLICY} : {sourceIdentity:lead.sourceIdentity,evidence:lead.evidence}} : {}),
      ...(deferred ? {localWorkflowPolicy:plan.localWorkflowPolicy} : {}),
      sourceEvidence:deferred
        ? {...(input.site ? {site:input.site.evidence} : {}),description:input.description.evidence,schedule:input.schedule.evidence,complete:false as const}
        : {equipment:input.equipment!.evidence,parts:input.parts!.evidence,site:input.site!.evidence,description:input.description.evidence,schedule:input.schedule.evidence,complete:true as const},
      request:plan.request.p_request,
    }),
  };
}
