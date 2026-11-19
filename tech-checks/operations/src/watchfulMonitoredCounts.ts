import {cameraTimestamp} from './cameraEvidence';
import {watchfulCanonicalUnitKey} from './watchfulUnitKey';
import {formatObservedCt, IN_SHOP_COLOR, IN_SHOP_LABEL, oldestObservationIso, WATCHFUL_OBSERVATION_FRESH_MS} from './watchfulObservation';

export {formatObservedCt, IN_SHOP_COLOR, IN_SHOP_LABEL, WATCHFUL_OBSERVATION_FRESH_MS};

export const SHOP_REVIEW_FLAG = 'Watchful says at site, mHelp says Shop';
export const IMMIX_GROUP_LABEL = 'Monitored on Immix';
export const IMMIX_STATUS_LABEL = 'Unknown';
export const STALE_MHELP_REASON = 'Stale mHelp record needs a check';
export const SNIPER_4100_FLAG = 'Watchful: down (record named SHOP) · mHelp: Field · Router swap in progress, unconfirmed · counted as down to match Watchful.';

export type MonitoredSource = 'watchful' | 'immix';

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
  siteName?: string | null;
  doNotUse?: boolean;
  /** A stale mHelp record is reported for a check. It is not Immix and not pending. */
  stale?: boolean;
  /** What COS currently shows, so a disagreement can be listed. It does not replace Watchful. */
  cosStatus?: 'up' | 'down' | 'unknown';
};

export type NeedsCheck = { name: string; reason: typeof STALE_MHELP_REASON };
export type MatchException = { name: string; reason: string };
export type AmberFlag = { name: string; flag: typeof SNIPER_4100_FLAG };

export type ImmixMonitoredUnit = {
  name: string;
  siteName: string;
  source: 'immix';
  status: 'unknown';
  statusLabel: 'Unknown';
  groupLabel: typeof IMMIX_GROUP_LABEL;
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
  downUnits: number | null;
  unknownUnits: number | null;
  notInWatchful: {name: string}[];
  needsCheck: NeedsCheck[];
  matchExceptions: MatchException[];
  amberFlags: AmberFlag[];
  monitoredOnImmix: ImmixMonitoredUnit[];
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
  downUnits: fresh ? 0 : null,
  unknownUnits: fresh ? 0 : null,
  notInWatchful: [],
  needsCheck: [],
  matchExceptions: [],
  amberFlags: [],
  monitoredOnImmix: [],
  shopReview: [],
  statusMismatches: [],
});

function siteKey(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

export function customerMonitoredName(name: string, doNotUse = false): boolean {
  if (doNotUse) return false;
  if (name.toLowerCase().includes('test')) return false;
  if (/do not use/i.test(name)) return false;
  return true;
}

function oldestObservation(values: readonly string[]): string | null {
  return oldestObservationIso(values);
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
  /** Site names monitored on Immix instead of Watchful. Loaded later; not committed. */
  immixSites?: readonly string[];
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

  const immixSites = new Set((input.immixSites || []).map(siteKey).filter(Boolean));
  const result = empty(true, oldestObservedAt);
  const sites = new Map<string, SiteCameraRow>();
  let camerasUp = 0;
  let camerasDown = 0;
  const counted = new Set<string>();
  const countedNames = new Set<string>();

  for (const [key, unit] of watchful) {
    const sniper4100Name = unit.unitName.trim().toLowerCase() === 'sniper 4-100';
    const matches = sniper4100Name
      ? input.mhelp.filter(item => item.name.trim().toLowerCase() === 'sniper 4-100')
      : (mhelpByKey.get(key) || []);
    const shop = matches.filter(item => item.placement === 'SHOP');
    const field = matches.filter(item => item.placement === 'FIELD' && customerMonitoredName(item.name, item.doNotUse));
    if (shop.length && !field.length) {
      result.inShop += 1;
      result.shopReview.push({name: shop[0].name, flag: SHOP_REVIEW_FLAG});
      continue;
    }
    if (field.length === 0) {
      result.matchExceptions.push({name: unit.unitName, reason: 'Watchful unit has no mHelp Field match'});
      continue;
    }
    if (field.length !== 1) {
      result.matchExceptions.push({name: unit.unitName, reason: `Watchful unit has ${field.length} mHelp Field matches`});
      continue;
    }
    const sniper4100 = unit.unitName.trim().toLowerCase() === 'sniper 4-100' && unit.status === 'down';
    counted.add(key);
    result.units = (result.units || 0) + 1;
    if (unit.status === 'down') result.downUnits = (result.downUnits || 0) + 1;
    if (sniper4100) {
      result.amberFlags.push({name: field[0].name, flag: SNIPER_4100_FLAG});
      countedNames.add(field[0].name.trim().toLowerCase());
    }
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
    if (unit.stale) {
      result.needsCheck.push({name: unit.name, reason: STALE_MHELP_REASON});
      continue;
    }
    const key = watchfulCanonicalUnitKey(unit.name);
    if (countedNames.has(unit.name.trim().toLowerCase())) continue;
    if (key && counted.has(key)) continue;
    if (immixSites.has(siteKey(unit.siteName))) {
      result.monitoredOnImmix.push({
        name: unit.name,
        siteName: (unit.siteName || '').trim().replace(/\s+/g, ' '),
        source: 'immix',
        status: 'unknown',
        statusLabel: IMMIX_STATUS_LABEL,
        groupLabel: IMMIX_GROUP_LABEL,
      });
      continue;
    }
    result.notInWatchful.push({name: unit.name});
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

/** Immix has no live status. The label is Unknown, never up or down. */
export function presentedImmixStatus(unit: ImmixMonitoredUnit): { status: 'unknown'; statusLabel: typeof IMMIX_STATUS_LABEL } {
  return { status: 'unknown', statusLabel: unit.statusLabel };
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
