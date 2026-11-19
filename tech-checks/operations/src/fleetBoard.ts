/**
 * Fleet board counts and lists. Field and In shop go through selectFleetCounts.
 * Armed, Watchful, and Immix numbers are read from the object #451 returns.
 * This file does not decide who may open the board.
 */
import {censusFromDashboardRows, selectFleetCounts, type DashboardCountRow} from './sharedFleetCounts';
import {cameraMarks, readIsStale, publicCameraLabel, type CameraMark, type CameraMarkRow} from './fleetCameraStatusRead';
import type {CameraRow} from './cameraEvidence';
import type {StageSharedMonitoredCount} from './fleetMapStage';

export const BOARD_NOT_AVAILABLE = 'not available';

export type BoardContact = { name: string; phone: string; email: string };
export type BoardAlarm = { label: string; at: string };
export type BoardScheduleLine = { day: string; window: string };
export type BoardArming = 'Auto' | 'TestMode' | 'Disarmed' | 'Paused' | null;

export type BoardUnitInput = {
  id: string;
  name: string;
  site: string;
  placement: 'field' | 'shop' | 'unknown';
  cameras: readonly CameraMarkRow[];
  observedAt: string | null;
  support?: boolean;
  point: [number, number] | null;
  estimate: boolean;
  immix?: boolean;
  inWatchful?: boolean | null;
  arming?: BoardArming;
  /** True only when a saved Watchful schedule says this unit is disarmed today. */
  scheduleDisarmed?: boolean;
  schedule?: readonly BoardScheduleLine[] | null;
  alarms?: readonly BoardAlarm[] | null;
  contacts?: readonly BoardContact[] | null;
  eye?: string | null;
  /** Outage start, when a source recorded one. An observation time is not a since time. */
  downSince?: string | null;
};

export type BoardProblem = {
  siteKey: string;
  site: string;
  unit: string;
  what: 'Offline' | 'Camera down' | 'Not armed';
  since: string | null;
};

export type BoardSite = {
  key: string;
  name: string;
  point: [number, number] | null;
  estimate: boolean;
  immix: boolean;
  dot: 'green' | 'red' | 'grey';
  units: readonly BoardUnitView[];
};

export type BoardUnitView = {
  id: string;
  name: string;
  placement: 'field' | 'shop' | 'unknown';
  status: CameraMark | 'shop';
  cameraDown: boolean;
  cameras: readonly CameraMarkRow[];
  schedule: readonly BoardScheduleLine[] | null;
  alarms: readonly BoardAlarm[] | null;
  contacts: readonly BoardContact[] | null;
  eye: string | null;
};

export type BoardCount = { up: number | null; total: number | null };

export type BoardView = {
  stale: boolean;
  readAt: string | null;
  unitsOnline: BoardCount;
  camerasOnline: BoardCount;
  sitesArmed: BoardCount;
  immixSites: number | null;
  inShop: number | null;
  notArmedToday: number | null;
  problems: readonly BoardProblem[];
  sites: readonly BoardSite[];
  unplaced: number;
};

const ipAddress = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

const text = (value: unknown) => publicCameraLabel(value);

export function recordContacts(value: unknown): BoardContact[] | null {
  if (!Array.isArray(value)) return null;
  const contacts: BoardContact[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = text(row.name);
    if (!name) continue;
    contacts.push({ name, phone: text(row.phone) || '', email: text(row.email) || '' });
  }
  return contacts.length ? contacts : null;
}

export function recordEye(value: unknown) {
  return text(value);
}

export function recordSchedule(value: unknown): BoardScheduleLine[] | null {
  if (!Array.isArray(value)) return null;
  const lines: BoardScheduleLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const day = text(row.day);
    const window = text(row.window);
    if (day && window) lines.push({ day, window });
  }
  return lines.length ? lines : null;
}

export function alarmsFromMeasurements(measurements: readonly {metric?: string; value?: number; unit?: string; observedAt?: string}[] | null | undefined): BoardAlarm[] | null {
  if (!measurements) return null;
  const alarms = measurements.filter(item => item.unit === 'state' && typeof item.metric === 'string' && item.metric.endsWith('_alarm') && typeof item.value === 'number' && item.value > 0 && typeof item.observedAt === 'string');
  return alarms.length ? alarms.map(item => ({ label: item.metric!.replaceAll('_', ' '), at: item.observedAt! })) : null;
}

