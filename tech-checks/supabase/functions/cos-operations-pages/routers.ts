/** Read-only Camera Health observations. This module never probes or writes a router. */
// The existing sweep runs every 15 minutes; allow five minutes for execution/jitter.
// @ts-ignore plain module shared with the edge function
import { boardRouterStatus, deviceDoNotUse, doNotUseForKey, routerJoinKey } from './routerBoardJoin.mjs';
export const ROUTER_FRESHNESS_MS = 20 * 60 * 1000;
export type RouterStatus = 'reachable' | 'unreachable' | 'stale' | 'unknown';
export type BoardRouterStatus = 'Online' | 'Offline' | 'Unknown' | 'Unknown (no feed)' | 'In Shop';
export type RouterRow = {
  id: string; unitKey: string; name: string; model: string; publicIp: string | null;
  unitIp: string | null; port: number | null; protocol: string | null;
  probeStatus: string; checkedAt: string | null; lastRecoveredAt: string | null;
  reportedStatus: string; reportedAt: string | null; reportedSource: string;
  savedLatencyMs: number | null; match: 'exact_name' | 'ambiguous' | 'unmatched';
  candidateUnit: { id: string; unitNumber: string; placement?: string } | null;
  gps: null;
  boardStatus?: BoardRouterStatus;
  boardCheckedAt?: string | null;
  boardOutage?: boolean;
  doNotUse?: boolean;
};
export type RouterSnapshot = { items: RouterRow[]; generatedAt: string; source: 'camera_health'; gpsAvailable: false; doNotUseKeys?: string[] };
type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const stamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
/** Deliberately no aliases, punctuation stripping, family inference or zero padding. */
export const exactUnitName = (value: unknown) => text(value).replace(/\s+/g, ' ').toLowerCase();
export function routerStatus(row: Pick<RouterRow, 'probeStatus' | 'checkedAt'>, now = Date.now()): RouterStatus {
  const observed = row.checkedAt ? Date.parse(row.checkedAt) : NaN;
  if (!Number.isFinite(observed) || observed > now) return 'unknown';
  if (now - observed > ROUTER_FRESHNESS_MS) return 'stale';
  return row.probeStatus === 'online' ? 'reachable' : row.probeStatus === 'offline' ? 'unreachable' : 'unknown';
}
/** All fields are allowlisted. Raw metadata, credentials, and guessed GPS never reach the browser. */
export function routerSnapshot(routers: Row[], units: Row[], now = new Date(), devices: Row[] = []): RouterSnapshot {
  if (!Array.isArray(routers) || !Array.isArray(units) || !Array.isArray(devices)) throw new Error('Router source returned an incomplete collection.');
  const unitGroups = new Map<string, Row[]>(), routerCounts = new Map<string, number>();
  const catalog = [...units];
  for (const device of devices) {
    const key = routerJoinKey(device.unit_key);
    if (!key || catalog.some((unit) => routerJoinKey(unit.unit_number) === key)) continue;
    catalog.push({ id: 'camera-device:' + String(device.id), unit_number: text(device.unit_key) });
  }
  for (const unit of catalog) {
    if (typeof unit.id !== 'string' || !text(unit.unit_number)) throw new Error('COS unit list is incomplete.');
    const key = routerJoinKey(unit.unit_number);
    unitGroups.set(key, [...unitGroups.get(key) || [], unit]);
  }
  for (const router of routers) { const key = routerJoinKey(router.unit_key); routerCounts.set(key, (routerCounts.get(key) || 0) + 1); }
  const seen = new Set<string>();
  const items = routers.map(row => {
    if (!row || (typeof row.id !== 'string' && typeof row.id !== 'number') || !text(row.unit_key)) throw new Error('Router inventory contains an incomplete row.');
    const id = String(row.id); if (!id || seen.has(id)) throw new Error('Router inventory contains duplicate identities.'); seen.add(id);
    const key = routerJoinKey(row.unit_key), candidates = unitGroups.get(key) || [];
    const ambiguous = candidates.length > 1 || (routerCounts.get(key) || 0) > 1;
    let match: RouterRow['match'] = ambiguous ? 'ambiguous' : candidates.length === 1 ? 'exact_name' : 'unmatched';
    const placed = (unit: Row) => {
      const location = text(unit.current_location_type || unit.placement);
      return { id: String(unit.id), unitNumber: String(unit.unit_number), ...(location ? { placement: location } : {}) };
    };
    let candidateUnit = match === 'exact_name' ? placed(candidates[0]) : null;
    if (match !== 'exact_name') {
      const serials = [row.router_serial, row.inhand_serial].map(text).filter(Boolean);
      const hits = devices.filter((device) => serials.some((serial) => serial === text(device.device_serial)));
      const keys = new Set(hits.map((device) => routerJoinKey(device.unit_key)).filter(Boolean));
      if (hits.length === 1 && keys.size === 1) {
        match = 'exact_name';
        const located = text(hits[0].current_location_type || hits[0].placement).toLowerCase();
        candidateUnit = { id: 'camera-device:' + String(hits[0].id), unitNumber: text(hits[0].unit_key), ...(located ? { placement: located } : {}) };
      } else if (keys.size > 1) {
        match = 'ambiguous';
        candidateUnit = null;
      }
    }
    const unitPlacement = text(candidateUnit?.placement).toLowerCase();
    const reading = boardRouterStatus(row, +now, unitPlacement === 'shop' ? 'shop' : '');
    const port = number(row.web_port);
    return { id, unitKey: text(row.unit_key), name: text(row.router_name) || text(row.unit_key), model: text(row.router_model),
      publicIp: text(row.router_public_ip) || null, unitIp: text(row.unit_ip) || null,
      port: port !== null && Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
      protocol: ['http', 'https'].includes(text(row.web_protocol).toLowerCase()) ? text(row.web_protocol).toLowerCase() : null,
      probeStatus: ['online', 'offline'].includes(text(row.current_status).toLowerCase()) ? text(row.current_status).toLowerCase() : 'unknown',
      checkedAt: stamp(row.last_checked_at), lastRecoveredAt: stamp(row.last_online_at),
      reportedStatus: text(row.reported_status) || 'Unknown', reportedAt: stamp(row.status_observed_at), reportedSource: text(row.status_source) || 'Unspecified import',
      savedLatencyMs: number(row.reported_latency_ms) !== null && Number(row.reported_latency_ms) >= 0 ? Number(row.reported_latency_ms) : null,
      match, candidateUnit, gps: null,
      boardStatus: reading.status, boardCheckedAt: reading.checkedAt, boardOutage: reading.outage,
      doNotUse: doNotUseForKey(row.unit_key, devices),
    } as RouterRow;
  }).sort((a, b) => a.unitKey.localeCompare(b.unitKey, undefined, { numeric: true }));
  const doNotUseKeys: string[] = [];
  for (const device of devices) {
    if (!deviceDoNotUse(device)) continue;
    const key = routerJoinKey(device.unit_key);
    if (key && !doNotUseKeys.includes(key)) doNotUseKeys.push(key);
  }
  return { items, generatedAt: now.toISOString(), source: 'camera_health', gpsAvailable: false, doNotUseKeys };
}
export function readRouterSnapshot(value: unknown): RouterSnapshot {
  const data = value as RouterSnapshot;
  if (!data || data.source !== 'camera_health' || data.gpsAvailable !== false || !stamp(data.generatedAt) || !Array.isArray(data.items)) throw new Error('Router inventory returned an incomplete response.');
  const ids = new Set<string>();
  for (const row of data.items) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.unitKey !== 'string' || typeof row.name !== 'string' ||
      !['online', 'offline', 'unknown'].includes(row.probeStatus) || !['exact_name', 'ambiguous', 'unmatched'].includes(row.match) || row.gps !== null ||
      (row.checkedAt !== null && !stamp(row.checkedAt)) ||
      (row.doNotUse !== undefined && typeof row.doNotUse !== 'boolean') ||
      (row.boardStatus !== undefined && !['Online', 'Offline', 'Unknown', 'Unknown (no feed)', 'In Shop'].includes(row.boardStatus)) ||
      (row.match === 'exact_name' ? !row.candidateUnit || typeof row.candidateUnit.id !== 'string' || typeof row.candidateUnit.unitNumber !== 'string' : row.candidateUnit !== null))
      throw new Error('Router inventory returned inconsistent records.');
    ids.add(row.id);
  }
  return data;
}
export const routerLabels: Record<RouterStatus, string> = { reachable: 'Port reachable', unreachable: 'Port unreachable', stale: 'Stale check', unknown: 'Not verified' };
export function summarizeRouters(rows: RouterRow[], now = Date.now()) {
  return rows.reduce((counts, row) => { if (row.boardStatus === 'In Shop') return counts; counts[routerStatus(row, now)]++; return counts; }, { reachable: 0, unreachable: 0, stale: 0, unknown: 0 });
}

