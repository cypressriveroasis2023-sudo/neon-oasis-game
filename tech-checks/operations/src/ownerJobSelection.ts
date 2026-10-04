export type OwnerJobCandidate = { id?: unknown; status?: unknown; [key: string]: unknown };

/** One source for dropdown options, visible details and the selected action target. */
export function ownerJobSelection<T extends OwnerJobCandidate>(jobs: readonly T[], requestedId: string) {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    if (job && typeof job.id === 'string' && job.id.trim()) {
      counts.set(job.id, (counts.get(job.id) || 0) + 1);
    }
  }
  const options = jobs.filter(job => {
    if (!job || typeof job.id !== 'string' || !job.id.trim() || counts.get(job.id) !== 1) return false;
    if (typeof job.status !== 'string' || !job.status.trim()) return false;
    const status = job.status.trim().toLowerCase();
    return !['closed', 'cancelled', 'canceled', 'deleted'].includes(status);
  });
  const selected = options.find(job => job.id === requestedId);
  return { options, selected, selectedId: selected ? String(selected.id) : '' };
}
