import {watchfulActor} from './access.ts';
import {parseWatchfulCsv, watchfulSourceSha256, WatchfulCsvError, type WatchfulRow} from './model.ts';

const ORIGINS = new Set([
  'https://cypressriveroasis2023-sudo.github.io',
  'https://cos-vision-integration-preview.pages.dev',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WatchfulProfile = { id?: unknown; role?: unknown; active?: unknown };
export type WatchfulHandlerOptions = {
  enabled: () => boolean;
  platformUrl: () => string | undefined;
  serviceKey: () => string | undefined;
  identify: (token: string) => Promise<WatchfulProfile | null>;
  fetch?: typeof fetch;
};

function cors(request: Request): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const origin = request.headers.get('Origin');
  if (origin && ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

const reply = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: cors(request)});

function rowsForSql(rows: WatchfulRow[]) {
  return rows.map(row => ({
    rowKey: row.rowKey,
    deviceName: row.deviceName,
    site: row.site,
    deviceType: row.deviceType,
    reportedStatus: row.reportedStatus,
    lastSeenAt: row.lastSeenAt,
  }));
}

export function createWatchfulDeviceHealthHandler(options: WatchfulHandlerOptions) {
  const requestFetch = options.fetch || fetch;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
    if (request.method !== 'POST') return reply(request, {error: 'Use POST.'}, 405);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length > 8192) return reply(request, {error: 'Sign in to Tech Check to continue.'}, 401);
    let body: unknown;
    try { body = await request.json(); } catch { return reply(request, {error: 'The Watchful file could not be read.'}, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(request, {error: 'The Watchful file could not be read.'}, 400);
    const record = body as Record<string, unknown>;
    const action = record.action;
    if (action !== 'load' && action !== 'read') return reply(request, {error: 'The Watchful file could not be read.'}, 400);
    const allowed = action === 'load' ? ['action', 'runId', 'runAt', 'csv'] : ['action'];
    if (Object.keys(record).some(key => !allowed.includes(key))) return reply(request, {error: 'The Watchful file could not be read.'}, 400);
    let actor: { actorId: string } | null;
    try { actor = watchfulActor(await options.identify(token)); } catch { return reply(request, {error: 'Sign in to Tech Check to continue.'}, 401); }
    if (!actor) return reply(request, {error: 'An active COS Owner or verified IT account is required.'}, 403);
    if (action === 'load' && options.enabled() !== true) return reply(request, {error: 'The Watchful device health loader is off.'}, 503);
    const platformUrl = options.platformUrl();
    const serviceKey = options.serviceKey();
    if (!platformUrl || !serviceKey) return reply(request, {error: 'Watchful device health is unavailable.'}, 503);
    let payload: Record<string, unknown>;
    let rpc: string;
    if (action === 'read') {
      rpc = 'cos_watchful_device_health_read';
      payload = {p_actor: actor.actorId};
    } else {
      if (typeof record.csv !== 'string' || typeof record.runId !== 'string' || !UUID.test(record.runId)) {
        return reply(request, {error: 'A run id and Watchful CSV are required.'}, 400);
      }
      if (record.runAt !== undefined && (typeof record.runAt !== 'string' || !Number.isFinite(Date.parse(record.runAt)))) {
        return reply(request, {error: 'The run timestamp is not valid.'}, 400);
      }
      let rows: WatchfulRow[];
      try { rows = parseWatchfulCsv(record.csv); } catch (error) {
        const message = error instanceof WatchfulCsvError ? error.message : 'The Watchful file could not be read.';
        return reply(request, {error: message}, 400);
      }
      rpc = 'cos_watchful_device_health_load';
      payload = {
        p_actor: actor.actorId,
        p_run_id: record.runId,
        p_run_at: typeof record.runAt === 'string' ? new Date(record.runAt).toISOString() : null,
        p_source_sha256: await watchfulSourceSha256(record.csv),
        p_rows: rowsForSql(rows),
      };
    }
    let response: Response;
    try {
      response = await requestFetch(platformUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + rpc, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      return reply(request, {error: 'Watchful device health is unavailable.'}, 503);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const status = response.status === 401 || response.status === 403 ? 403 : 503;
      return reply(request, {error: status === 403 ? 'An active COS Owner or verified IT account is required.' : 'Watchful device health is unavailable.'}, status);
    }
    const saved = await response.json().catch(() => null);
    if (!saved || typeof saved !== 'object') return reply(request, {error: 'Watchful device health is unavailable.'}, 503);
    return reply(request, saved);
  };
}