export function newestRead(values: readonly (string | null | undefined)[]) {
  let best: string | null = null;
  let bestAt = -Infinity;
  for (const value of values) {
    const at = value ? Date.parse(value) : NaN;
    if (Number.isFinite(at) && at > bestAt) { bestAt = at; best = value || null; }
  }
  return best;
}

export function marksOrUnit(rows: readonly CameraRow[] | null | undefined, fallback: CameraMark | null, observedAt: string | null, now: number): CameraMarkRow[] {
  const marks = cameraMarks(rows, now);
  if (marks.length || !fallback) return marks;
  return [{ name: 'Camera', state: fallback, observedAt }];
}

export function boardSiteKey(site: string, id: string) {
  const name = site.trim().toLowerCase();
  return name || id;
}

function countPair(up: number, total: number): BoardCount {
  return { up, total };
}

function sharedImmix(shared: StageSharedMonitoredCount): number | null {
  if (shared.monitoredOnImmix) return shared.monitoredOnImmix.length;
  if (shared.immixUp === null && shared.immixDown === null && shared.immixUnknown === null) return null;
  return (shared.immixUp ?? 0) + (shared.immixDown ?? 0) + (shared.immixUnknown ?? 0);
}

function presentedCameras(unit: BoardUnitInput, now: number): CameraMarkRow[] {
  if (unit.cameras.length) return unit.cameras.map(camera => ({
    ...camera,
    state: readIsStale(camera.observedAt, now) ? 'unknown' : camera.state,
  }));
  return [];
}

function unitStatus(cameras: readonly CameraMarkRow[]): { status: CameraMark; cameraDown: boolean } {
  const down = cameras.filter(camera => camera.state === 'down').length;
  const up = cameras.filter(camera => camera.state === 'up').length;
  const unknown = cameras.length - down - up;
  if (down <= 0) return { status: up > 0 && unknown <= 0 ? 'up' : 'unknown', cameraDown: false };
  if (up <= 0 && unknown <= 0) return { status: 'down', cameraDown: false };
  return { status: 'up', cameraDown: true };
}

export function boardProblems(units: readonly BoardUnitInput[], now: number): BoardProblem[] {
  const problems: BoardProblem[] = [];
  for (const unit of units) {
    if (unit.placement !== 'field' || unit.support) continue;
    const cameras = presentedCameras(unit, now);
    const status = unitStatus(cameras);
    const siteKey = boardSiteKey(unit.site, unit.id);
    if (status.status === 'down') {
      problems.push({ siteKey, site: unit.site || unit.name, unit: unit.name, what: 'Offline', since: unit.downSince || null });
      continue;
    }
    if (status.cameraDown) {
      problems.push({ siteKey, site: unit.site || unit.name, unit: unit.name, what: 'Camera down', since: unit.downSince || null });
      continue;
    }
    // A Watchful schedule that leaves the unit disarmed is not a problem.
    if (unit.scheduleDisarmed) continue;
    if (unit.inWatchful === true && unit.arming === 'Disarmed') {
      problems.push({ siteKey, site: unit.site || unit.name, unit: unit.name, what: 'Not armed', since: null });
    }
  }
  return problems;
}

/** Search site, unit, camera, and EYE text. An IP query matches nothing. */
export function boardSearch(sites: readonly {key: string; name: string; units: readonly BoardUnitView[]}[], query: string) {
  const text = query.trim().toLowerCase();
  if (!text || ipAddress.test(text)) return [];
  const hits: { siteKey: string; label: string }[] = [];
  for (const site of sites) {
    const names = site.units.flatMap(unit => [unit.name, unit.eye || '', ...unit.cameras.map(camera => camera.name)]);
    const haystack = [site.name, ...names].join(' ').toLowerCase();
    if (haystack.includes(text)) hits.push({ siteKey: site.key, label: site.name });
  }
  return hits;
}

function safeContacts(value: readonly BoardContact[] | null | undefined): BoardContact[] | null {
  if (!value) return null;
  const contacts = value.filter(contact => contact && publicCameraLabel(contact.name) && !ipAddress.test(contact.phone || '') && !ipAddress.test(contact.email || ''));
  return contacts.length ? contacts.map(contact => ({
    name: publicCameraLabel(contact.name) || 'Name not recorded',
    phone: publicCameraLabel(contact.phone) || '',
    email: publicCameraLabel(contact.email) || '',
  })) : null;
}

