import {mhelpRetryAt} from '../cos-operations-pages/mhelpReadBackoff.ts';

/** Account ceiling confirmed in operations/docs/mhelp-inventory-resource-cache.md.
 * COS admits fewer than that through operations/db/mhelp-request-budget.sql:
 * daily_limit 4800, essential reserve 200, so ordinary data reads stop at 4600.
 * spacing_ms 400 is slower than 6/second and does not use the burst of 3.
 * Ticket reads must share that same admission. These numbers do not raise it.
 */
export const ACCOUNT_DAILY_CAP = 5000;
export const COS_DAILY_LIMIT = 4800;
export const ESSENTIAL_RESERVE = 200;
export const DATA_DAILY_CAP = COS_DAILY_LIMIT - ESSENTIAL_RESERVE;
export const ACCOUNT_RATE_PER_SECOND = 6;
export const ACCOUNT_BURST = 3;
export const SHARED_SPACING_MS = 400;
/** Frequent end of the 30–60 minute cadence. The schedule is not installed.
 * The reader enforces both limits before each vendor call. */
export const TICKET_RUNS_PER_DAY = 48;
export const TICKET_RUN_CAP = 24;
export const TICKET_DAILY_CAP = TICKET_RUN_CAP * TICKET_RUNS_PER_DAY;
/** A longer wait than this would outlive the function and drop rows already read. */
export const CENSUS_WAIT_CAP_MS = 5_000;
/** Half-hour inventory assertion in mhelp-budget-roster.test.mjs is strictly under 2600. */
export const INVENTORY_DAY_RESERVE = 2600;

export function ticketBudgetPlan() {
  const ticketDailyMax = TICKET_RUN_CAP * TICKET_RUNS_PER_DAY;
  const combined = INVENTORY_DAY_RESERVE + ticketDailyMax;
  const spacingFits = SHARED_SPACING_MS * ACCOUNT_RATE_PER_SECOND >= 1000;
  const burstFits = ACCOUNT_BURST >= 1 && SHARED_SPACING_MS >= 400;
  return {ticketDailyMax, combined, dataCap: DATA_DAILY_CAP, accountCap: ACCOUNT_DAILY_CAP, fits: combined <= DATA_DAILY_CAP && combined <= ACCOUNT_DAILY_CAP && spacingFits && burstFits};
}

/** Full wait after a provider 429. Never shorter than Retry-After.
 * Attempt 0 is 1s, then 2s, 4s, capped at 60s before the header is applied.
 * censusWaitAllowed refuses a wait that would exceed the function lifetime;
 * the caller then stops and keeps rows already stored.
 */
export function censusBackoffMs(attempt: number, retryAfter: string | null, now = Date.now()): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 8) throw new Error('invalid_backoff');
  const exponential = Math.min(60_000, 1_000 * 2 ** attempt);
  const at = mhelpRetryAt(retryAfter, now);
  const headerMs = at ? Date.parse(at) - now : 0;
  return Math.max(exponential, headerMs > 0 ? headerMs : 0);
}
export function censusWaitAllowed(waitMs: number): boolean {
  return Number.isFinite(waitMs) && waitMs >= 0 && waitMs <= CENSUS_WAIT_CAP_MS;
}
