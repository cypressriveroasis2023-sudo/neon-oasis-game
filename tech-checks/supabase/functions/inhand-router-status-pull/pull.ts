/**
 * Read-only InHand Device Manager pull for router online/offline.
 *
 * Reads iot.inhandnetworks.com only: GET /api/platform/config (public OAuth
 * client), POST /oauth2/access_token (sign-in / refresh), GET /api/devices.
 * It never sends a command, setting or write to InHand.
 *
 * The secrets live in Supabase only and never leave this file: they are not
 * logged, returned, or written into an error message.
 */
export const INHAND_ORIGIN = 'https://iot.inhandnetworks.com';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type PullErrorCode =
  | 'not_configured' | 'config_unavailable' | 'sign_in_rejected' | 'sign_in_unavailable'
  | 'devices_unavailable' | 'devices_unauthorized' | 'devices_unexpected' | 'too_many_devices' | 'apply_failed';

export class PullError extends Error {
  readonly code: PullErrorCode;
  /** Short, secret-free reason from InHand (HTTP status and OAuth error code only). */
  readonly detail: string;
  constructor(code: PullErrorCode, detail = '') { super(code); this.name = 'PullError'; this.code = code; this.detail = detail; }
}

export type Token = { access_token: string; expires_in?: number; refresh_token?: string | null };
export type Reading = { serial: string; online: 0 | 1 };

export type PullDeps = {
  fetch: typeof fetch;
  env: (name: string) => string | undefined;
  /** Cached session from the database (may be empty). */
  loadSession: () => Promise<{ access_token: string | null; access_expires_at: string | null; refresh_token: string | null } | null>;
  saveSession: (token: Token) => Promise<void>;
  clearSession: () => Promise<void>;
  now: () => Date;
};

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new PullError('devices_unexpected');
  try { return JSON.parse(text); } catch { return null; }
}

async function send(deps: PullDeps, path: string, init: RequestInit, failure: PullErrorCode): Promise<Response> {
  try {
    const response = await deps.fetch(INHAND_ORIGIN + path, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response;
  } catch {
    throw new PullError(failure);
  }
}

export async function oauthClient(deps: PullDeps): Promise<{ id: string; secret: string }> {
  const response = await send(deps, '/api/platform/config', { method: 'GET', headers: { Accept: 'application/json' } }, 'config_unavailable');
  if (response.status !== 200) { await response.body?.cancel(); throw new PullError('config_unavailable'); }
  const body = await readJson(response) as any;
  const auth = body?.result?.auth;
  const id = auth?.clientId == null ? '' : String(auth.clientId);
  const secret = typeof auth?.clientSecret === 'string' ? auth.clientSecret : '';
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(id) || secret.length > 256) throw new PullError('config_unavailable');
  return { id, secret };
}

/** InHand's own error code only, e.g. "400:invalid_grant" — never echoes anything we sent. */
export function rejectionReason(status: number, body: any): string {
  const raw = [body?.error, body?.error_code, body?.code].find(v => typeof v === 'string' || typeof v === 'number');
  const code = raw == null ? '' : String(raw).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
  return status + (code ? ':' + code : '');
}

