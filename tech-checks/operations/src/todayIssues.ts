import {addressTodoDetail, type TodoAddress} from './technicianTodos';
import type {CosPowerVerdict} from './cosPowerAlarms';
import {canonicalCameraUnit} from './fieldCameraHealth';
import {cameraState, type CameraRow} from './cameraEvidence';
import {RECON_CRITICAL_BATTERY_PERCENT} from '../shared/otherUnitStatus';

export type IssueKind = 'outage' | 'power' | 'placement' | 'device_link' | 'address' | 'no_reading';
export type TodayAudience = 'tech' | 'owner';

export type TodayIssue = {
  id: string;
  kind: IssueKind;
  unit: string;
  line: string;
  unitId?: string;
  productId?: string;
  recordId?: string;
};

const rank: Record<IssueKind, number> = {
  outage: 0, power: 1, placement: 2, device_link: 3, address: 4, no_reading: 5,
};
const ownerOnly = new Set<IssueKind>(['placement', 'device_link']);

export type TodayIssuesModel = {
  boardCurrent: boolean;
  count: number;
  issues: TodayIssue[];
  headline: string;
  empty: string | null;
};

type Camera = { unit: string; unitId?: string; placement?: string; offline: number };
type Power = { unit: string; unitId?: string; placement?: string; verdict: CosPowerVerdict };
type Placement = { unit: string; unitId?: string; detail?: string };
type Link = { unit: string; unitId?: string; productId?: string; recordId?: string };
type Quiet = { unit: string; unitId?: string; productId?: string };

