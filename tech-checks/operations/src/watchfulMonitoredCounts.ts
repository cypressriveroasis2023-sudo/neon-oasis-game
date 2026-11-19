import {CAMERA_FRESH_MS, cameraTimestamp} from './cameraEvidence';
import {watchfulCanonicalUnitKey} from './watchfulUnitKey';

const IN_SHOP_LABEL = 'In Shop';
const IN_SHOP_COLOR = '#64748b';

/** Same 20-minute observation window as a camera reading. Not the fetch time, and not widened. */
export const WATCHFUL_OBSERVATION_FRESH_MS = CAMERA_FRESH_MS;

export const SHOP_REVIEW_FLAG = 'Watchful says at site, mHelp says Shop';

export type WatchfulCountUnit = {
  unitName: string;
  canonicalUnitKey: string;
  siteName: string;
  status: 'up' | 'down';
  camerasUp: number;
  camerasDown: number;
  snapshotAt: string;
};

export type MhelpCountUnit = {
  name: string;
  placement: 'FIELD' | 'SHOP' | 'OTHER';
  doNotUse?: boolean;
  /** What COS currently shows, so a disagreement can be listed. It does not replace Watchful. */
  cosStatus?: 'up' | 'down' | 'unknown';
};

export type StatusMismatch = {
  name: string;
  watchful: 'up' | 'down';
  cos: 'up' | 'down';
};

export type SiteCameraRow = { siteName: string; units: number; camerasUp: number; camerasDown: number };

export type SharedMonitoredCount = {
  fresh: boolean;
  /** Oldest observation in the snapshot. The UI stamps this, not the newest and not the fetch. */
  oldestObservedAt: string | null;
  units: number | null;
  sites: number | null;
  siteRows: SiteCameraRow[];
  cameras: {up: number; down: number; total: number} | null;
  inShop: number;
  inShopLabel: typeof IN_SHOP_LABEL;
  inShopColor: typeof IN_SHOP_COLOR;
  offlineUnits: number | null;
  unknownUnits: number | null;
  notInWatchful: {name: string}[];
  shopReview: {name: string; flag: typeof SHOP_REVIEW_FLAG}[];
  statusMismatches: StatusMismatch[];
};

const empty = (fresh: boolean, oldestObservedAt: string | null = null): SharedMonitoredCount => ({
  fresh,
  oldestObservedAt,
  units: fresh ? 0 : null,
  sites: fresh ? 0 : null,
  siteRows: [],
  cameras: fresh ? {up: 0, down: 0, total: 0} : null,
  inShop: 0,
  inShopLabel: IN_SHOP_LABEL,
  inShopColor: IN_SHOP_COLOR,
  offlineUnits: fresh ? 0 : null,
  unknownUnits: fresh ? 0 : null,
  notInWatchful: [],
  shopReview: [],
  statusMismatches: [],
});

export function customerMonitoredName(name: string, doNotUse = false): boolean {
  if (doNotUse) return false;
  if (name.toLowerCase().includes('test')) return false;
  if (/do not use/i.test(name)) return false;
  return true;
}

function oldestObservation(values: readonly string[]): string | null {
  let oldest = Number.POSITIVE_INFINITY;
  if (!values.length) return null;
  for (const value of values) {
    const stamp = cameraTimestamp(value, Number.MAX_SAFE_INTEGER);
    const at = stamp.at ? Date.parse(stamp.at) : NaN;
    if (!Number.isFinite(at)) return null;
    if (at < oldest) oldest = at;
  }
  return new Date(oldest).toISOString();
}

function freshSnapshot(observedAt: string | null, now: number): boolean {
  return observedAt !== null && cameraTimestamp(observedAt, now).fresh;
}

/**
 * The only monitored count. Watchful decides who is monitored and up or down.
 * mHelp decides Field or Shop. A Shop unit stays In Shop, counts 0, and is flagged.
 * Cameras and units stay separate. A missing or stale snapshot is Unknown.
 */
