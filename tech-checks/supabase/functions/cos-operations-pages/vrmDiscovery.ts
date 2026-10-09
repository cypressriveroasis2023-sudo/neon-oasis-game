import { heliosVrmUnits, validInstallationId, validVrmName, VRM_MAX_INSTALLATIONS, vrmPortalConfig, type VrmFleetConfig, type VrmInstallation, type VrmSync } from './vrm.ts';

const API = 'https://vrmapi.victronenergy.com/v2';
const RESPONSE_LIMIT = 2 * 1024 * 1024;
export const VRM_SYNC_INTERVAL_MS = 15 * 60 * 1000;
type ErrorCode = 'access' | 'rate_limit' | 'provider' | 'invalid_response' | 'account_changed' | 'storage';
const messages: Record<ErrorCode,string> = {
  access: 'Victron access could not be verified. Check the saved API connection and account permissions.',
  rate_limit: 'Victron is limiting requests. The last known fleet is retained until a later retry.',
  provider: 'Victron could not be reached. The last known fleet is retained.',
  invalid_response: 'Victron returned an incomplete installation list. The last known fleet is retained.',
  account_changed: 'The API connection belongs to a different Victron account. Review the connection before syncing.',
  storage: 'COS could not save the fleet refresh. The last known fleet is retained.',
};
export class VrmDiscoveryError extends Error {
  constructor(public code: ErrorCode, public retryAfterSeconds = 60) { super(messages[code]); }
}
export type DiscoveryResult = { userId: number; items: VrmInstallation[] };
export type VrmDiscoveryOptions = {
  fetch?: typeof fetch; getAccessToken: () => string | undefined;
  rpc: (name: string, payload: Record<string,unknown>) => Promise<unknown>;
  embeds?: string; now?: () => number;
};
type Snapshot = {
  items: VrmInstallation[]; lastAttemptAt: string | null; lastSuccessAt: string | null;
  errorCode: ErrorCode | null; retryAfterAt: string | null; syncing: boolean; scheduleActive: boolean;
};
const time = (v: unknown): v is string | null => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v));
function readSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  if (!s || !Array.isArray(s.items) || s.items.length > VRM_MAX_INSTALLATIONS || ![s.lastAttemptAt,s.lastSuccessAt,s.retryAfterAt].every(time) ||
    typeof s.syncing !== 'boolean' || typeof s.scheduleActive !== 'boolean' || s.errorCode !== null && !Object.hasOwn(messages,s.errorCode)) throw new VrmDiscoveryError('storage');
  // The public validator also verifies all IDs, names and duplicate identities.
  vrmPortalConfig(undefined,s.items);
  return s;
}
async function providerJson(fetcher: typeof fetch, path: string, token: string): Promise<Record<string,unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetcher(API + path, { method: 'GET', headers: { 'X-Authorization': 'Token ' + token, Accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new VrmDiscoveryError('access');
    if (response.status === 429) {
      const delay = Number(response.headers.get('retry-after'));
      throw new VrmDiscoveryError('rate_limit', Number.isFinite(delay) && delay > 0 ? Math.max(30,Math.min(86400,Math.ceil(delay))) : 900);
    }
    if (!response.ok) throw new VrmDiscoveryError('provider');
    if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT || !response.body) throw new VrmDiscoveryError('invalid_response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); let text = ''; let size = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
        if (size > RESPONSE_LIMIT) { await reader.cancel(); throw new VrmDiscoveryError('invalid_response'); }
        text += decoder.decode(chunk.value,{stream:true}); }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let result: unknown;
    try { result = JSON.parse(text); } catch { throw new VrmDiscoveryError('invalid_response'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new VrmDiscoveryError('invalid_response');
    const data = result as Record<string,unknown>;
    if (data.success !== true) throw new VrmDiscoveryError(data.success === false ? 'provider' : 'invalid_response');
    // The official endpoint is non-paginated. Never silently reconcile a newly paginated/partial shape.
    if (['next','nextPage','next_page','nextCursor','next_cursor','pagination','hasMore','has_more','links'].some(key => data[key] !== undefined && data[key] !== null && data[key] !== false)) throw new VrmDiscoveryError('invalid_response');
    return data;
  } catch (error) { if (error instanceof VrmDiscoveryError) throw error; throw new VrmDiscoveryError('provider'); }
  finally { clearTimeout(timer); }
}
export async function discoverVrmInstallations(token: string, fetcher: typeof fetch = fetch): Promise<DiscoveryResult> {
  if (!token || token.length > 8192 || /[\r\n]/.test(token)) throw new VrmDiscoveryError('access');
  const account = await providerJson(fetcher, '/users/me', token);
  const user = account.user as Record<string,unknown> | undefined;
  if (!validInstallationId(user?.id)) throw new VrmDiscoveryError('invalid_response');
  const result = await providerJson(fetcher, '/users/' + user.id + '/installations', token);
  if (!Array.isArray(result.records) || result.records.length > VRM_MAX_INSTALLATIONS) throw new VrmDiscoveryError('invalid_response');
  if (result.total !== undefined && result.total !== result.records.length || result.count !== undefined && result.count !== result.records.length) throw new VrmDiscoveryError('invalid_response');
  const seen = new Set<number>();
  const items = result.records.map(row => {
    if (!row || !validInstallationId(row.idSite) || seen.has(row.idSite) || !validVrmName(row.name)) throw new VrmDiscoveryError('invalid_response');
    seen.add(row.idSite);
    return { installationId: row.idSite, name: row.name };
  });
  return {userId:user.id,items};
}
export function createVrmFleetReader(options: VrmDiscoveryOptions) {
  const now = options.now || Date.now;
  const read = async () => readSnapshot(await options.rpc('cos_vrm_fleet_snapshot', {}));
  const present = (snapshot: Snapshot, configured: boolean): VrmFleetConfig => {
    const old = !snapshot.lastSuccessAt || now() - Date.parse(snapshot.lastSuccessAt) > 2 * VRM_SYNC_INTERVAL_MS;
    const sync: VrmSync = {
      state: !configured ? 'not_configured' : snapshot.syncing ? 'syncing' : snapshot.errorCode ? (snapshot.lastSuccessAt ? 'stale' : 'error') : old ? (snapshot.lastSuccessAt ? 'stale' : 'idle') : 'current',
      lastAttemptAt: snapshot.lastAttemptAt, lastSuccessAt: snapshot.lastSuccessAt, error: snapshot.errorCode ? messages[snapshot.errorCode] : null,
      nextSyncAt: snapshot.scheduleActive && configured ? new Date(Math.ceil(Math.max(now() + 1, snapshot.retryAfterAt ? Date.parse(snapshot.retryAfterAt) : 0) / VRM_SYNC_INTERVAL_MS) * VRM_SYNC_INTERVAL_MS).toISOString() : null,
      scheduleActive: snapshot.scheduleActive, connectionConfigured: configured,
    };
    return vrmPortalConfig(options.embeds,!snapshot.lastSuccessAt && !snapshot.items.length ? heliosVrmUnits : snapshot.items,sync);
  };
  return async (refresh = false): Promise<VrmFleetConfig> => {
    const token = options.getAccessToken();
    const configured = typeof token === 'string' && token.trim().length > 0;
    if (!refresh || !configured) return present(await read(),configured);
    const lease = await options.rpc('cos_vrm_fleet_begin', {}) as {leaseId?:unknown};
    if (lease?.leaseId === null) return present(await read(),configured);
    if (!lease || typeof lease.leaseId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lease.leaseId)) throw new VrmDiscoveryError('storage');
    try {
      const result = await discoverVrmInstallations(token!, options.fetch);
      const saved = await options.rpc('cos_vrm_fleet_finish', { p_lease_id: lease.leaseId, p_user_id: result.userId, p_items: result.items });
      if (saved !== true) throw new VrmDiscoveryError(saved === 'account_changed' ? 'account_changed' : 'storage');
    } catch (error) {
      const safe = error instanceof VrmDiscoveryError ? error : new VrmDiscoveryError('storage');
      await options.rpc('cos_vrm_fleet_fail', { p_lease_id: lease.leaseId, p_error_code: safe.code, p_retry_seconds: safe.retryAfterSeconds });
    }
    return present(await read(),configured);
  };
}
