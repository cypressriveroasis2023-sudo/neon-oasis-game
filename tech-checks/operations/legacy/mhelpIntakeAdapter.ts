/** Local proposal only. No transport, credential handling, or activation lives here. */
import {
  LEGACY_TECH_CHECK_PROJECT, planMhelpLegacyRoute,
  type LegacyRouteInput, type LegacyBundleRequest, type AssignmentFact,
} from '../shared/mhelpLegacyRoutePlan.ts';

export const MHELP_LEGACY_INTAKE_CONTRACT = 'cos-mhelp-legacy-intake-v1';
export type LegacyIntakePayload = {
  contract: typeof MHELP_LEGACY_INTAKE_CONTRACT;
  schemaContract: string;
  source: LegacyRouteInput['source'] & {createdAt: string};
  departmentAssignments: Array<AssignmentFact & {department: 'it' | 'service'}>;
  ticketLead: {sourceIdentity: string; evidence: string};
  sourceEvidence: {equipment: string; parts: string; site: string; description: string; schedule: string; complete: true};
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
 * lead needed by my_managed_tickets_v1. The database repeats all write-boundary
 * checks using persisted reviewed mappings and current profiles. A caller cannot
 * establish production authority by casting data or setting `reviewed: true`.
 */
export function prepareMhelpLegacyIntake(input: LegacyRouteInput, options: {
  createdAt: string;
  schemaContract: string;
  ticketLead: {sourceIdentity: string; evidence: string};
}): LegacyIntakePreparation {
  const plan = planMhelpLegacyRoute(input), reasonCodes = [...plan.reasonCodes];
  const add = (reason: string) => { if (!reasonCodes.includes(reason)) reasonCodes.push(reason); };
  // Canonical UTC only: do not guess an absent offset or silently fix invalid dates.
  if (typeof options?.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.createdAt) ||
      !Number.isFinite(Date.parse(options.createdAt)) || new Date(options.createdAt).toISOString().replace('.000Z','Z') !== options.createdAt.replace('.000Z','Z')) add('source_creation_time_invalid');
  if (!id(options?.schemaContract)) add('source_schema_unverified');
  const lead = options?.ticketLead;
  if (!id(lead?.sourceIdentity) || !evidence(lead?.evidence)) add('ticket_lead_unverified');
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
      ticketLead:{sourceIdentity:lead.sourceIdentity,evidence:lead.evidence},
      sourceEvidence:{equipment:input.equipment.evidence,parts:input.parts.evidence,site:input.site.evidence,description:input.description.evidence,schedule:input.schedule.evidence,complete:true as const},
      request:plan.request.p_request,
    }),
  };
}
