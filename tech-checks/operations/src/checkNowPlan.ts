/**
 * What COS said when Refresh asked it to run the camera checks now.
 *
 * `started` is true when this tap started them. Otherwise one was already
 * running on the timer, was about to, or had just finished, and `reason` says
 * which. Either way `waitSeconds` is Tech Check's own count of how long until
 * the results should be in, so the wait never depends on this device's clock.
 */
export type CheckNowPlan = {
  started: boolean;
  reason: 'started' | 'scheduled_check_running' | 'scheduled_check_due' | 'checked_recently';
  waitSeconds: number;
  /** This device's clock when the answer arrived. */
  receivedAt: number;
};

/** The longest Refresh will wait on a check before reading whatever is saved. */
export const CHECK_NOW_MAX_WAIT_MS = 100 * 1000;

const REASONS = ['started', 'scheduled_check_running', 'scheduled_check_due', 'checked_recently'] as const;

/** Throws on anything that is not COS's own answer, so a bad reply is never treated as a started check. */
export function readCheckNowPlan(value: unknown, receivedAt: number = Date.now()): CheckNowPlan {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const reason = REASONS.find(item => item === row?.reason);
  if (!row || row.contract !== 'COS_CHECK_NOW_STARTED_V1' || typeof row.started !== 'boolean' || !reason
    || (row.started !== (reason === 'started'))
    || typeof row.waitSeconds !== 'number' || !Number.isInteger(row.waitSeconds) || row.waitSeconds < 0 || row.waitSeconds > 180) {
    throw new Error('COS could not confirm the check started.');
  }
  return {started: row.started, reason, waitSeconds: row.waitSeconds, receivedAt};
}

/** Milliseconds still to wait, never more than the cap and never negative. */
export function checkNowWaitMs(plan: CheckNowPlan, now: number): number {
  const until = plan.receivedAt + Math.min(plan.waitSeconds * 1000, CHECK_NOW_MAX_WAIT_MS);
  return Math.max(0, Math.min(CHECK_NOW_MAX_WAIT_MS, until - now));
}

/**
 * A check that could not be started is worth telling the person about, except in
 * two cases where there is nothing for them to act on: the route is not live yet
 * (404), or this sign-in may not start checks (403). Those read the saved reading
 * exactly as Refresh always has.
 */
export function checkNowFailureIsQuiet(error: unknown): boolean {
  const status = error && typeof error === 'object' ? (error as {status?: unknown}).status : undefined;
  return status === 404 || status === 403;
}
