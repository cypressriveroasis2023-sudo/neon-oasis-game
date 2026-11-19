import {CAMERA_FRESH_MS, cameraTimestamp} from './cameraEvidence';

/** Same 20-minute observation window as a camera reading. Not widened. */
export const WATCHFUL_OBSERVATION_FRESH_MS = CAMERA_FRESH_MS;
export const IN_SHOP_LABEL = 'In Shop';
export const IN_SHOP_COLOR = '#64748b';

/** Oldest retained observation. A missing stamp makes the whole set unusable. */
export function oldestObservationIso(values: readonly (string | null | undefined)[]): string | null {
  const present = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (!present.length) return null;
  let oldest = Number.POSITIVE_INFINITY;
  for (const value of present) {
    const stamp = cameraTimestamp(value, Number.MAX_SAFE_INTEGER);
    const at = stamp.at ? Date.parse(stamp.at) : NaN;
    if (!Number.isFinite(at)) return null;
    if (at < oldest) oldest = at;
  }
  return new Date(oldest).toISOString();
}

/** h:mm AM CT. The hour has no leading zero. */
export function formatObservedCt(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const clock = new Date(at).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${clock} CT`;
}
