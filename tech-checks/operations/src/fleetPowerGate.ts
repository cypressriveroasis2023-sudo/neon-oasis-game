import {powerSampleFresh, powerSampleStamp, victronFeedFresh} from './feedFreshness';

type Measurement = {metric?: string; value?: number; unit?: string; observedAt?: string | null; source?: string; instance?: number};
type Power = {measurements?: Measurement[] | null};
type BatteryEvidence = {percent: number | null; percentObservedAt?: string | null; status?: string | null; statusObservedAt?: string | null};
type CameraRow = {name?: string; evidence?: {source?: string} | null; batteryEvidence?: BatteryEvidence | null};
type Row = {
  family: string;
  power: Power | null;
  camera?: {identity?: string; rows?: CameraRow[]};
  batteryState: string;
  batteryPercent: number | null;
  batteryReadings: {source: string; percent: number; observedAt: string | null; fresh: boolean}[];
  batteryReadIssue: string | null;
};

const combine = (states: string[]) => states.includes('offline') ? 'offline' : states.length && states.every(state => state === 'online') ? 'online' : 'unknown';

/** Helios, Recon II and the battery alarm go Unknown at 20 minutes.
 * POWER_FRESH_MS stays 45 minutes. The pinned summary reads measurement times,
 * so a sample past 20 minutes loses that time and cannot read as a live alarm. */
export function gateDashboardPower<T extends Row>(rows: readonly T[], sync: Parameters<typeof victronFeedFresh>[0], now: number): T[] {
  const feedFresh = victronFeedFresh(sync, now);
  return rows.map(row => {
    const family = row.family.toUpperCase();
    if (family.startsWith('HELIOS')) {
      const measurements = row.power?.measurements || [];
      const batteryReadings = measurements.filter(measurement => measurement.metric === 'battery_soc' && typeof measurement.value === 'number').map(measurement => {
        const stamp = powerSampleStamp(measurement.observedAt, now);
        return {source: 'Victron · '+measurement.source+' '+measurement.instance, percent: measurement.value as number, observedAt: stamp.at, fresh: feedFresh && stamp.fresh};
      });
      let batteryPercent: number | null = null;
      let batteryState = 'unknown';
      if (row.power && !row.batteryReadIssue && feedFresh) {
        const recent = measurements.filter(measurement => powerSampleFresh(measurement.observedAt, now));
        const soc = recent.filter(measurement => measurement.metric === 'battery_soc' && typeof measurement.value === 'number');
        batteryPercent = soc.length ? Math.min(...soc.map(measurement => measurement.value as number)) : null;
        batteryState = recent.some(measurement => measurement.unit === 'state' && (measurement.value || 0) > 0) || batteryPercent !== null && batteryPercent < 20 ? 'offline' : batteryPercent !== null ? 'online' : 'unknown';
      }
      const power = row.power ? {...row.power, measurements: measurements.map(measurement => feedFresh && powerSampleFresh(measurement.observedAt, now) ? measurement : {...measurement, observedAt: null})} : row.power;
      return {...row, batteryReadings, batteryPercent, batteryState, power};
    }
    if (family.startsWith('RECON')) {
      const batteryRows = row.camera?.identity === 'matched' ? (row.camera.rows || []).filter(item => item.evidence?.source === 'Reconeyez' && item.batteryEvidence) : [];
      const readings = batteryRows.map(item => item.batteryEvidence).filter((item): item is BatteryEvidence => Boolean(item));
      const batteryReadings = batteryRows.filter(item => item.batteryEvidence && item.batteryEvidence.percent !== null).map(item => {
        const stamp = powerSampleStamp(item.batteryEvidence!.percentObservedAt, now);
        return {source: 'Reconeyez · '+(item.name || 'unit'), percent: item.batteryEvidence!.percent as number, observedAt: stamp.at, fresh: stamp.fresh};
      });
      const values = readings.filter(reading => reading.percent !== null && powerSampleFresh(reading.percentObservedAt, now)).map(reading => reading.percent as number);
      const batteryPercent = values.length ? Math.min(...values) : null;
      const batteryState = readings.length ? combine(readings.map(reading => powerSampleFresh(reading.statusObservedAt, now) && reading.status ? (reading.status === 'normal' ? 'online' : 'offline') : powerSampleFresh(reading.percentObservedAt, now) && reading.percent !== null ? (reading.percent < 20 ? 'offline' : 'online') : 'unknown')) : row.batteryState;
      return {...row, batteryReadings, batteryPercent, batteryState};
    }
    return row;
  });
}
