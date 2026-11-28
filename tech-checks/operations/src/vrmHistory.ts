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

/* ---------- Early warnings: didn't fill up, using more power than usual ---------- */
export const FULL_PERCENT = 95;          // a healthy day gets the battery to at least this
export const LOAD_RATIO = 1.5;           // "more than usual" = 1.5x its normal night draw ...
export const LOAD_EXTRA_W = 10;          // ... and at least 10 W more

/**
 * The most recent daytime (7 AM - 5 PM) that has finished, and the highest battery % reached in it.
 * Needs 8+ readings spread over 6+ hours, so a unit that was off most of the day is not judged.
 */
export function dayPeak(points: HistoryPoint[], now: number): {peak: number; label: 'today' | 'yesterday'} | null {
  const d = new Date(now), h = d.getHours();
  if (h >= 7 && h < 17) return null;                       // judge only after the sun is done
  const off = h >= 17 ? 0 : -1, from = at(d, off, 7), to = at(d, off, 17);
  const day = points.filter(p => p[1] !== null && p[0] >= from && p[0] <= to);
  if (day.length < 8 || day[day.length - 1][0] - day[0][0] < 6 * 3600) return null;
  return {peak: Math.round(Math.max(...day.map(p => p[1] as number))), label: off === 0 ? 'today' : 'yesterday'};
}

/**
 * Yesterday (7 AM - 5 PM) the battery sat below 90% at some point, so the panels had work to do.
 * A unit that stayed full (on outside power, or barely used) makes little because it needed little.
 * Needs 8+ readings; without them the answer is no.
 */
export function hadRoomYesterday(points: readonly HistoryPoint[] | null | undefined, now: number, dayOffset: 0 | -1 = -1): boolean {
  if (!points?.length) return false;
  // dayOffset 0 asks about today instead: late in the evening the charger's newest finished day is today.
  const d = new Date(now), from = at(d, dayOffset, 7), to = at(d, dayOffset, 17);
  const day = points.filter(p => p[1] !== null && p[0] >= from && p[0] <= to);
  return day.length >= 8 && Math.min(...day.map(p => p[1] as number)) < 90;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Power the unit pulls from its battery when there is no sun (W, positive), from one reading. */
const nightDraw = (p: HistoryPoint): number | null => p[3] !== null && p[3] < 0 && (p[2] ?? 0) < 5 ? -p[3] : null;

/**
 * Night power use over the last 2 hours against this unit's own normal (median of its earlier no-sun readings,
 * 6 hours to 7 days old). Needs 4+ recent and 12+ normal readings.
 */
export function nightLoad(points: HistoryPoint[], now: number): {recent: number; normal: number; high: boolean} | null {
  const nowS = now / 1000;
  const recent = points.filter(p => p[0] >= nowS - 2 * 3600 && p[0] <= nowS + 300).map(nightDraw).filter((w): w is number => w !== null);
  const before = points.filter(p => p[0] < nowS - 6 * 3600 && p[0] >= nowS - 7 * 86400).map(nightDraw).filter((w): w is number => w !== null);
  if (recent.length < 4 || before.length < 12) return null;
  const r = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length), n = Math.round(median(before));
  return {recent: r, normal: n, high: n > 0 && r >= n * LOAD_RATIO && r - n >= LOAD_EXTRA_W};
}

export type HistoryFlag = {kind: 'overnight' | 'notfull' | 'load' | 'solar'; line: string};
export function historyFlags(points: HistoryPoint[], now: number): HistoryFlag[] {
  const flags: HistoryFlag[] = [];
  const night = overnightLow(points, now);
  if (night && night.low < OVERNIGHT_LOW_PERCENT) flags.push({kind: 'overnight', line: 'Dropped to ' + night.low + '% overnight'});
  const day = dayPeak(points, now);
  if (day && day.peak < FULL_PERCENT) flags.push({kind: 'notfull', line: "Didn't fill up " + day.label + ' · best was ' + day.peak + '%'});
  const load = nightLoad(points, now);
  if (load?.high) flags.push({kind: 'load', line: 'Using more power than usual · ' + load.recent + ' W vs normal ' + load.normal + ' W'});
  const sun = solarVsYesterday(points, now);
  if (sun && sun.share < SOLAR_LOW_SHARE) flags.push({kind: 'solar', line: 'Solar ' + Math.round(sun.share * 100) + '% of yesterday (weather, dirt or shade)'});
  return flags;
}

/** The last 24 hours, for a chart. */
export function last24h(points: HistoryPoint[], now: number): HistoryPoint[] {
  const from = now / 1000 - 24 * 3600;
  return points.filter(p => p[0] >= from);
}

/* ---------- Tonight: will this Helios make it to sunrise? ---------- */
export const NIGHT_FLOOR_PERCENT = 20;   // "will run low" means reaching this before morning
export const NIGHT_TIGHT_PERCENT = 30;   // under this at 7 AM is "tight"
export type TonightVerdict = 'ok' | 'tight' | 'low' | 'charging';
export type Tonight = {
  verdict: TonightVerdict;
  battery: number;          // battery % now (newest point)
  ratePerHour: number;      // % per hour over the last 2 hours (negative = draining)
  atMorning: number;        // estimated % at 7 AM (0..100)
  floorAt: number | null;   // epoch s when it reaches 20%, if before 7 AM
  morning: number;          // epoch s of the 7 AM being forecast
  lowerBy?: number;         // points the system number is running ahead of the energy that actually went in (see systemLead)
};

