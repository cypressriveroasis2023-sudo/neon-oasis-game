import {projectCustomer} from '../cos-mhelp-assignments/index.ts';

const PORTAL = '224643';
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_DELAY = 500;
const MAX_DELAY = 2000;

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
}) {
  if (options.portalId !== PORTAL || !/^[1-9]\d{0,14}$/.test(id) || options.signal.aborted) return null;
  const pause = options.pause ?? waitForCustomerRetry;
  const url = 'https://connect.mhelpdesk.com/api/v1.0/portal/' + PORTAL + '/customers/' + id + '?fields=customerId,portalId,name,isServiceLocation';
  for (let attempt = 0; attempt < 2 && !options.signal.aborted; attempt++) {
    let response: Response;
    try {
      response = await options.fetch(url, {
        method: 'GET', headers: {Authorization: 'Bearer ' + options.accessToken, Accept: 'application/json'},
        redirect: 'error', cache: 'no-store', signal: AbortSignal.any([options.signal, AbortSignal.timeout(10000)]),
      });
    } catch {
      if (attempt === 1 || options.signal.aborted || !await pause(DEFAULT_DELAY, options.signal)) return null;
      continue;
    }
    if (options.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    if (response.ok) {
      // Invalid identities, malformed data and wrong record kinds never become a retry success.
      try {
        const row = await options.readJson(response);
        return options.signal.aborted ? null : projectCustomer(row, id, PORTAL);
      }
      catch { return null; }
    }
    void response.body?.cancel().catch(() => {});
    const delay = customerRetryDelay(response.headers.get('Retry-After'), options.now?.());
    if (attempt === 1 || !TRANSIENT.has(response.status) || delay === null || !await pause(delay, options.signal)) return null;
  }
  return null;
}
