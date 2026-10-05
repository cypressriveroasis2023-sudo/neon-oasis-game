import type { BoardRecord, ReadinessRow } from './dailyBoardData';

export type BoardSnapshot = {
  jobs: BoardRecord[];
  tasks: BoardRecord[];
  readiness: ReadinessRow[];
  asOf?: string;
};
type BoardApi = { get: (path: string) => Promise<{ data: unknown }> };
export type AssignmentExpectation = {
  jobId: string;
  technician: string;
  visitId?: string;
  start?: string;
  end?: string;
};

function checkedBoard(value: unknown): BoardSnapshot {
  const snapshot = value as BoardSnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.jobs) || !Array.isArray(snapshot.tasks) ||
      !Array.isArray(snapshot.readiness) || typeof snapshot.asOf !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.asOf))) {
    throw new Error('The daily board received an incomplete response.');
  }
  return snapshot;
}

/** Coalesce background reads; queue a NEW read after pending work when verifying a write. */
export function createBoardReader(api: BoardApi) {
  let pending: Promise<BoardSnapshot> | null = null;
  return (fresh = false): Promise<BoardSnapshot> => {
    if (pending && !fresh) return pending;
    const previous = pending;
    const request = Promise.resolve(previous).catch(() => undefined).then(async () => {
      const { data } = await api.get('/api/daily-board');
      return checkedBoard(data);
    });
    pending = request;
    const clear = () => { if (pending === request) pending = null; };
    void request.then(clear, clear);
    return request;
  };
}

/** Read-back confirmation only. Backend authorization remains authoritative. */
export function hasConfirmedAssignment(snapshot: BoardSnapshot | null, expected: AssignmentExpectation): boolean {
  if (!snapshot) return false;
  const matches = snapshot.jobs.filter(job =>
    job && typeof job === 'object' && job.id === expected.jobId && job.completionKind !== 'visit');
  if (matches.length !== 1) return false;
  const job = matches[0];
  const status = String(job.status || '').trim().toLowerCase().replaceAll('_', ' ');
  const activeStatuses = ['assigned', 'scheduled', 'dispatched', 'in progress', 'accepted', 'en route', 'on site', 'working'];
  if (!expected.start && !expected.end) activeStatuses.push('unscheduled');
  if (!activeStatuses.includes(status)) return false;
  if (String(job.technician || '').trim() !== expected.technician.trim()) return false;
  if (expected.visitId && job.visitId !== expected.visitId) return false;
  const normalize = (value: unknown) => typeof value === 'string' ? value.trim().replace('T', ' ') : '';
  if (expected.start && normalize(job.scheduled) !== normalize(expected.start)) return false;
  if (expected.end && normalize(job.scheduledEnd) !== normalize(expected.end)) return false;
  return true;
}

export type AssignmentSaveResult =
  | { status: 'busy' }
  | { status: 'refresh_required' }
  | { status: 'unconfirmed' | 'accepted_unverified'; message: string }
  | { status: 'confirmed'; snapshot: BoardSnapshot };

/** One write at a time; never automatically replay a write after a connection failure. */
export function createBoardAssignmentSaver(
  api: { post: (path: string, body: unknown) => Promise<unknown> },
  readFresh: () => Promise<BoardSnapshot | null>,
) {
  let inFlight = false, refreshRequired = false;
  return {
    get busy() { return inFlight; },
    get needsRefresh() { return refreshRequired; },
    acknowledgeRefresh(value: unknown) { checkedBoard(value); if (!inFlight) refreshRequired = false; },
    async save(path: string, body: unknown, expected: AssignmentExpectation): Promise<AssignmentSaveResult> {
      if (inFlight) return { status: 'busy' };
      if (refreshRequired) return { status: 'refresh_required' };
      inFlight = true;
      try {
        try { await api.post(path, body); }
        catch (cause) {
          refreshRequired = true;
          const failure = cause as { response?: { data?: { error?: unknown } } };
          const detail = failure?.response?.data?.error;
          return { status: 'unconfirmed', message: typeof detail === 'string' ? detail :
            'The save could not be confirmed. Refresh the board before trying again.' };
        }
        let snapshot: BoardSnapshot | null = null;
        try { snapshot = await readFresh(); } catch { /* Report accepted-but-unverified, not a failed write. */ }
        if (!snapshot || !hasConfirmedAssignment(snapshot, expected)) {
          refreshRequired = true;
          return { status: 'accepted_unverified', message:
            'Save accepted, but the requested assignment could not be confirmed. Refresh the board before trying again.' };
        }
        return { status: 'confirmed', snapshot };
      } finally { inFlight = false; }
    },
  };
}
