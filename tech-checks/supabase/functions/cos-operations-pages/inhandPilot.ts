/** Disabled, read-only InHand pilot. No token discovery, refresh, polling, persistence, or unit mapping. */
export const INHAND_PILOT = Object.freeze({
  origin: 'https://iot.inhandnetworks.com',
  organizationId: '6606d46b1aed8800012d1840',
  deviceId: '693b0ed130c49e0001afb16f',
  serialNumber: 'RF3152533024049',
  accountId: '68de7fd03cdea20001c73077',
  accountEmail: 'jmartin@camerasonsite.com',
  observedRoleName: 'DeviceSense',
});
export const LOCATION_FRESHNESS_MS = 10 * 60 * 1000;
const MIN_STAMP_MS = Date.UTC(2000, 0, 1);
const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 128 * 1024;
type Row = Record<string, unknown>;
export type Freshness = 'fresh' | 'stale' | 'unknown';
export type PilotErrorCode = 'disabled' | 'review_required' | 'already_attempted' | 'not_configured' | 'claim_denied' | 'claim_unavailable' | 'provider_auth' | 'provider_unavailable' | 'provider_response' | 'identity_mismatch' | 'role_mismatch' | 'device_mismatch';
const ERROR_MESSAGES: Record<PilotErrorCode, string> = {
  disabled: 'The InHand pilot is disabled.',
  review_required: 'The InHand pilot identity, role, and response contract still require verification.',
  already_attempted: 'This pilot instance has already attempted its controlled read.',
  not_configured: 'The InHand pilot credential is not configured.',
  claim_denied: 'The one-use InHand pilot is not armed, has expired, or has already been attempted.',
  claim_unavailable: 'The one-use InHand pilot claim could not be verified. No provider request was made.',
  provider_auth: 'InHand authorization was rejected. The pilot did not refresh or retry.',
  provider_unavailable: 'InHand could not be read. The pilot did not retry.',
  provider_response: 'InHand returned an unsupported response. No telemetry was accepted.',
  identity_mismatch: 'The InHand account or organization did not match the reviewed pilot.',
  role_mismatch: 'The InHand role did not match the reviewed pilot.',
  device_mismatch: 'The InHand device identity did not match the reviewed pilot.',
};
export class InhandPilotError extends Error {
  readonly code: PilotErrorCode;
  readonly status: number;
  constructor(code: PilotErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'InhandPilotError';
    this.code = code;
    this.status = ['disabled', 'review_required', 'not_configured', 'already_attempted', 'claim_denied', 'claim_unavailable'].includes(code) ? 503 : 502;
  }
}
const fail = (code: PilotErrorCode): never => { throw new InhandPilotError(code); };
const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
/** Accept only the two narrow shapes supported by the observed CLI flow; never recursively unwrap. */
export function unwrapInhandResponse(value: unknown): Row {
  if (!isRow(value)) return fail('provider_response');
  if (Object.hasOwn(value, 'result')) {
    if (Object.keys(value).length !== 1 || !isRow(value.result)) return fail('provider_response');
    return value.result;
  }
  return value;
}
/** Numeric info.updatedAt/updateTime were observed as Unix SECONDS, never guessed as milliseconds. */
export function readUnixSeconds(value: unknown, now: number): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  const ms = value * 1000;
  if (!Number.isSafeInteger(ms) || ms < MIN_STAMP_MS || ms > now) return null;
  return new Date(ms).toISOString();
}
/** Verified location.time/logtime schema is UTC ISO text. Reject normalized impossible dates. */
export function readUtcTimestamp(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < MIN_STAMP_MS || ms > now) return null;
  const canonical = new Date(ms).toISOString();
  const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, digits) => '.' + digits.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
  return canonical === normalized ? canonical : null;
}
function ipv4(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
  return value.split('.').every(part => Number(part) <= 255) ? value : null;
}
export function freshness(observedAt: string | null, now: number): Freshness {
  if (!observedAt) return 'unknown';
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms) || ms > now) return 'unknown';
  return now - ms <= LOCATION_FRESHNESS_MS ? 'fresh' : 'stale';
}
export type InhandPilotSnapshot = {
  source: 'inhand'; version: 1; fetchedAt: string;
  identity: { deviceId: string; serialNumber: string; name: string | null };
  connection: { reportedStatus: 'online' | 'offline' | 'unknown'; statusObservedAt: null; freshness: 'unknown'; independentlyProbed: false };
  network: { publicIp: string | null; wanIp: string | null; infoUpdatedAt: string | null };
  location: null | { latitude: number; longitude: number; source: 'cellTower'; observedAt: string; freshness: Freshness; accuracyM: null; address: string | null };
  locationUnavailableReason: null | 'missing' | 'invalid_coordinates' | 'unverified_source' | 'invalid_timestamp';
  providerTimes: { infoUpdatedAt: string | null; profileUpdatedAt: string | null; logtime: string | null };
  mapping: { status: 'not_mapped'; cosUnitId: null };
};
export function verifyInhandIdentity(value: unknown): void {
  const account = unwrapInhandResponse(value);
  if (account._id !== INHAND_PILOT.accountId || account.oid !== INHAND_PILOT.organizationId || account.email !== INHAND_PILOT.accountEmail) fail('identity_mismatch');
  // DeviceSense matches this account’s verified UI Device Monitor role; it is not a permission/scope guarantee.
  if (account.roleName !== INHAND_PILOT.observedRoleName || account.isRoot !== false) fail('role_mismatch');
}
export function inhandPilotSnapshot(value: unknown, now = new Date()): InhandPilotSnapshot {
  if (!Number.isFinite(now.getTime())) fail('provider_response');
  const device = unwrapInhandResponse(value);
  if (device._id !== INHAND_PILOT.deviceId || device.serialNumber !== INHAND_PILOT.serialNumber || device.oid !== INHAND_PILOT.organizationId) fail('device_mismatch');
  const info = isRow(device.info) ? device.info : {};
  const wan = isRow(info.wan) ? info.wan : {};
  const infoUpdatedAt = readUnixSeconds(info.updatedAt, +now);
  let location: InhandPilotSnapshot['location'] = null;
  let locationUnavailableReason: InhandPilotSnapshot['locationUnavailableReason'] = 'missing';
  if (isRow(device.location)) {
    const { latitude, longitude, source, time } = device.location;
    const observedAt = readUtcTimestamp(time, +now);
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) locationUnavailableReason = 'invalid_coordinates';
    else if (source !== 'cellTower') locationUnavailableReason = 'unverified_source';
    else if (!observedAt) locationUnavailableReason = 'invalid_timestamp';
    else {
      location = { latitude, longitude, source, observedAt, freshness: freshness(observedAt, +now), accuracyM: null, address: cleanText(device.address, 512) };
      locationUnavailableReason = null;
    }
  }
  return {
    source: 'inhand', version: 1, fetchedAt: now.toISOString(),
    identity: { deviceId: device._id as string, serialNumber: device.serialNumber as string, name: cleanText(device.name, 160) },
    connection: { reportedStatus: device.online === 1 ? 'online' : device.online === 0 ? 'offline' : 'unknown', statusObservedAt: null, freshness: 'unknown', independentlyProbed: false },
    network: { publicIp: ipv4(device.pubIp), wanIp: ipv4(wan.ip), infoUpdatedAt },
    location, locationUnavailableReason,
    providerTimes: { infoUpdatedAt, profileUpdatedAt: readUnixSeconds(device.updateTime, +now), logtime: readUtcTimestamp(device.logtime, +now) },
    mapping: { status: 'not_mapped', cosUnitId: null },
  };
}
export type InhandPilotOptions = {
  enabled?: boolean;
  /** Only set after role permissions, actual identity JSON and device envelope were reviewed. Not a runtime permission check. */
  contractReviewed?: boolean;
  /** Server-only injection; never discover credentials or read a CLI config. */
  getAccessToken?: () => string | undefined;
  /** Durable atomic claim; true only after its transaction commits. No retry or reset. */
  claimAttempt?: (verifiedOwnerId: string) => Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => Date;
};
/** Must be called ONLY after the existing active same-person COS Owner gate. */
export function createInhandPilotReader(options: InhandPilotOptions = {}) {
  const requestFetch = options.fetch || fetch;
  let attempted = false; // Instance-local safety only. NOT a durable/global one-use authorization gate.
  return async (verifiedOwnerId: string): Promise<InhandPilotSnapshot> => {
    if (options.enabled !== true) fail('disabled');
    if (options.contractReviewed !== true) fail('review_required');
    if (attempted) fail('already_attempted');
    attempted = true; // Consume before awaiting, including failed attempts; no concurrent replay.
    const claimAttempt = options.claimAttempt;
    if (!claimAttempt) return fail('claim_unavailable');
    let claimed = false;
    try { claimed = await claimAttempt(verifiedOwnerId); } catch { fail('claim_unavailable'); }
    if (claimed !== true) { attempted = false; fail('claim_denied'); }
    let token: string | undefined;
    try { token = options.getAccessToken?.(); } catch { fail('not_configured'); }
    if (!token || token.length < 16 || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) fail('not_configured');
    const accessToken = token as string;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const read = async (path: '/api/users/this?verbose=100' | `/api/devices/${string}?verbose=100`) => {
      let response: Response;
      try {
        response = await requestFetch(INHAND_PILOT.origin + path, {
          method: 'GET', headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
          redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
      } catch { return fail('provider_unavailable'); }
      if (response.status === 401 || response.status === 403) { void response.body?.cancel().catch(() => {}); return fail('provider_auth'); }
      if (response.status !== 200 || response.redirected || (response.url && response.url !== INHAND_PILOT.origin + path)) { void response.body?.cancel().catch(() => {}); return fail('provider_unavailable'); }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || '') || Number(response.headers.get('Content-Length')) > MAX_BODY_BYTES || !response.body) { void response.body?.cancel().catch(() => {}); return fail('provider_response'); }
      const reader = response.body.getReader();
      let size = 0, body = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BODY_BYTES) { void reader.cancel().catch(() => {}); return fail('provider_response'); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } catch { return fail('provider_response'); }
      finally { reader.releaseLock(); }
      try { return JSON.parse(body) as unknown; } catch { return fail('provider_response'); }
    };
    try {
      verifyInhandIdentity(await read('/api/users/this?verbose=100'));
      const snapshot = inhandPilotSnapshot(await read(`/api/devices/${INHAND_PILOT.deviceId}?verbose=100`), options.now?.() || new Date());
      // A hostile provider value must not smuggle the access token through even an allowlisted text field.
      const containsCredential = (value: unknown): boolean => typeof value === 'string' ? value.includes(accessToken) : isRow(value) ? Object.values(value).some(containsCredential) : false;
      if (containsCredential(snapshot)) fail('provider_response');
      return snapshot;
    } catch (error) {
      if (error instanceof InhandPilotError) throw error;
      return fail('provider_unavailable'); // Never forward raw transport, parse, header, or provider errors.
    } finally {
      clearTimeout(timeout);
      controller.abort();
      token = undefined;
    }
  };
}

/** A control RPC returns only a JSON boolean; bound its bytes and lifetime before trusting it. */
export async function readPilotClaimBoolean(response: Response, signal: AbortSignal): Promise<boolean> {
  const length = response.headers.get('Content-Length');
  if (response.status !== 200 || response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type') || '') || !response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > 16))) {
    void response.body?.cancel().catch(() => {}); return fail('claim_unavailable');
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let result = '', size = 0;
  try {
    while (true) {
      if (signal.aborted) return fail('claim_unavailable');
      const chunk = await reader.read();
      if (signal.aborted) return fail('claim_unavailable');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16) { void reader.cancel().catch(() => {}); return fail('claim_unavailable'); }
      result += new TextDecoder('utf-8', { fatal: true }).decode(chunk.value);
    }
    if (!['true', 'false'].includes(result.trim())) return fail('claim_unavailable');
    return result.trim() === 'true';
  } catch { return fail('claim_unavailable'); }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

