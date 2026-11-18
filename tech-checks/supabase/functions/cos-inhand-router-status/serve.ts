import {inhandActor} from './access.ts';
import {parseInhandRouterCsv, InhandCsvError, type InhandRouterRow} from './model.ts';

const ORIGINS = new Set([
  'https://cypressriveroasis2023-sudo.github.io',
  'https://cos-vision-integration-preview.pages.dev',
]);

export type InhandProfile = { id?: unknown; role?: unknown; active?: unknown };
export type InhandHandlerOptions = {
  enabled: () => boolean;
  platformUrl: () => string | undefined;
  serviceKey: () => string | undefined;
  identify: (token: string) => Promise<InhandProfile | null>;
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

function safeFailure(request: Request, raw: string): Response {
  if (raw.includes('Router serial columns are not installed')) {
    return reply(request, {error: 'Router serial columns are not installed. The loader is refused.'}, 503);
  }
  if (raw.includes('A SIM identifier was refused') || raw.includes('SIM identifiers are not accepted')) {
    return reply(request, {error: 'A SIM identifier was refused.'}, 400);
  }
  return reply(request, {error: 'InHand router status is unavailable.'}, 503);
}

export function createInhandRouterStatusHandler(options: InhandHandlerOptions) {
  const requestFetch = options.fetch || fetch;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
    if (request.method !== 'POST') return reply(request, {error: 'Use POST.'}, 405);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length > 8192) return reply(request, {error: 'Sign in to Tech Check to continue.'}, 401);
    let body: unknown;
    try { body = await request.json(); } catch { return reply(request, {error: 'The router file could not be read.'}, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(request, {error: 'The router file could not be read.'}, 400);
    const record = body as Record<string, unknown>;
    if (record.action !== 'load' || Object.keys(record).some(key => !['action', 'csv'].includes(key))) {
      return reply(request, {error: 'The router file could not be read.'}, 400);
    }
    let actor: { actorId: string; role: 'owner' | 'it' } | null;
    try { actor = inhandActor(await options.identify(token)); } catch { return reply(request, {error: 'Sign in to Tech Check to continue.'}, 401); }
    if (!actor) return reply(request, {error: 'An active COS Owner or verified IT account is required.'}, 403);
    if (options.enabled() !== true) return reply(request, {error: 'The InHand router status loader is off.'}, 503);
    const platformUrl = options.platformUrl();
    const serviceKey = options.serviceKey();
    if (typeof record.csv !== 'string') return reply(request, {error: 'A router CSV is required.'}, 400);
    if (!platformUrl || !serviceKey) return reply(request, {error: 'InHand router status is unavailable.'}, 503);
    let rows: InhandRouterRow[];
    try { rows = parseInhandRouterCsv(record.csv); } catch (error) {
      const message = error instanceof InhandCsvError ? error.message : 'The router file could not be read.';
      return reply(request, {error: message}, 400);
    }
    let response: Response;
    try {
      response = await requestFetch(platformUrl.replace(/\/$/, '') + '/rest/v1/rpc/cos_inhand_router_status_load', {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + serviceKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          p_actor: actor.actorId,
          p_rows: rows.map(row => ({
            name: row.name, serial: row.serial, status: row.status, lastSeenAt: row.lastSeenAt, ip: row.ip, deviceId: row.deviceId,
          })),
        }),
      });
    } catch {
      return reply(request, {error: 'InHand router status is unavailable.'}, 503);
    }
    if (!response.ok) return safeFailure(request, await response.text());
    const saved = await response.json().catch(() => null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return reply(request, {error: 'InHand router status is unavailable.'}, 503);
    const result = saved as { matched?: { ip?: string | null }[] };
    if (Array.isArray(result.matched)) {
      for (const row of result.matched) {
        if (!row || typeof row !== 'object') continue;
        if (actor.role !== 'owner' && actor.role !== 'it') row.ip = null;
      }
    }
    return reply(request, saved);
  };
}
