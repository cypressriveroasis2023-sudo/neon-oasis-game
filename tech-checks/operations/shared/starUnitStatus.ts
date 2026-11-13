// Unit camera status from the Star4Live (VCC) feed only.
//
// Owner rules this projection follows, and must keep following:
//  - One unit is one line. A unit with four cameras is still one unit.
//  - "root" (and "shop") is the shop. A customer or site name is the field.
//  - A unit in the shop never counts as offline. It can be online in the shop,
//    and it stays in the shop until a technician moves it by hand.
//  - A missing or failed check is Unknown. It is never reported as Offline.
//  - Nothing here moves a unit, renames a camera or writes to any provider.
export const STAR_UNIT_STATUS_CONTRACT = 'COS_STAR_UNIT_STATUS_V1';
const SHOP_NAMES = new Set(['', 'root', 'shop']);
const PENDING_SITE = /^Star4Live site #\d+ \(name pending\)$/;

export type StarCameraRow = {
  id?: number | string | null;
  device_name?: string | null;
  unit_key?: string | null;
  organization?: string | null;
  vigilant_status?: string | null;
  activation_state?: string | null;
  source_last_seen_at?: string | null;
  public_ip?: string | null;
  star_organization_id?: string | null;
};

export type UnitCamera = { name: string; status: 'online' | 'offline' | 'unknown' };

export type UnitCameraStatus = {
  unit: string;
  placement: 'FIELD' | 'SHOP';
  site: string | null;
  siteNamePending: boolean;
  state: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  cameras: number;
  online: number;
  offline: number;
  unknown: number;
  down: UnitCamera[];
  onlineInShop: boolean;
  publicIp: string | null;
  observedAt: string | null;
};

export type UnitCameraStatusReport = {
  contract: typeof STAR_UNIT_STATUS_CONTRACT;
  feed?: StarFeed;
  units: UnitCameraStatus[];
  counts: {
    units: number; cameras: number;
    field: { units: number; green: number; yellow: number; red: number; unknown: number; camerasDown: number };
    shop: { units: number; onlineInShop: number };
  };
};

// The Star4Live sync runs every fifteen minutes. Three missed runs and the
// readings are no longer evidence of anything: they become Unknown, not good news.
export const STAR_FEED_FRESH_MS = 45 * 60 * 1000;

