// cos-vrm-mppt-sync: extra solar-charger (MPPT) readings for Helios units. Read-only at Victron.
//
// Deliberately separate from cos-vrm-fleet-sync. That sync and its database step accept only a fixed set of
// readings and reject anything else, so new readings are collected here and saved in their own tables.
// Nothing the Victron page already uses is read differently or written by this function.
//
// It keeps numbers only: a path name Victron publishes for the charger, a numeric value and Victron's timestamp.
const API = 'https://vrmapi.victronenergy.com/v2';
const MAX_BYTES = 2 * 1024 * 1024, PAGE_SIZE = 500, MAX_PAGES = 4;
export const MPPT_MAX_UNITS = 100, MPPT_BUDGET_MS = 100_000, MPPT_GAP_MS = 350;

/** Solar-charger readings worth keeping, with sane bounds. Anything else is counted by name only. */
export const MPPT_PATHS: Record<string, {min: number; max: number}> = {
  '/Pv/V': {min: 0, max: 500}, '/Pv/I': {min: 0, max: 500},
  '/Pv/0/V': {min: 0, max: 500}, '/Pv/1/V': {min: 0, max: 500},
  '/Dc/0/Voltage': {min: 0, max: 200}, '/Dc/0/Current': {min: -1000, max: 1000},
  '/State': {min: 0, max: 300}, '/ErrorCode': {min: 0, max: 300}, '/MppOperationMode': {min: 0, max: 10},
  '/History/Daily/0/Yield': {min: 0, max: 1000}, '/History/Daily/0/MaxPower': {min: 0, max: 100000},
  '/History/Daily/1/Yield': {min: 0, max: 1000}, '/History/Daily/1/MaxPower': {min: 0, max: 100000},
  '/Yield/User': {min: 0, max: 10000000},
  // The load output (GAGO DD3: the switchable output), to learn what it feeds. Read only.
  '/Load/State': {min: 0, max: 10}, '/Load/I': {min: -100, max: 100}, '/Mode': {min: 0, max: 10}, '/DeviceOffReason': {min: 0, max: 100000},
};
export type MpptRow = {installationId: number; instance: number; path: string; value: number; observedAt: string};
const PATH_NAME = /^\/[A-Za-z0-9/]{1,60}$/;

/** Newest value per charger and kept path, plus the names of every path the chargers publish (names only). */
export function parseMpptRecords(records: unknown, installationId: number, now = Date.now()): {rows: MpptRow[]; paths: string[]} {
  if (!Array.isArray(records) || records.length > PAGE_SIZE * MAX_PAGES) throw Error('invalid_response');
  const found = new Map<string, MpptRow>(), names = new Set<string>();
  for (const candidate of records) {
    if (!candidate || typeof candidate !== 'object') continue;
    const r = candidate as Record<string, unknown>;
    if (r.idSite !== installationId || r.dbusServiceType !== 'solarcharger') continue;
    if (!Number.isSafeInteger(r.instance) || Number(r.instance) < 0 || Number(r.instance) > 1000) continue;
    const path = typeof r.dbusPath === 'string' ? r.dbusPath : '';
    if (!PATH_NAME.test(path)) continue;
    if (names.size < 150) names.add(path);
    const bounds = Object.hasOwn(MPPT_PATHS, path) ? MPPT_PATHS[path] : null;
    if (!bounds) continue;
    if (typeof r.rawValue !== 'number' && typeof r.rawValue !== 'string' || r.rawValue === '' || typeof r.rawValue === 'string' && !/^-?\d+(?:\.\d+)?$/.test(r.rawValue)) continue;
    const value = Number(r.rawValue), stamp = Number(r.timestamp) * 1000;
    if (!Number.isFinite(value) || value < bounds.min || value > bounds.max || !Number.isFinite(stamp) || stamp < Date.UTC(2000, 0, 1) || stamp > now + 300000) continue;
    const row: MpptRow = {installationId, instance: Number(r.instance), path, value, observedAt: new Date(stamp).toISOString()};
    const key = row.instance + '|' + path, prior = found.get(key);
    if (!prior || Date.parse(prior.observedAt) < stamp) found.set(key, row);
  }
  return {rows: [...found.values()].sort((a, b) => a.instance - b.instance || a.path.localeCompare(b.path)).slice(0, 60), paths: [...names].sort()};
}

