const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Never infer a go-back from free-form notes or change the underlying job status. */
export function withDeliveryGoBacks(snapshot, goBacks) {
  if (!Array.isArray(snapshot?.items) || !Array.isArray(goBacks?.items)) throw new Error('Invalid delivery follow-up snapshot');
  const byJob = new Map();
  for (const item of goBacks.items) {
    if (!item || !UUID.test(item.jobId) || !UUID.test(item.visitId) || !UUID.test(item.previousVisitId) || !UUID.test(item.requestId) ||
        item.visitId === item.previousVisitId || typeof item.required !== 'boolean' || typeof item.status !== 'string' ||
        typeof item.completionVerified !== 'boolean' || item.required === item.completionVerified ||
        item.completionVerified && item.status !== 'completed' || byJob.has(item.jobId) ||
        ['reason','remainingWork','partsNeeded','returnNotes'].some(field => item[field] != null && typeof item[field] !== 'string')) throw new Error('Invalid delivery follow-up snapshot');
    byJob.set(item.jobId, { visitId: item.visitId, previousVisitId: item.previousVisitId, requestId: item.requestId, required: item.required, status: item.status, completionVerified: item.completionVerified,
      reason: item.reason || '', remainingWork: item.remainingWork || '', partsNeeded: item.partsNeeded || '', returnNotes: item.returnNotes || '', completedAt: item.completedAt || null });
  }
  return { ...snapshot, items: snapshot.items.map(item => ({ ...item, goBackAvailable: true, goBack: byJob.get(item.id) || null })) };
}