/** One list, severity order. Shop is not an outage. Unknown is not offline. */
export function todayIssues(input: {
  role: TodayAudience;
  boardCurrent: boolean;
  checkedAt?: number | null;
  cameras?: Camera[];
  power?: Power[];
  placements?: Placement[];
  deviceLinks?: Link[];
  addresses?: (TodoAddress & { unitId?: string })[];
  noReadings?: Quiet[];
}): TodayIssuesModel {
  const issues: TodayIssue[] = [];
  for (const camera of input.cameras ?? []) {
    if (camera.placement === 'SHOP' || camera.placement === 'shop') continue;
    if (camera.offline <= 0) continue;
    const n = camera.offline;
    issues.push({
      id: 'outage:'+camera.unit,
      kind: 'outage',
      unit: camera.unit,
      unitId: camera.unitId,
      line: camera.unit+' — '+n+' camera'+(n === 1 ? '' : 's')+' offline in the field',
    });
  }
  for (const power of input.power ?? []) {
    if (power.placement === 'SHOP' || power.placement === 'shop') continue;
    const alarm = power.verdict.voltage === 'alarm' || power.verdict.soc === 'alarm' || power.verdict.silent === 'alarm';
    if (!alarm) continue;
    const what = power.verdict.silent === 'alarm' && power.verdict.voltage !== 'alarm' && power.verdict.soc !== 'alarm'
      ? 'power readings silent'
      : [power.verdict.voltage === 'alarm' ? 'voltage' : '', power.verdict.soc === 'alarm' ? 'charge' : ''].filter(Boolean).join(' and ')+' alarm';
    issues.push({id: 'power:'+power.unit, kind: 'power', unit: power.unit, unitId: power.unitId, line: power.unit+' — '+what});
  }
  if (input.role === 'owner') {
    for (const move of input.placements ?? []) {
      issues.push({id: 'placement:'+(move.unitId || move.unit), kind: 'placement', unit: move.unit, unitId: move.unitId, line: move.unit+' — mHelp Field overrode an old Shop move'});
    }
    for (const link of input.deviceLinks ?? []) {
      issues.push({id: 'link:'+(link.productId || link.unitId || link.unit), kind: 'device_link', unit: link.unit, unitId: link.unitId, productId: link.productId, recordId: link.recordId, line: link.unit+' — device link needed'});
    }
  }
  for (const address of input.addresses ?? []) {
    if (address.placement === 'SHOP') continue;
    const detail = addressTodoDetail(address);
    const words = detail.startsWith('Address couldn') ? 'address couldn\'t be mapped' : 'address cannot be placed';
    issues.push({id: 'address:'+(address.productId || address.unit), kind: 'address', unit: address.unit, unitId: address.unitId, productId: address.productId, line: address.unit+' — '+words});
  }
  for (const quiet of input.noReadings ?? []) {
    issues.push({id: 'quiet:'+(quiet.productId || quiet.unitId || quiet.unit), kind: 'no_reading', unit: quiet.unit, unitId: quiet.unitId, productId: quiet.productId, line: quiet.unit+' — no recent reading'});
  }
  issues.sort((a, b) => rank[a.kind] - rank[b.kind] || a.unit.localeCompare(b.unit));
  const visible = issues.filter(issue => input.role === 'owner' || !ownerOnly.has(issue.kind));
  const time = input.checkedAt ? new Date(input.checkedAt).toLocaleString('en-US', {timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : 'no completed board';
  const empty = visible.length ? null : input.boardCurrent ? 'No issues right now' : 'Board not current — last checked '+time;
  const count = visible.length;
  return {
    boardCurrent: input.boardCurrent,
    count,
    issues: visible,
    headline: count === 1 ? '1 issue today' : count+' issues today',
    empty,
  };
}

export type ChecklistRow =
  | { kind: 'item'; issue: TodayIssue }
  | { kind: 'group'; id: string; line: string; items: TodayIssue[] };

/** Repeated address lines become one item. The count is the number of units. */
export function checklistRows(issues: TodayIssue[]): ChecklistRow[] {
  const addresses = issues.filter(issue => issue.kind === 'address');
  const rest = issues.filter(issue => issue.kind !== 'address').map(issue => ({ kind: 'item' as const, issue }));
  if (addresses.length <= 1) return [...rest, ...addresses.map(issue => ({ kind: 'item' as const, issue }))];
  return [...rest, { kind: 'group', id: 'addresses', line: 'Fix '+addresses.length+' addresses in mHelpDesk', items: addresses }];
}

export type CameraFamilyId = 'recon' | 'avigilon' | 'alibi' | 'walle';
export type FamilyDetector = {
  name: string;
  status: 'online' | 'offline' | 'unknown';
  lastStatus?: 'online' | 'offline';
  lastAt?: string | null;
  batteryPercent?: number | null;
  batteryStatus?: string | null;
};
export type FamilyUnit = { unit: string; placement?: string; state: 'online' | 'offline' | 'unknown' | string; support?: boolean; detectors?: FamilyDetector[] };

/** Detector rows already on the unit. A missing product id is not filled in from the name. */
export function reconDetectors(rows: CameraRow[] | undefined, now = Date.now()): FamilyDetector[] {
  return (rows || []).filter(row => row.evidence?.source === 'Reconeyez' && row.evidence.resource === 'detector').map(row => {
    const current = cameraState(row, now);
    const said = row.evidence?.status;
    const stale = current !== 'online' && current !== 'offline';
    return {
      name: row.name,
      status: stale ? 'unknown' : current,
      ...(stale && (said === 'online' || said === 'offline') ? {lastStatus: said, lastAt: row.evidence?.observedAt || null} : {}),
      batteryPercent: row.batteryEvidence?.percent ?? null,
      batteryStatus: row.batteryEvidence?.status ?? null,
    };
  });
}

function reconUnitState(unit: FamilyUnit): 'online' | 'offline' | 'unknown' {
  const detectors = unit.detectors || [];
  if (!detectors.length) return unit.state === 'online' || unit.state === 'offline' ? unit.state : 'unknown';
  if (detectors.some(detector => detector.status === 'offline')) return 'offline';
  if (detectors.every(detector => detector.status === 'online')) return 'online';
  return 'unknown';
}

function reportAge(at: string | null | undefined, now: number): string {
  const ms = at ? now - Date.parse(at) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return 'age not recorded';
  const hours = Math.floor(ms / 3600000);
  if (hours >= 48) return Math.floor(hours / 24)+' days ago';
  if (hours >= 1) return hours+' hour'+(hours === 1 ? '' : 's')+' ago';
  return Math.floor(ms / 60000)+' min ago';
}
export type FamilyHealthCard = {
  id: CameraFamilyId;
  label: string;
  online: number;
  offline: number;
  unknown: number;
  field: number;
  issues: TodayIssue[];
  batteries?: { name: string; percent: number }[];
  deviceLinks?: string[];
  notes?: string[];
};

const FAMILY_LABELS: Record<CameraFamilyId, string> = {recon: 'Recon', avigilon: 'Avigilon', alibi: 'Star4Live', walle: 'Wall-E'};
const wallEName = (unit: string) => /^WA(?:LLE)?(?:\s|[-#]|$)/i.test(unit.trim());

export function cameraFamily(unit: string): CameraFamilyId | null {
  const key = canonicalCameraUnit(unit)?.split('|')[0];
  if (!key) return null;
  if (key === 'RECON' || key === 'RECON2') return 'recon';
  if (key === 'SNIPER' || key === 'SNIPER2' || key === 'SNIPER4' || key === 'CAMV') return 'avigilon';
  if (key === 'HELIOS' || key === 'RANGER' || key === 'SOLARSPOTTER' || key === 'SPOTTER' || key === 'SSHYBRID') return 'alibi';
  if (key === 'WALLE' || /^WA\d/.test(key)) return null;
  return null;
}

/** Field units only. Unknown stays unknown. Shop is left out of the counts and the issue list. */
export function familyHealthCards(units: FamilyUnit[], issues: TodayIssue[], now = Date.now()): FamilyHealthCard[] {
  const cards = (['recon', 'avigilon', 'alibi'] as const).map(id => {
    const field = units.filter(unit => !unit.support && unit.placement !== 'shop' && unit.placement !== 'SHOP' && cameraFamily(unit.unit) === id);
    const names = new Set(field.map(unit => unit.unit));
    const states = field.map(unit => id === 'recon' ? reconUnitState(unit) : unit.state === 'online' || unit.state === 'offline' ? unit.state : 'unknown');
    const detectors = id === 'recon' ? field.flatMap(unit => (unit.detectors || []).map(detector => ({unit: unit.unit, detector}))) : [];
    const batteries = detectors.filter(item => item.detector.batteryStatus === 'critical' || (item.detector.batteryPercent != null && item.detector.batteryPercent <= RECON_CRITICAL_BATTERY_PERCENT))
      .map(item => ({name: item.unit+' '+item.detector.name, percent: item.detector.batteryPercent ?? 0}));
    const notes = detectors.filter(item => item.detector.status === 'unknown' && item.detector.lastStatus)
      .map(item => item.unit+' '+item.detector.name+' — last reported '+item.detector.lastStatus+' · '+reportAge(item.detector.lastAt, now));
    return {
      id, label: FAMILY_LABELS[id], online: states.filter(state => state === 'online').length, offline: states.filter(state => state === 'offline').length, unknown: states.filter(state => state === 'unknown').length, field: field.length,
      issues: issues.filter(issue => names.has(issue.unit) && (issue.kind === 'outage' || issue.kind === 'no_reading' || issue.kind === 'power' || issue.kind === 'device_link')),
      ...(batteries.length ? {batteries} : {}),
      ...(notes.length ? {notes} : {}),
    };
  }).filter(card => card.field > 0);
  const wallE = units.filter(unit => !unit.support && unit.placement !== 'shop' && unit.placement !== 'SHOP' && wallEName(unit.unit));
  if (!wallE.length) return cards;
  return [...cards, {
    id: 'walle', label: 'Wall-E', online: 0, offline: 0, unknown: wallE.length, field: wallE.length,
    issues: wallE.map(unit => ({id: 'walle:'+unit.unit, kind: 'no_reading' as const, unit: unit.unit, line: unit.unit+' — no status source'})),
  }];
}
