import { validateCameraHealth } from './CameraHealthWorkspace';
import { readRouterSnapshot, type RouterSnapshot } from '../../supabase/functions/cos-operations-pages/routers';

export type DashboardRow = Record<string, unknown>;
export const dashboardSources = [
  ['jobs', '/api/jobs', 'Jobs'],
  ['quotes', '/api/quotes', 'Quotes'],
  ['invoices', '/api/ar', 'Invoices'],
  ['pos', '/api/purchasing', 'Purchasing'],
  ['tasks', '/api/owner-tasks', 'Owner Tasks'],
] as const;
export type SourceKey = typeof dashboardSources[number][0];
export type DashboardData = Record<SourceKey, DashboardRow[] | null> & { errors: Partial<Record<SourceKey, string>> };
export type DashboardApi = { get: (path: string) => Promise<{ data: unknown }> };

/** A failed source is null, never an invented empty list. Each source is independent. */
export async function loadTodayDashboard(api: DashboardApi): Promise<DashboardData> {
  const result: DashboardData = { jobs: null, quotes: null, invoices: null, pos: null, tasks: null, errors: {} };
  await Promise.all(dashboardSources.map(async ([key, path, label]) => {
    try {
      const response = await api.get(path);
      const payload = response?.data;
      const items = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>).items : undefined;
      if (!Array.isArray(items) || items.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Invalid response');
      result[key] = items;
    } catch (cause) {
      const status = cause && typeof cause === 'object' ? (cause as { response?: { status?: number } }).response?.status : undefined;
      result.errors[key] = status === 401 || status === 403
        ? label + ': sign-in or Owner access needs attention.'
        : label + ' could not be loaded. Retry to verify this section.';
    }
  }));
  return result;
}
const statusKey = (value: unknown) => String(value || '').trim().toLowerCase().replaceAll('_', ' ');
const statusIn = (row: DashboardRow, allowed: string[]) => allowed.includes(statusKey(row.status));
const activeStates = ['scheduled', 'assigned', 'dispatched', 'accepted', 'en route', 'on site', 'in progress', 'working'];
const fieldStates = ['dispatched', 'accepted', 'en route', 'on site', 'in progress', 'working'];
const terminalStates = ['closed', 'cancelled', 'canceled', 'deleted'];
export function summarizeTodayDashboard(data: DashboardData) {
  const jobs = data.jobs || [];
  const tasks = (data.tasks || []).filter(task => !statusIn(task, ['complete', 'completed', 'cancelled', 'canceled']));
  const ownerJobs = jobs.filter(job => statusIn(job, ['owner review']));
  const jobIssues = jobs.filter(job => job.needsAttention === true);
  const quoteApprovals = (data.quotes || []).filter(row => statusIn(row, ['pending owner approval']));
  const invoiceApprovals = (data.invoices || []).filter(row => statusIn(row, ['pending owner approval']));
  const poApprovals = (data.pos || []).filter(row => statusIn(row, ['pending owner po approval']));
  const apExceptions = (data.pos || []).filter(row => statusKey(row.match) === 'exception' || statusIn(row, ['needs review']));
  const attentionKnown = [data.jobs, data.quotes, data.invoices, data.pos].every(value => value !== null);
  const attentionCount = ownerJobs.length + jobIssues.length + quoteApprovals.length + invoiceApprovals.length + poApprovals.length + apExceptions.length;
  return {
    openTasks: data.tasks === null ? null : tasks.length,
    highPriorityTasks: tasks.filter(task => statusKey(task.priority) === 'high').length,
    activeJobs: data.jobs === null ? null : jobs.filter(job => statusIn(job, activeStates)).length,
    inField: data.jobs === null ? null : jobs.filter(job => statusIn(job, fieldStates)).length,
    unscheduled: data.jobs === null ? null : jobs.filter(job => statusIn(job, ['unscheduled'])).length,
    timeline: jobs.filter(job => !statusIn(job, terminalStates)).slice(0, 8),
    ownerJobs, jobIssues, quoteApprovals, invoiceApprovals, poApprovals, apExceptions,
    attention: attentionKnown ? attentionCount : null,
    verifiedAttentionItems: attentionCount,
  };
}

/** Health is sourced independently so one failed integration never hides another. */
export type CompanyEquipmentData = {
  camera: ReturnType<typeof validateCameraHealth> | null;
  routers: RouterSnapshot | null;
  errors: Partial<Record<'camera' | 'routers', string>>;
};
export async function loadCompanyEquipment(api: DashboardApi): Promise<CompanyEquipmentData> {
  const result: CompanyEquipmentData = { camera: null, routers: null, errors: {} };
  await Promise.all([
    (async () => {
      try { result.camera = validateCameraHealth((await api.get('/api/camera-health/summary')).data); }
      catch (cause) { result.errors.camera = equipmentError(cause, 'Camera Health'); }
    })(),
    (async () => {
      try { result.routers = readRouterSnapshot((await api.get('/api/routers')).data); }
      catch (cause) { result.errors.routers = equipmentError(cause, 'Router inventory'); }
    })(),
  ]);
  return result;
}
function equipmentError(cause: unknown, label: string) {
  const status = cause && typeof cause === 'object' ? (cause as { response?: { status?: number } }).response?.status : undefined;
  return status === 401 || status === 403
    ? label + ': sign-in or Owner access needs attention.'
    : label + ' could not be loaded. Refresh Overview to verify this section.';
}
