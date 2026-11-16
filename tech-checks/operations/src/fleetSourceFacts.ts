import {mhelpSyncStatus} from './mhelpSyncStatus';
import type {SourceFacts} from './sourceAttention';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Facts already on the fleet board. Sources this screen does not carry are omitted. */
export function fleetSourceFacts(input: {
  now: number;
  map?: unknown;
  inventory?: { receivedAt?: string; live?: boolean; stale?: boolean } | null;
  connectionState?: string | null;
  boardCheckedAt?: number | null;
  star?: SourceFacts['star'];
  victronError?: string | null;
  victronAttempt?: string | null;
  trackerVerifiedAt?: string | null;
  includeStar?: boolean;
  includeVictron?: boolean;
  includeTracker?: boolean;
}): SourceFacts {
  const status = input.map ? mhelpSyncStatus(input.map, input.now) : null;
  const sync = input.map && typeof input.map === 'object' ? (input.map as {mhelpPlacementSync?: {errorCode?: unknown}}).mhelpPlacementSync : null;
  const errorCode = text(sync?.errorCode);
  const facts: SourceFacts = {now: input.now};
  if (input.map || input.inventory) facts.mhelp = {
    authState: status?.reconnectRequired ? 'reconnect_required' : status && (status.connection === 'Connected' || status.connection === 'Access verified at last update') ? 'verified' : 'unknown',
    lastSuccess: input.inventory?.receivedAt || status?.lastSuccess || null,
    failed: Boolean(errorCode),
    errorCode,
    live: input.inventory?.live,
    reportedStale: input.inventory?.stale === true,
  };
  if (typeof input.boardCheckedAt === 'number' || typeof input.connectionState === 'string') {
    facts.connections = {state: input.connectionState ?? null, boardCheckedAt: input.boardCheckedAt ?? null};
  }
  if (input.includeTracker || typeof input.trackerVerifiedAt === 'string') facts.tracker = {verifiedAt: input.trackerVerifiedAt ?? null, failed: input.connectionState === 'error' || input.connectionState === 'rejected'};
  if (input.includeStar) facts.star = input.star ?? null;
  if (input.includeVictron) facts.victron = {errorCode: input.victronError ?? null, lastAttemptAt: input.victronAttempt ?? null};
  return facts;
}
