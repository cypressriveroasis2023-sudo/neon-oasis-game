// Router status for the saved Fleet board and the Routers page.
//
// Join keys reuse Camera Health's canonical unit parser (case, collapsed
// spaces, and SOLAR SPOTTER === SOLARSPOTTER). Names that parser does not
// recognize, including the SS001-style labels, stay on a full-string match
// after case and space collapsing. Nothing here is a partial or fuzzy match.
// prior_inhand_serial is never a live join key.

export const ROUTER_BOARD_FRESH_MS = 3 * 60 * 60 * 1000;
export const BOARD_ROUTER_STATUSES = ['Online', 'Offline', 'Unknown', 'Unknown (no feed)'];

const text = (value) => typeof value === 'string' ? value.trim() : '';
const plain = (value) => text(value).replace(/\s+/g, ' ').toUpperCase();

/** Same family + asset-number parse as canonicalCameraUnit in fieldCameraHealth. */
export function cameraHealthUnitKey(value) {
  const raw = String(value ?? '');
  const match = /^(SNIPER\s*[24]|RECON\s*(?:2|II))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(raw.trim())
    || /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)$/i.exec(raw.trim());
  if (!match) return null;
  let family = plain(match[1]).replace(/\s/g, '');
  family = { RI: 'RECON', RII: 'RECON2', RECONII: 'RECON2' }[family] || family;
  const [base, ...tail] = match[2].split('.');
  if (Number(base) === 0) return null;
  return family + '|' + Number(base) + (tail.length ? '.' + tail.join('.') : '');
}

/** Deterministic join key. Canonical camera units share a key; other labels do not. */
export function routerJoinKey(value) {
  const canonical = cameraHealthUnitKey(value);
  if (canonical) return 'canon:' + canonical;
  const name = text(String(value ?? '')).replace(/\s+/g, ' ').toLowerCase();
  return name ? 'name:' + name : '';
}

export function routerTypeOf(row) {
  if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(row, 'router_type')) {
    return { column: false, type: null };
  }
  const raw = row.router_type;
  if (raw == null || text(String(raw)) === '') return { column: true, type: null };
  return { column: true, type: text(String(raw)).toLowerCase() };
}

export function deviceDoNotUse(device) {
  if (!device || typeof device !== 'object' || !Object.prototype.hasOwnProperty.call(device, 'do_not_use')) return false;
  return device.do_not_use === true;
}

const stamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const shopPlacement = (placement) => text(placement).toLowerCase() === 'shop';

function liveSerials(row) {
  // prior_inhand_serial is history. It is not a live identity.
  return [row?.router_serial, row?.inhand_serial].map(text).filter(Boolean);
}

/** A saved Online/Offline label is only current inside the 3-hour window. */
export function shownBoardRouterLabel(status, checkedAt, now = Date.now(), placement = '') {
  if (shopPlacement(placement) && status) return 'In Shop';
  if (!status) return undefined;
  return displayedRouterStatus(status, checkedAt, now);
}

export function displayedRouterStatus(status, checkedAt, now = Date.now()) {
  if (status === 'In Shop' || status === 'Unknown (no feed)') return status;
  if (status !== 'Online' && status !== 'Offline') return 'Unknown';
  const at = typeof checkedAt === 'string' ? Date.parse(checkedAt) : NaN;
  if (!Number.isFinite(at) || at > now || now - at > ROUTER_BOARD_FRESH_MS) return 'Unknown';
  return status;
}

export function boardRouterStatus(row, now = Date.now(), placement = '') {
  const shop = shopPlacement(placement);
  const checkedAt = stamp(row?.last_checked_at ?? row?.checkedAt);
  if (shop) return { status: 'In Shop', checkedAt, outage: false };
  const finish = (status, outage) => ({ status, checkedAt, outage });
  const typeInfo = routerTypeOf(row);
  if (typeInfo.type === 'mofi' || typeInfo.type === 'cradlepoint') return finish('Unknown (no feed)', false);
  if (typeInfo.type === 'unknown') return finish('Unknown', false);
  const feedSerial = typeInfo.type === 'inhand'
    ? (text(row?.inhand_serial) || text(row?.router_serial))
    : text(row?.inhand_serial);
  if (!feedSerial) return finish('Unknown (no feed)', false);
  const observed = checkedAt ? Date.parse(checkedAt) : NaN;
  if (!Number.isFinite(observed) || observed > now || now - observed > ROUTER_BOARD_FRESH_MS) return finish('Unknown', false);
  const probe = text(row?.current_status ?? row?.probeStatus).toLowerCase();
  if (probe === 'online') return finish('Online', false);
  if (probe === 'offline') return finish('Offline', true);
  return finish('Unknown', false);
}

