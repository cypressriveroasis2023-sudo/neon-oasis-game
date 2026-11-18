import {CAMERA_FRESH_MS, cameraTimestamp, resourceKind, type CameraRow} from './cameraEvidence';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {exactUnitName, ROUTER_FRESHNESS_MS, type RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import {unitVerdict, type UnitCameraStatus} from '../shared/starUnitStatus';

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
  unverified: Record<UnverifiedReason, number>;
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
};

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

/**
 * The only headline counter. Shop units add 0 to every total.
 * Camera status, the map, and About this board all call this.
 */
export function selectFleetCounts(units: readonly CountUnit[], now = Date.now()): FleetCountSnapshot {
  const cameras = emptyTriple();
  const unitCounts = emptyTriple();
  const unverified = emptyUnverifiedReasons();
  let inShopUnits = 0;
  for (const unit of units) {
    if (unit.placement === 'shop') {
      inShopUnits += 1;
      continue;
    }
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
  return { cameras, units: unitCounts, inShopUnits, unverified };
}

export type ViewHeadlines = { cameras: CountTriple; units: CountTriple };

export function cameraStatusHeadline(units: readonly CountUnit[], now = Date.now()): ViewHeadlines {
  const snapshot = selectFleetCounts(units, now);
  return { cameras: snapshot.cameras, units: snapshot.units };
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
    const placement = unit.placement === 'SHOP' ? 'shop' : unit.placement === 'FIELD' ? 'field' : 'unknown';
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
export type CommandCountProduct = { status: string; unitNumber?: string | null; productId: string };

/**
 * Field Product IDs already classified by the command center.
 * Support equipment is left out, so it adds 0 and raises no alert.
 * Known online and offline readings are stamped at `now` because the command center already applied freshness.
 */
export function censusFromCommandProducts(items: readonly CommandCountProduct[], now = Date.now()): CountUnit[] {
  const fresh = new Date(now).toISOString();
  return items.filter(item => item.status !== 'not_applicable').map(item => {
    const state = item.status === 'online' || item.status === 'offline' ? item.status : 'unknown';
    return {
      name: item.unitNumber || item.productId,
      placement: 'field',
      cameras: [cameraFromStatus(state, state === 'unknown' ? null : fresh)],
      newestOnlineAt: state === 'online' ? now : null,
      unverifiedReason: state === 'unknown' ? 'no_reading' : null,
    };
  });
}

export function censusFromDashboardRows(rows: readonly DashboardCountRow[], now = Date.now()): CountUnit[] {
  const fresh = new Date(now).toISOString();
  return rows.filter(row => !row.support).map(row => {
    const placement = row.placement === 'shop' ? 'shop' : row.placement === 'field' ? 'field' : 'unknown';
    const state = row.cameraState === 'online' || row.cameraState === 'offline' ? row.cameraState : 'unknown';
    const observedAt = state === 'unknown' ? row.checkedAt || null : row.checkedAt || fresh;
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

const cleanId = (value: string | null | undefined) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 && text.length <= 80 ? text : '';
};

/**
 * Exact device id, exact serial, or the board's existing exact unit name.
 * A shared number with a different family is not a match.
 */
export function exactEquipmentLinks(units: readonly LinkSide[], devices: readonly LinkSide[]) {
  const matched: { unit: string; device: string; by: 'device' | 'serial' | 'name' }[] = [];
  const needsDataFix: { unit: string; device: string; reason: string }[] = [];
  const usedUnits = new Set<string>();
  const usedDevices = new Set<string>();
  const take = (by: 'device' | 'serial' | 'name', unitName: string, deviceName: string, unitHits: LinkSide[], deviceHits: LinkSide[]) => {
    if (unitHits.length !== 1 || deviceHits.length !== 1) return false;
    if (usedUnits.has(unitHits[0].name) || usedDevices.has(deviceHits[0].name)) return false;
    matched.push({ unit: unitHits[0].name, device: deviceHits[0].name, by });
    usedUnits.add(unitHits[0].name);
    usedDevices.add(deviceHits[0].name);
    return true;
  };
  for (const device of devices) {
    const deviceId = cleanId(device.deviceId);
    if (!deviceId) continue;
    const unitHits = units.filter(unit => cleanId(unit.deviceId) === deviceId);
    const deviceHits = devices.filter(item => cleanId(item.deviceId) === deviceId);
    take('device', device.name, device.name, unitHits, deviceHits);
  }
  for (const device of devices) {
    const serial = cleanId(device.serial);
    if (!serial || usedDevices.has(device.name)) continue;
    const unitHits = units.filter(unit => !usedUnits.has(unit.name) && cleanId(unit.serial) === serial);
    const deviceHits = devices.filter(item => cleanId(item.serial) === serial);
    take('serial', device.name, device.name, unitHits, deviceHits);
  }
  for (const device of devices) {
    if (usedDevices.has(device.name)) continue;
    const key = canonicalCameraUnit(device.name);
    const plain = exactUnitName(device.name);
    const unitHits = units.filter(unit => !usedUnits.has(unit.name) && (key ? canonicalCameraUnit(unit.name) === key : exactUnitName(unit.name) === plain));
    const deviceHits = devices.filter(item => !usedDevices.has(item.name) && (key ? canonicalCameraUnit(item.name) === key : exactUnitName(item.name) === plain));
    if (take('name', device.name, device.name, unitHits, deviceHits.length ? deviceHits : [device])) continue;
    const number = /(\d{1,6})$/.exec(device.name.trim());
    if (!number || !key) continue;
    const stem = units.filter(unit => {
      const unitKey = canonicalCameraUnit(unit.name);
      return Boolean(unitKey && unitKey !== key && unitKey.endsWith('|' + Number(number[1])));
    });
    if (stem.length === 1) needsDataFix.push({
      unit: stem[0].name,
      device: device.name,
      reason: 'The number matches a different family name. Store the recorder or router name as the unit name before COS can use it.',
    });
  }
  return { matched, needsDataFix };
}

type RecorderLink = LinkSide & { state: 'online' | 'offline' | 'unknown'; observedAt: string | null };

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

export function cameraProvesRouterUp(cameraOnlineAt: number | null, routerObservedAt: number | null): boolean {
  return cameraOnlineAt !== null && routerObservedAt !== null && Number.isFinite(cameraOnlineAt) && Number.isFinite(routerObservedAt) && cameraOnlineAt > routerObservedAt;
}
