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
type Charge = ReturnType<typeof chargeReadings>[number];
/**
 * The one charge reading the tiles and alerts go by: a current one if there is any, the system's own if it
 * reports one, otherwise the lowest. Always a real, labeled source; never an average.
 */
export function primaryCharge(charges: readonly Charge[], now: number): Charge | undefined {
  const fresh = charges.filter(reading => readingIsFresh(reading, now));
  const pool = fresh.length ? fresh : charges;
  return pool.find(reading => reading.source === 'system') ?? [...pool].sort((a, b) => a.value - b.value)[0];
}
/** How the battery monitors compare. They "agree" when all are equally current and within one point of each other. */
export const CHARGE_AGREE_POINTS = 1;
export function chargeAgreement(charges: readonly Charge[], now: number): {lead: Charge | undefined; spread: number; agree: boolean} {
  const lead = primaryCharge(charges, now);
  if (charges.length < 2) return {lead, spread: 0, agree: false};
  const values = charges.map(reading => reading.value), spread = Math.max(...values) - Math.min(...values);
  const sameAge = charges.every(reading => readingIsFresh(reading, now)) || charges.every(reading => !readingIsFresh(reading, now));
  return {lead, spread, agree: sameAge && spread <= CHARGE_AGREE_POINTS};
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
  if (unit.available === false) return { tone: 'unavailable' as TileTone, soc: undefined, solar: undefined, fresh: false, flow: undefined, alarms: [] as VictronAlarm[], lastSeen: lastConnected(unit, undefined) };
  const row = dashboardPowerFor(unit, rows);
  const charges = chargeReadings(row, now);
  const soc = primaryCharge(charges, now);
  const solar = selectReading(row, 'solar_power', now);
  const isFresh = Boolean(soc && readingIsFresh(soc, now)) && !row?.errorCode;
  const alarms = victronAlarms(row, now);
  const worst = Math.max(0, ...alarms.map(alarm => alarm.level));
  let tone: TileTone = !soc ? 'none' : !isFresh ? 'stale' : soc.value < 20 ? 'low' : soc.value < 50 ? 'fair' : 'good';
  // Victron's own alarm outranks our colors: an alarm is red, a warning is at least amber.
  if (worst === 2 && (tone === 'good' || tone === 'fair')) tone = 'low';
  else if (worst === 1 && tone === 'good') tone = 'fair';
  return { tone, soc, solar, fresh: isFresh, flow: powerFlow(row, now), alarms, lastSeen: lastConnected(unit, row) };
}

export type PowerFlow = {state: 'charging' | 'draining' | 'idle'; watts: number | null; amps: number | null};
/** Charging or draining from a current reading only: the system battery power, else battery current. Stale = none. */
export function powerFlow(row: SafeVrmPower | undefined, now: number): PowerFlow | undefined {
  const fresh = (metric: PowerMetric) => (row?.measurements ?? []).filter(m => m.metric === metric && readingIsFresh(m, now))
    .sort((a, b) => Number(b.source === 'system') - Number(a.source === 'system') || a.instance - b.instance)[0];
  const power = fresh('battery_power'), current = fresh('battery_current');
  if (!power && !current) return undefined;
  const watts = power ? Math.round(power.value) : null, amps = current ? Math.round(current.value * 10) / 10 : null;
  const sign = power ? (Math.abs(power.value) < 3 ? 0 : Math.sign(power.value)) : (Math.abs(current!.value) < 0.2 ? 0 : Math.sign(current!.value));
  return {state: sign > 0 ? 'charging' : sign < 0 ? 'draining' : 'idle', watts, amps};
}

export type VictronAlarm = {kind: 'Low battery' | 'Low voltage' | 'High voltage'; level: 1 | 2};
const ALARM_KIND: Partial<Record<PowerMetric, VictronAlarm['kind']>> = {low_soc_alarm: 'Low battery', low_voltage_alarm: 'Low voltage', high_voltage_alarm: 'High voltage'};
/** Victron's own alarms on current readings (1 = warning, 2 = alarm), one per kind, worst level kept. */
export function victronAlarms(row: SafeVrmPower | undefined, now: number): VictronAlarm[] {
  const out = new Map<VictronAlarm['kind'], 1 | 2>();
  for (const m of row?.measurements ?? []) {
    const kind = ALARM_KIND[m.metric];
    if (!kind || !readingIsFresh(m, now) || m.value < 1) continue;
    const level: 1 | 2 = m.value >= 2 ? 2 : 1;
    out.set(kind, Math.max(out.get(kind) ?? 0, level) as 1 | 2);
  }
  return [...out].map(([kind, level]) => ({kind, level})).sort((a, b) => b.level - a.level || a.kind.localeCompare(b.kind));
}

/** When this installation last sent Victron anything: its newest reading, or the sync's last-seen time. */
export function lastConnected(unit: VrmUnit, row: SafeVrmPower | undefined): string | undefined {
  const times = [...(row?.measurements ?? []).map(m => Date.parse(m.observedAt)), unit.lastSeenAt ? Date.parse(unit.lastSeenAt) : NaN].filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

export function shortDate(value: string | undefined, now: number): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay ? date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
