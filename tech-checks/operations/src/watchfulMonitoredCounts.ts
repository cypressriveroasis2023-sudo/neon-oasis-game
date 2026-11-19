import {cameraTimestamp} from './cameraEvidence';
import {watchfulCanonicalUnitKey} from './watchfulUnitKey';
import {formatObservedCt, IN_SHOP_COLOR, IN_SHOP_LABEL, oldestObservationIso, WATCHFUL_OBSERVATION_FRESH_MS} from './watchfulObservation';
import {presentedFromWatchfulRead} from './watchfulReadStatus';

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
  /** Live arming is data. TestMode leaves the customer total before bucketing. */
  arming?: 'Auto' | 'TestMode' | 'Disarmed' | 'Paused';
  /** A marked archived project is not a Watchful customer unit. */
  projectArchived?: boolean;
  project?: string;
  projectId?: string | null;
  /** This row's read time. Null is Unknown and never borrows another row or the file time. */
  readAt?: string | null;
  recordCount?: number;
  link?: 'linked' | 'unlinked';
  /** Absent when the unit links by a Recon label instead of a hard key. */
  hardKey?: string | null;
  linkBy?: 'key' | 'recon_label';
};

export type MhelpCountUnit = {
  name: string;
  placement: 'FIELD' | 'SHOP' | 'OTHER';
  siteName?: string | null;
  /** Immix loads match this key only. A name never matches. */
  siteKey?: string | null;
  productId?: string;
  arming?: 'Auto' | 'TestMode' | 'Disarmed' | 'Paused';
  projectArchived?: boolean;
  project?: string;
  projectId?: string | null;
  /** Latest provider status. Unknown once it is 20 minutes past read time. */
  latestStatus?: 'up' | 'down';
  observedAt?: string;
  bucket?: 'b' | 'd';
  deployed?: boolean;
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
  productId: string | null;
  siteName: string;
  siteKey: string;
  source: 'immix';
  status: 'up' | 'down' | 'unknown';
  statusLabel: string;
  groupLabel: typeof IMMIX_GROUP_LABEL;
  watchful_excluded_by: 'test_mode' | null;
};

export type FieldNotMonitored = {
  name: string;
  productId: string | null;
  reason: 'Watchful project in TestMode';
  status: 'Field-not-monitored';
};

export type ArmingDrift = { name: string; from: 'test'; to: 'armed' };

export const TEST_MODE_REASON = 'Watchful project in TestMode' as const;

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
  upUnits: number | null;
  records: number | null;
  unlinked: number | null;
  unknownUnits: number | null;
  notInWatchful: {name: string; productId: string | null; bucket: 'b' | 'd'; deployed: boolean; mode?: string}[];
  notInWatchfulBuckets: {b: number; d: number};
  notArmed: number | null;
  notArmedUnits: {name: string; mode: string}[];
  armedUnits: number | null;
  /** Counted units whose arming value is missing. They stay visible, including how many are down. */
  armingUnknown: number | null;
  armingUnknownDown: number | null;
  armedCameras: {up: number; down: number; total: number} | null;
  armedSites: number | null;
  immixUp: number | null;
  immixDown: number | null;
  immixUnknown: number | null;
  fieldNotMonitored: FieldNotMonitored[];
  excludedTestLines: string[];
  drift: ArmingDrift[];
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
  upUnits: fresh ? 0 : null,
  records: fresh ? 0 : null,
  unlinked: fresh ? 0 : null,
  unknownUnits: fresh ? 0 : null,
  notInWatchful: [],
  notInWatchfulBuckets: {b: 0, d: 0},
  notArmed: fresh ? 0 : null,
  notArmedUnits: [],
  armedUnits: fresh ? 0 : null,
  armingUnknown: fresh ? 0 : null,
  armingUnknownDown: fresh ? 0 : null,
  armedCameras: fresh ? {up: 0, down: 0, total: 0} : null,
  armedSites: fresh ? 0 : null,
  immixUp: fresh ? 0 : null,
  immixDown: fresh ? 0 : null,
  immixUnknown: fresh ? 0 : null,
  fieldNotMonitored: [],
  excludedTestLines: [],
  drift: [],
  needsCheck: [],
  matchExceptions: [],
  amberFlags: [],
  monitoredOnImmix: [],
  shopReview: [],
  statusMismatches: [],
});

export function customerMonitoredName(name: string, doNotUse = false): boolean {
  if (doNotUse) return false;
  if (/do not use/i.test(name)) return false;
  return true;
}

function oldestObservation(values: readonly (string | null | undefined)[], now: number): string | null {
  return oldestObservationIso(values, now);
}

