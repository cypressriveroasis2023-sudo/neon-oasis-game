import {watchfulCanonicalUnitKey} from './watchfulUnitKey';

const IN_SHOP_LABEL = 'In Shop';
const IN_SHOP_COLOR = '#64748b';

/** A reviewed Watchful snapshot older than this is Unknown, never Offline. */
export const WATCHFUL_SNAPSHOT_FRESH_MS = 26 * 60 * 60 * 1000;

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

export type SharedMonitoredCount = {
  fresh: boolean;
  units: number | null;
  sites: number | null;
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

const empty = (fresh: boolean): SharedMonitoredCount => ({
  fresh,
  units: fresh ? 0 : null,
  sites: fresh ? 0 : null,
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

function freshSnapshot(snapshotAt: string | null, now: number): boolean {
  if (!snapshotAt) return false;
  const at = Date.parse(snapshotAt);
  return Number.isFinite(at) && at <= now && now - at <= WATCHFUL_SNAPSHOT_FRESH_MS;
}

/**
 * The only monitored count. Watchful decides who is monitored and up or down.
 * mHelp decides Field or Shop. A Shop unit stays In Shop, counts 0, and is flagged.
 * Cameras and units stay separate. A missing or stale snapshot is Unknown.
 */
export function selectSharedMonitoredCount(input: {
  snapshot: readonly WatchfulCountUnit[] | null;
  snapshotAt?: string | null;
  mhelp: readonly MhelpCountUnit[];
  now?: number;
}): SharedMonitoredCount {
  const now = input.now ?? Date.now();
  const snapshotAt = input.snapshotAt ?? input.snapshot?.[0]?.snapshotAt ?? null;
  if (!input.snapshot || !freshSnapshot(snapshotAt, now)) return empty(false);

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

  const result = empty(true);
  const sites = new Set<string>();
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
    if (unit.siteName) sites.add(unit.siteName);
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

  result.sites = sites.size;
  result.cameras = {up: camerasUp, down: camerasDown, total: camerasUp + camerasDown};
  return result;
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
