// "Last night" report for the Victron page: every Helios from 5 PM to 7 AM, from the saved battery history.
// Plain numbers an owner can read at a glance; the same rules the page's other warnings use.
import type {HistoryPoint} from './vrmHistory';

export type NightStatus = 'act' | 'watch' | 'ok' | 'power' | 'none';
export type NightRow = {
  installationId: number; name: string; status: NightStatus; label: string;
  start: number | null; end: number | null; low: number | null; perHour: number | null; lastSeen: number | null;
};
export type NightReport = {
  from: number; to: number; done: boolean; rows: NightRow[];
  reporting: number; attention: number; lowest: {name: string; low: number} | null; silent: number;
  bottom: string[];
};

const at = (base: Date, dayOffset: number, hour: number) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.getTime() / 1000; };

/** The night being reported: the last finished 5 PM - 7 AM until 7 PM, then tonight so far (once it has 2 hours of readings). */
export function nightWindow(now: number): {from: number; to: number; done: boolean} {
  const d = new Date(now), h = d.getHours();
  if (h >= 19) return {from: at(d, 0, 17), to: at(d, 1, 7), done: false};
  if (h < 7) return {from: at(d, -1, 17), to: at(d, 0, 7), done: false};
  return {from: at(d, -1, 17), to: at(d, 0, 7), done: true};
}

const range = (xs: number[], unit: string) => { const a = Math.min(...xs), b = Math.max(...xs); return a === b ? a + unit : a + unit + '–' + b + unit; };
const rank: Record<NightStatus, number> = {act: 0, watch: 1, ok: 2, power: 3, none: 4};

/** isShop: units mHelp says are in the shop are listed but never counted as needing a look. */
export function nightReport(units: readonly {installationId: number; name: string}[], history: ReadonlyMap<number, HistoryPoint[]> | null, now: number, isShop: (name: string) => boolean = () => false): NightReport {
  const w = nightWindow(now), nowS = now / 1000;
  const rows: NightRow[] = units.map((u): NightRow => {
    const all = history?.get(u.installationId) ?? [];
    const pts = all.filter(p => p[1] !== null && p[0] >= w.from && p[0] <= Math.min(w.to, nowS + 60));
    const last = all.length ? all[all.length - 1][0] : null;
    const base = {installationId: u.installationId, name: u.name, lastSeen: last};
    if (pts.length < 3) return {...base, status: 'none', label: 'Not reporting', start: null, end: null, low: null, perHour: null};
    const start = pts[0][1] as number, end = pts[pts.length - 1][1] as number;
    const low = Math.min(...pts.map(p => p[1] as number));
    const hrs = (pts[pts.length - 1][0] - pts[0][0]) / 3600;
    const perHour = hrs >= 1 ? Math.max(0, Math.round((start - end) / hrs * 10) / 10) : null;
    const nightSun = pts.filter(p => (p[2] ?? 0) > 10).length;
    let status: NightStatus = 'ok', label = 'OK';
    if (low < 20) { status = 'act'; label = 'Went under 20%'; }
    else if (low < 30) { status = 'watch'; label = 'Under 30%'; }
    else if (low < 50) { status = 'watch'; label = 'Under 50%'; }
    else if (low >= 99 && nightSun >= pts.length / 2) { status = 'power'; label = 'Full, on outside power'; }
    return {...base, status, label, start: Math.round(start), end: Math.round(end), low: Math.round(low), perHour};
  }).sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, undefined, {numeric: true}));

  const live = rows.filter(r => r.status !== 'none');
  const onBattery = live.filter(r => r.status !== 'power');
  const lowestRow = onBattery.reduce<NightRow | null>((m, r) => r.low !== null && (!m || r.low < (m.low as number)) ? r : m, null);
  const attention = rows.filter(r => (r.status === 'act' || r.status === 'watch') && !isShop(r.name));
  const silent = rows.length - live.length;
  const bottom: string[] = [];
  if (!live.length) bottom.push('No Helios saved readings for this night yet.');
  else if (attention.length) bottom.push(attention.length + (attention.length === 1 ? ' unit needs' : ' units need') + ' a look' + (attention.length <= 3 ? ': ' + attention.map(r => r.name).join(', ') : ' (see Needs attention)') + '.');
  else bottom.push(w.done ? 'Every reporting Helios made it through the night.' : 'Every reporting Helios is fine so far tonight.');
  const ends = onBattery.map(r => r.end).filter((n): n is number => n !== null);
  if (ends.length) bottom.push((w.done ? 'Battery at 7 AM: ' : 'Battery now: ') + range(ends, '%') + ' for the units on battery.');
  const rates = onBattery.map(r => r.perHour).filter((n): n is number => n !== null);
  if (rates.length) bottom.push('They used ' + range(rates, '%') + ' an hour overnight.');
  const power = live.filter(r => r.status === 'power');
  if (power.length) bottom.push('On outside power all night: ' + power.map(r => r.name).join(', ') + '.');
  if (silent) bottom.push(silent + ' not reporting (tested and unplugged units show here with the last time they connected).');
  return {from: w.from, to: w.to, done: w.done, rows, reporting: live.length, attention: attention.length,
    lowest: lowestRow ? {name: lowestRow.name, low: lowestRow.low as number} : null, silent, bottom};
}
