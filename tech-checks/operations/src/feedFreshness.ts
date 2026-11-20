/** Every fleet feed is Unknown after 20 minutes, measured on our read time.
 * A missing, future, or older read is Unknown. It is never Down. */

export const FEED_UNKNOWN_MS = 20 * 60 * 1000;

export type FeedId = 'mhelp' | 'tracker' | 'cameras' | 'routers' | 'victron';

export type FeedReason = 'fresh' | 'missing' | 'future' | 'stale';

export type FeedAge = {
  id?: FeedId;
  state: 'fresh' | 'unknown';
  reason: FeedReason;
  readAt: number | null;
};

const FUTURE_SLACK_MS = 60_000;

const FEED_LINE: Record<FeedId, string> = {
  mhelp: 'unit list',
  tracker: 'tracker sheet',
  cameras: 'camera checks',
  routers: 'router checks',
  victron: 'battery checks',
};

/** Placement-derived figures. A fresh camera check must not hide a late unit list. */
export const PLACEMENT_QUICK = new Set(['field', 'shop', 'total', 'online', 'offline', 'unknown']);

export function readInstant(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ageFeed(readAt: number | string | null | undefined, now: number, id?: FeedId): FeedAge {
  const at = readInstant(readAt);
  if (at === null) return {id, state: 'unknown', reason: 'missing', readAt: null};
  if (at > now + FUTURE_SLACK_MS) return {id, state: 'unknown', reason: 'future', readAt: at};
  if (now - at > FEED_UNKNOWN_MS) return {id, state: 'unknown', reason: 'stale', readAt: at};
  return {id, state: 'fresh', reason: 'fresh', readAt: at};
}

/** A combined value takes the worst freshness of its inputs. */
export function worstFeed(ages: readonly FeedAge[]): FeedAge {
  const unknown = ages.find(age => age.state === 'unknown');
  if (unknown) return unknown;
  return ages[0] ?? {state: 'unknown', reason: 'missing', readAt: null};
}

export function allFeedsUnknown(reads: readonly {readAt: number | string | null | undefined}[], now: number): boolean {
  return reads.length > 0 && reads.every(read => ageFeed(read.readAt, now).state === 'unknown');
}

export function centralClock(at: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at));
}

/** One line, naming the late feed. Example: Updates delayed · unit list from 5:36 PM */
export function updatesDelayedLine(id: FeedId, readAt: number | null): string {
  const name = FEED_LINE[id];
  if (readAt === null) return 'Updates delayed · '+name;
  return 'Updates delayed · '+name+' from '+centralClock(readAt);
}

/** Grey caption. Example: Last known 186 / 196 · as of 5:36 PM */
export function lastKnownLine(known: string, readAt: number | null): string {
  if (readAt === null) return 'Last known '+known;
  return 'Last known '+known+' · as of '+centralClock(readAt);
}

export function fieldListLine(readAt: number | null): string {
  if (readAt === null) return 'Field list time unknown';
  return 'Field list as of '+centralClock(readAt);
}

export type ShownValue = {
  stale: boolean;
  text: string;
  note: string | null;
};

/** Live text when every input is fresh. Otherwise '?' and the last-known line. */
export function presentValue(
  liveText: string,
  knownText: string,
  inputs: readonly {readAt: number | string | null | undefined}[],
  now: number,
): ShownValue {
  const ages = inputs.map(input => ageFeed(input.readAt, now));
  if (worstFeed(ages).state === 'fresh') return {stale: false, text: liveText, note: null};
  const stamps = ages.map(age => age.readAt).filter((at): at is number => at !== null);
  const oldest = stamps.length ? Math.min(...stamps) : null;
  return {stale: true, text: '?', note: lastKnownLine(knownText, oldest)};
}
