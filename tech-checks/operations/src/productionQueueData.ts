type Row = Record<string, any>;
const row = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function productionDay(value: any) {
  if (!row(value) || !row(value.profile) || !Array.isArray(value.visits) || value.visits.some((v: any) => !row(v) || typeof v.visit_id !== 'string' || !v.visit_id))
    throw new Error('Operations returned an incomplete assignment snapshot.');
  return value as { profile: Row; visits: Row[]; truck_check?: Row; [key: string]: any };
}
export function productionTasks(value: any): Row[] {
  if (!row(value) || !Array.isArray(value.items) || value.items.some((v: any) => !row(v) || typeof v.id !== 'string' || !v.id))
    throw new Error('Operations returned an incomplete task snapshot.');
  return value.items;
}
export function productionVisit(value: any, visitId: string) {
  if (!row(value) || !row(value.visit) || value.visit.id !== visitId || !row(value.job) || typeof value.job.id !== 'string')
    throw new Error('Assigned visit details could not be verified. Refresh your assignments.');
  return value as Row;
}
export function queueStatus(value: unknown) { return String(value || 'Unavailable').replaceAll('_', ' ').toUpperCase(); }
export function queueTime(value: unknown) {
  if (!value) return 'Not scheduled';
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}