export function joinUnitRouter({ unitKey, serial = '', placement = '', routers = [], devices = [], now = Date.now() }) {
  const key = routerJoinKey(unitKey);
  const unitSerials = new Set(text(serial) ? [text(serial)] : []);
  for (const device of devices) {
    if (key && routerJoinKey(device.unit_key) === key && text(device.device_serial)) unitSerials.add(text(device.device_serial));
  }
  const hits = [];
  for (const router of routers) {
    const routerKey = routerJoinKey(router.unit_key ?? router.unitKey);
    const keyHit = Boolean(key) && routerKey === key;
    const serialHit = !keyHit && liveSerials(router).some((value) => unitSerials.has(value));
    if (keyHit || serialHit) hits.push(router);
  }
  if (hits.length !== 1) {
    return { status: hits.length === 0 ? 'Unknown (no feed)' : 'Unknown', checkedAt: null, outage: false, matched: false };
  }
  return { ...boardRouterStatus(hits[0], now, placement), matched: true };
}

export function doNotUseForKey(unitKey, devices = []) {
  const key = routerJoinKey(unitKey);
  if (!key) return false;
  return devices.some((device) => deviceDoNotUse(device) && routerJoinKey(device.unit_key) === key);
}

const stripPrivate = (unit) => {
  const copy = { ...unit };
  for (const key of ['publicIp', 'unitIp', 'router_public_ip', 'unit_ip', 'router_serial', 'inhand_serial', 'prior_inhand_serial', 'device_serial', 'do_not_use_note']) delete copy[key];
  return copy;
};

export function applyBoardRouterFields(rows, { savedUnits = [], doNotUseKeys = [] } = {}) {
  const saved = new Map();
  for (const unit of savedUnits || []) {
    const key = routerJoinKey(unit?.unitNumber);
    if (key && typeof unit.routerStatus === 'string') saved.set(key, unit);
  }
  const flags = new Set(doNotUseKeys || []);
  return (rows || []).map((row) => {
    const key = routerJoinKey(row?.name);
    const fromSaved = saved.get(key);
    const doNotUse = row?.doNotUse === true || flags.has(key) || fromSaved?.doNotUse === true;
    let routerLabel = row?.routerLabel || fromSaved?.routerStatus;
    if (!doNotUse && !fromSaved && row?.placement !== 'shop') return row;
    let routerState = row.routerState;
    if (row.placement === 'shop' && routerLabel) {
      routerLabel = 'In Shop';
      routerState = 'unknown';
    } else if (!row?.routerLabel && routerLabel) {
      routerState = routerLabel === 'Online' ? 'online' : routerLabel === 'Offline' ? 'offline' : 'unknown';
    }
    return { ...row, doNotUse, routerLabel, routerState, routerCheckedAt: row.routerCheckedAt ?? fromSaved?.routerCheckedAt ?? null };
  });
}

export function annotateSavedBoard(board, sources, now = Date.now()) {
  if (!board || !Array.isArray(board.units)) return board;
  const routers = sources?.routers || [];
  const devices = sources?.devices || [];
  const units = board.units.map((unit) => {
    const reading = joinUnitRouter({
      unitKey: unit.unitNumber,
      placement: unit.placement,
      routers,
      devices,
      now,
    });
    return stripPrivate({
      ...unit,
      routerStatus: reading.status,
      routerCheckedAt: reading.checkedAt,
      routerOutage: reading.outage === true,
      doNotUse: doNotUseForKey(unit.unitNumber, devices),
    });
  });
  return { ...board, units };
}

export function attachCameraUnits(units, sources, now = Date.now()) {
  const routers = sources?.routers || [];
  const devices = sources?.devices || [];
  return (units || []).map((unit) => {
    const unitKey = unit.unit ?? unit.unitNumber ?? '';
    const reading = joinUnitRouter({ unitKey, placement: unit.placement, routers, devices, now });
    return stripPrivate({
      ...unit,
      routerStatus: reading.status,
      routerCheckedAt: reading.checkedAt,
      routerOutage: reading.outage === true,
      doNotUse: doNotUseForKey(unitKey, devices) || unit.doNotUse === true,
    });
  });
}

export function routerPageRole(role) {
  return role === 'owner' || role === 'it' ? role : 'hidden';
}

