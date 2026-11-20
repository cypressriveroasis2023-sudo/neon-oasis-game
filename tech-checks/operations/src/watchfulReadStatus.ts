import {cameraTimestamp} from './cameraEvidence';

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