export type StarFeed = {
  provider: 'star4live';
  syncedAt: string | null;
  status: string | null;
  enabled: boolean;
  fresh: boolean;
  ageMs: number | null;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

/** A camera is online only when the provider says so. Anything else is unknown, never offline. */
export function cameraStatus(row: StarCameraRow): UnitCamera['status'] {
  const value = text(row?.vigilant_status).toLowerCase();
  return value === 'online' ? 'online' : value === 'offline' ? 'offline' : 'unknown';
}

/** Shop or field comes from the camera's live organization, not from a saved placement. */
export function cameraPlacement(row: StarCameraRow): 'FIELD' | 'SHOP' {
  return SHOP_NAMES.has(text(row?.organization).toLowerCase()) ? 'SHOP' : 'FIELD';
}

export function unitLabel(row: StarCameraRow): string {
  return text(row?.unit_key) || text(row?.device_name);
}

function unitState(online: number, offline: number, unknown: number): UnitCameraStatus['state'] {
  if (online > 0 && offline === 0 && unknown === 0) return 'GREEN';
  if (online === 0 && offline === 0) return 'UNKNOWN';
  if (online === 0 && unknown === 0) return 'RED';
  return 'YELLOW';
}

/**
 * Group Star4Live camera rows into one line per unit.
 * Rows with no unit name, and cameras retired in COS, are left out.
 */
export function projectUnitCameraStatus(rows: StarCameraRow[] | null | undefined): UnitCameraStatusReport {
  const groups = new Map<string, StarCameraRow[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (text(row?.activation_state).toLowerCase() === 'deactivated') continue;
    const unit = unitLabel(row);
    if (!unit) continue;
    const key = unit.toUpperCase();
    (groups.get(key) || groups.set(key, []).get(key)!).push(row);
  }
  const units: UnitCameraStatus[] = [];
  for (const members of groups.values()) {
    const named = members.map(row => ({ row, status: cameraStatus(row), name: text(row.device_name) || unitLabel(row) }));
    const online = named.filter(c => c.status === 'online').length;
    const offline = named.filter(c => c.status === 'offline').length;
    const unknown = named.length - online - offline;
    // A camera that reports from a site decides where the unit is: a unit is in
    // the field as soon as one of its cameras sits under a customer name.
    const field = members.filter(row => cameraPlacement(row) === 'FIELD');
    const placement: 'FIELD' | 'SHOP' = field.length ? 'FIELD' : 'SHOP';
    const siteRow = field.find(row => cameraStatus(row) === 'online') || field[0];
    const site = placement === 'FIELD' ? text(siteRow?.organization) : null;
    const observed = members.map(row => text(row.source_last_seen_at)).filter(Boolean).sort();
    units.push({
      unit: unitLabel(members[0]),
      placement,
      site: site || null,
      siteNamePending: Boolean(site && PENDING_SITE.test(site)),
      state: unitState(online, offline, unknown),
      cameras: named.length, online, offline, unknown,
      down: named.filter(c => c.status !== 'online').map(c => ({ name: c.name, status: c.status })),
      onlineInShop: placement === 'SHOP' && online > 0,
      publicIp: text(members.find(row => text(row.public_ip))?.public_ip) || null,
      observedAt: observed.length ? observed[observed.length - 1] : null,
    });
  }
  units.sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true }));
  const fieldUnits = units.filter(u => u.placement === 'FIELD'), shopUnits = units.filter(u => u.placement === 'SHOP');
  return {
    contract: STAR_UNIT_STATUS_CONTRACT,
    units,
    counts: {
      units: units.length,
      cameras: units.reduce((total, u) => total + u.cameras, 0),
      field: {
        units: fieldUnits.length,
        green: fieldUnits.filter(u => u.state === 'GREEN').length,
        yellow: fieldUnits.filter(u => u.state === 'YELLOW').length,
        red: fieldUnits.filter(u => u.state === 'RED').length,
        unknown: fieldUnits.filter(u => u.state === 'UNKNOWN').length,
        camerasDown: fieldUnits.reduce((total, u) => total + u.offline, 0),
      },
      shop: { units: shopUnits.length, onlineInShop: shopUnits.filter(u => u.onlineInShop).length },
    },
  };
}

/**
 * Attach the state of the Star4Live sync, and refuse to present a stale feed as
 * health. When the last sync is missing, failed, disabled or old, every unit
 * reads Unknown: a reading nobody took is not an online camera and not an outage.
 */
export function applyFeedFreshness(
  report: UnitCameraStatusReport,
  feed: {syncedAt?: string | null; status?: string | null; enabled?: boolean | null} | null | undefined,
  now = Date.now(),
  maxAgeMs = STAR_FEED_FRESH_MS,
): UnitCameraStatusReport {
  const syncedAt = text(feed?.syncedAt) || null;
  const at = syncedAt ? Date.parse(syncedAt) : NaN;
  const ageMs = Number.isFinite(at) ? now - at : null;
  const status = text(feed?.status) || null;
  const enabled = feed?.enabled !== false;
  const fresh = enabled && status === 'ok' && ageMs !== null && ageMs >= -60000 && ageMs <= maxAgeMs;
  const stamped: StarFeed = {provider: 'star4live', syncedAt, status, enabled, fresh, ageMs};
  if (fresh) return {...report, feed: stamped};
  const units = report.units.map(unit => ({
    ...unit,
    state: 'UNKNOWN' as const,
    online: 0, offline: 0, unknown: unit.cameras,
    down: unit.down.map(camera => ({...camera, status: 'unknown' as const})),
    onlineInShop: false,
  }));
  const field = units.filter(unit => unit.placement === 'FIELD');
  return {
    ...report, feed: stamped, units,
    counts: {
      ...report.counts,
      field: {units: field.length, green: 0, yellow: 0, red: 0, unknown: field.length, camerasDown: 0},
      shop: {units: units.length - field.length, onlineInShop: 0},
    },
  };
}
