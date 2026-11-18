/** InHand router CSV. Match and write rules live with the SQL loader.
 * This module only accepts the file and decides who may see an IP. */

export class InhandCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InhandCsvError';
  }
}

const MAX_ROWS = 2000;
const MAX_CHARS = 1_000_000;
const SIM_COLUMNS = new Set(['imsi', 'iccid', 'imei', 'sim', 'sim number']);
const COLUMNS = {
  name: ['name', 'router name', 'device name'],
  serial: ['serial', 'serial number', 'inhand serial'],
  status: ['status', 'state', 'online', 'online/offline'],
  lastSeen: ['last seen', 'last seen at'],
  ip: ['ip', 'ip address', 'public ip'],
} as const;
const OPTIONAL = { deviceId: ['device id', 'inhand device id'] } as const;
const REQUIRED = Object.keys(COLUMNS) as (keyof typeof COLUMNS)[];

export type InhandRouterRow = {
  name: string;
  serial: string;
  status: 'online' | 'offline';
  lastSeenAt: string;
  ip: string | null;
  deviceId: string | null;
};

const fail = (message: string): never => { throw new InhandCsvError(message); };
const headerKey = (value: string) => value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const cell = (value: string) => value.trim().replace(/\s+/g, ' ');

function parseTable(text: string): string[][] {
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
  if (!rows.length) fail('A header row is required.');
  return rows;
}

function ipv4(value: string): string | null {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
  return value.split('.').every(part => Number(part) <= 255) ? value : null;
}

export function parseInhandRouterCsv(text: string): InhandRouterRow[] {
  const table = parseTable(text);
  const header = table[0].map(headerKey);
  if (header.some(item => !item)) fail('Missing required column: name, serial, status, last seen, ip.');
  if (new Set(header).size !== header.length) fail('Duplicate column: ' + header.find((item, index) => header.indexOf(item) !== index) + '.');
  const canonical = new Map<string, number>();
  const unknown: string[] = [];
  header.forEach((name, index) => {
    const required = REQUIRED.find(key => (COLUMNS[key] as readonly string[]).includes(name));
    const optional = (OPTIONAL.deviceId as readonly string[]).includes(name) ? 'deviceId' : null;
    const found = required || optional;
    if (!found) { unknown.push(name); return; }
    if (canonical.has(found)) fail('Duplicate column: ' + name + '.');
    canonical.set(found, index);
  });
  if (unknown.some(name => SIM_COLUMNS.has(name))) fail('SIM identifiers are not accepted.');
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
    const value = (key: string) => cell(record[canonical.get(key)!] ?? '');
    const name = value('name');
    const serial = value('serial');
    const status = value('status').toLowerCase();
    const rawSeen = value('lastSeen');
    const rawIp = value('ip');
    const rawDevice = canonical.has('deviceId') ? value('deviceId') : '';
    if (!name || name.length > 160 || !serial || serial.length > 80) fail('Row ' + line + ' is missing a name or serial.');
    if (/^[0-9]{14,22}$/.test(serial)) fail('A SIM identifier was refused.');
    if (status !== 'online' && status !== 'offline') fail('Row ' + line + ' status must be online or offline.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawSeen) || !Number.isFinite(Date.parse(rawSeen))) fail('Row ' + line + ' is missing a last-seen time.');
    const ip = rawIp ? ipv4(rawIp) : null;
    if (rawIp && !ip) fail('Row ' + line + ' IP could not be read.');
    if (rawDevice.length > 80) fail('Row ' + line + ' device id could not be read.');
    if (/^[0-9]{14,22}$/.test(rawDevice)) fail('A SIM identifier was refused.');
    if (seen.has(serial)) fail('Row ' + line + ' repeats a serial already in this file.');
    seen.add(serial);
    return { name, serial, status, lastSeenAt: new Date(Date.parse(rawSeen)).toISOString(), ip, deviceId: rawDevice || null };
  });
}

/** IPs stay with Owner and verified IT. No SIM field is copied onto the result. */
export function inhandStatusForRole<T extends { ip?: string | null }>(row: T, role: string): Omit<T, 'ip'> & { ip: string | null } {
  const show = role === 'owner' || role === 'it';
  const { ip, ...rest } = row;
  return { ...rest, ip: show ? ip || null : null };
}
