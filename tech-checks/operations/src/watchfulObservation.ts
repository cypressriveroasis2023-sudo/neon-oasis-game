import {CAMERA_FRESH_MS, cameraTimestamp} from './cameraEvidence';

/** Same 20-minute observation window as a camera reading. Not widened. */
export const WATCHFUL_OBSERVATION_FRESH_MS = CAMERA_FRESH_MS;
export const IN_SHOP_LABEL = 'In Shop';
export const IN_SHOP_COLOR = '#64748b';

/** Oldest retained observation. A missing or unreadable stamp makes the whole set Unknown. */
export function oldestObservationIso(values: readonly (string | null | undefined)[]): string | null {
  if (!values.length) return null;
  let oldest = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const stamp = cameraTimestamp(value, Number.MAX_SAFE_INTEGER);
    const at = stamp.at ? Date.parse(stamp.at) : NaN;
    if (!Number.isFinite(at)) return null;
    if (at < oldest) oldest = at;
  }
  return new Date(oldest).toISOString();
}

/**
 * Freshness is our read of Watchful. A unit lastConnection does not age the status.
 * A fresh read that says offline is Down. A read older than 20 minutes, missing, or failed is Unknown.
 */
export function presentedFromWatchfulRead(input: {
  readAt: string | null;
  readFailed?: boolean;
  watchfulStatus: 'up' | 'down' | 'offline' | null;
  lastConnection?: string | null;
  now: number;
}): 'Up' | 'Down' | 'Unknown' {
  if (input.readFailed || !input.readAt || !cameraTimestamp(input.readAt, input.now).fresh) return 'Unknown';
  if (input.watchfulStatus === 'down' || input.watchfulStatus === 'offline') return 'Down';
  if (input.watchfulStatus === 'up') return 'Up';
  return 'Unknown';
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
