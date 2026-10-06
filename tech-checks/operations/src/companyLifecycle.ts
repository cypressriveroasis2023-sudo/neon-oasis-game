import type { DashboardRow } from './todayDashboardData';
import { ownerJobSelection } from './ownerJobSelection';

/** Display lanes only. Workflow permissions, completion and readiness remain server-owned. */
export const COMPANY_STAGES = [
  { id: 'quote', label: 'Quote', team: 'Sales' },
  { id: 'agreement', label: 'Agreement', team: 'Sales' },
  { id: 'signed', label: 'Signed', team: 'Sales' },
  { id: 'schedule', label: 'Schedule & Parts', team: 'Operations' },
  { id: 'it-prep', label: 'IT Prep', team: 'IT' },
  { id: 'service-install', label: 'Service Install', team: 'Service' },
  { id: 'closeout', label: 'Closeout', team: 'Owner' },
  { id: 'billing', label: 'Billing', team: 'Finance' },
] as const;
export type CompanyStageId = typeof COMPANY_STAGES[number]['id'];
export type LifecycleFact = { id: string; title: string; detail: string };
export type LifecycleStage = {
  id: CompanyStageId; label: string; team: string;
  state: 'current' | 'complete' | 'unavailable'; detail: string;
};
export type JobLifecycleModel = {
  currentStageId: CompanyStageId | null;
  currentStageLabel: string;
  responsibleTeam: string | null;
  backendStage: string;
  backendStatus: string;
  stages: LifecycleStage[];
  completed: LifecycleFact[];
  missing: LifecycleFact[];
  unavailable: LifecycleFact[];
  nextStep: string;
};
export const lifecycleText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const key = (value: unknown) => lifecycleText(value).toLowerCase().replaceAll('_', ' ');
const terminal = new Set(['closed', 'cancelled', 'canceled', 'deleted']);
const serviceVisits = new Set(['service', 'delivery', 'swap', 'pickup']);
const serviceStages = new Set(['service', 'service delivery', 'service swap', 'service pickup']);
const knownOperationalStatuses = new Set(['unscheduled', 'scheduled', 'assigned', 'dispatched', 'accepted', 'en route', 'on site', 'in progress', 'working']);
const records = (input: unknown): DashboardRow[] => Array.isArray(input) ? input.filter(value => value && typeof value === 'object' && !Array.isArray(value)) : [];
const dated = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));

/** Map only documented owner-jobs snapshot fields; never guess a phase from job type. */
export function jobStageId(job: DashboardRow): CompanyStageId | null {
  const status = key(job.status), stage = key(job.stage), visit = key(job.visitType);
  if (!status || terminal.has(status)) return null;
  if (status === 'owner review' || status === 'field complete') return 'closeout';
  if (status === 'billing ready' || status === 'ready to bill') return 'billing';
  if (['unscheduled', 'scheduled', 'assigned'].includes(status)) return 'schedule';
  // An unknown status is not a license to infer where a job belongs.
  if (!knownOperationalStatuses.has(status)) return null;
  if (stage === 'billing') return 'billing';
  if (stage === 'owner review') return 'closeout';
  if (['it prep', 'it intake'].includes(stage) || ['it prep', 'it intake'].includes(visit)) return 'it-prep';
  if (serviceStages.has(stage) || serviceVisits.has(visit)) return 'service-install';
  return null;
}