type Rejected = { rejected: string };
async function tokenRequest(deps: PullDeps, form: Record<string, string>): Promise<Token | Rejected> {
  const response = await send(deps, '/oauth2/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  }, 'sign_in_unavailable');
  const body = await readJson(response) as any;
  if (response.status >= 500) throw new PullError('sign_in_unavailable');
  const token = typeof body?.access_token === 'string' ? body.access_token : '';
  if (response.status !== 200 || body?.error || !/^[A-Za-z0-9._~+/=-]{16,8192}$/.test(token)) return { rejected: rejectionReason(response.status, body) };
  const refresh = typeof body.refresh_token === 'string' && /^[A-Za-z0-9._~+/=-]{8,8192}$/.test(body.refresh_token) ? body.refresh_token : null;
  const expires = Number(body.expires_in);
  return { access_token: token, refresh_token: refresh, expires_in: Number.isFinite(expires) && expires > 0 ? expires : 3600 };
}

/**
 * Fresh session from a refresh token: the stored one first, then the optional
 * INHAND_REFRESH_TOKEN secret. InHand Device Manager refuses password sign-in
 * for its public client ("invalid_client"), so the first session comes from
 * the one-time browser connect flow (exchangeCode).
 */
export async function signIn(deps: PullDeps, storedRefresh: string | null): Promise<string> {
  const bootstrapRefresh = deps.env('INHAND_REFRESH_TOKEN')?.trim();
  if (!storedRefresh && !bootstrapRefresh) throw new PullError('not_configured');
  const client = await oauthClient(deps);
  const base = { client_id: client.id, client_secret: client.secret };
  const reasons: string[] = [];
  for (const refresh of [storedRefresh, bootstrapRefresh]) {
    if (!refresh) continue;
    const token = await tokenRequest(deps, { ...base, grant_type: 'refresh_token', refresh_token: refresh });
    if (!('rejected' in token)) { await deps.saveSession(token); return token.access_token; }
    reasons.push('refresh ' + token.rejected);
  }
  await deps.clearSession();
  throw new PullError('sign_in_rejected', reasons.join(', '));
}

/** One-time connect: trade the code from InHand's own sign-in page for a session. */
export async function exchangeCode(deps: PullDeps, code: string, redirectUri: string): Promise<void> {
  if (!/^[A-Za-z0-9._~+/=-]{4,2048}$/.test(code)) throw new PullError('sign_in_rejected', 'bad code');
  const client = await oauthClient(deps);
  const token = await tokenRequest(deps, {
    grant_type: 'authorization_code', code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri,
  });
  if ('rejected' in token) throw new PullError('sign_in_rejected', 'code ' + token.rejected);
  if (!token.refresh_token) throw new PullError('sign_in_rejected', 'no refresh token');
  await deps.saveSession(token);
}

function deviceArray(body: any): any[] | null {
  for (const candidate of [body?.result, body?.result?.list, body?.result?.items, body?.data, body?.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

export function readingOf(device: any): Reading | null {
  const serial = typeof device?.serialNumber === 'string' ? device.serialNumber.trim().toUpperCase() : '';
  if (!/^[A-Z0-9-]{6,40}$/.test(serial)) return null;
  const online = device?.online;
  if (online === 1 || online === true) return { serial, online: 1 };
  if (online === 0 || online === false) return { serial, online: 0 };
  return null;
}

/** Every page of /api/devices. Throws 'devices_unauthorized' on 401/403 so the caller can sign in again once. */
export async function listDevices(deps: PullDeps, accessToken: string): Promise<{ readings: Reading[]; seen: number }> {
  const readings: Reading[] = [];
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ verbose: '100', limit: String(PAGE_LIMIT), cursor: String(page * PAGE_LIMIT) });
    const response = await send(deps, '/api/devices?' + query, {
      method: 'GET', headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
    }, 'devices_unavailable');
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new PullError('devices_unauthorized'); }
    if (response.status !== 200) { await response.body?.cancel(); throw new PullError('devices_unavailable'); }
    const body = await readJson(response) as any;
    const devices = deviceArray(body);
    if (!devices) throw new PullError('devices_unexpected');
    seen += devices.length;
    for (const device of devices) { const reading = readingOf(device); if (reading) readings.push(reading); }
    const total = Number(body?.total);
    if (devices.length < PAGE_LIMIT || (Number.isFinite(total) && seen >= total)) return { readings, seen };
  }
  throw new PullError('too_many_devices');
}

/** One full pull. Returns the readings and the time InHand was read. */
export async function pullInhand(deps: PullDeps): Promise<{ readings: Reading[]; seen: number; observedAt: string }> {
  const session = await deps.loadSession();
  const now = deps.now().getTime();
  const cachedValid = session?.access_token && session.access_expires_at && Date.parse(session.access_expires_at) > now;
  let token = cachedValid ? session!.access_token! : await signIn(deps, session?.refresh_token || null);
  const observedAt = deps.now().toISOString();
  try {
    return { ...(await listDevices(deps, token)), observedAt };
  } catch (error) {
    // Only a cached token gets one fresh sign-in; a brand-new token that is refused is a real failure.
    if (!cachedValid || !(error instanceof PullError) || error.code !== 'devices_unauthorized') throw error;
    token = await signIn(deps, session?.refresh_token || null);
    return { ...(await listDevices(deps, token)), observedAt: deps.now().toISOString() };
  }
}
