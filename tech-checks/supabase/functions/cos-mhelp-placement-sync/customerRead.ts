import {projectCustomer} from '../cos-mhelp-assignments/index.ts';

const PORTAL = '224643';
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_DELAY = 500;
const MAX_DELAY = 2000;

type ReadOutcome = 'verified' | 'transport' | 'request_timeout' | 'deadline' | 'response_unreadable' | 'identity_unverified' | 'http';
export type CustomerReadAttempt = {attempt: number; outcome: ReadOutcome; status?: number; retryAfterMs?: number | null};
/** Aggregate codes only: no IDs, names, headers, response bodies or exception messages. */
export function createCustomerReadDiagnostics() {
  let attempts = 0, verified = 0;
  const failures: Record<string, number> = {};
  const rateLimitDelays: Record<string, number> = {};
  return {
    record(event: CustomerReadAttempt) {
      attempts++;
      if (event.outcome === 'verified') { verified++; return; }
      const code = event.outcome === 'http' ? 'http_' + event.status : event.outcome;
      failures[code] = (failures[code] ?? 0) + 1;
      if (event.outcome === 'http' && event.status === 429) {
        const delay = event.retryAfterMs === undefined ? 'unspecified' : event.retryAfterMs === null ? 'deferred' : String(event.retryAfterMs);
        rateLimitDelays[delay] = (rateLimitDelays[delay] ?? 0) + 1;
      }
    },
    snapshot: () => ({attempts, verified, failures: {...failures}, rateLimitDelays: {...rateLimitDelays}}),
  };
}

/** One request-start clock and cooldown shared by every worker in this source run. */
export function createCustomerReadGate(options: {
  signal: AbortSignal;
  now?: () => number;
  pause?: typeof waitForCustomerRetry;
}) {
  const now = options.now ?? Date.now, pause = options.pause ?? waitForCustomerRetry;
  let nextStart = 0, cooldown = 0, deferred = false;
  return {
    async acquire() {
      while (!options.signal.aborted && !deferred) {
        const time = now(), delay = Math.max(nextStart, cooldown) - time;
        if (delay <= 0) { nextStart = time + 400; return true; }
        if (!await pause(delay, options.signal)) return false;
      }
      return false;
    },
    rateLimited(delay: number | null) {
      if (delay === null) deferred = true;
      else cooldown = Math.max(cooldown, now() + Math.max(2000, delay));
    },
  };
}

/** Do not retry earlier than Retry-After, or wait beyond the bounded source run. */
export function customerRetryDelay(value: string | null, now = Date.now()): number | null {
  if (!value) return DEFAULT_DELAY;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  const milliseconds = seconds === null ? Date.parse(value) - now : seconds * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return DEFAULT_DELAY;
  return milliseconds > MAX_DELAY ? null : Math.max(DEFAULT_DELAY, milliseconds);
}

export function waitForCustomerRetry(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(ready);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort();
  });
}

/** At most two GETs inside the existing worker and deadline; no cached assignment fallback. */
export async function readPlacementCustomer(id: string, options: {
  accessToken: string;
  portalId: string;
  signal: AbortSignal;
  fetch: typeof fetch;
  readJson: (response: Response) => Promise<unknown>;
  pause?: typeof waitForCustomerRetry;
  now?: () => number;
  onAttempt?: (event: CustomerReadAttempt) => void;
  beforeAttempt?: () => Promise<boolean>;
  onRateLimit?: (delay: number | null) => void;
}) {
  if (options.portalId !== PORTAL || !/^[1-9]\d{0,14}$/.test(id) || options.signal.aborted) return null;
  const pause = options.pause ?? waitForCustomerRetry;
  const url = 'https://connect.mhelpdesk.com/api/v1.0/portal/' + PORTAL + '/customers/' + id + '?fields=customerId,portalId,name,isServiceLocation';
  for (let attempt = 0; attempt < 2 && !options.signal.aborted; attempt++) {
    if (options.beforeAttempt && !await options.beforeAttempt()) return null;
    if (options.signal.aborted) return null;
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10000)]);
    const report = (outcome: ReadOutcome, status?: number, retryAfterMs?: number | null) => options.onAttempt?.({attempt: attempt + 1, outcome, ...(status === undefined ? {} : {status}), ...(retryAfterMs === undefined ? {} : {retryAfterMs})});
    let response: Response;
    try {
      response = await options.fetch(url, {
        method: 'GET', headers: {Authorization: 'Bearer ' + options.accessToken, Accept: 'application/json'},
        redirect: 'error', cache: 'no-store', signal,
      });
    } catch {
      report(options.signal.aborted ? 'deadline' : signal.aborted ? 'request_timeout' : 'transport');
      if (attempt === 1 || options.signal.aborted || !await pause(DEFAULT_DELAY, options.signal)) return null;
      continue;
    }
    if (options.signal.aborted) {
      report('deadline');
      void response.body?.cancel().catch(() => {});
      return null;
    }
    if (response.ok) {
      // Invalid identities, malformed data and wrong record kinds never become a retry success.
      let row: unknown;
      try { row = await options.readJson(response); }
      catch { report(options.signal.aborted ? 'deadline' : signal.aborted ? 'request_timeout' : 'response_unreadable'); return null; }
      if (options.signal.aborted) { report('deadline'); return null; }
      try { const result = projectCustomer(row, id, PORTAL); report('verified'); return result; }
      catch { report('identity_unverified'); return null; }
    }
    void response.body?.cancel().catch(() => {});
    const delay = customerRetryDelay(response.headers.get('Retry-After'), options.now?.());
    report('http', response.status, response.status === 429 && response.headers.has('Retry-After') ? delay : undefined);
    if (response.status === 429) options.onRateLimit?.(delay);
    if (attempt === 1 || !TRANSIENT.has(response.status) || delay === null || !await pause(delay, options.signal)) return null;
  }
  return null;
}
