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
  /** Watchful arming: armed, disarmed, paused, test, or unknown. Missing stays null. */
  arming: WatchfulArming | null;
  /** Watchful project id. Test sites are chosen from this id, not from the name. */
  projectId: string | null;
  /** This row's read time. Null means this row is Unknown. */
  readAt: string | null;
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
const PROJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * One forward gap. Each alternative consumes at least one character and the
 * repeat stops at 256, so a long run of spaces cannot backtrack.
 */
const SERIAL_GAP = /^(?:was\b|of\b|is\b|N[º°]|[^A-Za-z0-9]){0,256}/i;
const SERIAL_GAP_MAX = 256;
const READ_SKEW_MS = 5 * 60 * 1000;
export type WatchfulArming = 'armed' | 'disarmed' | 'paused' | 'test' | 'unknown';

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

function isSerialSep(char: string): boolean {
  return char !== undefined && !/[A-Za-z0-9]/.test(char);
}

function wordAt(text: string, index: number, word: string): number | null {
  if (text.slice(index, index + word.length).toLowerCase() !== word) return null;
  const after = index + word.length;
  if (after < text.length && /[A-Za-z0-9]/.test(text[after])) return null;
  return after;
}

function takeSeps(text: string, index: number): number {
  let at = index;
  let count = 0;
  while (at < text.length && count < SERIAL_GAP_MAX && isSerialSep(text[at])) {
    at += 1;
    count += 1;
  }
  return at;
}

function takeValue(text: string, index: number): number | null {
  let end = index;
  while (end < text.length && /[A-Za-z0-9-]/.test(text[end])) end += 1;
  if (end - index < 4) return null;
  const token = text.slice(index, end);
  if (!/\d/.test(token)) return null;
  return end;
}

/** Apply SERIAL_GAP once. The match is not retried against a shorter gap. A four-digit year after "of" is not a serial. */
function takeGapValue(text: string, index: number): {start: number; end: number} | null {
  const gap = SERIAL_GAP.exec(text.slice(index));
  const gapText = gap?.[0] ?? '';
  const at = index + gapText.length;
  const valueEnd = takeValue(text, at);
  if (valueEnd === null) return null;
  const token = text.slice(at, valueEnd);
  if (/^\d{4}$/.test(token) && /\bof\b[^A-Za-z0-9]*$/i.test(gapText)) return null;
  return {start: at, end: valueEnd};
}

function extendSerial(text: string, index: number): number {
  const spaced = takeSeps(text, index);
  const from = spaced > index ? spaced : index;
  for (const word of ['number', 'num', 'nbr', 'no']) {
    const end = wordAt(text, from, word);
    if (end === null) continue;
    return text[end] === '.' ? end + 1 : end;
  }
  return index;
}

function serialKeyword(text: string, index: number): number | null {
  if (text[index] === '\u2116') return index + 1;
  if (text.slice(index, index + 6).toLowerCase() === 'serial') {
    const after = index + 6;
    const extended = extendSerial(text, after);
    if (after < text.length && /[A-Za-z]/.test(text[after]) && extended === after) return null;
    return extended;
  }
  if (wordAt(text, index, 'ser') !== null) {
    let at = index + 3;
    if (text[at] === '.') at += 1;
    const afterSep = takeSeps(text, at);
    if (afterSep === at && text[index + 3] !== '.') return null;
    const no = wordAt(text, afterSep, 'no');
    if (no === null) return null;
    return text[no] === '.' ? no + 1 : no;
  }
  const lower = text[index]?.toLowerCase();
  if (lower === 's' && text[index + 1] === '.' && text[index + 2]?.toLowerCase() === 'n') {
    let at = index + 3;
    if (text[at] === '.') at += 1;
    if (at < text.length && /[A-Za-z0-9]/.test(text[at])) return null;
    return at;
  }
  if (lower === 's' && text[index + 1] === '/' && text[index + 2]?.toLowerCase() === 'n') {
    if (index + 3 < text.length && /[A-Za-z0-9]/.test(text[index + 3])) return null;
    return index + 3;
  }
  if (wordAt(text, index, 'sn') !== null) return index + 2;
  return null;
}

/** Find a serial label at a word boundary. The scan advances, so a long gap is not retried. */
function labelEnd(text: string, index: number): number | null {
  if (index > 0 && /[A-Za-z0-9_]/.test(text[index - 1])) return null;
  const direct = serialKeyword(text, index);
  if (direct !== null) return direct;
  if (!/[A-Za-z]/.test(text[index] || '')) return null;
  let end = index;
  while (end < text.length && /[A-Za-z]/.test(text[end])) end += 1;
  const word = text.slice(index, end).toLowerCase();
  const at = word.lastIndexOf('serial');
  if (at > 0) return extendSerial(text, index + at + 'serial'.length);
  const seps = takeSeps(text, end);
  if (seps === end) return null;
  return serialKeyword(text, seps);
}