async function diagnosticPage(id: number, page: number, token: string, fetcher: typeof fetch): Promise<{records: unknown[]; total: number}> {
  const response = await fetcher(API + '/installations/' + id + '/diagnostics?count=' + PAGE_SIZE + '&page=' + page,
    {method: 'GET', headers: {'X-Authorization': 'Token ' + token, Accept: 'application/json'}, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8500)});
  if (response.status === 401 || response.status === 403) throw Error('access');
  if (response.status === 429) throw Error('rate_limit');
  if (!response.ok) throw Error('provider');
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw Error('invalid_response');
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const c = await reader.read(); if (c.done) break; bytes += c.value.byteLength; if (bytes > MAX_BYTES) { await reader.cancel(); throw Error('invalid_response'); } parts.push(c.value); }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes); let pos = 0; for (const p of parts) { buffer.set(p, pos); pos += p.byteLength; }
  let data: Record<string, unknown>;
  try { data = JSON.parse(new TextDecoder().decode(buffer)); } catch { throw Error('invalid_response'); }
  if (!data || data.success !== true) throw Error('invalid_response');
  const records = Array.isArray(data.records) ? data.records : data.records && typeof data.records === 'object' && 'idSite' in data.records ? [data.records] : null;
  if (!records || records.length > PAGE_SIZE || !Number.isSafeInteger(data.num_records) || Number(data.num_records) < 0 || Number(data.num_records) > PAGE_SIZE * MAX_PAGES) throw Error('invalid_response');
  return {records, total: Number(data.num_records)};
}

/** One installation's charger readings. Throws 'access' | 'rate_limit' | 'provider' | 'invalid_response'. */
export async function readInstallationMppt(id: number, token: string, fetcher: typeof fetch = fetch, now = Date.now()) {
  const all: unknown[] = []; let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await diagnosticPage(id, page, token, fetcher);
    if (page === 1) total = data.total; else if (data.total !== total) throw Error('invalid_response');
    all.push(...data.records);
    if (all.length >= total) break;
    if (!data.records.length) throw Error('invalid_response');
  }
  if (all.length < total) throw Error('invalid_response');
  return parseMpptRecords(all, id, now);
}

type Options = {
  platformUrl: string; serviceKey: string; getAccessToken: () => string | undefined;
  fetch?: typeof fetch; wait?: (ms: number) => Promise<void>; clock?: () => number;
};
export function createMpptSyncHandler(options: Options) {
  const fetcher = options.fetch || fetch, clock = options.clock || Date.now;
  const wait = options.wait || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const rpc = async (name: string, payload: Record<string, unknown>): Promise<unknown> => {
    const response = await fetcher(options.platformUrl + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: {apikey: options.serviceKey, Authorization: 'Bearer ' + options.serviceKey, 'Content-Type': 'application/json'},
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('storage');
    return response.json();
  };
  return async (request: Request): Promise<Response> => {
    const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
    if (request.method !== 'POST' || new URL(request.url).search || request.headers.has('origin')) return reply({error: 'Scheduled request required'}, 405);
    const secret = request.headers.get('x-cos-vrm-sync');
    if (!secret || !/^[0-9a-f]{64}$/.test(secret)) return reply({error: 'Unauthorized'}, 401);
    try {
      // The same scheduler credential check the fleet sync uses. The credential never leaves the database vault.
      if (await rpc('cos_vrm_scheduler_authorized', {p_secret: secret}) !== true) return reply({error: 'Unauthorized'}, 401);
      if (Number(request.headers.get('content-length')) > 128) return reply({error: 'Invalid request'}, 400);
      const token = options.getAccessToken();
      if (typeof token !== 'string' || !token.trim() || token.length > 8192 || /[\r\n]/.test(token)) return reply({ok: false, state: 'not_configured'}, 503);
      // Stand back whenever the fleet sync is running, failing or being rate limited: it always comes first.
      const targets = await rpc('cos_vrm_mppt_targets', {}) as {ready?: unknown; ids?: unknown};
      if (!targets || targets.ready !== true) return reply({ok: true, state: 'skipped', units: 0, rows: 0});
      const ids = Array.isArray(targets.ids) ? targets.ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, MPPT_MAX_UNITS) : [];
      const rows: MpptRow[] = [], paths = new Set<string>(), start = clock();
      let units = 0, stopped: string | null = null;
      for (const [index, id] of ids.entries()) {
        if (clock() - start > MPPT_BUDGET_MS) { stopped = 'budget'; break; }
        try {
          const one = await readInstallationMppt(id, token, fetcher, clock());
          rows.push(...one.rows); for (const p of one.paths) if (paths.size < 150) paths.add(p);
          units++;
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          // A bad answer for one unit is skipped. Trouble with Victron itself stops the run.
          if (code !== 'invalid_response') { stopped = ['access', 'rate_limit'].includes(code) ? code : 'provider'; break; }
        }
        if (index < ids.length - 1) await wait(MPPT_GAP_MS);
      }
      const saved = rows.length || paths.size ? await rpc('cos_vrm_mppt_save', {p_rows: rows.slice(0, 2000), p_paths: [...paths].sort()}) : 0;
      // Scheduled callers receive counts only: no names, readings, account details or credentials.
      return reply({ok: !stopped, state: stopped ?? 'current', units, rows: typeof saved === 'number' ? saved : 0}, stopped && stopped !== 'budget' ? 503 : 200);
    } catch { return reply({error: 'MPPT sync unavailable'}, 503); }
  };
}