const nextSeven = (now: number) => { const d = new Date(now); const t = new Date(d); t.setHours(7, 0, 0, 0); if (d.getHours() >= 7) t.setDate(t.getDate() + 1); return t.getTime() / 1000; };

/**
 * How far the system's battery number is running AHEAD of the energy that really went in, in points.
 *
 * Why: the system number is right once a battery is full, and right on the way down (every Field unit gives
 * 28-30 Wh per 1% at night). On the way up it runs ahead. HELIOS 004, 009 and 019 jump from about 87% straight
 * to 100% when the sun comes up and then keep taking 100-300 W for three hours; the others climb about 20% too
 * fast and take a last 3% after reading 100%. On a sunny day the battery catches up by noon and this is 0 again.
 * After a cloudy day it is not, and the system would start the night claiming more than is there.
 *
 * How: walk the saved readings. On every charging step, add what the number gained and take off what the energy
 * explains; that covers the jump, the too-fast climb and the catching-up at 100% in one rule. Discharging is left
 * alone. A battery sitting at 100% around midday and taking nothing for 45 minutes is full: back to 0. Gaps over an
 * hour are skipped. Anything under SYSTEM_LEAD_MIN points is noise and reads as 0.
 */
export const WH_PER_POINT = 29.5;
export const SYSTEM_LEAD_MIN = 4;
export const SYSTEM_LEAD_MAX = 40;
export function systemLead(points: readonly HistoryPoint[] | null | undefined, now: number): number {
  if (!points?.length) return 0;
  const pts = points.filter(p => p[1] !== null && p[0] <= now / 1000 + 300);
  let lead = 0, idleAtTop = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], hours = (b[0] - a[0]) / 3600;
    if (hours <= 0 || hours > 1 || a[3] === null || b[3] === null) { idleAtTop = 0; continue; }
    const watts = (a[3] + b[3]) / 2, real = watts * hours / WH_PER_POINT;   // points the energy explains (+ in, - out)
    const rise = (b[1] as number) - (a[1] as number);
    if (real > 0) lead += rise - real;            // charging: ahead by whatever the energy does not explain
    else if (rise >= 3) lead += rise;             // a jump with no energy behind it at all
    const hour = new Date(b[0] * 1000).getHours();
    idleAtTop = (a[1] as number) >= 99.5 && (b[1] as number) >= 99.5 && Math.abs(watts) <= 10 && hour >= 10 && hour < 15 ? idleAtTop + 1 : 0;
    if (idleAtTop >= 3) lead = 0;                 // at the top at midday and taking nothing: full
    lead = Math.max(-2, Math.min(SYSTEM_LEAD_MAX, lead));   // a little slack below zero; extra energy is not banked
  }
  return lead >= SYSTEM_LEAD_MIN ? Math.round(lead) : 0;
}

/** True from 5 PM to 7 AM local, when the sun can no longer refill the battery and a forecast means something. */
export function isNightForecastTime(now: number): boolean { const h = new Date(now).getHours(); return h >= 17 || h < 7; }

/**
 * Straight-line forecast from the last 2 hours of battery readings (needs 4+ readings over 45+ minutes,
 * the newest no older than 45 minutes). Only from 5 PM to 7 AM. Returns null when there is not enough to go on.
 */
export function tonightForecast(points: HistoryPoint[], now: number, lowerBy = 0): Tonight | null {
  if (!isNightForecastTime(now)) return null;
  const nowS = now / 1000;
  const recent = points.filter(p => p[1] !== null && p[0] >= nowS - 2 * 3600 && p[0] <= nowS + 300);
  if (recent.length < 4) return null;
  const first = recent[0], last = recent[recent.length - 1];
  if (last[0] - first[0] < 45 * 60 || nowS - last[0] > 45 * 60) return null;
  // Least-squares slope in % per hour.
  const xs = recent.map(p => (p[0] - first[0]) / 3600), ys = recent.map(p => p[1] as number);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const rate = den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0;
  // The saved history is the system's charge. When it has run ahead of the energy that really went in
  // (systemLead), the estimate starts from the lower level and keeps the measured rate of loss.
  const off = lowerBy > 0 ? lowerBy : 0, extra = off ? {lowerBy: Math.round(off)} : {};
  const battery = Math.max(0, (last[1] as number) - off), morning = nextSeven(now);
  const hours = Math.max(0, (morning - last[0]) / 3600);
  const atMorning = Math.max(0, Math.min(100, battery + rate * hours));
  if (rate >= -0.2) return {verdict: 'charging', battery: Math.round(battery), ratePerHour: Math.round(rate * 10) / 10, atMorning: Math.round(atMorning), floorAt: null, morning, ...extra};
  const toFloor = battery > NIGHT_FLOOR_PERCENT ? (battery - NIGHT_FLOOR_PERCENT) / -rate : 0;
  const floorAt = last[0] + toFloor * 3600;
  const verdict: TonightVerdict = floorAt < morning ? 'low' : atMorning < NIGHT_TIGHT_PERCENT ? 'tight' : 'ok';
  return {verdict, battery: Math.round(battery), ratePerHour: Math.round(rate * 10) / 10, atMorning: Math.round(atMorning), floorAt: floorAt < morning ? Math.round(floorAt) : null, morning, ...extra};
}

