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
  snapshotAt: string | null;
};

export type WatchfulLoadResult = {
  /** Oldest retained observation. Not the fetch time and not the newest row. */
  snapshotAt: string | null;
  oldestObservedAt: string | null;
  fetchedAt: string;
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
const MAC = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
const DOTTED_MAC = /\b[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}\b/gi;
const LABELED_SERIAL = /\b(?:serial|s\/n|sn)\b[:\s#-]*[A-Z0-9][A-Z0-9-]{5,}/gi;
const BARE_SERIAL = /\b(?:\d{14,17}|[A-F0-9]{12,})\b/gi;

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

/** Drop an IPv4, IPv6, or MAC token. A cell that is only one of those is rejected by the caller. */
export function stripWatchfulIp(value: string): {text: string; stripped: boolean; onlyIp: boolean} {
  let text = value;
  let stripped = false;
  if (MAC.test(text)) { MAC.lastIndex = 0; stripped = true; text = text.replace(MAC, ' '); MAC.lastIndex = 0; }
  if (DOTTED_MAC.test(text)) { DOTTED_MAC.lastIndex = 0; stripped = true; text = text.replace(DOTTED_MAC, ' '); DOTTED_MAC.lastIndex = 0; }
  if (LABELED_SERIAL.test(text)) { LABELED_SERIAL.lastIndex = 0; stripped = true; text = text.replace(LABELED_SERIAL, ' '); LABELED_SERIAL.lastIndex = 0; }
  if (BARE_SERIAL.test(text)) { BARE_SERIAL.lastIndex = 0; stripped = true; text = text.replace(BARE_SERIAL, ' '); BARE_SERIAL.lastIndex = 0; }
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
};

/**
 * Read a sanitized Watchful export. An IP or serial column rejects the file.
 * An IP typed into a unit, site, or group cell is stripped, and a cell that
 * is only an IP rejects the file. Nothing is written to a database.
 */
export function loadWatchfulExport(csv: string, fetchedAt: string): WatchfulLoadResult {
  const fetched = Date.parse(fetchedAt);
  if (!Number.isFinite(fetched)) throw new WatchfulLoadError('The fetch time is not a timestamp.');
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
    });
  }

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
    });
  }
  units.sort((left, right) => left.canonicalUnitKey.localeCompare(right.canonicalUnitKey));
  return {snapshotAt: oldestObservedAt, oldestObservedAt, fetchedAt: new Date(fetched).toISOString(), units, droppedSpeakers, collapsedCameraRows};
}