export function selectSharedMonitoredCount(input: {
  snapshot: readonly WatchfulCountUnit[] | null;
  snapshotAt?: string | null;
  /** Ignored. Freshness uses the oldest observation, not the fetch. */
  fetchedAt?: string | null;
  mhelp: readonly MhelpCountUnit[];
  now?: number;
}): SharedMonitoredCount {
  const now = input.now ?? Date.now();
  const observations = [
    ...(input.snapshot || []).map(unit => unit.snapshotAt),
    ...(input.snapshotAt ? [input.snapshotAt] : []),
  ];
  const oldestObservedAt = oldestObservation(observations);
  if (!input.snapshot || !freshSnapshot(oldestObservedAt, now)) return empty(false, oldestObservedAt);

  const watchful = new Map<string, WatchfulCountUnit>();
  for (const unit of input.snapshot) {
    if (!watchful.has(unit.canonicalUnitKey)) watchful.set(unit.canonicalUnitKey, unit);
  }
  const mhelpByKey = new Map<string, MhelpCountUnit[]>();
  for (const unit of input.mhelp) {
    const key = watchfulCanonicalUnitKey(unit.name);
    if (!key) continue;
    const list = mhelpByKey.get(key) || [];
    list.push(unit);
    mhelpByKey.set(key, list);
  }

  const result = empty(true, oldestObservedAt);
  const sites = new Map<string, SiteCameraRow>();
  let camerasUp = 0;
  let camerasDown = 0;
  const counted = new Set<string>();

  for (const [key, unit] of watchful) {
    const matches = mhelpByKey.get(key) || [];
    const shop = matches.filter(item => item.placement === 'SHOP');
    const field = matches.filter(item => item.placement === 'FIELD' && customerMonitoredName(item.name, item.doNotUse));
    if (shop.length && !field.length) {
      result.inShop += 1;
      result.shopReview.push({name: shop[0].name, flag: SHOP_REVIEW_FLAG});
      continue;
    }
    if (field.length !== 1) continue;
    counted.add(key);
    result.units = (result.units || 0) + 1;
    if (unit.status === 'down') result.offlineUnits = (result.offlineUnits || 0) + 1;
    camerasUp += unit.camerasUp;
    camerasDown += unit.camerasDown;
    if (unit.siteName) {
      const row = sites.get(unit.siteName) || {siteName: unit.siteName, units: 0, camerasUp: 0, camerasDown: 0};
      row.units += 1;
      row.camerasUp += unit.camerasUp;
      row.camerasDown += unit.camerasDown;
      sites.set(unit.siteName, row);
    }
    const cos = field[0].cosStatus;
    if ((cos === 'up' || cos === 'down') && cos !== unit.status) {
      result.statusMismatches.push({name: field[0].name, watchful: unit.status, cos});
    }
  }

  for (const unit of input.mhelp) {
    if (unit.placement !== 'FIELD' || !customerMonitoredName(unit.name, unit.doNotUse)) continue;
    const key = watchfulCanonicalUnitKey(unit.name);
    if (!key || !counted.has(key)) result.notInWatchful.push({name: unit.name});
  }

  result.siteRows = [...sites.values()].sort((left, right) => left.siteName.localeCompare(right.siteName));
  result.sites = result.siteRows.length;
  result.cameras = {up: camerasUp, down: camerasDown, total: camerasUp + camerasDown};
  return result;
}

/**
 * unit_status is only up or down. A missing or stale snapshot is Unknown.
 * A Shop unit is In Shop, never down.
 */
export function presentedWatchfulStatus(input: {
  snapshotFresh: boolean;
  mhelpPlacement: 'FIELD' | 'SHOP' | 'OTHER' | null;
  unitStatus: 'up' | 'down' | null;
}): 'Unknown' | 'In Shop' | 'up' | 'down' {
  if (!input.snapshotFresh || (input.unitStatus !== 'up' && input.unitStatus !== 'down')) return 'Unknown';
  if (input.mhelpPlacement === 'SHOP') return 'In Shop';
  return input.unitStatus;
}

/** Every monitored headline asks this model. The path name is recorded so the callers stay one count. */
export const MONITORED_COUNT_PATHS = [
  'sharedFleetCounts',
  'camera-health.html',
  'TvFleetView',
  'FleetEquipmentTotals',
  'FleetDashboard',
] as const;

export function countForPath(path: typeof MONITORED_COUNT_PATHS[number], input: Parameters<typeof selectSharedMonitoredCount>[0]): SharedMonitoredCount {
  if (!MONITORED_COUNT_PATHS.includes(path)) throw new Error('Unknown monitored count path.');
  return selectSharedMonitoredCount(input);
}
