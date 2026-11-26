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

export async function readVrmMppt(fetcher: typeof fetch = fetch, token?: string | null): Promise<Map<number, Mppt> | null> {
  try {
    const access = token === undefined ? await readParentAccessToken() : token;
    if (!access) return null;
    const response = await fetcher(URL_, {method: 'POST', headers: {Authorization: 'Bearer ' + access, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'read'}), cache: 'no-store'});
    if (!response.ok) return null;
    return parseMppt(await response.json());
  } catch { return null; }
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

export type MpptFlag = {kind: 'charger' | 'panel'; line: string};
/** Trouble this unit's own charger readings show. `peerYield` is the middle "yesterday" yield of the other Field units. */
export function mpptFlags(m: Mppt | null | undefined, now: number, context: {needed?: boolean; peerYield?: number | null} = {}): MpptFlag[] {
  if (!mpptFresh(m, now)) return [];
  const flags: MpptFlag[] = [];
  if (m.errorCode !== null && m.errorCode > 0) flags.push({kind: 'charger', line: 'Solar charger error · ' + (ERRORS[m.errorCode] ?? 'code ' + m.errorCode)});
  const hour = new Date(now).getHours();
  if (hour >= 9 && hour < 16 && m.panelVolts !== null && m.panelVolts < PANEL_DEAD_VOLTS)
    flags.push({kind: 'panel', line: 'Panels not producing · ' + Math.round(m.panelVolts) + ' V at the charger in daylight'});
  // A unit that stayed full makes little because it needed little, so this only counts when it needed the sun.
  else if (context.needed && m.yieldYesterday !== null && context.peerYield && context.peerYield >= 0.3 && m.yieldYesterday < context.peerYield * LOW_YIELD_SHARE)
    flags.push({kind: 'panel', line: 'Panels made ' + kwh(m.yieldYesterday) + ' yesterday · the others made about ' + kwh(context.peerYield)});
  return flags;
}

/** Middle "yesterday" yield across the given units' fresh readings (needs 4+), or null. */
export function peerYield(all: ReadonlyMap<number, Mppt> | null | undefined, ids: readonly number[], now: number): number | null {
  const ys = ids.map(id => all?.get(id)).filter((m): m is Mppt => mpptFresh(m, now) && m.yieldYesterday !== null).map(m => m.yieldYesterday as number).sort((a, b) => a - b);
  if (ys.length < 4) return null;
  const mid = ys.length >> 1;
  return ys.length % 2 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
}

/** One compact line for a unit: "0.42 kWh today · 0.88 yesterday · peak 350 W · panels 32 V". */
export function mpptLine(m: Mppt | null | undefined, now: number): string | null {
  if (!mpptFresh(m, now)) return null;
  const parts = [
    m.yieldToday !== null ? kwh(m.yieldToday) + ' today' : null,
    m.yieldYesterday !== null ? kwh(m.yieldYesterday).replace(' kWh', '') + ' yesterday' : null,
    m.peakToday !== null ? 'peak ' + Math.round(m.peakToday) + ' W' : null,
    m.panelVolts !== null ? 'panels ' + Math.round(m.panelVolts) + ' V' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
