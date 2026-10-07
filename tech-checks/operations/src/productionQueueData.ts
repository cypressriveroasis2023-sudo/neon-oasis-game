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

export type ItQueueItem = {
  visitId: string; jobId: string; jobNumber: string; customer: string; site: string;
  visitType: string; scheduledStart: string | null; scheduledEnd: string | null;
  setupNeeded: boolean; readinessNote: string; nativeDispatchStatus: string;
  queueStatus: 'ready' | 'claimed'; claimOwnerId: string | null; claimOwner: string | null; claimable: boolean;
};
export type ItQueue = { actorId: string; items: ItQueueItem[] };
export function productionItQueue(value: unknown, actorId: string): ItQueue {
  const ids = new Set<string>();
  if (!row(value) || !actorId || value.actorId !== actorId || !Array.isArray(value.items) || value.items.some((item: any) => {
    if (!row(item) || typeof item.visitId !== 'string' || !item.visitId || ids.has(item.visitId) ||
      ['jobId','jobNumber','customer','site','visitType'].some(key => typeof item[key] !== 'string') || !item.jobId ||
      !['ready','claimed'].includes(item.queueStatus) || typeof item.claimable !== 'boolean' ||
      typeof item.setupNeeded !== 'boolean' || typeof item.readinessNote !== 'string' || typeof item.nativeDispatchStatus !== 'string' ||
      (item.claimOwnerId !== null && (typeof item.claimOwnerId !== 'string' || !item.claimOwnerId)) ||
      (item.claimOwner !== null && typeof item.claimOwner !== 'string') ||
      ['scheduledStart','scheduledEnd'].some(key => item[key] !== null && typeof item[key] !== 'string') ||
      (item.queueStatus === 'ready' && item.claimOwnerId !== null) ||
      (item.queueStatus === 'claimed' && (!item.claimOwnerId || item.claimable))) return true;
    ids.add(item.visitId); return false;
  })) throw new Error('The shared IT queue could not be verified. Refresh before taking work.');
  return value as ItQueue;
}
export function confirmedItClaim(queue: ItQueue, day: ReturnType<typeof productionDay>, visitId: string, actorId: string) {
  const item = queue.items.find(item => item.visitId === visitId);
  const visits = day.visits.filter(visit => visit.visit_id === visitId);
  return queue.actorId === actorId && item?.queueStatus === 'claimed' && item.claimOwnerId === actorId &&
    !item.claimable && visits.length === 1 && visits[0].assignment_status === 'accepted';
}
