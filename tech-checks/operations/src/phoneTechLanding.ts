import type {SavedFleetReading} from './savedFleetReading';
import {technicianTodos, type TechnicianTodo} from './technicianTodos';

export type PhoneCount = number | '—';

export type PhoneBoardCounts = {
  up: PhoneCount;
  down: PhoneCount;
  unknown: PhoneCount;
  note: string;
  stale: boolean;
};

type LiveCounts = { online: number; offline: number; unknown: number; checkedAt: number };

/** Field camera counts only. Shop is not an input to down, and unknown stays
 * its own number. A saved reading paints immediately and is labeled not current
 * until a board inside the current window replaces it. */
export function phoneBoardCounts(input: {
  now: number;
  windowMs: number;
  saved: SavedFleetReading | null;
  live: LiveCounts | null;
  shop?: number;
}): PhoneBoardCounts {
  const liveCurrent = Boolean(input.live && [input.live.online, input.live.offline, input.live.unknown, input.live.checkedAt].every(Number.isFinite) && input.now >= input.live.checkedAt && input.now - input.live.checkedAt <= input.windowMs);
  const source = liveCurrent && input.live
    ? { online: input.live.online, offline: input.live.offline, unknown: input.live.unknown, checkedAt: input.live.checkedAt }
    : input.saved
      ? { online: input.saved.online, offline: input.saved.offline, unknown: input.saved.unverified, checkedAt: input.saved.checkedAt }
      : null;
  if (!source) return { up: '—', down: '—', unknown: '—', note: 'No completed reading yet.', stale: false };
  const time = new Date(source.checkedAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return {
    up: source.online,
    down: source.offline,
    unknown: source.unknown,
    stale: !liveCurrent,
    note: liveCurrent ? 'Reading ' + time + '.' : 'Last completed reading ' + time + ' · not current.',
  };
}

type PhoneRow = { name: string; placement: 'field' | 'shop' | 'unknown' | string; cameraState: 'online' | 'offline' | 'unknown' | 'support' | string; support?: boolean };

/** Same evidence rules as the technician list. Unknown is not a job. Shop is not an outage. */
export function phoneTechnicianTodos(rows: PhoneRow[], addresses: { unit: string; productId?: string; placement?: string }[] = []): TechnicianTodo[] {
  return technicianTodos({
    cameras: rows.filter(row => !row.support).map(row => ({
      unit: row.name,
      placement: row.placement === 'shop' ? 'SHOP' : row.placement === 'field' ? 'FIELD' : 'UNKNOWN',
      state: row.cameraState === 'offline' ? 'RED' : row.cameraState === 'online' ? 'GREEN' : 'UNKNOWN',
      offline: row.cameraState === 'offline' ? 1 : 0,
    })),
    addresses,
  });
}
