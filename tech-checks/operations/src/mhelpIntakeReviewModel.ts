/** Client-only saved-status contract. Never import server credentials or source readers. */
export const INTAKE_REVIEW_CONTRACT = 'cos-mhelp-intake-review-v1';
export const INTAKE_STATUS_STALE_MS = 15 * 60 * 1000;
export const intakeReviewReasons = {
  assignment_identity_unverified: 'Technician identity needs verification',
  configuration_reviewer_inactive: 'Configuration approval needs an active reviewer',
  existing_ticket_requires_reconciliation: 'An existing ticket needs reconciliation',
  source_changed_review_required: 'Source changed; existing work is preserved',
  source_creation_in_future: 'Source creation time is in the future',
  source_schema_unverified: 'Source fields need verification',
  source_scope_or_route_invalid: 'Source scope or workflow needs review',
  source_status_incomplete_or_deleted: 'Source status is incomplete or deleted',
  source_status_review_required: 'Source status needs review',
  source_status_reviewer_inactive: 'Status approval needs an active reviewer',
  source_status_terminal: 'Source ticket has a terminal status',
  source_status_unreviewed: 'Source status has not been reviewed',
  ticket_lead_inactive_or_unverified: 'Ticket lead is inactive or unverified',
  ticket_lead_unverified: 'Ticket lead needs verification',
  ticket_lead_policy_conflict: 'Local ticket lead policy conflicts with source assignment',
  type_mapping_reviewer_inactive: 'Type mapping needs an active reviewer',
  type_mapping_unverified: 'Ticket type mapping needs verification',
} as const;
export const intakeReviewErrors = {
  SOURCE_UNAVAILABLE: 'Source read unavailable', SOURCE_INVALID: 'Source response needs review',
  BATCH_LIMIT: 'Source batch exceeds the safe limit', WRITE_UNAVAILABLE: 'Intake recording unavailable',
  RECEIPT_INVALID: 'Saved receipt could not be verified', DEADLINE: 'Poll exceeded its time limit',
  CONFIGURATION: 'Intake configuration needs review', INTERNAL: 'Poll could not complete',
} as const;
export type IntakeReviewStatus = {
  contract: typeof INTAKE_REVIEW_CONTRACT; enabled: boolean; activationAt: string | null;
  pendingReviewCount: number; createdCount: number; lastAttemptAt: string | null;
  lastSuccessAt: string | null; failureCount: number; retryAfter: string | null;
  lastErrorCode: keyof typeof intakeReviewErrors | null;
  held: { ticketNumber: string; reasonCodes: (keyof typeof intakeReviewReasons)[] }[];
  heldTruncated: boolean;
};
function invalid(): never { throw new Error('The saved intake status could not be verified.'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown, max = 100000000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid();
  return value;
}
function time(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
export function intakeReviewAccess(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return session.authorized === true && session.legacyOwner === true && session.role === 'Owner';
}
/** Unknown fields/codes fail closed rather than rendering source payload or arbitrary error text. */
export function checkedIntakeReview(value: unknown): IntakeReviewStatus {
  const row = record(value, ['contract','enabled','activationAt','pendingReviewCount','createdCount','lastAttemptAt','lastSuccessAt','failureCount','retryAfter','lastErrorCode','held','heldTruncated']);
  if (row.contract !== INTAKE_REVIEW_CONTRACT || typeof row.enabled !== 'boolean' ||
      typeof row.heldTruncated !== 'boolean' || !Array.isArray(row.held) || row.held.length > 25) invalid();
  if (row.lastErrorCode !== null && (typeof row.lastErrorCode !== 'string' || !Object.hasOwn(intakeReviewErrors, row.lastErrorCode))) invalid();
  const held = row.held.map(value => {
    const item = record(value, ['ticketNumber','reasonCodes']);
    if (typeof item.ticketNumber !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/.test(item.ticketNumber) ||
        !Array.isArray(item.reasonCodes) || item.reasonCodes.length > 40) invalid();
    const reasonCodes = item.reasonCodes.map(code => {
      if (typeof code !== 'string' || !Object.hasOwn(intakeReviewReasons, code)) invalid();
      return code as keyof typeof intakeReviewReasons;
    });
    return { ticketNumber: item.ticketNumber, reasonCodes };
  });
  const pendingReviewCount = count(row.pendingReviewCount);
  if (held.length > pendingReviewCount || row.heldTruncated !== (pendingReviewCount > held.length)) invalid();
  return { contract: INTAKE_REVIEW_CONTRACT, enabled: row.enabled, activationAt: time(row.activationAt),
    pendingReviewCount, createdCount: count(row.createdCount), lastAttemptAt: time(row.lastAttemptAt),
    lastSuccessAt: time(row.lastSuccessAt), failureCount: count(row.failureCount, 16), retryAfter: time(row.retryAfter),
    lastErrorCode: row.lastErrorCode as IntakeReviewStatus['lastErrorCode'], held, heldTruncated: row.heldTruncated };
}
export function intakeReviewHealth(status: IntakeReviewStatus, now: number): { state: string; text: string } {
  if (!Number.isFinite(now)) return { state: 'unknown', text: 'Current timing is unknown.' };
  if ([status.lastSuccessAt, status.lastAttemptAt].some(value => value !== null && Date.parse(value) > now))
    return { state: 'unknown', text: 'Saved poll timestamps are in the future. Timing could not be verified.' };
  if (!status.enabled) return { state: 'disabled', text: 'Disabled. Automatic intake is not enabled.' };
  if (status.activationAt === null || Date.parse(status.activationAt) > now)
    return { state: 'unknown', text: 'Enabled configuration; activation time is unknown or has not been reached.' };
  if (status.retryAfter !== null && Date.parse(status.retryAfter) > now)
    return { state: 'backoff', text: 'Backoff. The scheduler is waiting until the saved next eligible poll time.' };
  if (status.failureCount > 0 || status.lastErrorCode !== null)
    return { state: 'error', text: 'Poll error recorded. A later completed source scan has not been verified.' };
  if (status.lastSuccessAt === null) return { state: 'unknown', text: 'No completed source scan recorded.' };
  if (now - Date.parse(status.lastSuccessAt) > INTAKE_STATUS_STALE_MS)
    return { state: 'stale', text: 'Stale. The last completed source scan is more than 15 minutes old.' };
  if (status.pendingReviewCount > 0) return { state: 'review', text: 'Recent source scan completed. Review is required.' };
  return { state: 'recent', text: 'Recent source scan completed.' };
}
export function intakeReviewErrorMessage(cause: unknown): string {
  const code = (cause as { response?: { status?: number } } | null)?.response?.status;
  if (code === 401) return 'Your sign-in could not be verified. Return to Tech Check and sign in again. Intake state is unknown.';
  if (code === 403) return 'This saved status requires your normal authorized Owner session. Intake state is unknown.';
  if (code === 404) return 'Saved intake status is unavailable on this backend. Intake state is unknown.';
  return 'Saved intake status could not be verified. Refresh to check again. Intake state is unknown.';
}
