// Saved Victron battery history for Helios units (cos-vrm-history), and the two checks drawn from it.
// Read-only and best-effort: when history cannot be read, the screens simply show no history.
import {readParentAccessToken} from './cosPowerAlarms';

export type HistoryPoint = [number, number | null, number | null, number | null]; // [epoch s, battery %, solar W, battery W]
export type UnitHistory = {installationId: number; name: string; points: HistoryPoint[]};
const URL_ = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-history';

/** Overnight is 8 PM to 7 AM local time. Under this battery % it is flagged. */
export const OVERNIGHT_LOW_PERCENT = 30;
/** Today's solar so far under this share of yesterday's by the same clock time is flagged. */
export const SOLAR_LOW_SHARE = 0.5;

const finite = (v: unknown, lo: number, hi: number) => v === null || typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export function parseHistory(value: unknown): UnitHistory[] {
  const v = value as {units?: unknown};
  if (!v || typeof v !== 'object' || !Array.isArray(v.units)) throw Error('History unavailable');
  return v.units.flatMap((u: any) => {
    if (!u || !Number.isSafeInteger(u.installationId) || typeof u.name !== 'string' || !Array.isArray(u.points)) return [];
    const points = u.points.filter((p: any) => Array.isArray(p) && p.length === 4 && Number.isSafeInteger(p[0]) &&
      finite(p[1], 0, 100) && finite(p[2], 0, 1e6) && finite(p[3], -1e6, 1e6)) as HistoryPoint[];
    return [{installationId: u.installationId, name: u.name, points: points.sort((a, b) => a[0] - b[0])}];
  });
}

export async function readVrmHistory(fetcher: typeof fetch = fetch, token?: string | null): Promise<UnitHistory[] | null> {
  try {
    const access = token === undefined ? await readParentAccessToken() : token;
    if (!access) return null;
    const response = await fetcher(URL_, {method: 'POST', headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'read'}), cache: 'no-store'});
    if (!response.ok) return null;
    return parseHistory(await response.json());
  } catch { return null; }
}

const at = (base: Date, dayOffset: number, hour: number) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.getTime() / 1000; };

/** The most recent 8 PM - 7 AM window that has started. */
export function overnightWindow(now: number): {from: number; to: number; done: boolean} {
  const today = new Date(now), hour = today.getHours();
  if (hour >= 20) return {from: at(today, 0, 20), to: at(today, 1, 7), done: false};
  if (hour < 7) return {from: at(today, -1, 20), to: at(today, 0, 7), done: false};
  return {from: at(today, -1, 20), to: at(today, 0, 7), done: true};
}

/** Lowest battery % in the last overnight window, when there is enough data (3+ points) to say so. */
export function overnightLow(points: HistoryPoint[], now: number): {low: number; at: number} | null {
  const w = overnightWindow(now);
  const night = points.filter(p => p[1] !== null && p[0] >= w.from && p[0] <= w.to);
  if (night.length < 3) return null;
  const min = night.reduce((a, b) => (b[1] as number) < (a[1] as number) ? b : a);
  return {low: Math.round(min[1] as number), at: min[0]};
}

/** Solar energy (Wh) between two times, from the points inside them. */
export function solarWh(points: HistoryPoint[], from: number, to: number): number | null {
  const inside = points.filter(p => p[2] !== null && p[0] >= from && p[0] <= to);
  if (inside.length < 4) return null;
  let wh = 0;
  for (let i = 1; i < inside.length; i++) {
    const gap = inside[i][0] - inside[i - 1][0];
    if (gap > 3 * 3600) continue; // a long gap is missing data, not darkness
    wh += ((inside[i][2] as number) + (inside[i - 1][2] as number)) / 2 * gap / 3600;
  }
  return wh;
}

/** Today's solar so far against yesterday's by the same clock time. Only after noon, and only when yesterday made real power. */
export function solarVsYesterday(points: HistoryPoint[], now: number): {today: number; yesterday: number; share: number} | null {
  const d = new Date(now);
  if (d.getHours() < 12) return null;
  const nowS = now / 1000, startToday = at(d, 0, 0), startYesterday = at(d, -1, 0);
  const today = solarWh(points, startToday, nowS), yesterday = solarWh(points, startYesterday, startYesterday + (nowS - startToday));
  if (today === null || yesterday === null || yesterday < 200) return null;
  return {today: Math.round(today), yesterday: Math.round(yesterday), share: today / yesterday};
}

export type HistoryFlag = {kind: 'overnight' | 'solar'; line: string};
export function historyFlags(points: HistoryPoint[], now: number): HistoryFlag[] {
  const flags: HistoryFlag[] = [];
  const night = overnightLow(points, now);
  if (night && night.low < OVERNIGHT_LOW_PERCENT) flags.push({kind: 'overnight', line: 'Dropped to ' + night.low + '% overnight'});
  const sun = solarVsYesterday(points, now);
  if (sun && sun.share < SOLAR_LOW_SHARE) flags.push({kind: 'solar', line: 'Solar ' + Math.round(sun.share * 100) + '% of yesterday (weather, dirt or shade)'});
  return flags;
}

/** The last 24 hours, for a chart. */
export function last24h(points: HistoryPoint[], now: number): HistoryPoint[] {
  const from = now / 1000 - 24 * 3600;
  return points.filter(p => p[0] >= from);
}
