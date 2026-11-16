/** COS thresholds are separate from Victron's own alarm bits.
 * Nothing here invents a voltage or a charge percentage. */

export type CosPowerSettings = {
  lowVoltageV: number | null;
  lowSocPercent: number | null;
  silentHours: number | null;
};

export type PowerSample = { value: number; observedAt: string };

export type CosCheck = 'alarm' | 'clear' | 'unset' | 'unknown';

export type CosPowerVerdict = {
  voltage: CosCheck;
  soc: CosCheck;
  silent: CosCheck;
  victronLowVoltage: 'alarm' | 'clear' | 'unknown';
};

const OBSERVATION_FRESH_MS = 20 * 60 * 1000;

export const EMPTY_POWER_SETTINGS: CosPowerSettings = {
  lowVoltageV: null,
  lowSocPercent: null,
  silentHours: null,
};

function at(sample: PowerSample | null | undefined, now: number): number | null {
  if (!sample || typeof sample.value !== 'number' || !Number.isFinite(sample.value)) return null;
  const time = Date.parse(sample.observedAt);
  if (!Number.isFinite(time) || time > now + 60_000) return null;
  return time;
}

function compare(sample: PowerSample | null | undefined, now: number, threshold: number | null, alarmWhenBelow: boolean): CosCheck {
  if (threshold === null) return 'unset';
  const time = at(sample ?? null, now);
  if (time === null || now - time > OBSERVATION_FRESH_MS || !sample) return 'unknown';
  return alarmWhenBelow ? (sample.value < threshold ? 'alarm' : 'clear') : (sample.value > threshold ? 'alarm' : 'clear');
}

export function cosPowerVerdict(input: {
  now: number;
  settings: CosPowerSettings;
  voltage?: PowerSample | null;
  soc?: PowerSample | null;
  newestObservedAt?: string | null;
  victronLowVoltage?: PowerSample | null;
}): CosPowerVerdict {
  const {now, settings} = input;
  const newest = input.newestObservedAt ? Date.parse(input.newestObservedAt) : NaN;
  let silent: CosCheck = 'unset';
  if (settings.silentHours !== null) {
    if (!Number.isFinite(newest) || newest > now + 60_000) silent = 'unknown';
    else silent = now - newest > settings.silentHours * 60 * 60 * 1000 ? 'alarm' : 'clear';
  }
  const victronTime = at(input.victronLowVoltage ?? null, now);
  const victronLowVoltage: CosPowerVerdict['victronLowVoltage'] =
    victronTime === null || !input.victronLowVoltage || now - victronTime > OBSERVATION_FRESH_MS
      ? 'unknown'
      : input.victronLowVoltage.value > 0 ? 'alarm' : 'clear';
  return {
    voltage: compare(input.voltage, now, settings.lowVoltageV, true),
    soc: compare(input.soc, now, settings.lowSocPercent, true),
    silent,
    victronLowVoltage,
  };
}

export type PowerMeasurement = { metric: string; value: number; unit?: string; observedAt: string };

/** Newest sample of each metric. Victron's alarm bit is only a state, never a voltage. */
export function powerSamples(measurements: PowerMeasurement[] | null | undefined) {
  const rows = measurements ?? [];
  const newest = (metric: string, stateOnly = false) => rows
    .filter(item => item.metric === metric && (!stateOnly || item.unit === 'state'))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null;
  const times = rows.map(item => Date.parse(item.observedAt)).filter(time => Number.isFinite(time));
  return {
    voltage: newest('battery_voltage'),
    soc: newest('battery_soc'),
    newestObservedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    victronLowVoltage: newest('low_voltage_alarm', true),
  };
}

export function cosPowerLabel(check: CosCheck, name: string): string {
  if (check === 'unset') return name+' threshold not set';
  if (check === 'unknown') return name+' unknown';
  if (check === 'alarm') return name+' alarm';
  return name+' clear';
}

const KEY = 'cos-power-alarm-settings-v1';

function finiteOrNull(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

export function readPowerAlarmSettings(storage: Storage | null): CosPowerSettings {
  if (!storage) return {...EMPTY_POWER_SETTINGS};
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null') as Partial<CosPowerSettings> | null;
    if (!raw || typeof raw !== 'object') return {...EMPTY_POWER_SETTINGS};
    return {
      lowVoltageV: finiteOrNull(raw.lowVoltageV, 0, 80),
      lowSocPercent: finiteOrNull(raw.lowSocPercent, 0, 100),
      silentHours: finiteOrNull(raw.silentHours, 1, 168),
    };
  } catch {
    return {...EMPTY_POWER_SETTINGS};
  }
}

export function writePowerAlarmSettings(storage: Storage | null, settings: CosPowerSettings) {
  if (!storage) return;
  const stored: CosPowerSettings = {
    lowVoltageV: finiteOrNull(settings.lowVoltageV, 0, 80),
    lowSocPercent: finiteOrNull(settings.lowSocPercent, 0, 100),
    silentHours: finiteOrNull(settings.silentHours, 1, 168),
  };
  storage.setItem(KEY, JSON.stringify(stored));
}
