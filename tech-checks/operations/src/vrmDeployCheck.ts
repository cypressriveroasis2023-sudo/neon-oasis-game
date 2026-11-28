// Deploy check: a Field Helios that has just been switched on (moved from the Shop to a site, or back on after
// being off) gets a short checklist for its first two days, so a bad setup shows on day one, not on the first
// night it goes dark. Works from the saved battery history (48 hours) and the solar charger reading only.
import type {HistoryPoint} from './vrmHistory';
import {overnightWindow, FULL_PERCENT, OVERNIGHT_LOW_PERCENT} from './vrmHistory';
import {mpptFresh, type Mppt} from './vrmMppt';

export const DEPLOY_GAP_H = 6;          // off this long, then back on = a new start
export const DEPLOY_SYNC_OUTAGE = 4;    // this many units "starting" within the same hour = a sync outage, not deploys
export const PANEL_ON_W = 20;           // solar power that proves the panels are wired
export type DeployState = 'ok' | 'fail' | 'wait';
export type DeployCheck = {label: string; state: DeployState; note: string};
export type Deploy = {installationId: number; name: string; since: number; checks: DeployCheck[]; failed: DeployCheck[]; done: boolean};

/** When the unit's current stretch of readings began (epoch s), if that was a fresh start inside the window. */
export function deployStart(points: readonly HistoryPoint[] | null | undefined, fleetStart: number | null): number | null {
  if (!points?.length) return null;
  let i = points.length - 1;
  while (i > 0 && points[i][0] - points[i - 1][0] < DEPLOY_GAP_H * 3600) i--;
  if (i > 0) return points[i][0];                                                  // off for 6+ hours, then back on
  return fleetStart !== null && points[0][0] - fleetStart >= DEPLOY_GAP_H * 3600 ? points[0][0] : null;   // first ever reading, well after the others
}

/** Hours of daylight (9 AM - 4 PM local) between two times. */
export function daylightHours(from: number, to: number): number {
  let total = 0;
  for (let day = new Date(from * 1000); day.getTime() / 1000 < to; day.setDate(day.getDate() + 1)) {
    const a = new Date(day); a.setHours(9, 0, 0, 0); const b = new Date(day); b.setHours(16, 0, 0, 0);
    total += Math.max(0, Math.min(b.getTime() / 1000, to) - Math.max(a.getTime() / 1000, from));
    day.setHours(0, 0, 0, 0);
  }
  return total / 3600;
}

export function deployCheck(input: {installationId: number; name: string; since: number; fresh: boolean; hasBattery: boolean;
  points: readonly HistoryPoint[]; mppt: Mppt | null | undefined}, now: number): Deploy {
  const {since, points} = input, nowS = now / 1000, after = points.filter(p => p[0] >= since);
  const onHours = (nowS - since) / 3600, sun = daylightHours(since, nowS);
  const checks: DeployCheck[] = [];
  checks.push(input.fresh ? {label: 'Reporting to Victron', state: 'ok', note: ''} : {label: 'Reporting to Victron', state: 'fail', note: 'no current reading'});
  checks.push(input.hasBattery ? {label: 'Battery reading', state: 'ok', note: ''} : {label: 'Battery reading', state: input.fresh ? 'fail' : 'wait', note: 'no battery number'});
  const m = input.mppt;
  if (mpptFresh(m, now)) checks.push(m.errorCode && m.errorCode > 0
    ? {label: 'Solar charger', state: 'fail', note: 'error ' + m.errorCode}
    : {label: 'Solar charger', state: 'ok', note: ''});
  else checks.push(onHours >= 1 ? {label: 'Solar charger', state: 'fail', note: 'not seen'} : {label: 'Solar charger', state: 'wait', note: 'first reading due'});
  const peakW = Math.max(0, ...after.map(p => p[2] ?? 0));
  checks.push(peakW >= PANEL_ON_W ? {label: 'Panels producing', state: 'ok', note: Math.round(peakW) + ' W seen'}
    : sun >= 2 ? {label: 'Panels producing', state: 'fail', note: 'nothing in ' + Math.round(sun) + ' h of daylight'}
    : {label: 'Panels producing', state: 'wait', note: 'waits for daylight'});
  const topped = after.some(p => (p[1] ?? 0) >= FULL_PERCENT);
  checks.push(topped ? {label: 'Charged to full', state: 'ok', note: ''}
    : sun >= 6 ? {label: 'Charged to full', state: 'fail', note: 'not full after a day of sun'}
    : {label: 'Charged to full', state: 'wait', note: 'after a day of sun'});
  const night = overnightWindow(now);
  if (night.done && night.from >= since) {
    const lows = points.filter(p => p[0] >= night.from && p[0] <= night.to && p[1] !== null).map(p => p[1] as number);
    const low = lows.length ? Math.min(...lows) : null;
    checks.push(low === null ? {label: 'First night', state: 'fail', note: 'no readings overnight'}
      : low >= OVERNIGHT_LOW_PERCENT ? {label: 'First night', state: 'ok', note: 'lowest ' + Math.round(low) + '%'}
      : {label: 'First night', state: 'fail', note: 'dropped to ' + Math.round(low) + '%'});
  } else checks.push({label: 'First night', state: 'wait', note: 'tonight'});
  const failed = checks.filter(c => c.state === 'fail');
  return {installationId: input.installationId, name: input.name, since, checks, failed, done: checks.every(c => c.state === 'ok')};
}

/** Field units that came on inside the saved history window. A shared start (sync outage) is not a deploy. */
export function newlyDeployed(units: readonly {installationId: number; name: string}[], history: ReadonlyMap<number, HistoryPoint[]> | null | undefined,
  isField: (name: string) => boolean): {installationId: number; name: string; since: number}[] {
  if (!history?.size) return [];
  // Where most units' history begins (the middle one), so an old stray reading does not move it.
  const firsts = [...history.values()].filter(p => p.length).map(p => p[0][0]).sort((a, b) => a - b);
  const fleetStart = firsts.length ? firsts[Math.floor((firsts.length - 1) / 2)] : null;
  const starts = units.filter(u => isField(u.name)).flatMap(u => { const s = deployStart(history.get(u.installationId), fleetStart); return s === null ? [] : [{...u, since: s}]; });
  return starts.filter(a => starts.filter(b => Math.abs(b.since - a.since) < 3600).length < DEPLOY_SYNC_OUTAGE);
}

export function deployAttentionLine(d: Deploy): string {
  return 'Just set up · ' + d.failed.map(c => c.label.toLowerCase() + (c.note ? ' (' + c.note + ')' : '')).join(', ');
}
