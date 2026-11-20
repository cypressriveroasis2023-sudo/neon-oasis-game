import {CAMERA_FRESH_MS, cameraTimestamp, resourceKind, type CameraRow} from './cameraEvidence';
import {countForPath} from './watchfulMonitoredCounts';
import {exactUnitName, ROUTER_FRESHNESS_MS, type RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import {unitVerdict, type UnitCameraStatus} from '../shared/starUnitStatus';
import {decideShopCameras, liveFeedShopRows} from '../shared/shopCameraStatus';
import type {TechnicianTodo} from './technicianTodos';

/** Shop placement is a label, not a health state. */
export const IN_SHOP_LABEL = 'In Shop';
export const IN_SHOP_COLOR = '#64748b';

export type CountTriple = { online: number; offline: number; unknown: number };

export type UnverifiedReason =
  | 'no_recorder_link'
  | 'no_router_link'
  | 'stale_reading'
  | 'no_reading'
  | 'identity_hold'
  | 'no_device_link'
  | 'source_conflict'
  | 'address_unmapped';

export const UNVERIFIED_REASON_LABEL: Record<UnverifiedReason, string> = {
  no_recorder_link: 'No recorder link',
  no_router_link: 'No router link',
  stale_reading: 'Stale reading',
  no_reading: 'No reading',
  identity_hold: 'Identity or placement hold',
  no_device_link: 'No recorder or device link',
  source_conflict: 'Sources disagree',
  address_unmapped: 'Address could not be mapped',
};

export type FleetCountSnapshot = {
  cameras: CountTriple;
  units: CountTriple;
  inShopUnits: number;
  /** Shop, DO NOT USE. Out of the field totals, on its own line. */
  doNotUseUnits: number;
  /** DO NOT USE that mHelp still places in Field, including the reviewed Sniper 318 case. Out of every total. */
  exceptionUnits: number;
  unverified: Record<UnverifiedReason, number>;
  /** Field problems only. The count on every screen is this list's length. */
  problems: TechnicianTodo[];
};

export type CountCamera = { state: 'online' | 'offline' | 'unknown'; observedAt: string | null };

export type CountUnit = {
  name: string;
  placement: 'field' | 'shop' | 'unknown';
  cameras: CountCamera[];
  newestOnlineAt: number | null;
  unverifiedReason: UnverifiedReason | null;
  deviceId?: string | null;
  serial?: string | null;
  /** mHelp DO NOT USE. Excluded from field totals. Field + DO NOT USE is the Sniper 318 exception. */
  doNotUse?: boolean;
  /** Named exception. Out of every total, including the DO NOT USE line. */
  exception?: boolean;
};

/** Watchful names this record SHOP. mHelp says Field. It counts as down. */
export function isSniper4100(name: string): boolean {
  const folded = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return folded === 'sniper 4 100' || folded.replace(/ /g, '') === 'sniper4100';
}

const FIELD_PROBLEM_KINDS = new Set(['camera_offline', 'router_offline', 'battery_alarm']);

/** power_silent stays out until a fresh Victron feed can gate it. Cleanup kinds are not Problems. */
export function fieldProblemList(problems: readonly TechnicianTodo[] = []): TechnicianTodo[] {
  return problems.filter(problem => FIELD_PROBLEM_KINDS.has(problem.kind));
}

const emptyTriple = (): CountTriple => ({ online: 0, offline: 0, unknown: 0 });

export function emptyUnverifiedReasons(): Record<UnverifiedReason, number> {
  return {
    no_recorder_link: 0, no_router_link: 0, stale_reading: 0, no_reading: 0,
    identity_hold: 0, no_device_link: 0, source_conflict: 0, address_unmapped: 0,
  };
}

/** A missing or stale camera is Unknown. Offline requires a fresh confirmed miss. */
export function presentedCameraState(camera: CountCamera, now = Date.now()): 'online' | 'offline' | 'unknown' {
  const stamp = cameraTimestamp(camera.observedAt, now);
  if (!stamp.fresh || now - Date.parse(stamp.at || '') > CAMERA_FRESH_MS) return 'unknown';
  if (camera.state === 'online') return 'online';
  if (camera.state === 'offline') return 'offline';
  return 'unknown';
}

function tallyFieldUnit(unit: CountUnit, cameras: CountTriple, unitCounts: CountTriple, unverified: Record<UnverifiedReason, number>, now: number) {
  const states = unit.cameras.map(camera => presentedCameraState(camera, now));
  const online = states.filter(state => state === 'online').length;
  const offline = states.filter(state => state === 'offline').length;
  const unknown = states.length - online - offline;
  cameras.online += online;
  cameras.offline += offline;
  cameras.unknown += unknown;
  const verdict = unitVerdict(online, offline, unknown);
  if (verdict === 'GREEN') unitCounts.online += 1;
  else if (verdict === 'RED' || verdict === 'YELLOW') unitCounts.offline += 1;
  else {
    unitCounts.unknown += 1;
    const reason = unit.unverifiedReason
      ?? (states.length === 0 ? 'no_reading'
        : unit.cameras.some(camera => camera.state === 'offline' && presentedCameraState(camera, now) === 'unknown') ? 'stale_reading'
        : 'no_reading');
    unverified[reason] += 1;
  }
}

/**
 * The only headline counter. Shop units add 0 to every field total.
 * DO NOT USE is excluded. A DO NOT USE unit mHelp still places in Field
 * (the reviewed Sniper 318 case) is out of every total.
 * Unknown placement counts as Unknown, never as a field online or offline unit.
 * Sniper 4-100 counts as down when its reading is a fresh offline.
 * Camera status, the map, the TV, the phone and equipment totals all call this.
 */
export function selectFleetCounts(units: readonly CountUnit[], now = Date.now(), problems: readonly TechnicianTodo[] = []): FleetCountSnapshot {
  const cameras = emptyTriple();
  const unitCounts = emptyTriple();
  const unverified = emptyUnverifiedReasons();
  let inShopUnits = 0;
  let doNotUseUnits = 0;
  let exceptionUnits = 0;
  for (const unit of units) {
    if (isSniper4100(unit.name)) {
      tallyFieldUnit(unit, cameras, unitCounts, unverified, now);
      continue;
    }
    if (unit.exception === true || (unit.doNotUse === true && unit.placement === 'field')) {
      exceptionUnits += 1;
      continue;
    }
    if (unit.doNotUse === true) {
      doNotUseUnits += 1;
      continue;
    }
    if (unit.placement === 'shop') {
      inShopUnits += 1;
      continue;
    }
    if (unit.placement === 'unknown') {
      unitCounts.unknown += 1;
      cameras.unknown += unit.cameras.length;
      unverified[unit.unverifiedReason ?? 'identity_hold'] += 1;
      continue;
    }
    tallyFieldUnit(unit, cameras, unitCounts, unverified, now);
  }
  const listed = fieldProblemList(problems);
  return { cameras, units: unitCounts, inShopUnits, doNotUseUnits, exceptionUnits, unverified, problems: listed };
}

export type ViewHeadlines = { cameras: CountTriple; units: CountTriple };

export function cameraStatusHeadline(units: readonly CountUnit[], now = Date.now()): ViewHeadlines {
  const snapshot = selectFleetCounts(units, now);
  return { cameras: snapshot.cameras, units: snapshot.units };
}

/**
 * The only camera headline. Camera status, the map, and About pass this result through.
 * A missing or failed camera-status feed is not replaced with map rows.
 * Recorder names attach only inside this call, and only by exact normalized unit name.
 */
export function fleetCountsFromCameraFeed(
  units: readonly UnitCameraStatus[] | null,
  recorders: readonly RecorderLink[] = [],
  now = Date.now(),
  fieldMap?: unknown,
  problems: readonly TechnicianTodo[] = [],
): FleetCountSnapshot | null {
  if (!units) return null;
  let census = applyExactRecorderLinks(censusFromCameraUnits(units, now), recorders, now);
  if (fieldMap !== undefined) {
    const report = decideShopCameras(liveFeedShopRows(units, fieldMap).inputs);
    census = census.map(unit => {
      const decision = report.byUnit.get(unit.name.trim().toUpperCase());
      if (!decision || isSniper4100(unit.name)) return unit;
      if (decision.category === 'exception') return { ...unit, doNotUse: true, exception: true };
      if (decision.category === 'doNotUse') return { ...unit, doNotUse: true };
      if (decision.category === 'inShop') return { ...unit, placement: 'shop', cameras: [] };
      return unit;
    });
  }
  return selectFleetCounts(census, now, problems);
}

export function mapHeadline(units: readonly CountUnit[], now = Date.now()): ViewHeadlines {
  return cameraStatusHeadline(units, now);
}

export function aboutHeadline(units: readonly CountUnit[], now = Date.now()): ViewHeadlines {
  return cameraStatusHeadline(units, now);
}

function cameraFromStatus(status: string, observedAt: string | null): CountCamera {
  const state = status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'unknown';
  return { state, observedAt };
}

/** Star / unit-camera-status rows. Shop is kept so it can be shown as In Shop and then ignored by the totals. */
export function censusFromCameraUnits(units: readonly UnitCameraStatus[], now = Date.now()): CountUnit[] {
  return units.map(unit => {
    const marked = unit as UnitCameraStatus & { doNotUse?: boolean; exception?: boolean };
    const placement = isSniper4100(unit.unit) ? 'field' : unit.placement === 'SHOP' ? 'shop' : unit.placement === 'FIELD' ? 'field' : 'unknown';
    const listed = (unit.cameraList || []).filter(camera => !camera.removed && (placement !== 'field' || camera.atSite !== false));
    const cameras = listed.length
      ? listed.map(camera => cameraFromStatus(camera.status, unit.observedAt))
      : [
        ...Array.from({ length: unit.online || 0 }, () => cameraFromStatus('online', unit.observedAt)),
        ...Array.from({ length: unit.offline || 0 }, () => cameraFromStatus('offline', unit.observedAt)),
        ...Array.from({ length: unit.unknown || 0 }, () => cameraFromStatus('unknown', unit.observedAt)),
      ];
    const onlineAt = unit.observedAt && cameras.some(camera => camera.state === 'online' && presentedCameraState(camera, now) === 'online')
      ? Date.parse(unit.observedAt) : NaN;
    return {
      name: unit.unit,
      placement,
      cameras: placement === 'shop' ? [] : cameras,
      newestOnlineAt: Number.isFinite(onlineAt) ? onlineAt : null,
      unverifiedReason: null,
      doNotUse: marked.doNotUse === true,
      exception: marked.exception === true,
    };
  });
}

export type DashboardCountRow = {
  name: string;
  placement: string;
  support?: boolean;
  cameraState: string;
  checkedAt?: string | null;
  unverifiedReason?: UnverifiedReason | null;
};

/** Linked fleet rows. One row is one camera unit. Channel rows are preferred when they are present. */
export type CommandCountProduct = {
  status: string;
  unitNumber?: string | null;
  productId: string;
  lifecycle?: string | null;
  doNotUse?: boolean;
  placement?: string | null;
};

/**
 * Field Product IDs already classified by the command center.
 * Support equipment is left out, so it adds 0 and raises no alert.
 * Online and offline are stamped at `now` only because the command center already
 * dropped stale and missing readings. fieldCameraHealth and the exact TCP check
 * admit online or offline only inside the freshness window. Anything else stays unverified.
 */
function commandPlacement(item: CommandCountProduct): CountUnit['placement'] {
  const placement = (item.placement || '').trim().toLowerCase();
  if (placement === 'shop' || placement === 'warehouse') return 'shop';
  if (placement === 'unknown') return 'unknown';
  return 'field';
}

function commandDoNotUse(item: CommandCountProduct): boolean {
  // A Product-ID census row stays in its health bucket. The field inventory
  // screen still counts a DO NOT USE field record as unknown. Exclusion is
  // explicit on a count unit, which is how Sniper 318 and the camera feed opt in.
  return item.doNotUse === true;
}

export function censusFromCommandProducts(items: readonly CommandCountProduct[], now = Date.now()): CountUnit[] {
  const fresh = new Date(now).toISOString();
  return items.filter(item => item.status !== 'not_applicable').map(item => {
    const state = item.status === 'online' || item.status === 'offline' ? item.status : 'unknown';
    const placement = commandPlacement(item);
    const doNotUse = commandDoNotUse(item);
    return {
      name: item.unitNumber || item.productId,
      placement,
      cameras: [cameraFromStatus(state, state === 'unknown' ? null : fresh)],
      newestOnlineAt: state === 'online' ? now : null,
      unverifiedReason: state === 'unknown' ? 'no_reading' : null,
      doNotUse,
      exception: doNotUse && placement === 'field',
    };
  });
}

export function censusFromDashboardRows(rows: readonly DashboardCountRow[], now = Date.now()): CountUnit[] {
  return rows.filter(row => !row.support).map(row => {
    const placement = row.placement === 'shop' ? 'shop' : row.placement === 'field' ? 'field' : 'unknown';
    const state = row.cameraState === 'online' || row.cameraState === 'offline' ? row.cameraState : 'unknown';
    // No check time is not a fresh reading. Stamping `now` would turn a missing miss into Offline.
    const observedAt = row.checkedAt || null;
    const onlineAt = state === 'online' && observedAt && presentedCameraState({ state: 'online', observedAt }, now) === 'online' ? Date.parse(observedAt) : NaN;
    return {
      name: row.name,
      placement,
      cameras: placement === 'shop' ? [] : [cameraFromStatus(state, observedAt)],
      newestOnlineAt: Number.isFinite(onlineAt) ? onlineAt : null,
      unverifiedReason: state === 'online' || state === 'offline' ? null : row.unverifiedReason || null,
    };
  });
}

export type InventoryUnverifiedItem = {
  status: string;
  reason?: string;
  linked?: { state?: string; evidence?: { gap?: string | null } | null } | null;
};

/** One reason per inventory row, so the parts add up to the unverified total. */
export function classifyInventoryUnverified(item: InventoryUnverifiedItem): UnverifiedReason {
  const reason = item.reason || '';
  const gap = item.linked?.evidence?.gap || '';
  const linked = item.linked?.state || '';
  if (linked === 'review' || linked === 'unlinked' || /identity|do not use|missing —/i.test(reason)) return 'identity_hold';
  if (/disagree|conflict/i.test(reason)) return 'source_conflict';
  if (/stale/i.test(reason)) return 'stale_reading';
  if (gap === 'device_link_needed' || /device link/i.test(reason)) return 'no_device_link';
  if (/recorder/i.test(reason)) return 'no_recorder_link';
  if (/router/i.test(reason)) return 'no_router_link';
  if (/address could not|couldn't be mapped|cannot be placed/i.test(reason)) return 'address_unmapped';
  if (/unavailable|no verified|no current|not counted|no reading|missing/i.test(reason)) return 'no_reading';
  return 'no_reading';
}

export function inventoryUnverifiedBreakdown(items: readonly InventoryUnverifiedItem[]) {
  const counts = emptyUnverifiedReasons();
  let total = 0;
  for (const item of items) {
    if (item.status !== 'unverified') continue;
    total += 1;
    counts[classifyInventoryUnverified(item)] += 1;
  }
  return { total, counts };
}

export type LinkSide = { name: string; deviceId?: string | null; serial?: string | null };

/**
 * Recorder matching is an exact normalized unit name only.
 * Device ids, serials, family keys, and partial numbers are not links.
 * A name that does not match stays unmatched. Nothing is guessed.
 */
export function exactEquipmentLinks(units: readonly LinkSide[], devices: readonly LinkSide[]) {
  const matched: { unit: string; device: string; by: 'name' }[] = [];
  const needsDataFix: { unit: string; device: string; reason: string }[] = [];
  const usedUnits = new Set<string>();
  const usedDevices = new Set<string>();
  for (const device of devices) {
    const plain = exactUnitName(device.name);
    if (!plain || usedDevices.has(device.name)) continue;
    const unitHits = units.filter(unit => !usedUnits.has(unit.name) && exactUnitName(unit.name) === plain);
    const deviceHits = devices.filter(item => !usedDevices.has(item.name) && exactUnitName(item.name) === plain);
    if (unitHits.length !== 1 || deviceHits.length !== 1) continue;
    matched.push({ unit: unitHits[0].name, device: deviceHits[0].name, by: 'name' });
    usedUnits.add(unitHits[0].name);
    usedDevices.add(deviceHits[0].name);
  }
  return { matched, needsDataFix };
}

export type RecorderLink = LinkSide & { state: 'online' | 'offline' | 'unknown'; observedAt: string | null };

/** Replace an empty or unknown unit with one exact fresh recorder reading. Ambiguous names are left unknown. */
export function applyExactRecorderLinks(units: readonly CountUnit[], recorders: readonly RecorderLink[], now = Date.now()): CountUnit[] {
  const links = exactEquipmentLinks(units.map(unit => ({ name: unit.name, deviceId: unit.deviceId, serial: unit.serial })), recorders);
  const byUnit = new Map(links.matched.map(link => [link.unit, recorders.find(recorder => recorder.name === link.device)]));
  return units.map(unit => {
    if (unit.placement === 'shop') return unit;
    const known = unit.cameras.some(camera => presentedCameraState(camera, now) !== 'unknown');
    const recorder = byUnit.get(unit.name);
    if (known || !recorder) return unit;
    const state = presentedCameraState({ state: recorder.state, observedAt: recorder.observedAt }, now);
    if (state === 'unknown') return { ...unit, unverifiedReason: unit.unverifiedReason || (recorder.observedAt ? 'stale_reading' : 'no_reading') };
    const onlineAt = state === 'online' && recorder.observedAt ? Date.parse(recorder.observedAt) : NaN;
    return {
      ...unit,
      cameras: [{ state, observedAt: recorder.observedAt }],
      newestOnlineAt: Number.isFinite(onlineAt) ? onlineAt : null,
      unverifiedReason: null,
    };
  });
}

export function recorderLinksFromHealth(rows: readonly CameraRow[] | null | undefined): RecorderLink[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => resourceKind(row) === 'recorders' && !row.trackerOnly).map(row => {
    const evidence = row.evidence;
    const status = evidence?.status === 'online' || evidence?.status === 'offline' ? evidence.status : 'unknown';
    return { name: row.unit || row.name, deviceId: String(row.id), state: status, observedAt: evidence?.observedAt || row.checkedAt || null };
  });
}

/** Newest fresh router fact. A stale or missing fact is not offline. */
export function routerOfflineFact(row: Pick<RouterRow, 'probeStatus' | 'checkedAt' | 'reportedStatus' | 'reportedAt'>, now = Date.now()): { offline: boolean; at: number | null } {
  const facts: { at: number; offline: boolean }[] = [];
  const probeAt = row.checkedAt ? Date.parse(row.checkedAt) : NaN;
  if (Number.isFinite(probeAt) && probeAt <= now && now - probeAt <= ROUTER_FRESHNESS_MS && (row.probeStatus === 'online' || row.probeStatus === 'offline')) {
    facts.push({ at: probeAt, offline: row.probeStatus === 'offline' });
  }
  const reportedAt = row.reportedAt ? Date.parse(row.reportedAt) : NaN;
  const reported = typeof row.reportedStatus === 'string' ? row.reportedStatus.trim().toLowerCase() : '';
  if (Number.isFinite(reportedAt) && reportedAt <= now && now - reportedAt <= ROUTER_FRESHNESS_MS && (reported === 'online' || reported === 'offline')) {
    facts.push({ at: reportedAt, offline: reported === 'offline' });
  }
  if (!facts.length) return { offline: false, at: null };
  facts.sort((left, right) => right.at - left.at);
  return { offline: facts[0].offline, at: facts[0].at };
}

export function sharedFleetMonitoredCount(input: Parameters<typeof countForPath>[1]) {
  return countForPath('sharedFleetCounts', input);
}

export function cameraProvesRouterUp(cameraOnlineAt: number | null, routerObservedAt: number | null): boolean {
  return cameraOnlineAt !== null && routerObservedAt !== null && Number.isFinite(cameraOnlineAt) && Number.isFinite(routerObservedAt) && cameraOnlineAt > routerObservedAt;
}

export type PresentedFleetCounts = FleetCountSnapshot & { problemCount: number } | {
  units: null;
  cameras: null;
  problems: TechnicianTodo[];
  problemCount: number;
  inShopUnits: number;
  doNotUseUnits: number;
  exceptionUnits: number;
  unverified: Record<UnverifiedReason, number>;
};

/** One reading. A missing census is an em dash on every screen, never a number on one and a dash on another. */
export function presentFleetCounts(units: readonly CountUnit[], now?: number, problems?: readonly TechnicianTodo[]): FleetCountSnapshot & { problemCount: number };
export function presentFleetCounts(units: null, now?: number, problems?: readonly TechnicianTodo[]): Exclude<PresentedFleetCounts, FleetCountSnapshot>;
export function presentFleetCounts(units: readonly CountUnit[] | null, now = Date.now(), problems: readonly TechnicianTodo[] = []): PresentedFleetCounts {
  if (!units) {
    return {
      units: null, cameras: null, problems: fieldProblemList(problems), problemCount: fieldProblemList(problems).length,
      inShopUnits: 0, doNotUseUnits: 0, exceptionUnits: 0, unverified: emptyUnverifiedReasons(),
    };
  }
  const snapshot = selectFleetCounts(units, now, problems);
  return { ...snapshot, problemCount: snapshot.problems.length };
}

export const fleetDashboardCounts = presentFleetCounts;
export const cameraStatusCounts = presentFleetCounts;
export const tvFleetCounts = presentFleetCounts;
export const phoneLandingCounts = presentFleetCounts;
export const equipmentTotalsCounts = presentFleetCounts;