export function buildBoard(units: readonly BoardUnitInput[], shared: StageSharedMonitoredCount | null, readAt: string | null, now = Date.now()): BoardView {
  const stale = readIsStale(readAt, now);
  if (!units.length && stale) {
    return { stale: true, readAt, unitsOnline: { up: null, total: null }, camerasOnline: { up: null, total: null }, sitesArmed: { up: null, total: null }, immixSites: null, inShop: null, notArmedToday: null, problems: [], sites: [], unplaced: 0 };
  }
  const counted: DashboardCountRow[] = [];
  const countUnits = units.filter(unit => !unit.support && (unit.placement === 'field' || unit.placement === 'shop'));
  for (const unit of countUnits) counted.push({
    name: unit.name,
    placement: unit.placement,
    cameraState: 'unknown',
    checkedAt: unit.observedAt,
  });
  const census = selectFleetCounts(censusFromDashboardRows(counted, now).map((unit, index) => {
    const source = countUnits[index];
    const cameras = source && source.placement !== 'shop' ? presentedCameras(source, now).map(camera => ({
      state: camera.state === 'up' ? 'online' as const : camera.state === 'down' ? 'offline' as const : 'unknown' as const,
      observedAt: camera.observedAt,
    })) : unit.cameras;
    return { ...unit, cameras: cameras.length ? cameras : unit.cameras };
  }), now);
  const fieldTotal = census.units.online + census.units.offline + census.units.unknown;
  const cameraTotal = census.cameras.online + census.cameras.offline + census.cameras.unknown;
  const armedKnown = shared?.fresh === true && typeof shared.armedSites === 'number' && shared.sites != null;
  const scheduleKnown = units.some(unit => typeof unit.scheduleDisarmed === 'boolean');
  const problems = stale ? [] : boardProblems(units, now);
  const problemKeys = new Set(problems.map(problem => problem.siteKey));
  const groups = new Map<string, BoardSite>();
  for (const unit of units) {
    if (unit.placement === 'shop') continue;
    const key = boardSiteKey(unit.site, unit.id);
    const cameras = presentedCameras(unit, now);
    const status = unit.support ? { status: 'unknown' as const, cameraDown: false } : unitStatus(cameras);
    const view: BoardUnitView = {
      id: unit.id,
      name: publicCameraLabel(unit.name) || 'Unit',
      placement: unit.placement,
      status: stale ? 'unknown' : status.status,
      cameraDown: stale ? false : status.cameraDown,
      cameras,
      schedule: unit.schedule && unit.schedule.length ? unit.schedule : null,
      alarms: unit.alarms && unit.alarms.length ? unit.alarms : null,
      contacts: safeContacts(unit.contacts),
      eye: publicCameraLabel(unit.eye),
    };
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, immix: existing.immix || unit.immix === true, units: [...existing.units, view], point: existing.point || unit.point, estimate: existing.point ? existing.estimate : unit.estimate });
    } else {
      groups.set(key, { key, name: unit.site.trim() || view.name, point: unit.point, estimate: unit.estimate, immix: unit.immix === true, dot: 'grey', units: [view] });
    }
  }
  const sites = [...groups.values()].map(site => {
    const dot: BoardSite['dot'] = stale || !site.point ? 'grey' : problemKeys.has(site.key) ? 'red' : site.units.some(unit => unit.status !== 'up') ? 'grey' : 'green';
    return { ...site, dot };
  });
  return {
    stale,
    readAt,
    unitsOnline: countPair(census.units.online, fieldTotal),
    camerasOnline: countPair(census.cameras.online, cameraTotal),
    sitesArmed: armedKnown ? { up: shared!.armedSites!, total: shared!.sites! } : { up: null, total: null },
    immixSites: shared?.fresh ? sharedImmix(shared) : null,
    inShop: census.inShopUnits,
    notArmedToday: scheduleKnown ? units.filter(unit => unit.placement === 'field' && unit.scheduleDisarmed === true).length : null,
    problems,
    sites,
    unplaced: sites.filter(site => !site.point).length,
  };
}