/**
 * The only monitored count. Watchful decides who is monitored and up or down.
 * mHelp decides Field or Shop. A Shop unit stays In Shop, counts 0, and is flagged.
 * Cameras and units stay separate. A missing or stale snapshot is Unknown.
 */
export function selectSharedMonitoredCount(input: {
  snapshot: readonly WatchfulCountUnit[] | null;
  snapshotAt?: string | null;
  /** Our read of Watchful. A fresh read keeps an old unit Down. A stale read is Unknown. */
  fetchedAt?: string | null;
  /** Accepted Immix site keys. A row with no key is never passed here. */
  immixKeys?: readonly string[];
  /** When true, a TestMode project leaves the Watchful customer total before bucketing. */
  testModeRule?: boolean;
  /** When true, an archived project counts as not in Watchful. Off leaves the totals unchanged. */
  archivedRule?: boolean;
  /** When our Watchful read was taken. Same clock as fetchedAt. Per-unit snapshotAt is not this clock. */
  watchfulReadAt?: string | null;
  watchfulReadFailed?: boolean;
  /** When our Immix read was taken. A missing time is Unknown, even if the Watchful read is fresh. */
  immixReadAt?: string | null;
  immixReadFailed?: boolean;
  /** Prior arming, so a flip back to armed is a drift item rather than a silent move. */
  previousArming?: Readonly<Record<string, string>>;
  /** Watchful project ids that are test sites. A name containing "test" is not a test site. */
  testProjectIds?: readonly string[];
  mhelp: readonly MhelpCountUnit[];
  now?: number;
}): SharedMonitoredCount {
  const now = input.now ?? Date.now();
  const observations = [
    ...(input.snapshot || []).map(unit => unit.snapshotAt),
    ...(input.snapshotAt ? [input.snapshotAt] : []),
  ];
  const oldestObservedAt = oldestObservation(observations, now);
  const readAt = input.fetchedAt ?? input.watchfulReadAt ?? null;
  const readKnown = presentedFromWatchfulRead({
    readAt,
    readFailed: input.watchfulReadFailed,
    watchfulStatus: 'down',
    now,
  }) === 'Down';
  if (!input.snapshot || oldestObservedAt === null || !readKnown) return empty(false, oldestObservedAt);
  const testProjects = new Set((input.testProjectIds || []).map(id => id.trim().toLowerCase()).filter(Boolean));
  let knownArming = 0;

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

  const immixKeys = new Set((input.immixKeys || []).map(key => key.trim()).filter(Boolean));
  const result = empty(true, oldestObservedAt);
  const sites = new Map<string, SiteCameraRow>();
  const armedSiteRows = new Map<string, SiteCameraRow>();
  let camerasUp = 0;
  let camerasDown = 0;
  let armedUp = 0;
  let armedDown = 0;
  const counted = new Set<string>();
  const countedNames = new Set<string>();

  for (const [key, unit] of watchful) {
    const sniper4100Name = unit.unitName.trim().toLowerCase() === 'sniper 4-100';
    const matches = sniper4100Name
      ? input.mhelp.filter(item => item.name.trim().toLowerCase() === 'sniper 4-100')
      : (mhelpByKey.get(key) || []);
    if (input.archivedRule && unit.projectArchived) {
      const placement = matches.find(item => item.placement === 'FIELD' || item.placement === 'SHOP');
      const mode = presentedArming({name: unit.unitName, arming: unit.arming});
      result.notInWatchful.push({
        name: unit.unitName,
        productId: placement?.productId || null,
        bucket: 'b',
        deployed: placement?.placement === 'FIELD',
        mode,
      });
      result.notInWatchfulBuckets.b += 1;
      if (mode === 'Disarmed' || mode === 'Paused') result.notArmed = (result.notArmed || 0) + 1;
      counted.add(key);
      continue;
    }
    if (unit.projectId && testProjects.has(unit.projectId.trim().toLowerCase())) continue;
    if (input.testModeRule && normalisedArming(unit.arming) === 'test') {
      if (unit.project) {
        const line = `${unit.project} · excluded test/Test Mode`;
        if (!result.excludedTestLines.includes(line)) result.excludedTestLines.push(line);
      }
      continue;
    }
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
    if (unit.readAt === null) {
      result.unknownUnits = (result.unknownUnits || 0) + 1;
      continue;
    }
    result.records = (result.records || 0) + (unit.recordCount ?? 1);
    if (unit.link === 'unlinked') result.unlinked = (result.unlinked || 0) + (unit.recordCount ?? 1);
    const mode = presentedArming({name: unit.unitName, arming: unit.arming});
    const heldOutOfDown = (mode === 'Paused' || mode === 'Disarmed') && unit.status === 'down';
    if (unit.status === 'down' && !heldOutOfDown) result.downUnits = (result.downUnits || 0) + 1;
    else if (unit.status !== 'down') result.upUnits = (result.upUnits || 0) + 1;
    if (mode === 'Unknown') {
      result.armingUnknown = (result.armingUnknown || 0) + 1;
      if (unit.status === 'down') result.armingUnknownDown = (result.armingUnknownDown || 0) + 1;
    }
    const parked = mode === 'Disarmed' || mode === 'Paused';
    if (mode !== 'Unknown') knownArming += 1;
    if (mode === 'Unknown' || mode === 'TestMode') {
      // Missing arming and Test Mode stay out of the armed headline.
    } else if (parked) {
      result.notArmed = (result.notArmed || 0) + 1;
      result.notArmedUnits.push({name: unit.unitName, mode});
    } else {
      result.armedUnits = (result.armedUnits || 0) + 1;
      armedUp += unit.camerasUp;
      armedDown += unit.camerasDown;
      if (unit.siteName) {
        const armedRow = armedSiteRows.get(unit.siteName) || {siteName: unit.siteName, units: 0, camerasUp: 0, camerasDown: 0};
        armedRow.units += 1;
        armedSiteRows.set(unit.siteName, armedRow);
      }
    }
    if (normalisedArming(input.previousArming?.[unit.unitName]) === 'test' && normalisedArming(unit.arming) === 'armed') {
      result.drift.push({name: unit.unitName, from: 'test', to: 'armed'});
    }
    if (sniper4100) {
      result.amberFlags.push({name: field[0].name, flag: SNIPER_4100_FLAG});
      countedNames.add(field[0].name.trim().toLowerCase());
    }
    if (!heldOutOfDown) {
      camerasUp += unit.camerasUp;
      camerasDown += unit.camerasDown;
    }
    if (unit.siteName) {
      const row = sites.get(unit.siteName) || {siteName: unit.siteName, units: 0, camerasUp: 0, camerasDown: 0};
      row.units += 1;
      if (!heldOutOfDown) {
        row.camerasUp += unit.camerasUp;
        row.camerasDown += unit.camerasDown;
      }
      sites.set(unit.siteName, row);
    }
    const cos = field[0].cosStatus;
    if ((cos === 'up' || cos === 'down') && cos !== unit.status) {
      result.statusMismatches.push({name: field[0].name, watchful: unit.status, cos});
    }
  }

  for (const unit of input.mhelp) {
    if (unit.placement !== 'FIELD' || !customerMonitoredName(unit.name, unit.doNotUse)) continue;
    if (unit.projectId && testProjects.has(unit.projectId.trim().toLowerCase())) continue;
    if (unit.stale) {
      result.needsCheck.push({name: unit.name, reason: STALE_MHELP_REASON});
      continue;
    }
    const key = watchfulCanonicalUnitKey(unit.name);
    if (countedNames.has(unit.name.trim().toLowerCase())) continue;
    if (key && counted.has(key)) continue;
    const watchfulArming = key ? watchful.get(key)?.arming : undefined;
    const matchedKey = typeof unit.siteKey === 'string' ? unit.siteKey.trim() : '';
    if (matchedKey && immixKeys.has(matchedKey)) {
      const reading = immixReadingStatus(input.immixReadAt, input.immixReadFailed, unit.latestStatus, now);
      result.monitoredOnImmix.push({
        name: unit.name,
        productId: unit.productId || null,
        siteName: (unit.siteName || '').trim().replace(/\s+/g, ' '),
        siteKey: matchedKey,
        source: 'immix',
        status: reading,
        statusLabel: reading === 'up' ? 'Up' : reading === 'down' ? 'Down' : IMMIX_STATUS_LABEL,
        groupLabel: IMMIX_GROUP_LABEL,
        watchful_excluded_by: normalisedArming(watchfulArming) === 'test' ? 'test_mode' : null,
      });
      if (reading === 'up') result.immixUp = (result.immixUp || 0) + 1;
      else if (reading === 'down') result.immixDown = (result.immixDown || 0) + 1;
      else result.immixUnknown = (result.immixUnknown || 0) + 1;
      continue;
    }
    if (input.testModeRule && normalisedArming(watchfulArming) === 'test') {
      result.fieldNotMonitored.push({
        name: unit.name,
        productId: unit.productId || null,
        reason: TEST_MODE_REASON,
        status: 'Field-not-monitored',
      });
      continue;
    }
    const bucket = unit.bucket === 'd' ? 'd' : 'b';
    result.notInWatchful.push({name: unit.name, productId: unit.productId || null, bucket, deployed: unit.deployed !== false});
    result.notInWatchfulBuckets[bucket] += 1;
  }

  result.siteRows = [...sites.values()].sort((left, right) => left.siteName.localeCompare(right.siteName));
  result.sites = result.siteRows.length;
  result.cameras = {up: camerasUp, down: camerasDown, total: camerasUp + camerasDown};
  result.armedCameras = {up: armedUp, down: armedDown, total: armedUp + armedDown};
  result.armedSites = armedSiteRows.size;
  if (knownArming === 0) result.armedUnits = null;
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

/** A fresh reading is up or down. A reading 20 minutes past read time is Unknown. */
export function immixReadingStatus(readAt: string | null | undefined, readFailed: boolean | undefined, latest: 'up' | 'down' | null | undefined, now: number): 'up' | 'down' | 'unknown' {
  if (readFailed || !readAt || !cameraTimestamp(readAt, now).fresh) return 'unknown';
  if (latest !== 'up' && latest !== 'down') return 'unknown';
  return latest;
}

/** Loader words. Auto and TestMode fold in so older fixtures still match. */
function normalisedArming(value: string | null | undefined): 'armed' | 'disarmed' | 'paused' | 'test' | 'unknown' | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s._-]+/g, '') : '';
  if (!raw) return null;
  if (raw === 'armed' || raw === 'auto') return 'armed';
  if (raw === 'disarmed') return 'disarmed';
  if (raw === 'paused') return 'paused';
  if (raw === 'test' || raw === 'testmode') return 'test';
  if (raw === 'unknown') return 'unknown';
  return 'unknown';
}