function redactLabeledSerial(text: string): {text: string; stripped: boolean} {
  const {folded, spans} = foldForSerial(text);
  const cuts: {start: number; end: number}[] = [];
  let index = 0;
  while (index < folded.length) {
    const label = labelEnd(folded, index);
    if (label !== null) {
      const value = takeGapValue(folded, label);
      if (value) {
        const start = spans[value.start]?.start;
        const end = spans[value.end - 1]?.end;
        if (start !== undefined && end !== undefined) cuts.push({start, end});
        index = value.end;
        continue;
      }
      index = Math.max(index + 1, label);
      continue;
    }
    index += 1;
  }
  if (!cuts.length) return {text, stripped: false};
  const ordered = cuts.sort((left, right) => left.start - right.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const cut of ordered) {
    if (cut.end <= cursor) continue;
    const start = Math.max(cut.start, cursor);
    if (start > cursor) parts.push(text.slice(cursor, start));
    cursor = cut.end;
  }
  parts.push(text.slice(cursor));
  return {text: parts.join(''), stripped: true};
}

/** A project id is a UUID, stored lowercase. Anything else, including a name, is null. */
function projectIdOf(raw: string): string | null {
  const text = raw.trim();
  return PROJECT_UUID.test(text) ? text.toLowerCase() : null;
}

/** Drop an IPv4, IPv6, MAC, or serial value. Labels stay. Ordinary words stay. A UUID in an ordinary cell is not held aside. */
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

function normalizeArming(value: string | null): WatchfulArming | null {
  if (value === null) return null;
  const key = value.trim().toLowerCase().replace(/[\s._-]+/g, '');
  if (!key) return null;
  if (key === 'armed' || key === 'auto') return 'armed';
  if (key === 'disarmed') return 'disarmed';
  if (key === 'paused') return 'paused';
  if (key === 'test' || key === 'testmode') return 'test';
  if (key === 'unknown') return 'unknown';
  return 'unknown';
}

function rowReadAt(row: string[], readCol: number, fileRead: string | null, now: number): string | null {
  if (readCol < 0) return fileRead;
  const raw = String(row[readCol] ?? '').trim();
  if (!raw) return null;
  return parseOurRead(raw, now);
}

function parseOurRead(raw: string, now: number): string {
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) throw new WatchfulLoadError('Our read time is not a timestamp. The file was not loaded.');
  if (at > now + READ_SKEW_MS) throw new WatchfulLoadError('Our read time is in the future. The file was not loaded.');
  return new Date(at).toISOString();
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
  arming: WatchfulArming | null;
  projectId: string | null;
  /** This row's read time. A blank cell stays null and never borrows another row. */
  readAt: string | null;
};

/**
 * Read a sanitized Watchful export. An IP or serial column rejects the file.
 * An IP typed into a unit, site, or group cell is stripped, and a cell that
 * is only an IP rejects the file. Nothing is written to a database.
 */
export function loadWatchfulExport(csv: string, fetchedAt?: string | null, now = Date.now()): WatchfulLoadResult {
  const argument = typeof fetchedAt === 'string' ? fetchedAt.trim() : '';
  const fileRead = argument ? parseOurRead(argument, now) : null;
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
    if (Number.isFinite(seenAt) && seenAt > now + READ_SKEW_MS) throw new WatchfulLoadError('A reading time is in the future. The file was not loaded.');
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
      arming: armingCol >= 0 ? normalizeArming(read(armingCol) || null) : null,
      projectId: projectCol >= 0 ? projectIdOf(String(row[projectCol] ?? '')) : null,
      readAt: rowReadAt(row, readCol, fileRead, now),
    });
  }
  const rowReads = parsed.map(row => row.readAt).filter((value): value is string => value !== null);
  const ourRead = fileRead ?? (rowReads.length === parsed.length && rowReads.length ? rowReads.slice().sort()[0] : null);

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
      readAt: newest.readAt,
    });
  }
  units.sort((left, right) => left.canonicalUnitKey.localeCompare(right.canonicalUnitKey));
  return {snapshotAt: oldestObservedAt, oldestObservedAt, fetchedAt: ourRead, units, droppedSpeakers, collapsedCameraRows};
}
