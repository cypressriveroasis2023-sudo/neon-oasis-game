/** Map-centered Fleet stage. Watchful decides who is monitored and up or down.
 * mHelp decides Field or Shop. Immix stays outside the Watchful totals.
 * A missing, failed, or 20-minute-old read is Unknown, never Down.
 * Shop is never red. The armed headline is the only number called monitored.
 */
export const STAGE_UNKNOWN_COLOR = '#94a3b8';
export const STAGE_UP_COLOR = '#2bff35';
export const STAGE_DOWN_COLOR = '#ff2734';
export const STAGE_SHOP_COLOR = '#64748b';
export const STAGE_FRESH_MS = 20 * 60 * 1000;
export const FLEET_MAP_STAGE_LAYOUT = true;
export const STAGE_MIN_WIDTH_PX = 1600;

export type StageArming = 'Auto' | 'TestMode' | 'Disarmed' | 'Paused' | null;
export type StageIcon = 'up' | 'down' | 'unknown' | 'shop';
export type StageBoxId = 'monitored' | 'in-watchful' | 'not-in-watchful' | 'immix' | 'in-shop';

export type StageUnitInput = {
  id: string;
  name: string;
  site: string;
  placement: 'field' | 'shop' | 'other';
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
  placement: 'field' | 'shop' | 'other';
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
export function fleetMapStageActive(wide: boolean, enabled = FLEET_MAP_STAGE_LAYOUT) {
  return enabled && wide;
}

export function fleetMapStageEnabled(enabled = FLEET_MAP_STAGE_LAYOUT) {
  return enabled;
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
    placement: row.placement,
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

const watchfulKnown = (units: readonly StageUnitInput[]) => units.some(unit => unit.inWatchful !== null);
const immixKnown = (units: readonly StageUnitInput[]) => units.some(unit => unit.immix);
const fieldUnit = (unit: StageUnitInput) => unit.placement === 'field' && !unit.immix;
const armed = (unit: StageUnitInput, now: number) => fieldUnit(unit) && unit.inWatchful === true && unit.arming === 'Auto' && !unit.armingReadFailed && freshAt(unit.armingObservedAt, now);

/** Armed-only when the Watchful arming read is fresh. Otherwise the grey fallback. */
export function armingReadFresh(units: readonly StageUnitInput[], now: number) {
  if (!watchfulKnown(units)) return false;
  const watched = units.filter(fieldUnit).filter(unit => unit.inWatchful === true);
  if (!watched.length) return false;
  return watched.every(unit => !unit.armingReadFailed && freshAt(unit.armingObservedAt, now));
}

export function stageCountBoxes(units: readonly StageUnitInput[], now: number): StageBox[] {
  const watchful = watchfulKnown(units);
  const immix = immixKnown(units);
  const freshArming = armingReadFresh(units, now);
  const monitored = units.filter(unit => armed(unit, now));
  const inWatchful = units.filter(unit => fieldUnit(unit) && unit.inWatchful === true);
  const notInWatchful = units.filter(unit => fieldUnit(unit) && unit.inWatchful === false);
  const immixUnits = units.filter(unit => unit.immix);
  const shop = units.filter(unit => unit.placement === 'shop');
  const stalePopulation = units.filter(unit => unit.placement === 'field' && !unit.immix && stageIcon(unit, now).icon === 'unknown');
  const monitoredBox: StageBox = freshArming
    ? { id: 'monitored', label: 'Monitored', value: String(monitored.length), source: 'Watchful arming · mHelp field', tone: 'neutral', saysMonitored: true }
    : { id: 'monitored', label: 'Arming read stale', value: String(stalePopulation.length), source: 'Watchful arming', tone: 'stale', saysMonitored: false };
  return [
    monitoredBox,
    { id: 'in-watchful', label: 'In Watchful', value: watchful ? String(inWatchful.length) : '—', source: watchful ? 'mHelp field · same units as Watchful' : 'Watchful', tone: 'neutral', saysMonitored: false },
    { id: 'not-in-watchful', label: 'Not in Watchful', value: watchful ? String(notInWatchful.length) : '—', source: 'mHelp', tone: 'neutral', saysMonitored: false },
    { id: 'immix', label: 'Immix', value: immix ? String(immixUnits.length) : '—', source: 'Immix', tone: 'neutral', saysMonitored: false },
    { id: 'in-shop', label: 'In shop', value: String(shop.length), source: 'mHelp', tone: 'shop', saysMonitored: false },
  ];
}

/** Field totals follow Watchful. Shop and Immix add nothing to that total. */
export function fieldCountMirrorsWatchful(units: readonly StageUnitInput[], now: number) {
  const boxes = stageCountBoxes(units, now);
  const watchful = boxes.find(box => box.id === 'in-watchful');
  if (!watchful || watchful.value === '—') return null;
  const counted = units.filter(unit => fieldUnit(unit) && unit.inWatchful === true).length;
  return { field: counted, inWatchful: Number(watchful.value), shop: units.filter(unit => unit.placement === 'shop').length, immix: units.filter(unit => unit.immix).length };
}

export function unitsForBox(units: readonly StageUnitInput[], id: StageBoxId, now: number): StageUnitInput[] {
  const freshArming = armingReadFresh(units, now);
  if (id === 'monitored') {
    if (freshArming) return units.filter(unit => armed(unit, now));
    return units.filter(unit => unit.placement === 'field' && !unit.immix && stageIcon(unit, now).icon === 'unknown');
  }
  if (id === 'in-watchful') return watchfulKnown(units) ? units.filter(unit => fieldUnit(unit) && unit.inWatchful === true) : [];
  if (id === 'not-in-watchful') return watchfulKnown(units) ? units.filter(unit => fieldUnit(unit) && unit.inWatchful === false) : [];
  if (id === 'immix') return immixKnown(units) ? units.filter(unit => unit.immix) : [];
  return units.filter(unit => unit.placement === 'shop');
}
