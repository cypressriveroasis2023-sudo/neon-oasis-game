import {cameraState, cameraTimestamp, type CameraRow} from './cameraEvidence';
import {canonicalCameraUnit} from './fieldCameraHealth';

export const VIA_WATCHFUL = 'via Watchful';
export const WATCHFUL_SNAPSHOT_FRESH_MS = 26 * 60 * 60 * 1000;
const IN_SHOP_LABEL = 'In Shop';

export type BoardWatchfulStatus = {
  canonicalUnitKey: string;
  status: 'up' | 'down';
  snapshotAt: string;
};

export type BoardPresentedStatus = {
  state: 'online' | 'offline' | 'unknown' | 'in_shop';
  label: string;
  viaWatchful: boolean;
};

const AVIGILON = /^(?:SNIPER2|SNIPER4|SNIPER|CAMV)\|/;

function freshWatchful(snapshotAt: string, now: number): boolean {
  const at = Date.parse(snapshotAt);
  return Number.isFinite(at) && at <= now && now - at <= WATCHFUL_SNAPSHOT_FRESH_MS;
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
