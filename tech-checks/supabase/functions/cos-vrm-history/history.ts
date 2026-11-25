// Victron battery history for Helios units: the pure parts, kept separate so they can be tested without Deno.
//
// Access is decided by the Operations function, not here. This function asks it the exact question the
// Victron Power page asks (a read of /api/vrm-fleet) with the caller's own token and origin, and serves
// history only on a plain yes. A genuine 401/403 from Operations is passed through unchanged; any other
// failure becomes 503. The app reads this outside its main request path, so no answer here can sign anyone out.

export const ALLOWED_ORIGINS = new Set([
  'https://cypressriveroasis2023-sudo.github.io',
  'https://cos-vision-integration-preview.pages.dev',
]);
export const HISTORY_HOURS = 48;

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = !origin || ALLOWED_ORIGINS.has(origin);
  return {
    ...(allowed ? {'Access-Control-Allow-Origin': origin || 'https://cypressriveroasis2023-sudo.github.io'} : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  };
}

/** The app asks with {"action":"read"} and nothing else. */
export function isHistoryRequest(text: string): boolean {
  if (text.length > 200) return false;
  try {
    const v = JSON.parse(text);
    return !!v && typeof v === 'object' && !Array.isArray(v) && v.action === 'read' && Object.keys(v).length === 1;
  } catch { return false; }
}

/** What the Operations answer means for this request. */
export function gateVerdict(status: number): 'allow' | 'denied' | 'unavailable' {
  return status === 200 ? 'allow' : status === 401 || status === 403 ? 'denied' : 'unavailable';
}

export type VrmHistoryPoint = [number, number | null, number | null, number | null];
export type VrmHistory = {hours: number; units: {installationId: number; name: string; points: VrmHistoryPoint[]}[]};
const num = (v: unknown, lo: number, hi: number) => v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/** Bounded, numeric only. Points are [epoch seconds, battery %, solar W, battery W]. */
export function safeVrmHistory(value: unknown, now = Date.now()): VrmHistory {
  const v = value as {hours?: unknown; units?: unknown};
  if (!v || typeof v !== 'object' || !Number.isInteger(v.hours) || (v.hours as number) < 1 || (v.hours as number) > 168 || !Array.isArray(v.units) || v.units.length > 200) throw Error('History unavailable');
  const seen = new Set<number>();
  const units = v.units.map((u: any) => {
    if (!u || !Number.isSafeInteger(u.installationId) || u.installationId < 1 || seen.has(u.installationId) || typeof u.name !== 'string' ||
      !/^HELIOS\s+\d{1,3}$/i.test(u.name) || !Array.isArray(u.points) || u.points.length > 2000) throw Error('History inconsistent');
    seen.add(u.installationId);
    const points = u.points.map((p: any): VrmHistoryPoint => {
      if (!Array.isArray(p) || p.length !== 4 || !Number.isSafeInteger(p[0]) || p[0] < 946684800 || p[0] > now / 1000 + 300) throw Error('History point invalid');
      const soc = num(p[1], 0, 100), solar = num(p[2], 0, 1000000), battery = num(p[3], -1000000, 1000000);
      if (soc === undefined || solar === undefined || battery === undefined) throw Error('History point invalid');
      return [p[0], soc, solar, battery];
    });
    return {installationId: u.installationId, name: u.name, points};
  });
  return {hours: v.hours as number, units};
}
