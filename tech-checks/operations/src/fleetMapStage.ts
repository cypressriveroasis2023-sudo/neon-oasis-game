/** Map-centered Fleet stage.
 * Field and In shop come from selectFleetCounts. Unknown placement is its own bucket.
 * Monitored, In Watchful, Not in Watchful, and Immix render only when a caller passes
 * the object returned by #451 countForPath / selectSharedMonitoredCount. This file does not implement that count.
 * A missing, failed, or 20-minute-old camera read is Unknown, never Down. Shop is never red.
 */
import {censusFromDashboardRows, selectFleetCounts, type DashboardCountRow} from './sharedFleetCounts';
export const STAGE_UNKNOWN_COLOR = '#94a3b8';
export const STAGE_UP_COLOR = '#2bff35';
export const STAGE_DOWN_COLOR = '#ff2734';
export const STAGE_SHOP_COLOR = '#64748b';
export const STAGE_FRESH_MS = 20 * 60 * 1000;
export const FLEET_MAP_STAGE_LAYOUT = true;
export const STAGE_MIN_WIDTH_PX = 1600;

export type StageArming = 'Auto' | 'TestMode' | 'Disarmed' | 'Paused' | null;
export type StageIcon = 'up' | 'down' | 'unknown' | 'shop';
export type StageBoxId = 'monitored' | 'in-watchful' | 'not-in-watchful' | 'immix' | 'in-shop' | 'field' | 'unknown-placement';

export type StageUnitInput = {
  id: string;
  name: string;
  site: string;
  placement: 'field' | 'shop' | 'unknown';
  inWatchful: boolean | null;
  immix: boolean;
  arming: StageArming;
  armingObservedAt: string | null;
  armingReadFailed?: boolean;
  status: 'up' | 'down' | null;
  observedAt: string | null;
  readFailed?: boolean;
  support?: boolean;
  point: [number, number] | null;
};

export type StageIconResult = { icon: StageIcon; color: string; label: 'Up' | 'Down' | 'Unknown' | 'In shop' };

export type StageBox = {
  id: StageBoxId;
  label: string;
  value: string;
  source: string;
  tone: 'stale' | 'neutral' | 'shop';
  saysMonitored: boolean;
};

export type FleetStageRow = {
  id: string;
  name: string;
  site: string;
  placement: string;
  status: 'up' | 'down' | null;
  observedAt: string | null;
  support?: boolean;
  point: [number, number] | null;
  inWatchful?: boolean | null;
  immix?: boolean;
  arming?: StageArming;
  armingObservedAt?: string | null;
  armingReadFailed?: boolean;
  readFailed?: boolean;
};

const freshAt = (value: string | null | undefined, now: number) => {
  if (!value) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now && now - at <= STAGE_FRESH_MS;
};

/** Rollback sets the flag false. A narrow desktop stays on the reviewed board. */
/** `?fleetStage=0` renders the reviewed main board. The source flag is the rollback. */
export function fleetStageRollbackRequested() {
  if (typeof location === 'undefined') return false;
  try { return new URLSearchParams(location.search).get('fleetStage') === '0'; }
  catch { return false; }
}

export function fleetMapStageActive(wide: boolean, enabled = FLEET_MAP_STAGE_LAYOUT) {
  return enabled && wide && !fleetStageRollbackRequested();
}

export function fleetMapStageEnabled(enabled = FLEET_MAP_STAGE_LAYOUT) {
  return enabled && !fleetStageRollbackRequested();
}

/** The TV wall is opt-in. The existing TV board stays up unless `?fleetBoard=1` is set. */
export function fleetBoardOnTv() {
  if (!fleetMapStageEnabled()) return false;
  if (typeof location === 'undefined') return false;
  try { return new URLSearchParams(location.search).get('fleetBoard') === '1'; }
  catch { return false; }
}

/** mHelp placement. Anything that is not Field or Shop is Unknown, including a blank value. */
export function stagePlacement(value: string | null | undefined): 'field' | 'shop' | 'unknown' {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'shop' || token === 'root') return 'shop';
  if (token === 'field') return 'field';
  return 'unknown';
}

export function stageIcon(unit: Pick<StageUnitInput, 'placement' | 'status' | 'observedAt' | 'readFailed' | 'support'>, now: number): StageIconResult {
  if (unit.placement === 'shop') return { icon: 'shop', color: STAGE_SHOP_COLOR, label: 'In shop' };
  if (unit.support || unit.readFailed || !freshAt(unit.observedAt, now) || (unit.status !== 'up' && unit.status !== 'down')) {
    return { icon: 'unknown', color: STAGE_UNKNOWN_COLOR, label: 'Unknown' };
  }
  if (unit.status === 'up') return { icon: 'up', color: STAGE_UP_COLOR, label: 'Up' };
  return { icon: 'down', color: STAGE_DOWN_COLOR, label: 'Down' };
}

export function stageUnitsFromRows(rows: readonly FleetStageRow[]): StageUnitInput[] {
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    site: row.site,
    placement: stagePlacement(row.placement),
    inWatchful: row.inWatchful === undefined ? null : row.inWatchful,
    immix: row.immix === true,
    arming: row.arming === undefined ? null : row.arming,
    armingObservedAt: row.armingObservedAt ?? null,
    armingReadFailed: row.armingReadFailed,
    status: row.status,
    observedAt: row.observedAt,
    readFailed: row.readFailed,
    support: row.support,
    point: row.point,
  }));
}

export type StageFleetRead = { failed: boolean; field: number | null; shop: number | null; unknownPlacement: number | null };

/**
 * Structural input from #451. `countForPath` and `selectSharedMonitoredCount` return this.
 * This module does not compute it.
 */
