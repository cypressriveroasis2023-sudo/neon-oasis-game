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
/** Extra router facts for the unit card. Never SIM numbers (ICCID, IMSI, IMEI) or phone numbers. */
export type ReadingDetails = {
  name?: string; model?: string; pub?: string; carrier?: string; fw?: string; seen?: string;
  sig?: { level?: number; radio?: string; band?: string; rsrp?: number; rsrq?: number; sinr?: number; ts?: string };
  gps?: { lat: number; lng: number; t?: string };
};
export type Reading = { serial: string; online: 0 | 1; d?: ReadingDetails };

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
  const raw = await response.text();
  if (raw.length > MAX_BODY_BYTES) throw new PullError('config_unavailable');
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* handled below */ }
  const auth = body?.result?.auth;
  // InHand's clientId is a long number (e.g. 20 digits). JSON.parse rounds numbers past
  // 2^53, which InHand then rejects as "invalid_client". Read the digits from the raw text.
  const exact = raw.match(/"clientId"\s*:\s*"?([A-Za-z0-9_-]{4,128})"?/);
  const id = exact ? exact[1] : (auth?.clientId == null ? '' : String(auth.clientId));
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

const CARRIERS: Record<string, string> = { '310-260': 'T-Mobile', '310-410': 'AT&T', '310-280': 'AT&T', '310-150': 'AT&T', '311-480': 'Verizon', '310-012': 'Verizon' };
const short = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) ? v : undefined;

/** Only the fields the card shows, each checked. Everything else InHand sends is dropped here. */
export function detailsOf(device: any): ReadingDetails {
  const d: ReadingDetails = {};
  const name = short(device?.name, 80); if (name) d.name = name;
  const model = short(device?.model, 24); if (model) d.model = model;
  if (typeof device?.pubIp === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(device.pubIp) && device.pubIp.split('.').every((p: string) => Number(p) <= 255)) d.pub = device.pubIp;
  const info = device?.info && typeof device.info === 'object' ? device.info : {};
  const mcc = num(info.mcc, 0, 999), mnc = num(info.mnc, 0, 999);
  if (mcc !== undefined && mnc !== undefined) {
    const key = String(mcc).padStart(3, '0') + '-' + String(mnc).padStart(3, '0');
    d.carrier = CARRIERS[key] || 'Carrier ' + key;
  }
  const fw = short(info.swVersion, 24); if (fw) d.fw = fw;
  const seen = iso(device?.logtime); if (seen) d.seen = seen;
  const s = device?.signalStrength;
  if (s && typeof s === 'object') {
    const sig: NonNullable<ReadingDetails['sig']> = {};
    const level = num(s.level, 0, 5); if (level !== undefined) sig.level = Math.round(level);
    const radio = short(s.radio, 8); if (radio) sig.radio = radio;
    const band = s.band === undefined || s.band === null ? undefined : short(String(s.band), 8); if (band) sig.band = band;
    for (const k of ['rsrp', 'rsrq', 'sinr'] as const) { const v = num(s[k], -200, 100); if (v !== undefined) sig[k] = v; }
    const ts = iso(s.ts); if (ts) sig.ts = ts;
    if (Object.keys(sig).length) d.sig = sig;
  }
  const loc = device?.location;
  if (loc && typeof loc === 'object') {
    const lat = num(loc.latitude, -90, 90), lng = num(loc.longitude, -180, 180);
    if (lat !== undefined && lng !== undefined && !(lat === 0 && lng === 0)) d.gps = { lat, lng, ...(iso(loc.time) ? { t: iso(loc.time) } : {}) };
  }
  return d;
}

export function readingOf(device: any): Reading | null {
  const serial = typeof device?.serialNumber === 'string' ? device.serialNumber.trim().toUpperCase() : '';
  if (!/^[A-Z0-9-]{6,40}$/.test(serial)) return null;
  const online = device?.online;
  const flag = online === 1 || online === true ? 1 : online === 0 || online === false ? 0 : null;
  if (flag === null) return null;
  return { serial, online: flag, d: detailsOf(device) };
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

/**
 * The address InHand's sign-in page sent the browser to, pasted back by the
 * owner. Only http://localhost or 127.0.0.1 on port 1024-65535 at /callback is
 * accepted (InHand's own CLI pattern). Returns the exact redirect address to
 * use for the code exchange, plus the code and state.
 */
export function parseLandedAddress(raw: string): { redirectUri: string; code: string; state: string } | null {
  let url: URL;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/callback') return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  if (!code || !/^[A-Za-z0-9_-]{20,100}$/.test(state)) return null;
  return { redirectUri: `http://${url.hostname}:${port}/callback`, code, state };
}

