import { chicagoDay } from './dailyBoardData';
export type OperationsRecord = Record<string, any>;
export type JobsMode = 'jobs' | 'unscheduled' | 'dispatch' | 'review';
export const statusKey = (value: unknown) => String(value || '').trim().toLowerCase().replaceAll('_', ' ');
export function recordItems(payload: unknown): OperationsRecord[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Operations returned an incomplete response.');
  const items = (payload as OperationsRecord).items;
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Operations returned an incomplete record list.');
  return items;
}
export function jobItems(payload: unknown): OperationsRecord[] {
  const items = recordItems(payload);
  const ids = new Set<string>();
  for (const item of items) {
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('Operations returned inconsistent COS Job records.');
    ids.add(item.id);
  }
  return items;
}
export function visibleJobs(rows: OperationsRecord[], mode: JobsMode): OperationsRecord[] {
  return mode === 'unscheduled' ? rows.filter(row => statusKey(row.status) === 'unscheduled') :
    mode === 'dispatch' ? rows.filter(row => ['scheduled', 'assigned', 'dispatched'].includes(statusKey(row.status))) :
    mode === 'review' ? rows.filter(row => statusKey(row.status) === 'owner review') : rows;
}
export function jobDepartment(job: OperationsRecord): string {
  const department = statusKey(job.department);
  if (department === 'it' || department === 'service') return department;
  const stage = statusKey(job.stage);
  if (stage.startsWith('it')) return 'it';
  if (stage.startsWith('service')) return 'service';
  const type = String(job.jobType || '').toUpperCase();
  return ['DELIVERY', 'SWAP'].includes(type) || type === 'SERVICE' && job.shopPrep === true ? 'it' : 'service';
}
export function assignmentTechnicians(team: OperationsRecord[], department: string) {
  return team.filter(person => person.active === true && statusKey(person.department) === department &&
    typeof (person.displayName || person.name) === 'string' && String(person.displayName || person.name).trim())
    .map(person => ({ ...person, name: String(person.displayName || person.name).trim() }))
    .sort((a,b) => a.name.localeCompare(b.name));
}
export function canDispatch(job: OperationsRecord): boolean {
  return ['scheduled', 'assigned'].includes(statusKey(job.status)) && typeof job.equipmentUnitTag === 'string' && Boolean(job.equipmentUnitTag.trim());
}
export function safeEvidenceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export function technicianLocationUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const location = value as OperationsRecord;
  const latitude = Number(location.latitude), longitude = Number(location.longitude);
  if (location.latitude == null || location.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + latitude + ',' + longitude;
}
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function dayDate(day: string): Date {
  if (!dayPattern.test(day)) throw new Error('Choose a valid calendar day.');
  const date = new Date(day + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('Choose a valid calendar day.');
  return date;
}
const dateDay = (date: Date) => date.toISOString().slice(0, 10);
export function scheduledDay(value: unknown): string {
  if (typeof value !== 'string' || !value || value === 'Not scheduled') return '';
  try { const day = chicagoDay(value); dayDate(day); return day; } catch { return ''; }
}
export function calendarDays(cursor: string, view: 'Month' | 'Week'): string[] {
  const date = dayDate(cursor);
  if (view === 'Month') date.setUTCDate(1);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return Array.from({ length: view === 'Week' ? 7 : 42 }, (_, offset) => {
    const next = new Date(date); next.setUTCDate(next.getUTCDate() + offset); return dateDay(next);
  });
}
export function moveCalendar(cursor: string, view: 'Month' | 'Week' | 'Year', direction: number): string {
  const date = dayDate(cursor);
  if (view === 'Week') { date.setUTCDate(date.getUTCDate() + direction * 7); return dateDay(date); }
  const day = date.getUTCDate();
  date.setUTCDate(1);
  if (view === 'Year') date.setUTCFullYear(date.getUTCFullYear() + direction);
  else date.setUTCMonth(date.getUTCMonth() + direction);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return dateDay(date);
}
type JobApi = { get(path: string): Promise<{ data: unknown }>; post(path: string, body?: unknown): Promise<unknown> };
export type JobSaveResult = { status: 'busy' } | { status: 'confirmed'; rows: OperationsRecord[] } |
  { status: 'unconfirmed' | 'accepted_unverified'; message: string };
/** Send a write once, then require an independent native jobs snapshot before reporting success. */
export function createJobActionSaver(api: JobApi) {
  let running = false;
  return {
    get busy() { return running; },
    async save(path: string, body: unknown, confirmed: (rows: OperationsRecord[]) => boolean): Promise<JobSaveResult> {
      if (running) return { status: 'busy' };
      running = true;
      try {
        try { await api.post(path, body); }
        catch (cause) {
          const failure = cause as { response?: { data?: { error?: unknown } } };
          const detail = failure?.response?.data?.error;
          return { status: 'unconfirmed', message: typeof detail === 'string' ? detail : 'The save could not be confirmed. Refresh this workspace before trying again.' };
        }
        try {
          const rows = jobItems((await api.get('/api/jobs')).data);
          if (confirmed(rows)) return { status: 'confirmed', rows };
        } catch { /* An accepted write is never automatically replayed. */ }
        return { status: 'accepted_unverified', message: 'Save accepted, but the requested job change could not be verified. Refresh this workspace before trying again.' };
      } finally { running = false; }
    },
  };
}
export function matchingJob(rows: OperationsRecord[], id: string) {
  const matches = rows.filter(row => row.id === id && row.completionKind !== 'visit');
  return matches.length === 1 ? matches[0] : null;
}
export function confirmedSchedule(rows: OperationsRecord[], expected: { id: string; visitId?: string; technician: string; start: string; end: string }) {
  const job = matchingJob(rows, expected.id);
  const local = (value: unknown) => typeof value === 'string' ? value.trim().replace('T', ' ') : '';
  return Boolean(job && ['scheduled', 'assigned', 'dispatched', 'accepted', 'en route', 'on site', 'in progress', 'working'].includes(statusKey(job.status)) &&
    String(job.technician || '').trim() === expected.technician.trim() &&
    (!expected.visitId || job.visitId === expected.visitId) && local(job.scheduled) === expected.start && local(job.scheduledEnd) === expected.end);
}
export function confirmedDispatch(rows: OperationsRecord[], id: string, technician: string, visitId?: string) {
  const job = matchingJob(rows, id);
  return Boolean(job && ['dispatched', 'accepted', 'en route', 'on site', 'in progress', 'working'].includes(statusKey(job.status)) && String(job.technician || '').trim() === technician.trim() && (!visitId || job.visitId === visitId));
}
export function confirmedReview(rows: OperationsRecord[], id: string, action: 'approve' | 'return') {
  const job = matchingJob(rows, id);
  return Boolean(job && (action === 'approve' ?
    job.billingReady === true && statusKey(job.stage) === 'billing' :
    statusKey(job.status) === 'unscheduled' && job.billingReady !== true));
}