export type StageSharedMonitoredCount = {
  fresh: boolean;
  oldestObservedAt?: string | null;
  units: number | null;
  sites?: number | null;
  /** Armed site count, when #451's return includes it. Absent means the board shows not available. */
  armedSites?: number | null;
  cameras?: {up: number; down: number; total: number} | null;
  armedUnits: number | null;
  armedCameras?: {up: number; down: number; total: number} | null;
  notInWatchful: readonly {name: string; productId?: string | null; bucket?: 'b' | 'd'; deployed?: boolean; mode?: string}[];
  immixUp: number | null;
  immixDown: number | null;
  immixUnknown: number | null;
  monitoredOnImmix: readonly {name?: string; source?: 'immix'; status?: string}[];
  inShop: number;
};

const countText = (failed: boolean, value: number | null) => failed || value === null ? '—' : String(value);

/** Field and In shop from selectFleetCounts. Unknown placement never enters that field total. `null` rows are a failed read. */
export function fleetStageRead(rows: readonly {name: string; placement: string; support?: boolean; cameraState?: string | null; checkedAt?: string | null}[] | null, now = Date.now()): StageFleetRead {
  if (!rows) return {failed: true, field: null, shop: null, unknownPlacement: null};
  let unknownPlacement = 0;
  const placed: DashboardCountRow[] = [];
  for (const row of rows) {
    const placement = stagePlacement(row.placement);
    if (placement === 'unknown') { unknownPlacement += 1; continue; }
    placed.push({name: row.name, placement, support: row.support, cameraState: row.cameraState === 'online' || row.cameraState === 'offline' ? row.cameraState : 'unknown', checkedAt: row.checkedAt ?? null});
  }
  const snapshot = selectFleetCounts(censusFromDashboardRows(placed, now), now);
  return {failed: false, field: snapshot.units.online + snapshot.units.offline + snapshot.units.unknown, shop: snapshot.inShopUnits, unknownPlacement};
}

/** The three #451 boxes. A null input means the module is not on this board, so the row omits them. */
export function stageSharedBoxes(shared: StageSharedMonitoredCount | null): StageBox[] {
  if (!shared) return [];
  const failed = !shared.fresh;
  const immix = failed ? null : (shared.immixUp === null && shared.immixDown === null && shared.immixUnknown === null)
    ? shared.monitoredOnImmix.length
    : (shared.immixUp ?? 0) + (shared.immixDown ?? 0) + (shared.immixUnknown ?? 0);
  return [
    {id: 'monitored', label: 'Monitored', value: countText(failed, shared.armedUnits), source: 'countForPath · selectSharedMonitoredCount', tone: failed ? 'stale' : 'neutral', saysMonitored: !failed && shared.armedUnits !== null},
    {id: 'in-watchful', label: 'In Watchful', value: countText(failed, shared.units), source: 'countForPath · selectSharedMonitoredCount', tone: 'neutral', saysMonitored: false},
    {id: 'not-in-watchful', label: 'Not in Watchful', value: countText(failed, failed ? null : shared.notInWatchful.length), source: 'countForPath · selectSharedMonitoredCount', tone: 'neutral', saysMonitored: false},
    {id: 'immix', label: 'Immix', value: countText(failed, immix), source: 'countForPath · selectSharedMonitoredCount', tone: 'neutral', saysMonitored: false},
  ];
}

export function stageFleetBoxes(read: StageFleetRead): StageBox[] {
  return [
    {id: 'field', label: 'Field', value: countText(read.failed, read.field), source: 'selectFleetCounts', tone: 'neutral', saysMonitored: false},
    {id: 'unknown-placement', label: 'Unknown', value: countText(read.failed, read.unknownPlacement), source: 'mHelp placement', tone: 'stale', saysMonitored: false},
    {id: 'in-shop', label: 'In shop', value: countText(read.failed, read.shop), source: 'selectFleetCounts', tone: 'shop', saysMonitored: false},
  ];
}

export function stageBoardBoxes(read: StageFleetRead, shared: StageSharedMonitoredCount | null): StageBox[] {
  return [...stageSharedBoxes(shared), ...stageFleetBoxes(read)];
}

/** Field matches the Watchful unit total from the shared count. Shop and Immix stay outside it. */
export function fieldCountMirrorsWatchful(shared: StageSharedMonitoredCount | null) {
  if (!shared?.fresh || shared.units === null) return null;
  const immix = (shared.immixUp === null && shared.immixDown === null && shared.immixUnknown === null)
    ? shared.monitoredOnImmix.length
    : (shared.immixUp ?? 0) + (shared.immixDown ?? 0) + (shared.immixUnknown ?? 0);
  return {field: shared.units, inWatchful: shared.units, shop: shared.inShop, immix};
}

export function unitsForBox(units: readonly StageUnitInput[], id: StageBoxId): StageUnitInput[] {
  if (id === 'field') return units.filter(unit => unit.placement === 'field' && !unit.immix);
  if (id === 'unknown-placement') return units.filter(unit => unit.placement === 'unknown');
  if (id === 'in-shop') return units.filter(unit => unit.placement === 'shop');
  if (id === 'monitored') return units.filter(unit => unit.placement === 'field' && !unit.immix && unit.inWatchful === true && unit.arming === 'Auto');
  if (id === 'in-watchful') return units.filter(unit => unit.placement === 'field' && !unit.immix && unit.inWatchful === true);
  if (id === 'not-in-watchful') return units.filter(unit => unit.placement === 'field' && !unit.immix && unit.inWatchful === false);
  if (id === 'immix') return units.filter(unit => unit.immix);
  return [];
}
