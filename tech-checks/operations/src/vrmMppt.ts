// Saved Victron MPPT (solar charger) readings for Helios units: what the panels made, and charger trouble.
// Best-effort and read-only, outside the main request path like the battery history: no answer here can
// sign anyone out, and when it is unreachable the page simply shows no panel line.
import {readParentAccessToken} from './cosPowerAlarms';

export type Mppt = {
  observedAt: number | null;                      // newest live charger reading, epoch seconds
  yieldToday: number | null; yieldYesterday: number | null;   // kWh
  peakToday: number | null; peakYesterday: number | null;     // W
  panelVolts: number | null; errorCode: number | null;
};
export const MPPT_FRESH_S = 45 * 60;           // same cutoff as the rest of the Victron page
export const PANEL_DEAD_VOLTS = 10;            // two panels read 30 V+ in any daylight; under 10 V means nothing is arriving
export const LOW_YIELD_SHARE = 0.5;            // "far less than the others" = under half the middle unit

const URL_ = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-mppt-read';
const num = (v: unknown, lo: number, hi: number): number | null | undefined => v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

export function parseMppt(value: unknown, now = Date.now()): Map<number, Mppt> | null {
  const v = value as {units?: unknown} | null;
  if (!v || typeof v !== 'object' || !Array.isArray(v.units) || v.units.length > 200) return null;
  const out = new Map<number, Mppt>();
  for (const raw of v.units) {
    const u = raw as Record<string, unknown> | null;
    if (!u || !Number.isSafeInteger(u.installationId) || (u.installationId as number) < 1 || out.has(u.installationId as number)) return null;
    const m = {observedAt: num(u.observedAt, 946684800, now / 1000 + 300), yieldToday: num(u.yieldToday, 0, 1000), yieldYesterday: num(u.yieldYesterday, 0, 1000),
      peakToday: num(u.peakToday, 0, 100000), peakYesterday: num(u.peakYesterday, 0, 100000), panelVolts: num(u.panelVolts, 0, 500), errorCode: num(u.errorCode, 0, 300)};
    if (Object.values(m).includes(undefined)) return null;
    out.set(u.installationId as number, m as Mppt);
  }
  return out;
}

/** Field or Shop for one Helios, from mHelp's own current list. ZIP only for Field units. */
export type MhelpPlace = {name: string; placement: 'FIELD' | 'SHOP'; zip: string | null};
/** The `placements` part of the same answer. Anything odd means no placement from here, never a guess. */
export function parsePlacements(value: unknown): MhelpPlace[] | null {
  const list = (value as {placements?: unknown} | null)?.placements;
  if (!Array.isArray(list) || list.length > 200) return null;
  const out: MhelpPlace[] = [], names = new Set<string>();
  for (const raw of list) {
    const u = raw as Record<string, unknown> | null;
    const name = typeof u?.name === 'string' ? u.name.replace(/\s+/g, ' ').trim().toUpperCase() : '';
    if (!u || !/^HELIOS \d{1,3}$/.test(name) || names.has(name) || u.placement !== 'FIELD' && u.placement !== 'SHOP'
      || u.zip !== null && u.zip !== undefined && !(typeof u.zip === 'string' && /^\d{5}$/.test(u.zip))) return null;
    names.add(name);
    out.push({name, placement: u.placement, zip: u.placement === 'FIELD' ? (u.zip as string | null | undefined) ?? null : null});
  }
  return out;
}

/** One read: the charger readings and, with them, mHelp's Field/Shop for every Helios. */
export async function readVrmExtras(fetcher: typeof fetch = fetch, token?: string | null): Promise<{mppt: Map<number, Mppt> | null; places: MhelpPlace[] | null}> {
  try {
    const access = token === undefined ? await readParentAccessToken() : token;
    if (!access) return {mppt: null, places: null};
    const response = await fetcher(URL_, {method: 'POST', headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'read'}), cache: 'no-store'});
    if (!response.ok) return {mppt: null, places: null};
    const body = await response.json();
    return {mppt: parseMppt(body), places: parsePlacements(body)};
  } catch { return {mppt: null, places: null}; }
}
export async function readVrmMppt(fetcher: typeof fetch = fetch, token?: string | null): Promise<Map<number, Mppt> | null> {
  return (await readVrmExtras(fetcher, token)).mppt;
}

/** The charger is reporting now (not an unplugged unit's last saved numbers). */
export const mpptFresh = (m: Mppt | null | undefined, now: number): m is Mppt => !!m && m.observedAt !== null && now / 1000 - m.observedAt <= MPPT_FRESH_S;

// Victron's published MPPT error codes, in plain words. Anything else shows as its number.
const ERRORS: Record<number, string> = {
  2: 'battery voltage too high', 17: 'charger too hot', 18: 'charger over-current', 20: 'bulk charge took too long',
  21: 'current sensor fault', 26: 'terminals overheated', 28: 'power stage fault', 33: 'panel voltage too high',
  34: 'panel current too high', 38: 'input shut down (battery over-voltage)', 39: 'input shut down',
};
const kwh = (n: number) => (Math.round(n * 100) / 100) + ' kWh';

