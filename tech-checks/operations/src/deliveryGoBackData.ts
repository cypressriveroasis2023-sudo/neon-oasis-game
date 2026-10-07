import { matchingJob, statusKey, type OperationsRecord } from './operationsWorkflowData';

export type GoBackDraft = { requestId: string; reason: string; remainingWork: string; partsNeeded: string; returnNotes: string };
export const emptyGoBackDraft = (): GoBackDraft => ({ requestId: crypto.randomUUID(), reason: '', remainingWork: '', partsNeeded: '', returnNotes: '' });
export const hasOpenGoBack = (job: OperationsRecord) => job.goBack?.required === true;
export function canRequestGoBack(job: OperationsRecord) {
  return job.goBackAvailable === true && String(job.jobType).toUpperCase() === 'DELIVERY' && !hasOpenGoBack(job) &&
    !job.invoiceNumber && ['owner review', 'field complete', 'billing ready'].includes(statusKey(job.status));
}
export function goBackBlockedReason(job: OperationsRecord): string {
  if (String(job.jobType).toUpperCase() !== 'DELIVERY' || hasOpenGoBack(job)) return '';
  if (job.invoiceNumber || ['closed', 'completed', 'cancelled', 'paid', 'invoiced'].includes(statusKey(job.status))) return 'This delivery is closed or linked to billing. A go-back cannot reopen it here; review the job and invoice first.';
  return '';
}
export function validGoBackDraft(draft: GoBackDraft) {
  return Boolean(draft.reason.trim() || draft.remainingWork.trim()) && [draft.reason, draft.remainingWork, draft.partsNeeded, draft.returnNotes].every(value => value.length <= 4000);
}
export function confirmedGoBack(rows: OperationsRecord[], id: string, draft: GoBackDraft) {
  const job = matchingJob(rows, id), saved = job?.goBack;
  return Boolean(job && saved && saved.required === true && saved.requestId === draft.requestId &&
    saved.visitId === job.visitId && typeof saved.previousVisitId === 'string' && saved.previousVisitId !== saved.visitId &&
    statusKey(job.status) === 'unscheduled' && job.billingReady === false &&
    ['reason', 'remainingWork', 'partsNeeded', 'returnNotes'].every(field => String(saved[field] || '').trim() === draft[field as keyof GoBackDraft].trim()));
}