const clock = (s: number) => new Date(s * 1000).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});

/** One plain sentence a tech can act on. */
export function tonightHeadline(t: Tonight): string {
  if (t.verdict === 'charging') return 'Holding steady — not losing charge right now.';
  if (t.verdict === 'ok') return 'Should make it to morning — about ' + t.atMorning + '% at 7 AM.';
  if (t.verdict === 'tight') return 'Tight — about ' + t.atMorning + '% at 7 AM. Check again before bed.';
  return t.floorAt !== null && t.battery <= NIGHT_FLOOR_PERCENT ? 'Already at ' + t.battery + '% and still dropping.' : 'Will run low — reaches 20% around ' + clock(t.floorAt as number) + '.';
}

/** The why, in one short line. */
export function tonightBasis(t: Tonight): string {
  const rate = Math.abs(t.ratePerHour);
  return 'Battery ' + (t.lowerBy ? 'about ' : '') + t.battery + '% now' + (t.lowerBy ? ' by the energy that went in (the system says ' + Math.min(100, t.battery + t.lowerBy) + '%, but it jumped ahead while charging)' : '') + ', ' + (t.ratePerHour < 0 ? 'losing about ' + rate + '% an hour' : t.ratePerHour > 0 ? 'gaining about ' + rate + '% an hour' : 'flat') + ' over the last 2 hours.';
}

/** What a tech should do about it, short and in order. Empty when nothing needs doing. */
export function tonightSteps(t: Tonight): string[] {
  if (t.verdict === 'charging' || t.verdict === 'ok') return [];
  if (t.verdict === 'tight') return [
    'Look again before end of shift — the estimate updates every 15 minutes.',
    'If it keeps dropping faster, treat it as "Will run low".',
  ];
  return [
    'Check its cameras now on the COS Board. If they go down overnight, low power is the likely cause.',
    'Look at today\'s solar on the chart. Little or no solar means dirty or shaded panels, or a charger problem.',
    'Check the load. A heater, extra camera or bad device can drain the battery fast.',
    'If it cannot make it, plan a battery swap or site visit the way you normally would, and note it on the IT sheet.',
  ];
}

/** "Without sun": how long a unit runs on its battery alone, at its own all-day use, with no solar at all.
 * Use = after-dark draw for the night hours plus daytime load (solar in minus battery in) for the daylight hours,
 * from the last 48 h. 29.5 Wh per 1% (measured on the Field units). Counts to empty: when the cameras go dark.
 * fromNow starts at the battery now (less any amount the system number ran ahead); full starts at 100%.
 * Cloudy days still give some charge, so real runs are longer: this is the floor. Null without enough data. */
export type WithoutSun = {fromNow: number; full: number; watts: number; soc: number};
export function withoutSun(points: readonly HistoryPoint[] | null | undefined, now: number): WithoutSun | null {
  if (!points?.length) return null;
  const nowS = now / 1000, last = [...points].reverse().find(p => p[1] !== null);
  if (!last || nowS - last[0] > 45 * 60) return null;
  const recent = points.filter(p => p[0] > nowS - 48 * 3600 && p[3] !== null), hour = (p: HistoryPoint) => new Date(p[0] * 1000).getHours();
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const night = median(recent.filter(p => (hour(p) < 6 || hour(p) >= 19) && (p[3] as number) < 0 && (p[2] ?? 0) < 5).map(p => -(p[3] as number)));
  const day = median(recent.filter(p => hour(p) >= 10 && hour(p) < 16 && (p[2] ?? 0) > 50).map(p => (p[2] as number) - (p[3] as number)).filter(w => w > 0));
  if (night === null || recent.filter(p => (p[3] as number) < 0).length < 6) return null;
  const hoursDark = darkHours(new Date(now)), watts = (night * hoursDark + (day ?? night) * (24 - hoursDark)) / 24;
  const perDay = watts * 24 / WH_PER_POINT;
  if (perDay <= 0) return null;
  const soc = Math.max(0, (last[1] as number) - systemLead(points, now));
  return {fromNow: Math.round(soc / perDay * 10) / 10, full: Math.round(100 / perDay * 10) / 10, watts: Math.round(watts), soc: Math.round(soc)};
}
/** Hours without useful sun in a day at this time of year (Texas): ~14 in winter, ~10 in summer. */
export function darkHours(d: Date): number {
  const day = (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5;
  return Math.round((12 + 2 * Math.cos((day + 10) / 365 * 2 * Math.PI)) * 10) / 10;
}
