import { safeVrmPower, type SafeVrmPower } from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import type { PowerMetric, PowerObservation } from '../../supabase/functions/cos-operations-pages/vrmPower';
import type { VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';

export const VRM_READING_MAX_AGE_MS = 45 * 60 * 1000;
export function readDashboardPower(value: unknown, items: VrmUnit[]): { rows: SafeVrmPower[]; invalid: boolean } {
  if (value === undefined) return { rows: [], invalid: false };
  try { return { rows: safeVrmPower(value, items), invalid: false }; }
  catch { return { rows: [], invalid: true }; }
}
export function readingIsFresh(reading: PowerObservation, now: number) {
  const age = now - Date.parse(reading.observedAt);
  return age >= -300000 && age <= VRM_READING_MAX_AGE_MS;
}
/** Keep distinct battery monitors visible; none is an inferred installation-wide SOC. */
export function chargeReadings(row: SafeVrmPower | undefined, now: number) {
  return (row?.measurements ?? []).filter(reading => reading.metric === 'battery_soc').sort((a,b) =>
    Number(readingIsFresh(b,now))-Number(readingIsFresh(a,now)) || a.source.localeCompare(b.source) || a.instance-b.instance || Date.parse(b.observedAt)-Date.parse(a.observedAt));
}
/** Select one labeled non-SOC source, never sum system totals and individual devices. */
export function selectReading(row: SafeVrmPower | undefined, metric: PowerMetric, now: number) {
  const readings = (row?.measurements ?? []).filter(reading => reading.metric === metric);
  return readings.sort((a,b) => Number(readingIsFresh(b,now))-Number(readingIsFresh(a,now)) ||
    Number(b.source === 'system')-Number(a.source === 'system') || Date.parse(b.observedAt)-Date.parse(a.observedAt) || a.instance-b.instance)[0];
}
export function dashboardPowerFor(unit: VrmUnit, rows: SafeVrmPower[]) {
  if (unit.available === false) return undefined;
  const matches = rows.filter(row => row.installationId === unit.installationId && row.name === unit.name);
  return matches.length === 1 ? matches[0] : undefined;
}

export type TileTone = 'good' | 'fair' | 'low' | 'stale' | 'none' | 'unavailable';
/** One glanceable reading per unit tile. Prefers the system SOC; otherwise the
 * lowest single battery monitor (never an average). Stale readings stay grey. */
export function unitTileSummary(unit: VrmUnit, rows: SafeVrmPower[], now: number) {
  if (unit.available === false) return { tone: 'unavailable' as TileTone, soc: undefined, solar: undefined, fresh: false };
  const row = dashboardPowerFor(unit, rows);
  const charges = chargeReadings(row, now);
  const fresh = charges.filter(reading => readingIsFresh(reading, now));
  const pool = fresh.length ? fresh : charges;
  const soc = pool.find(reading => reading.source === 'system') ?? [...pool].sort((a, b) => a.value - b.value)[0];
  const solar = selectReading(row, 'solar_power', now);
  const isFresh = Boolean(soc && readingIsFresh(soc, now)) && !row?.errorCode;
  const tone: TileTone = !soc ? 'none' : !isFresh ? 'stale' : soc.value < 20 ? 'low' : soc.value < 50 ? 'fair' : 'good';
  return { tone, soc, solar, fresh: isFresh };
}