/**
 * The charger has no clock. Its "today" counter starts over a few hours after dark: about 9:45 PM in late
 * November, after midnight in summer. So late in the evening its "today" is already tomorrow's empty count
 * and its "yesterday" is the day that just ended; and in the small hours of a summer night its "today" is
 * still the day before. This says which calendar day each counter is really about.
 */
export type SolarDays = {
  today: number | null; peakToday: number | null;   // the calendar day now (null when the charger cannot say)
  yesterday: number | null;                         // the calendar day before
  /** The newest finished solar day, for comparing units: which calendar day it is (0 today, -1 yesterday) and what it made. */
  judged: {day: 0 | -1; made: number | null};
};
export function solarDays(m: Mppt, now: number): SolarDays {
  const hour = new Date(now).getHours();
  const empty = m.yieldToday !== null && m.yieldToday < 0.005 && !m.peakToday;
  // Evening, counter already started over: "yesterday" is really today.
  if (hour >= 21 && empty) return {today: m.yieldYesterday, peakToday: m.peakYesterday, yesterday: null, judged: {day: 0, made: m.yieldYesterday}};
  // Before sunrise, counter not started over yet: "today" is really yesterday.
  if (hour < 7 && !empty && m.yieldToday !== null) return {today: null, peakToday: null, yesterday: m.yieldToday, judged: {day: -1, made: m.yieldToday}};
  return {today: m.yieldToday, peakToday: m.peakToday, yesterday: m.yieldYesterday, judged: {day: -1, made: m.yieldYesterday}};
}
const dayWord = (day: 0 | -1) => day === 0 ? 'today' : 'yesterday';
type ByDay<T> = T | ((day: 0 | -1) => T);
const forDay = <T,>(value: ByDay<T>, day: 0 | -1): T => typeof value === 'function' ? (value as (day: 0 | -1) => T)(day) : value;

export type MpptFlag = {kind: 'charger' | 'panel'; line: string};
/**
 * Trouble this unit's own charger readings show. `peerYield` is what the middle Field unit made on the same
 * day, and `needed` is whether this unit's battery had room to charge that day; each may be a plain value
 * (about yesterday) or a function of the day being judged.
 */
export function mpptFlags(m: Mppt | null | undefined, now: number, context: {needed?: ByDay<boolean | undefined>; peerYield?: ByDay<number | null | undefined>} = {}): MpptFlag[] {
  if (!mpptFresh(m, now)) return [];
  const flags: MpptFlag[] = [];
  if (m.errorCode !== null && m.errorCode > 0) flags.push({kind: 'charger', line: 'Solar charger error · ' + (ERRORS[m.errorCode] ?? 'code ' + m.errorCode)});
  const hour = new Date(now).getHours();
  const {day, made} = solarDays(m, now).judged;
  const peers = forDay(context.peerYield, day);
  if (hour >= 9 && hour < 16 && m.panelVolts !== null && m.panelVolts < PANEL_DEAD_VOLTS)
    flags.push({kind: 'panel', line: 'Panels not producing · ' + Math.round(m.panelVolts) + ' V at the charger in daylight'});
  // A unit that stayed full (outside power, light use) makes little because it needed little, so this only
  // counts when its battery had room to charge that day (`needed`).
  else if (forDay(context.needed, day) && made !== null && peers && peers >= 0.3 && made < peers * LOW_YIELD_SHARE)
    flags.push({kind: 'panel', line: 'Panels made ' + kwh(made) + ' ' + dayWord(day) + ' · the others made about ' + kwh(peers)});
  return flags;
}

/** What the middle unit made on that calendar day, across the given units' fresh readings (needs 4+), or null. */
export function peerYield(all: ReadonlyMap<number, Mppt> | null | undefined, ids: readonly number[], now: number, day: 0 | -1 = -1): number | null {
  const ys = ids.map(id => all?.get(id)).filter((m): m is Mppt => mpptFresh(m, now)).map(m => solarDays(m, now).judged)
    .filter(j => j.day === day && j.made !== null).map(j => j.made as number).sort((a, b) => a - b);
  if (ys.length < 4) return null;
  const mid = ys.length >> 1;
  return ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
}

/** One compact line for a unit: "0.42 kWh today · 0.88 yesterday · peak 350 W · panels 32 V". */
export function mpptLine(m: Mppt | null | undefined, now: number): string | null {
  if (!mpptFresh(m, now)) return null;
  const d = solarDays(m, now);
  const parts = [
    d.today !== null ? kwh(d.today) + ' today' : null,
    d.yesterday !== null ? (d.today !== null ? kwh(d.yesterday).replace(' kWh', '') : kwh(d.yesterday)) + ' yesterday' : null,
    d.peakToday !== null ? 'peak ' + Math.round(d.peakToday) + ' W' : null,
    m.panelVolts !== null ? 'panels ' + Math.round(m.panelVolts) + ' V' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
