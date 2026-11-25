import {readVrmFleetConfig} from '../../../supabase/functions/cos-operations-pages/vrm';
import {canonicalCameraUnit} from '../fieldCameraHealth';
import {readDashboardPower, unitTileSummary, type TileTone} from '../vrmReadOnlyModel';
import {cloudyWarning, outlookLine, type OutlookDay} from '../vrmWeather';
import {historyFlags, overnightLow, tonightBasis, tonightForecast, tonightHeadline, tonightSteps, type HistoryPoint} from '../vrmHistory';

/** One Helios unit's Victron reading as the COS Board draws it.
 * b = battery %, w = solar W, v = battery volts, t = reading time in seconds (0 = none), q = tone,
 * f = charging/draining now (with watts), al = Victron's own alarm ("Low voltage", level 1 warning / 2 alarm),
 * ls = when the installation last sent Victron anything, in seconds (0 = never). */
export type BoardPower = {b: number | null; w: number | null; v: number | null; t: number; q: Exclude<TileTone, 'unavailable'> | 'off';
  f?: {s: 'charging' | 'draining' | 'idle'; w: number | null}; al?: {k: string; l: 1 | 2}; ls: number;
  /** From saved history, when it has been read: last night's lowest battery %, and plain-language flags. */
  nl?: number; hf?: string[];
  /** Tonight's estimate (5 PM to 7 AM): verdict, one-line headline, why, and steps for a tech. */
  tn?: {v: 'ok' | 'tight' | 'low' | 'charging'; h: string; b: string; s: string[]};
  /** Sun for the next two days at this unit's site ("☀ Today · ☁ Tomorrow"), and a warning when gray days meet a low battery. */
  sk?: {o: string; w?: string}};

const seconds = (value?: string) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.round(time / 1000) : 0;
};

/**
 * Victron power by exact Helios number, from the same saved fleet reading the Victron Power page shows.
 * Only HELIOS names are matched. Two installations with the same number match nothing rather than a guess.
 * Separate batteries are never averaged: the system reading wins, otherwise the lowest single monitor.
 */
export function boardPowerByUnit(fleetData: unknown, now: number, history?: ReadonlyMap<number, HistoryPoint[]> | null, weather?: ReadonlyMap<string, OutlookDay[]> | null): Map<string, BoardPower> {
  const out = new Map<string, BoardPower>();
  let items: ReturnType<typeof readVrmFleetConfig>['items'];
  try { items = readVrmFleetConfig(fleetData).items; } catch { return out; }
  const rows = readDashboardPower((fleetData as {power?: unknown} | null)?.power, items).rows;
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = canonicalCameraUnit(item.name);
    if (key?.startsWith('HELIOS|')) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const item of items) {
    const key = canonicalCameraUnit(item.name);
    if (!key?.startsWith('HELIOS|') || seen.get(key) !== 1) continue;
    const tile = unitTileSummary(item, rows, now);
    const row = rows.find(r => r.installationId === item.installationId && r.name === item.name);
    const volts = row?.measurements?.find(m => m.metric === 'battery_voltage' && m.source === tile.soc?.source && m.instance === tile.soc?.instance)
      ?? row?.measurements?.find(m => m.metric === 'battery_voltage');
    out.set(key, {
      b: tile.soc ? Math.round(tile.soc.value) : null,
      w: tile.solar ? Math.round(tile.solar.value) : null,
      v: volts ? Math.round(volts.value * 10) / 10 : null,
      t: seconds(tile.soc?.observedAt ?? tile.solar?.observedAt),
      q: tile.tone === 'unavailable' ? 'off' : tile.tone,
      ...(tile.flow ? {f: {s: tile.flow.state, w: tile.flow.watts}} : {}),
      ...(tile.alarms[0] ? {al: {k: tile.alarms[0].kind, l: tile.alarms[0].level}} : {}),
      ls: seconds(tile.lastSeen),
      ...((points => {
        if (!points?.length) return {};
        const night = overnightLow(points, now), flags = historyFlags(points, now).map(f => f.line);
        const t = tile.fresh ? tonightForecast(points, now) : null;
        return {...(night ? {nl: night.low} : {}), ...(flags.length ? {hf: flags} : {}),
          ...(t ? {tn: {v: t.verdict, h: tonightHeadline(t), b: tonightBasis(t), s: tonightSteps(t)}} : {})};
      })(history?.get(item.installationId))),
      ...((o => {
        if (!o?.length) return {};
        const w = tile.fresh && tile.soc ? cloudyWarning(o, tile.soc.value) : null;
        return {sk: {o: outlookLine(o), ...(w ? {w} : {})}};
      })(weather?.get(key))),
    });
  }
  return out;
}

export function boardPowerFor(power: Map<string, BoardPower> | null | undefined, unitName: string): BoardPower | undefined {
  if (!power) return undefined;
  const key = canonicalCameraUnit(unitName);
  return key ? power.get(key) : undefined;
}