export function deriveJobLifecycle(job: DashboardRow): JobLifecycleModel {
  const currentStageId = jobStageId(job);
  const current = COMPANY_STAGES.find(stage => stage.id === currentStageId);
  const backendStage = lifecycleText(job.stage) || 'Unavailable';
  const backendStatus = lifecycleText(job.status) || 'Unavailable';
  const completed: LifecycleFact[] = [], missing: LifecycleFact[] = [];
  const unavailable: LifecycleFact[] = [
    { id: 'agreement', title: 'Agreement and signature status unavailable', detail: 'The job snapshot does not provide an agreement or its signing status. Field signatures do not verify a signed agreement.' },
    { id: 'parts', title: 'Parts list not connected', detail: 'This response does not include the job’s parts list or its readiness. Check Purchasing for the current records.' },
    { id: 'source', title: 'Source request unavailable', detail: 'The job snapshot does not identify an originating work request or MHelpDesk ticket.' },
  ];
  const scheduled = lifecycleText(job.scheduled);
  if (dated(scheduled)) completed.push({ id: 'schedule', title: 'Visit scheduled', detail: scheduled + (dated(job.scheduledEnd) ? ' – ' + lifecycleText(job.scheduledEnd) : '') });
  else if (key(job.status) === 'unscheduled' || lifecycleText(job.visitId) && key(scheduled) === 'not scheduled') missing.push({ id: 'schedule', title: 'Schedule the current visit', detail: 'No scheduled start is recorded for the current visit.' });
  else unavailable.push({ id: 'schedule', title: 'Visit schedule unavailable', detail: 'No current visit date is supplied by this response.' });
  const technician = lifecycleText(job.technician);
  if (technician && !['unassigned', 'completed field workflow'].includes(key(technician))) completed.push({ id: 'technician', title: 'Technician assigned', detail: technician });
  else if (key(technician) === 'unassigned' && lifecycleText(job.visitId)) missing.push({ id: 'technician', title: 'Assign a technician', detail: 'The current visit is recorded as Unassigned.' });
  const unit = lifecycleText(job.equipmentUnitTag);
  if (unit) completed.push({ id: 'unit', title: 'Physical unit linked', detail: [lifecycleText(job.equipment), unit].filter(Boolean).join(' · ') });
  else if (Object.hasOwn(job, 'equipmentUnitTag')) missing.push({ id: 'unit', title: 'Physical unit not identified', detail: 'No physical unit tag is included on this job. The established workflow determines when identification is required.' });
  else unavailable.push({ id: 'unit', title: 'Unit identity unavailable', detail: 'A physical unit tag was not supplied in this response.' });
  const quote = lifecycleText(job.quoteNumber);
  if (quote) completed.push({ id: 'quote', title: 'Quote record linked', detail: quote + ' · acceptance not supplied' });
  else unavailable.push({ id: 'quote', title: 'Quote link unavailable', detail: 'No quote number is supplied. This does not establish whether a quote exists or was accepted.' });
  if (job.needsAttention === true) missing.push({ id: 'attention', title: 'Open attention items', detail: 'The backend flags this job for attention. Open its existing actions to investigate.' });
  if (job.damageReported === true) missing.push({ id: 'damage', title: 'Reported damage needs review', detail: 'An open damage item is recorded. Review it in the existing workflow.' });
  if (job.billingReady === true) completed.push({ id: 'billing-ready', title: 'Billing readiness recorded', detail: 'The backend reports this job as billing ready. This does not confirm invoicing or payment.' });
  if (lifecycleText(job.invoiceNumber)) completed.push({ id: 'invoice', title: 'Invoice record linked', detail: lifecycleText(job.invoiceNumber) + ' · payment status not supplied' });
  // The jobs endpoint currently returns placeholder empty history/photos. Empty
  // arrays therefore cannot prove no evidence exists or that work is incomplete.
  for (const [index, check] of records(job.techCheckHistory).entries()) {
    if (dated(check.completedAt)) completed.push({ id: 'check-' + index, title: 'Completed Tech Check recorded', detail: [lifecycleText(check.stage), lifecycleText(check.technician), lifecycleText(check.completedAt)].filter(Boolean).join(' · ') });
  }
  const nextSteps: Partial<Record<CompanyStageId, string>> = {
    schedule: 'Review the current visit’s schedule, assignment and required items in the existing job workflow.',
    'it-prep': 'Continue the current IT visit in the established Tech Check workflow.',
    'service-install': 'Continue the current Service visit in the established Tech Check workflow.',
    closeout: 'Review saved field evidence and open attention items before an Owner decision.',
    billing: 'Review the linked invoice and billing records in Finance.',
  };
  return {
    currentStageId, currentStageLabel: current?.label || 'Stage unavailable',
    responsibleTeam: current?.team || null, backendStage, backendStatus,
    stages: COMPANY_STAGES.map(stage => ({ ...stage, state: stage.id === currentStageId ? 'current' : 'unavailable', detail: stage.id === currentStageId ? 'Current view · ' + backendStatus : ['quote', 'agreement', 'signed'].includes(stage.id) ? 'Status not connected' : 'Completion not verified' })),
    completed, missing, unavailable,
    nextStep: nextSteps[currentStageId!] || 'Open the authoritative job to verify its current workflow and responsible team.',
  };
}

/** Null means coverage unavailable, never zero. Count unique active job IDs only. */
export function companyStageCounts(jobs: DashboardRow[] | null): Record<CompanyStageId, number | null> & { unknown: number | null } {
  const counts = Object.fromEntries(COMPANY_STAGES.map(stage => [stage.id, jobs === null || ['quote', 'agreement', 'signed'].includes(stage.id) ? null : 0])) as Record<CompanyStageId, number | null> & { unknown: number | null };
  counts.unknown = jobs === null ? null : 0;
  if (jobs === null) return counts;
  for (const job of ownerJobSelection(jobs, '').options) {
    const stage = jobStageId(job);
    if (stage && counts[stage] !== null) counts[stage]! += 1;
    else counts.unknown! += 1;
  }
  return counts;
}
