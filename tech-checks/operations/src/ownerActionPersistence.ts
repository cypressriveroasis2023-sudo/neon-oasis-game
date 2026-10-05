import { jobItems, statusKey } from './operationsWorkflowData';

type Row = Record<string, any>;
export type OwnerSnapshot = { jobs: Row[]; control: Row };
export type OwnerAction =
  | { kind: 'create'; body: Row; previousIds: string[] }
  | { kind: 'assign' | 'close' | 'remove' | 'advance'; job: Row; body: Row }
  | { kind: 'truck'; check: Row; body: Row };
export function checkedOwnerSnapshot(jobs: unknown, control: unknown): OwnerSnapshot {
  const rows = jobItems(jobs);
  if (!control || typeof control !== 'object' || Array.isArray(control)) throw new Error('Owner controls received an incomplete response.');
  const value = control as Row;
  for (const key of ['sites', 'truckChecks', 'serviceTechnicians', 'itTechnicians']) {
    if (!Array.isArray(value[key])) throw new Error('Owner controls received an incomplete response.');
  }
  const ids = new Set<string>();
  for (const check of value.truckChecks) {
    if (!check || typeof check !== 'object' || typeof check.id !== 'string' || !check.id || ids.has(check.id)) throw new Error('Owner controls received inconsistent truck checks.');
    ids.add(check.id);
  }
  return { jobs: rows, control: value };
}
export function ownerActionRequest(action: OwnerAction) {
  if (action.kind === 'create') return { path: '/api/owner/jobs/manual', body: action.body };
  if (action.kind === 'truck') return { path: '/api/owner/truck-checks/' + action.check.id + '/approve', body: action.body };
  if (action.kind === 'advance') return { path: '/api/owner/jobs/' + action.job.id + '/advance-it', body: action.body };
  return { path: '/api/jobs/' + action.job.id + '/' + action.kind, body: action.body };
}
const equalText = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim();
/** Confirm authoritative identifiers and resulting state, never just a 2xx response. */
export function hasConfirmedOwnerAction(snapshot: OwnerSnapshot, action: OwnerAction, response: Row): boolean {
  if (action.kind === 'truck') {
    const checks = snapshot.control.truckChecks.filter((check: Row) => check.id === action.check.id);
    return checks.length === 1 && checks[0].ownerApproved === true && statusKey(checks[0].status) === 'completed';
  }
  const id = action.kind === 'create' ? response?.job_id : action.job.id;
  if (typeof id !== 'string' || !id) return false;
  const matches = snapshot.jobs.filter(job => job.id === id);
  if (action.kind === 'remove') return response?.job_id === id && response?.deleted === true && matches.length === 0;
  if (matches.length !== 1) return false;
  const job = matches[0];
  if (action.kind === 'create') return !action.previousIds.includes(id) &&
    equalText(job.jobNumber, response?.job_number) && equalText(job.jobType, action.body.jobType) &&
    typeof job.visitId === 'string' && Boolean(job.visitId) && !['closed', 'cancelled', 'deleted'].includes(statusKey(job.status));
  if (action.kind === 'close') return statusKey(job.status) === 'closed' && !job.visitId;
  if (action.kind === 'assign') return job.visitId === action.job.visitId && Boolean(job.visitId) &&
    equalText(job.technician, action.body.technician) && !['closed', 'cancelled', 'deleted'].includes(statusKey(job.status));
  return response?.next_department === 'service' && typeof response?.next_visit_id === 'string' &&
    job.visitId === response.next_visit_id && job.visitId !== action.job.visitId && statusKey(job.department) === 'service' &&
    equalText(job.technician, action.body.serviceTechnician) && equalText(job.equipmentUnitTag, action.body.unitNumber) &&
    equalText(job.scheduled, action.body.start) && equalText(job.scheduledEnd, action.body.end) &&
    ['scheduled', 'assigned', 'dispatched'].includes(statusKey(job.status));
}
export function truckApprovalDetails(check: Row) {
  const result = check.result && typeof check.result === 'object' ? check.result : {};
  const missing = check.ownerOverrideMissingFields ?? check.missingFields ?? result.owner_override_missing_fields ?? result.missing_fields;
  return { override: check.ownerOverride === true || result.owner_override === true,
    missing: Array.isArray(missing) ? missing.filter((value: unknown) => typeof value === 'string') : [] };
}
export type OwnerSaveResult = { status: 'busy' | 'refresh_required' } |
  { status: 'unconfirmed' | 'accepted_unverified'; message: string } |
  { status: 'confirmed'; snapshot: OwnerSnapshot; response: Row };
/** One write, a new snapshot, and a persistent uncertainty lock until explicit refresh. */
export function createOwnerActionSaver(api: { post(path: string, body: unknown): Promise<{ data: Row }> }, readFresh: () => Promise<OwnerSnapshot>) {
  let running = false, refreshRequired = false;
  return {
    get busy() { return running; },
    get needsRefresh() { return refreshRequired; },
    acknowledgeRefresh(snapshot: OwnerSnapshot) { checkedOwnerSnapshot({ items: snapshot.jobs }, snapshot.control); if (!running) refreshRequired = false; },
    async save(action: OwnerAction): Promise<OwnerSaveResult> {
      if (running) return { status: 'busy' };
      if (refreshRequired) return { status: 'refresh_required' };
      running = true;
      try {
        let response: Row;
        try { const request = ownerActionRequest(action); response = (await api.post(request.path, request.body)).data; }
        catch (cause) {
          refreshRequired = true;
          const message = cause instanceof Error ? cause.message + ' ' : '';
          return { status: 'unconfirmed', message: message + 'The action could not be confirmed. Refresh Owner Controls before trying again.' };
        }
        try {
          const snapshot = await readFresh();
          if (hasConfirmedOwnerAction(snapshot, action, response)) return { status: 'confirmed', snapshot, response };
        } catch { /* Never repeat an accepted or uncertain write. */ }
        refreshRequired = true;
        return { status: 'accepted_unverified', message: 'Action accepted, but the saved result could not be verified. Refresh Owner Controls before trying again.' };
      } finally { running = false; }
    },
  };
}
