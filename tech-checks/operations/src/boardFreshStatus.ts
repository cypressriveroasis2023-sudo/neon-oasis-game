import {CAMERA_FRESH_MS, cameraState, cameraTimestamp, type CameraRow} from './cameraEvidence';
import {CAMERA_AUTO_REFRESH_MS} from './refreshCadence';
import {canonicalCameraUnit} from './fieldCameraHealth';

export const VIA_WATCHFUL = 'via Watchful';
/** Watchful is fresh for the same 20 minutes as a camera observation. This is not widened. */
export const WATCHFUL_OBSERVATION_FRESH_MS = CAMERA_FRESH_MS;
/** The pull matches the saved camera cadence. */
export const WATCHFUL_PULL_CADENCE_MS = CAMERA_AUTO_REFRESH_MS;
/** The TV banner, separate from the 20-minute Unknown rule. */
export const TV_READ_STALE_MS = 120_000;
export const WATCHFUL_BANNER_AGE_MS = 12 * 60 * 1000;
const IN_SHOP_LABEL = 'In Shop';
let oldestWatchfulObservation: string | null = null;

/** The time the board stamps: the oldest Watchful observation, not the newest and not the fetch. */
export function watchfulOldestObservedAt(): string | null {
  return oldestWatchfulObservation;
}

export function noteWatchfulOldest(value: string | null) {
  oldestWatchfulObservation = value;
}

export type BoardWatchfulStatus = {
  canonicalUnitKey: string;
  status: 'up' | 'down';
  /** Oldest observation time in the snapshot. Not the time the file was fetched. */
  snapshotAt: string;
  fetchedAt?: string | null;
};

export type BoardPresentedStatus = {
  state: 'online' | 'offline' | 'unknown' | 'in_shop';
  label: string;
  viaWatchful: boolean;
};

const AVIGILON = /^(?:SNIPER2|SNIPER4|SNIPER|CAMV)\|/;

function freshWatchful(snapshotAt: string, now: number): boolean {
  return cameraTimestamp(snapshotAt, now).fresh;
}

/** UPDATES DELAYED when the last good read is over 120 seconds old, or the oldest Watchful observation is over 12 minutes old. */
export function tvUpdatesDelayed(input: {
  lastSuccessAt: number | null;
  now: number;
  sameDay?: boolean;
  watchfulOldestObservedAt?: string | null;
}): boolean {
  const readLate = input.lastSuccessAt !== null && Number.isFinite(input.lastSuccessAt) && input.now - input.lastSuccessAt > TV_READ_STALE_MS;
  const wrongDay = input.sameDay === false && input.lastSuccessAt !== null;
  if (!input.watchfulOldestObservedAt) return readLate || wrongDay;
  const stamp = cameraTimestamp(input.watchfulOldestObservedAt, input.now);
  const observedAt = stamp.at ? Date.parse(stamp.at) : NaN;
  const watchfulLate = !stamp.fresh || !Number.isFinite(observedAt) || input.now - observedAt > WATCHFUL_BANNER_AGE_MS;
  return readLate || wrongDay || watchfulLate;
}

/**
 * Fresh camera readings win. A stale reading stays Unknown, never Offline.
 * Shop stays In Shop. An Avigilon unit with no fresh live reading may show a
 * fresh Watchful status labeled "via Watchful"; that label is not a live Online.
 */
export function boardUnitStatus(input: {
  unitName: string;
  placement: 'field' | 'shop' | 'unknown';
  readings: readonly CameraRow[];
  watchful?: BoardWatchfulStatus | null;
  now?: number;
}): BoardPresentedStatus {
  const now = input.now ?? Date.now();
  if (input.placement === 'shop') return {state: 'in_shop', label: IN_SHOP_LABEL, viaWatchful: false};
  const key = canonicalCameraUnit(input.unitName);
  const matched = key ? input.readings.filter(row => canonicalCameraUnit(row.unit || row.name || '') === key) : [];
  let freshOnline = false;
  let freshOffline = false;
  for (const row of matched) {
    const state = cameraState(row, now);
    const stamp = cameraTimestamp(row.evidence?.observedAt || row.checkedAt, now);
    if (!stamp.fresh) continue;
    if (state === 'online') freshOnline = true;
    if (state === 'offline') freshOffline = true;
  }
  if (freshOffline) return {state: 'offline', label: 'Offline', viaWatchful: false};
  if (freshOnline) return {state: 'online', label: 'Online', viaWatchful: false};
  const watchful = input.watchful;
  if (key && AVIGILON.test(key) && watchful && watchful.canonicalUnitKey === key && freshWatchful(watchful.snapshotAt, now)) {
    const word = watchful.status === 'up' ? 'Up' : 'Down';
    return {state: 'unknown', label: `${word} ${VIA_WATCHFUL}`, viaWatchful: true};
  }
  return {state: 'unknown', label: 'Unknown', viaWatchful: false};
}

type BoardRow = {
  name: string;
  placement: string;
  cameraState: string;
  review: string[];
  camera?: {state?: string};
};

/** Only an Unknown field unit changes. A fresh camera reading replaces Unknown. Shop is left alone. */
export function applyBoardFreshStatus<T extends BoardRow>(rows: readonly T[], readings: readonly CameraRow[], watchful: readonly BoardWatchfulStatus[] | null, now = Date.now()): T[] {
  if (watchful) {
    const times = watchful.map(item => Date.parse(item.snapshotAt)).filter(at => Number.isFinite(at));
    noteWatchfulOldest(times.length ? new Date(Math.min(...times)).toISOString() : null);
  }
  const byKey = new Map((watchful || []).map(item => [item.canonicalUnitKey, item]));
  return rows.map(row => {
    if (row.placement !== 'field' || row.cameraState !== 'unknown') return row;
    const key = canonicalCameraUnit(row.name);
    const presented = boardUnitStatus({
      unitName: row.name,
      placement: 'field',
      readings,
      watchful: key ? byKey.get(key) || null : null,
      now,
    });
    if (presented.state === 'online' || presented.state === 'offline') {
      return {...row, cameraState: presented.state, ...(row.camera ? {camera: {...row.camera, state: presented.state}} : {})};
    }
    if (presented.viaWatchful && !row.review.includes(presented.label)) return {...row, review: [...row.review, presented.label]};
    return row;
  });
}

export function newestObservedAt(rows: readonly {evidence?: {observedAt?: string | null} | null; checkedAt?: string | null}[] | null | undefined, now = Date.now()): number | null {
  let newest: number | null = null;
  for (const row of rows || []) {
    const stamp = cameraTimestamp(row.evidence?.observedAt || row.checkedAt, now);
    if (!stamp.at) continue;
    const at = Date.parse(stamp.at);
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}