/** The mode is the arming value. A missing value is Unknown. A name that says Paused does not choose it. */
export function presentedArming(unit: { name?: string; arming?: string | null }): 'Auto' | 'TestMode' | 'Disarmed' | 'Paused' | 'Unknown' {
  const stored = normalisedArming(unit.arming);
  if (stored === 'disarmed') return 'Disarmed';
  if (stored === 'paused') return 'Paused';
  if (stored === 'test') return 'TestMode';
  if (stored === 'armed') return 'Auto';
  return 'Unknown';
}

/** A site key is split when a Watchful unit and a unit that is not Watchful both carry it. */
export function deriveSplitSiteKeys(units: readonly { siteKey?: string | null; watchful: boolean }[]): string[] {
  const seen = new Map<string, { watchful: boolean; other: boolean }>();
  for (const unit of units) {
    const key = typeof unit.siteKey === 'string' ? unit.siteKey.trim() : '';
    if (!key) continue;
    const row = seen.get(key) || { watchful: false, other: false };
    if (unit.watchful) row.watchful = true;
    else row.other = true;
    seen.set(key, row);
  }
  return [...seen.entries()].filter(([, row]) => row.watchful && row.other).map(([key]) => key).sort();
}

/** Immix status follows the latest fresh reading. A stale or missing reading stays Unknown. */
export function presentedImmixStatus(unit: ImmixMonitoredUnit): { status: 'up' | 'down' | 'unknown'; statusLabel: string } {
  return { status: unit.status, statusLabel: unit.statusLabel };
}

/** Every monitored headline asks this model. The path name is recorded so the callers stay one count. */
export const MONITORED_COUNT_PATHS = [
  'sharedFleetCounts',
  'camera-health.html',
  'TvFleetView',
  'FleetEquipmentTotals',
  'FleetDashboard',
] as const;

export type ImmixLoadRow = { siteKey?: string | null; siteName?: string };

/** An Immix row matches only when it has a site key. A name-only row is rejected. */
export function loadImmixRows(rows: readonly ImmixLoadRow[]): { accepted: {siteKey: string}[]; rejected: ImmixLoadRow[] } {
  const accepted: {siteKey: string}[] = [];
  const rejected: ImmixLoadRow[] = [];
  for (const row of rows) {
    if (typeof row.siteKey === 'string' && row.siteKey.trim()) accepted.push({siteKey: row.siteKey.trim()});
    else rejected.push(row);
  }
  return {accepted, rejected};
}

export function countForPath(path: typeof MONITORED_COUNT_PATHS[number], input: Parameters<typeof selectSharedMonitoredCount>[0]): SharedMonitoredCount {
  if (!MONITORED_COUNT_PATHS.includes(path)) throw new Error('Unknown monitored count path.');
  return selectSharedMonitoredCount(input);
}
