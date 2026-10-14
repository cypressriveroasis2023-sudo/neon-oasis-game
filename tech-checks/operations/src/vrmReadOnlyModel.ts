import { safeVrmPower, type SafeVrmPower } from '../../supabase/functions/cos-operations-pages/vrmSafePower';
import type { PowerMetric, PowerObservation } from '../../supabase/functions/cos-operations-pages/vrmPower';
import type { VrmUnit } from '../../supabase/functions/cos-operations-pages/vrm';

export const VRM_READING_MAX_AGE_MS = 30 * 60 * 1000;
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
