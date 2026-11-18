/** Watchful failing-device CSV. A separate assistant writes the file.
 * This module only reads it. It does not guess which COS unit a row belongs to. */

export const WATCHFUL_FRESH_MS = 45 * 60 * 1000;
export const IN_SHOP_COLOR = '#64748b';
export const RED_COLOR = '#b42318';
export const UNKNOWN_COLOR = '#8a8f98';
const MAX_ROWS = 5000;
const MAX_CHARS = 1_000_000;
const MAX_TEXT = 160;
const SHOP_SITES = new Set(['shop', 'root', 'in shop']);
const DEVICE_TYPES = new Set(['nvr', 'camera', 'vms', 'bridge']);
const FAILING = new Set(['offline', 'down', 'failed', 'fail', 'red', 'critical', 'alarm', 'unreachable']);
const COLUMNS: Record<'deviceName' | 'site' | 'deviceType' | 'status' | 'lastSeen', string[]> = {
  deviceName: ['device name', 'device', 'name'],
  site: ['site', 'site name', 'location'],
  deviceType: ['type', 'device type'],
  status: ['status', 'state'],
  lastSeen: ['last seen', 'last seen at'],
};
const REQUIRED = Object.keys(COLUMNS) as (keyof typeof COLUMNS)[];

export class WatchfulCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchfulCsvError';
  }
}

export type WatchfulDeviceType = 'nvr' | 'camera' | 'vms' | 'bridge';
export type WatchfulRow = {
  rowKey: string;
  deviceName: string;
  site: string;
  deviceType: WatchfulDeviceType;
  reportedStatus: string;
  lastSeenAt: string | null;
};
export type WatchfulUnit = {
  unit: string;
  displayName?: string | null;
  placement: 'FIELD' | 'SHOP';
  site?: string | null;
};
export type WatchfulLabel = 'Red' | 'Unknown' | 'In Shop';
export type WatchfulDeviceView = {
  rowKey: string;
  deviceName: string;
  site: string;
  deviceType: WatchfulDeviceType;
  match: 'exact' | 'unmatched';
  unit: string | null;
  placement: 'FIELD' | 'SHOP' | null;
  label: WatchfulLabel;
  color: string;
  counted: 0 | 1;
};
export type WatchfulCounts = { red: number; unknown: number; offline: number; inShop: number };
export type WatchfulPresentation = { devices: WatchfulDeviceView[]; counts: WatchfulCounts };

const fail = (message: string): never => { throw new WatchfulCsvError(message); };
const headerKey = (value: string) => value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const cell = (value: string) => value.trim().replace(/\s+/g, ' ');
export const exactWatchfulKey = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';

/** RFC-style CSV. A header row is required. Quoting mistakes fail the file. */
export function parseCsvTable(text: string): string[][] {
  if (typeof text !== 'string' || text.length > MAX_CHARS) fail('A header row is required.');
  const src = text.replace(/^\uFEFF/, '');
  if (!src.trim()) fail('A header row is required.');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      if (ch === '\u0000') fail('A header row is required.');
      field += ch;
      continue;
    }
    if (ch === '"') {
      if (field.length) fail('Invalid CSV quoting.');
      quoted = true;
      continue;
    }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }
    if (ch === '\u0000') fail('A header row is required.');
    field += ch;
  }
  if (quoted) fail('A quoted cell was not closed.');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(item => item === '')) rows.pop();
  if (rows.length < 1) fail('A header row is required.');
  return rows;
}