export function presentRouterPage(snapshot, rawRouters, devices, role, now = Date.now()) {
  const showIp = routerPageRole(role) !== 'hidden';
  const rawById = new Map((rawRouters || []).map((row) => [String(row.id), row]));
  const items = (snapshot.items || []).map((item) => {
    const raw = rawById.get(String(item.id)) || {};
    let match = item.match;
    let candidateUnit = item.candidateUnit;
    if (match !== 'exact_name') {
      const serials = liveSerials(raw);
      const hits = (devices || []).filter((device) => serials.some((serial) => serial && serial === text(device.device_serial)));
      const keys = new Set(hits.map((device) => routerJoinKey(device.unit_key)).filter(Boolean));
      if (hits.length === 1 && keys.size === 1) {
        match = 'exact_name';
        candidateUnit = { id: 'camera-device:' + String(hits[0].id), unitNumber: text(hits[0].unit_key) || item.unitKey };
      } else if (hits.length > 1 && keys.size > 1) {
        match = 'ambiguous';
        candidateUnit = null;
      }
    }
    const reading = boardRouterStatus(raw, now, '');
    const next = {
      ...item,
      match,
      candidateUnit,
      boardStatus: reading.status,
      boardCheckedAt: reading.checkedAt,
      boardOutage: reading.outage === true,
      doNotUse: doNotUseForKey(item.unitKey, devices),
    };
    if (!showIp) {
      next.publicIp = null;
      next.unitIp = null;
    }
    return next;
  });
  const doNotUseKeys = [];
  for (const device of devices || []) {
    if (!deviceDoNotUse(device)) continue;
    const key = routerJoinKey(device.unit_key);
    if (key && !doNotUseKeys.includes(key)) doNotUseKeys.push(key);
  }
  return { ...snapshot, items, doNotUseKeys };
}

const COS_REST = 'https://goqrnolcvqnirjmzaeyk.supabase.co/rest/v1/';
/** Same publishable key the operations pages function sends on COS reads. */
export const COS_PUBLISHABLE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const COS_READ_TIMEOUT_MS = 5000;

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}

function cosReadHeaders(headers) {
  return {
    apikey: COS_PUBLISHABLE_KEY,
    Authorization: headerValue(headers, 'Authorization'),
    Accept: 'application/json',
  };
}

async function restGet(fetchImpl, headers, path) {
  const response = await fetchImpl(COS_REST + path, {
    headers: cosReadHeaders(headers),
    signal: AbortSignal.timeout(COS_READ_TIMEOUT_MS),
  });
  const bodyText = await response.text();
  let body = null;
  try { body = JSON.parse(bodyText); } catch { body = null; }
  return { ok: response.ok, status: response.status, body, bodyText };
}

async function paged(fetchImpl, headers, select) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const page = await restGet(fetchImpl, headers, select + '&limit=1000&offset=' + offset);
    if (!page.ok || !Array.isArray(page.body)) return page;
    rows.push(...page.body);
    if (page.body.length < 1000) return { ok: true, status: 200, body: rows, bodyText: '' };
  }
  return { ok: false, status: 500, body: null, bodyText: 'page limit' };
}

function missingColumn(page, column) {
  return !page.ok && page.status === 400 && new RegExp(column, 'i').test(page.bodyText || '');
}

export async function loadRouterBoardSources(fetchImpl, headers) {
  const base = 'id,unit_key,inhand_serial,current_status,last_checked_at';
  let routers = await paged(fetchImpl, headers, 'camera_unit_routers?select=' + base + ',router_type,router_serial&order=id.asc');
  if (missingColumn(routers, 'router_type') || missingColumn(routers, 'router_serial')) {
    routers = await paged(fetchImpl, headers, 'camera_unit_routers?select=' + base + '&order=id.asc');
  }
  let devices = await paged(fetchImpl, headers, 'camera_devices?select=id,unit_key,device_serial,do_not_use&order=id.asc');
  if (missingColumn(devices, 'do_not_use')) {
    devices = await paged(fetchImpl, headers, 'camera_devices?select=id,unit_key,device_serial&order=id.asc');
  }
  return {
    routers: routers.ok && Array.isArray(routers.body) ? routers.body : [],
    devices: devices.ok && Array.isArray(devices.body) ? devices.body : [],
  };
}

export async function loadRouterInventory(fetchImpl, headers) {
  const base = 'id,unit_key,router_name,router_model,router_public_ip,unit_ip,web_port,web_protocol,current_status,last_checked_at,last_online_at,reported_status,reported_latency_ms,status_source,status_observed_at,inhand_serial';
  let routers = await paged(fetchImpl, headers, 'camera_unit_routers?select=' + base + ',router_type,router_serial&order=id.asc');
  if (missingColumn(routers, 'router_type') || missingColumn(routers, 'router_serial')) {
    routers = await paged(fetchImpl, headers, 'camera_unit_routers?select=' + base + '&order=id.asc');
  }
  const sources = await loadRouterBoardSources(fetchImpl, headers);
  return { routers: routers.ok && Array.isArray(routers.body) ? routers.body : [], devices: sources.devices };
}

export async function projectBoard(project, args, headers, fetchImpl = globalThis.fetch) {
  const board = await project(...args);
  let sources = { routers: [], devices: [] };
  try { sources = await loadRouterBoardSources(fetchImpl, headers); } catch { sources = { routers: [], devices: [] }; }
  const at = Number.isFinite(args?.[4]) ? args[4] : Date.now();
  return annotateSavedBoard(board, sources, at);
}
