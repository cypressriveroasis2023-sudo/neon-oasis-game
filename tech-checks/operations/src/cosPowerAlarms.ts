/** COS thresholds are separate from Victron's own alarm bits.
 * Nothing here invents a voltage or a charge percentage. */
import {ageFeed} from './feedFreshness';

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
  /** Our Victron read. When present, a silent alarm requires that read to be fresh. */
  victronFeedReadAt?: string | null;
}): CosPowerVerdict {
  const {now, settings} = input;
  const newest = input.newestObservedAt ? Date.parse(input.newestObservedAt) : NaN;
  let silent: CosCheck = 'unset';
  if (settings.silentHours !== null) {
    if (!Number.isFinite(newest) || newest > now + 60_000) silent = 'unknown';
    else silent = now - newest > settings.silentHours * 60 * 60 * 1000 ? 'alarm' : 'clear';
  }
  if ('victronFeedReadAt' in input && silent === 'alarm' && ageFeed(input.victronFeedReadAt, now, 'victron').state !== 'fresh') silent = 'unknown';
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

/** A shared payload. Undefined means the request failed and the cache stands. */
export function settingsFromShared(value: unknown): CosPowerSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Partial<CosPowerSettings>;
  if (!('lowVoltageV' in row) || !('lowSocPercent' in row) || !('silentHours' in row)) return undefined;
  return {
    lowVoltageV: finiteOrNull(row.lowVoltageV, 0, 80),
    lowSocPercent: finiteOrNull(row.lowSocPercent, 0, 100),
    silentHours: finiteOrNull(row.silentHours, 1, 168),
  };
}

/** Shared numbers win, including an explicit unset. The cache is only for a failed read. */
export function preferSharedSettings(shared: CosPowerSettings | undefined, cache: CosPowerSettings): CosPowerSettings {
  return shared ?? cache;
}

const SHARED_URL = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-power-alarm-settings';

export async function readParentAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined' || window.parent === window || location.origin === 'null') return null;
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = window.setTimeout(() => { window.removeEventListener('message', receive); resolve(null); }, 10000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.type !== 'COS_OPERATIONS_TOKEN_RESPONSE' || message.requestId !== requestId) return;
      window.removeEventListener('message', receive);
      window.clearTimeout(timer);
      resolve(typeof message.accessToken === 'string' && message.accessToken.trim() ? message.accessToken : null);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId}, location.origin);
  });
}

export async function readSharedPowerAlarmSettings(token: string | null, fetcher: typeof fetch = fetch): Promise<CosPowerSettings | undefined> {
  if (!token) return undefined;
  try {
    const response = await fetcher(SHARED_URL, {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'read'}),
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    return settingsFromShared(await response.json());
  } catch {
    return undefined;
  }
}

export async function writeSharedPowerAlarmSettings(token: string | null, settings: CosPowerSettings, fetcher: typeof fetch = fetch): Promise<CosPowerSettings | undefined> {
  if (!token) return undefined;
  const body = {
    action: 'write',
    lowVoltageV: finiteOrNull(settings.lowVoltageV, 0, 80),
    lowSocPercent: finiteOrNull(settings.lowSocPercent, 0, 100),
    silentHours: finiteOrNull(settings.silentHours, 1, 168),
  };
  try {
    const response = await fetcher(SHARED_URL, {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    return settingsFromShared(await response.json());
  } catch {
    return undefined;
  }
}
