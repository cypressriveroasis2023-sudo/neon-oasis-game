import {type WatchfulDeviceType, type WatchfulRow} from '../../supabase/functions/cos-watchful-device-health/model';

/** Same project the power-alarm panel already calls. Not a new secret. */
export const WATCHFUL_HEALTH_URL = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-watchful-device-health';
export const WATCHFUL_READ_TIMEOUT_MS = 8_000;

export type WatchfulRun = { runAt: string | null; rows: WatchfulRow[] };

const TYPES = new Set(['nvr', 'camera', 'vms', 'bridge']);

/** The read model returns the latest run, or no run at all. A bad payload is not a reading. */
export function watchfulRunFromRead(value: unknown): WatchfulRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as { runAt?: unknown; rows?: unknown; runId?: unknown };
  if (!Array.isArray(body.rows)) return null;
  if (body.runId == null && body.runAt == null) return null;
  const rows: WatchfulRow[] = [];
  for (const entry of body.rows) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const deviceName = typeof row.deviceName === 'string' ? row.deviceName.trim() : '';
    const site = typeof row.site === 'string' ? row.site.trim() : '';
    const deviceType = typeof row.deviceType === 'string' ? row.deviceType : '';
    if (!deviceName || !site || !TYPES.has(deviceType)) return null;
    const seen = typeof row.lastSeenAt === 'string' && Number.isFinite(Date.parse(row.lastSeenAt)) ? new Date(Date.parse(row.lastSeenAt)).toISOString() : null;
    rows.push({
      rowKey: typeof row.rowKey === 'string' && row.rowKey ? row.rowKey : deviceName + '|' + deviceType + '|' + site,
      deviceName,
      site,
      deviceType: deviceType as WatchfulDeviceType,
      reportedStatus: typeof row.reportedStatus === 'string' ? row.reportedStatus : '',
      lastSeenAt: seen,
    });
  }
  return { runAt: typeof body.runAt === 'string' ? body.runAt : null, rows };
}

export function readWatchfulOperator(): Promise<{ token: string; role: 'owner' | 'it' } | null> {
  if (typeof window === 'undefined' || window.parent === window || location.origin === 'null') return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = window.setTimeout(() => { window.removeEventListener('message', receive); resolve(null); }, 10000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.type !== 'COS_OPERATIONS_TOKEN_RESPONSE' || message.requestId !== requestId) return;
      window.removeEventListener('message', receive);
      window.clearTimeout(timer);
      const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
      if ((role !== 'owner' && role !== 'it') || typeof message.accessToken !== 'string' || !message.accessToken.trim()) {
        resolve(null);
        return;
      }
      resolve({ token: message.accessToken, role });
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId }, location.origin);
  });
}

type WatchfulReadOptions = {
  operator?: { token: string; role: string } | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Owner and verified IT only. Any other account, a failed read, or a slow read is not a reading. */
async function readLatestWatchfulRunOnce(options: WatchfulReadOptions): Promise<WatchfulRun | null> {
  const operator = options.operator === undefined ? await readWatchfulOperator() : options.operator;
  const role = operator?.role?.toLowerCase();
  if (!operator?.token || (role !== 'owner' && role !== 'it')) return null;
  const response = await (options.fetcher || fetch)(WATCHFUL_HEALTH_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + operator.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'read' }),
    cache: 'no-store',
    signal: options.signal,
  });
  if (!response.ok) return null;
  return watchfulRunFromRead(await response.json());
}

/** One attempt. After about 8 seconds the board shows Unknown and does not try again. */
export async function readLatestWatchfulRun(options: WatchfulReadOptions = {}): Promise<WatchfulRun | null> {
  const timeoutMs = options.timeoutMs ?? WATCHFUL_READ_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, readLatestWatchfulRunOnce({ ...options, signal: controller.signal })]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
