import {watchfulCameraIdentity, watchfulCanonicalUnitKey, watchfulPerCameraUnit} from './watchfulUnitKey';

export const WATCHFUL_GROUPS = ['Uniview Spotters', 'Solar Spotters', 'Avigilon', 'Recon', 'Other'] as const;
export type WatchfulGroup = typeof WATCHFUL_GROUPS[number];

export type WatchfulSnapshotUnit = {
  unitName: string;
  canonicalUnitKey: string;
  siteName: string;
  group: WatchfulGroup;
  status: 'up' | 'down';
  camerasUp: number;
  camerasDown: number;
  /** Watchful's own observation time. Not our read time. */
  snapshotAt: string | null;
  /** Watchful arming. Missing stays null and is never invented. */
  arming: string | null;
  /** Watchful project id. Test sites are chosen from this id, not from the name. */
  projectId: string | null;
};

export type WatchfulLoadResult = {
  /** Oldest retained Watchful observation. Not our read time and not the newest row. */
  snapshotAt: string | null;
  oldestObservedAt: string | null;
  /** When we read Watchful. Null means the read time was not supplied, so the data is Unknown. */
  fetchedAt: string | null;
  units: WatchfulSnapshotUnit[];
  droppedSpeakers: number;
  collapsedCameraRows: number;
};

const GROUP_ALIAS: Record<string, WatchfulGroup> = {
  'uniview spotters': 'Uniview Spotters',
  'solar spotters': 'Solar Spotters',
  'avigilon': 'Avigilon',
  'avigilon incl. sniper and cam v': 'Avigilon',
  'recon': 'Recon',
  'other': 'Other',
};

const FORBIDDEN_HEADER = /(^|[^a-z])(ip|ips|ipv6|ip6|serial|serials|imei|imsi|iccid|sim|mac)([^a-z]|$)/i;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gi;
const MAC_PAIRS = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
const MAC_GROUPS = /\b[0-9a-f]{4}(?:[.:-][0-9a-f]{4}){2}\b/gi;
const MAC_BARE = /\b[0-9a-f]{12}\b/gi;
const SERIAL_LABEL = String.raw`(?:[A-Za-z]+[\s._-]*)?(?:serial(?:[\s._-]*(?:number|num|nbr|no\.?))?|s\/n|sn)`;
const SERIAL_SEPARATOR = String.raw`(?::|=|#|_|-|\/|\.)`;
const SERIAL_VALUE = String.raw`(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{4,}`;
const LABELED_SERIAL = new RegExp(
  `(?<![A-Za-z0-9_])("|'|<)?(${SERIAL_LABEL})(?![A-Za-z0-9])("|'|)?(\\s*${SERIAL_SEPARATOR}\\s*("|'|)?|>\\s*|\\s*[\\[(]\\s*|\\s*)(${SERIAL_VALUE})\\s*("|'|\\]|\\)|<\\/serial>)?`,
  'gid',
);

export class WatchfulLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchfulLoadError';
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (char !== '\r') cell += char;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(item => item.some(value => value.trim() !== ''));
}

function headerKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isIpv6Token(token: string): boolean {
  if (!token.includes(':') || token.includes(':::')) return false;
  const pieces = token.split('::');
  if (pieces.length > 2) return false;
  const groups = token.split(':').filter(part => part.length > 0);
  if (groups.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return false;
  if (pieces.length === 2) return groups.length <= 7 && token.length > 2;
  return groups.length === 8;
}

function scrubToken(pattern: RegExp, text: string): {text: string; stripped: boolean} {
  pattern.lastIndex = 0;
  if (!pattern.test(text)) return {text, stripped: false};
  pattern.lastIndex = 0;
  return {text: text.replace(pattern, ' '), stripped: true};
}

/** Fold fullwidth letters and encoded separators so the label rule can see them. The original text is what we edit. */
function foldForSerial(text: string): {folded: string; spans: {start: number; end: number}[]} {
  const spans: {start: number; end: number}[] = [];
  let folded = '';
  for (let i = 0; i < text.length;) {
    const encoded = text.slice(i, i + 3);
    if (/^%3[AaDd]$/.test(encoded)) {
      folded += encoded[2].toLowerCase() === 'a' ? ':' : '=';
      spans.push({start: i, end: i + 3});
      i += 3;
      continue;
    }
    const code = text.charCodeAt(i);
    if (code === 0xFE55 || code === 0xA789 || code === 0xFF1A) {
      folded += ':';
      spans.push({start: i, end: i + 1});
      i += 1;
      continue;
    }
    if (code >= 0xFF01 && code <= 0xFF5E) {
      folded += String.fromCharCode(code - 0xFEE0);
      spans.push({start: i, end: i + 1});
      i += 1;
      continue;
    }
    folded += text[i];
    spans.push({start: i, end: i + 1});
    i += 1;
  }
  return {folded, spans};
}

function redactLabeledSerial(text: string): {text: string; stripped: boolean} {
  const {folded, spans} = foldForSerial(text);
  LABELED_SERIAL.lastIndex = 0;
  const cuts: {start: number; end: number}[] = [];
  for (const match of folded.matchAll(LABELED_SERIAL)) {
    const value = match[6];
    const indices = match.indices?.[6];
    if (!value || !indices) continue;
    const start = spans[indices[0]]?.start;
    const end = spans[indices[1] - 1]?.end;
    if (start === undefined || end === undefined) continue;
    cuts.push({start, end});
  }
  if (!cuts.length) return {text, stripped: false};
  let next = text;
  for (const cut of cuts.sort((left, right) => right.start - left.start)) {
    next = next.slice(0, cut.start) + next.slice(cut.end);
  }
  return {text: next, stripped: true};
}

/** Drop an IPv4, IPv6, MAC, or serial value. Labels stay. Ordinary words stay. */
export function stripWatchfulIp(value: string): {text: string; stripped: boolean; onlyIp: boolean} {
  let text = value;
  let stripped = false;
  const mark = (next: {text: string; stripped: boolean}) => { text = next.text; if (next.stripped) stripped = true; };
  mark(scrubToken(MAC_PAIRS, text));
  mark(scrubToken(MAC_GROUPS, text));
  mark(scrubToken(MAC_BARE, text));
  const labeled = redactLabeledSerial(text);
  text = labeled.text;
  if (labeled.stripped) stripped = true;
  text = text.replace(/\b(?:\d{14,17}|[A-F0-9]{12,})\b/gi, token => {
    if (/^\d{4}-\d{2}-\d{2}/.test(token)) return token;
    stripped = true;
    return ' ';
  });
  IPV4.lastIndex = 0;
  if (IPV4.test(text)) { IPV4.lastIndex = 0; stripped = true; text = text.replace(IPV4, ' '); IPV4.lastIndex = 0; }
  text = text.replace(/[0-9a-f:]{2,}/gi, token => {
    if (!isIpv6Token(token)) return token;
    stripped = true;
    return ' ';
  });
  text = text.replace(/\s+/g, ' ').trim();
  return {text, stripped, onlyIp: stripped && text.length === 0};
}

function groupOf(value: string): WatchfulGroup {
  const group = GROUP_ALIAS[value.trim().toLowerCase()];
  if (!group) throw new WatchfulLoadError('A group is not one of the Watchful groups. The row was not loaded.');
  return group;
}

function statusOf(value: string): 'up' | 'down' {
  const status = value.trim().toLowerCase();
  if (status === 'up' || status === 'online') return 'up';
  if (status === 'down' || status === 'offline') return 'down';
  throw new WatchfulLoadError('A status is not up or down. The file was not loaded.');
}

function countOf(value: string, label: string): number {
  if (value.trim() === '') return 0;
  if (!/^\d{1,6}$/.test(value.trim())) throw new WatchfulLoadError(`${label} is not a camera count. The file was not loaded.`);
  return Number(value.trim());
}

type Parsed = {
  order: number;
  seenAt: number | null;
  unitName: string;
  key: string;
  cameraId: string;
  perCamera: boolean;
  siteName: string;
  group: WatchfulGroup;
  status: 'up' | 'down';
  camerasUp: number;
  camerasDown: number;
  arming: string | null;
  projectId: string | null;
};

/**
 * Read a sanitized Watchful export. An IP or serial column rejects the file.
 * An IP typed into a unit, site, or group cell is stripped, and a cell that
 * is only an IP rejects the file. Nothing is written to a database.
 */
export function loadWatchfulExport(csv: string, fetchedAt?: string | null): WatchfulLoadResult {
  const argument = typeof fetchedAt === 'string' ? fetchedAt.trim() : '';
  if (argument && !Number.isFinite(Date.parse(argument))) throw new WatchfulLoadError('The fetch time is not a timestamp.');
  const table = parseCsv(csv);
  if (table.length < 2) throw new WatchfulLoadError('The export has no rows.');
  const headers = table[0].map(headerKey);
  const forbidden = headers.filter(header => FORBIDDEN_HEADER.test(header.replace(/_/g, ' ')));
  if (forbidden.length) throw new WatchfulLoadError(`The export has a forbidden column: ${forbidden[0]}.`);
  const index = (names: string[]) => names.map(name => headers.indexOf(name)).find(found => found >= 0) ?? -1;
  const unitCol = index(['unit', 'unit_name', 'name']);
  const siteCol = index(['site', 'site_name']);
  const groupCol = index(['group', 'unit_group']);
  const statusCol = index(['status', 'unit_status']);
  const upCol = index(['cameras_up', 'cameras_up_count']);
  const downCol = index(['cameras_down', 'cameras_down_count']);
  const seenCol = index(['seen_at', 'updated_at', 'snapshot_at']);
  const readCol = index(['read_at', 'our_read_at', 'fetched_at']);
  const armingCol = index(['arming']);
  const projectCol = index(['project_id', 'projectid']);
  if ([unitCol, siteCol, groupCol, statusCol, upCol, downCol].some(col => col < 0)) {
    throw new WatchfulLoadError('The export is missing unit, site, group, status, or camera counts.');
  }

  const parsed: Parsed[] = [];
  let droppedSpeakers = 0;
  for (let rowIndex = 1; rowIndex < table.length; rowIndex++) {
    const row = table[rowIndex];
    const read = (col: number) => {
      const raw = String(row[col] ?? '');
      const cleaned = stripWatchfulIp(raw);
      if (cleaned.onlyIp) throw new WatchfulLoadError('A cell is an IP or MAC address or a serial. The file was not loaded.');
      return cleaned.text;
    };
    const unitName = read(unitCol);
    const key = watchfulCanonicalUnitKey(unitName);
    if (!key) {
      if (/\bip\s*speakers?\b/i.test(unitName)) { droppedSpeakers++; continue; }
      throw new WatchfulLoadError('A unit name could not be paired. The file was not loaded.');
    }
    const seenRaw = seenCol >= 0 ? read(seenCol) : '';
    const seenAt = seenRaw ? Date.parse(seenRaw) : NaN;
    if (seenRaw && !Number.isFinite(seenAt)) throw new WatchfulLoadError('A reading time is not a timestamp. The file was not loaded.');
    parsed.push({
      order: rowIndex,
      seenAt: Number.isFinite(seenAt) ? seenAt : null,
      unitName,
      key,
      cameraId: watchfulCameraIdentity(unitName),
      perCamera: watchfulPerCameraUnit(key),
      siteName: read(siteCol),
      group: groupOf(read(groupCol)),
      status: statusOf(read(statusCol)),
      camerasUp: countOf(read(upCol), 'cameras up'),
      camerasDown: countOf(read(downCol), 'cameras down'),
      arming: armingCol >= 0 ? read(armingCol) || null : null,
      projectId: projectCol >= 0 ? read(projectCol) || null : null,
    });
  }
  const columnReads = readCol < 0 ? [] : table.slice(1).map(row => String(row[readCol] ?? '').trim()).filter(Boolean);
  if (columnReads.some(value => !Number.isFinite(Date.parse(value)))) throw new WatchfulLoadError('Our read time is not a timestamp. The file was not loaded.');
  const columnRead = columnReads.length ? new Date(Math.min(...columnReads.map(value => Date.parse(value)))).toISOString() : null;
  const ourRead = argument ? new Date(Date.parse(argument)).toISOString() : columnRead;

  const latest = new Map<string, Parsed>();
  for (const row of parsed) {
    const id = `${row.key}\n${row.perCamera ? row.cameraId : ''}`;
    const held = latest.get(id);
    if (!held) { latest.set(id, row); continue; }
    const rowTime = row.seenAt ?? row.order;
    const heldTime = held.seenAt ?? held.order;
    if (rowTime >= heldTime) latest.set(id, row);
  }
  const kept = [...latest.values()];
  const byUnit = new Map<string, Parsed[]>();
  for (const row of kept) {
    const list = byUnit.get(row.key) || [];
    list.push(row);
    byUnit.set(row.key, list);
  }

  const observed = kept.map(row => row.seenAt);
  const oldest = observed.length && observed.every(value => value !== null) ? Math.min(...observed as number[]) : null;
  const oldestObservedAt = oldest === null ? null : new Date(oldest).toISOString();
  const units: WatchfulSnapshotUnit[] = [];
  let collapsedCameraRows = 0;
  for (const [key, rows] of byUnit) {
    rows.sort((left, right) => (left.seenAt ?? left.order) - (right.seenAt ?? right.order));
    const newest = rows[rows.length - 1];
    if (newest.perCamera && rows.length > 1) collapsedCameraRows += rows.length - 1;
    const camerasUp = newest.perCamera ? rows.filter(row => row.status === 'up').length : newest.camerasUp;
    const camerasDown = newest.perCamera ? rows.filter(row => row.status === 'down').length : newest.camerasDown;
    const status = newest.perCamera ? (camerasDown > 0 ? 'down' : 'up') : newest.status;
    units.push({
      unitName: newest.unitName.replace(/\s+(?:CAM(?:ERA)?|CH(?:ANNEL)?)\s*\d+\s*$/i, '').trim(),
      canonicalUnitKey: key,
      siteName: newest.siteName,
      group: newest.group,
      status,
      camerasUp,
      camerasDown,
      snapshotAt: oldestObservedAt,
      arming: newest.arming,
      projectId: newest.projectId,
    });
  }
  units.sort((left, right) => left.canonicalUnitKey.localeCompare(right.canonicalUnitKey));
  return {snapshotAt: oldestObservedAt, oldestObservedAt, fetchedAt: ourRead, units, droppedSpeakers, collapsedCameraRows};
}