export function parseWatchfulCsv(text: string): WatchfulRow[] {
  const table = parseCsvTable(text);
  const header = table[0].map(headerKey);
  if (header.some(item => !item)) fail('Missing required column: device name, site, type, status, last seen.');
  if (new Set(header).size !== header.length) fail('Duplicate column: ' + header.find((item, index) => header.indexOf(item) !== index) + '.');
  const canonical = new Map<keyof typeof COLUMNS, number>();
  const unknown: string[] = [];
  header.forEach((name, index) => {
    const found = REQUIRED.find(key => COLUMNS[key].includes(name));
    if (!found) { unknown.push(name); return; }
    if (canonical.has(found)) fail('Duplicate column: ' + name + '.');
    canonical.set(found, index);
  });
  const sim = unknown.filter(name => ['imsi', 'iccid', 'imei', 'sim', 'sim number'].includes(name));
  if (sim.length) fail('SIM identifiers are not accepted.');
  const missing = REQUIRED.filter(key => !canonical.has(key));
  if (unknown.length || missing.length) {
    const parts = [];
    if (unknown.length) parts.push('Unknown column: ' + unknown.join(', ') + '.');
    if (missing.length) parts.push('Missing required column: ' + missing.map(key => COLUMNS[key][0]).join(', ') + '.');
    fail(parts.join(' '));
  }
  const body = table.slice(1);
  if (body.length > MAX_ROWS) fail('The file has too many rows.');
  const seen = new Set<string>();
  return body.map((record, index) => {
    const line = index + 2;
    if (record.length !== header.length) fail('Row ' + line + ' has a different number of columns.');
    const value = (key: keyof typeof COLUMNS) => cell(record[canonical.get(key)!] || '');
    const deviceName = value('deviceName');
    const site = value('site');
    const deviceType = value('deviceType').toLowerCase();
    if (!deviceName || deviceName.length > MAX_TEXT || !site || site.length > MAX_TEXT) fail('Row ' + line + ' is missing a device name or site.');
    if (!DEVICE_TYPES.has(deviceType)) fail('Row ' + line + ' device type is not an NVR, camera, VMS, or bridge.');
    const reportedStatus = value('status').toLowerCase().slice(0, 40);
    const rawSeen = value('lastSeen');
    const lastSeenAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawSeen) && Number.isFinite(Date.parse(rawSeen)) ? new Date(Date.parse(rawSeen)).toISOString() : null;
    const rowKey = deviceName + '|' + deviceType + '|' + site;
    if (seen.has(rowKey)) fail('Row ' + line + ' repeats a device already in this file.');
    seen.add(rowKey);
    return { rowKey, deviceName, site, deviceType: deviceType as WatchfulDeviceType, reportedStatus, lastSeenAt };
  });
}

export async function watchfulSourceSha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function reading(row: WatchfulRow, now: number): 'failing' | 'unknown' {
  if (!row.lastSeenAt) return 'unknown';
  const at = Date.parse(row.lastSeenAt);
  if (!Number.isFinite(at)) return 'unknown';
  const age = now - at;
  if (age < -60_000 || age > WATCHFUL_FRESH_MS) return 'unknown';
  return FAILING.has(row.reportedStatus) ? 'failing' : 'unknown';
}

function siteAgrees(unit: WatchfulUnit, site: string): boolean {
  const wanted = exactWatchfulKey(site);
  const recorded = exactWatchfulKey(unit.site || '');
  if (recorded && recorded === wanted) return true;
  return unit.placement === 'SHOP' && SHOP_SITES.has(wanted);
}

/** Exact unit name and an agreeing site. Two matches, or a site that does not agree, stay unmatched. */
export function presentWatchfulDevices(rows: readonly WatchfulRow[], units: readonly WatchfulUnit[], now = Date.now()): WatchfulPresentation {
  const byName = new Map<string, WatchfulUnit[]>();
  for (const unit of units || []) {
    const names = new Set([exactWatchfulKey(unit?.unit), exactWatchfulKey(unit?.displayName || '')].filter(Boolean));
    for (const name of names) byName.set(name, [...byName.get(name) || [], unit]);
  }
  const devices: WatchfulDeviceView[] = (rows || []).map(row => {
    const candidates = byName.get(exactWatchfulKey(row.deviceName)) || [];
    const agreed = candidates.filter(unit => siteAgrees(unit, row.site));
    const unique = agreed.length === 1 && new Set(agreed.map(unit => unit.unit)).size === 1 ? agreed[0] : null;
    const fresh = reading(row, now);
    if (!unique) {
      const failing = fresh === 'failing';
      return {
        rowKey: row.rowKey, deviceName: row.deviceName, site: row.site, deviceType: row.deviceType,
        match: 'unmatched' as const, unit: null, placement: null,
        label: failing ? 'Red' as const : 'Unknown' as const,
        color: failing ? RED_COLOR : UNKNOWN_COLOR,
        counted: 0 as const,
      };
    }
    if (unique.placement === 'SHOP') {
      return {
        rowKey: row.rowKey, deviceName: row.deviceName, site: row.site, deviceType: row.deviceType,
        match: 'exact' as const, unit: unique.unit, placement: 'SHOP' as const,
        label: 'In Shop' as const, color: IN_SHOP_COLOR, counted: 0 as const,
      };
    }
    const red = fresh === 'failing';
    return {
      rowKey: row.rowKey, deviceName: row.deviceName, site: row.site, deviceType: row.deviceType,
      match: 'exact' as const, unit: unique.unit, placement: 'FIELD' as const,
      label: red ? 'Red' as const : 'Unknown' as const,
      color: red ? RED_COLOR : UNKNOWN_COLOR,
      counted: 1 as const,
    };
  });
  const counts = devices.reduce((total, device) => {
    if (device.counted === 1 && device.label === 'Red') total.red += 1;
    if (device.counted === 1 && device.label === 'Unknown') total.unknown += 1;
    return total;
  }, { red: 0, unknown: 0, offline: 0, inShop: 0 });
  return { devices, counts };
}
