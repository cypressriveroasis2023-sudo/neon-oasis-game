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
/** Every camera Star4Live reports for a unit, with where it sits and whether a
 * person has said it is no longer on the unit (a swap). */
export type UnitCameraEntry = UnitCamera & { atSite: boolean; removed?: boolean };

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
  // Cameras on this unit that are sitting in root while the unit is at a site:
  // a spare, or one swapped out and not yet removed in Star4Live. They are shown
  // for the record and never counted as an outage at the site.
  awayFromSite?: UnitCamera[];
  // Every camera the provider reports for this unit, for the unit's own panel.
  cameraList?: UnitCameraEntry[];
  // What to call this unit on screen, when a person has corrected the provider's
  // name. The unit's own key is unchanged.
  displayName?: string;
  onlineInShop: boolean;
  publicIp: string | null;
  observedAt: string | null;
  providerPlacement?: 'FIELD' | 'SHOP';
  providerSite?: string | null;
  providerPublicIp?: string | null;
  // Star4Live reports no street address. A unit has one only when the Owner or
  // IT typed it and the Census geocoder matched it to a point; that is its pin.
  address?: string | null;
  location?: UnitLocation | null;
  handEdits?: Partial<Record<HandEditField, AppliedHandEdit>>;
  // Where the up/down reading came from. Absent means Star4Live.
  source?: UnitSource;
};

export type UnitSource = 'star4live' | 'ip_check' | 'reconeyez';

export type UnitLocation = { latitude: number; longitude: number; matchedAddress: string | null; source: 'hand' };

// 'camera' says a camera the provider still reports is no longer on this unit -
// a swap. It never says whether a camera is online.
// 'name' is what COS calls a unit when the provider's own name is wrong. It
// never changes which unit this is: every record still keys on the provider's
// name, so nothing is relinked and no history moves.
export const HAND_EDIT_FIELDS = ['placement', 'site', 'address', 'public_ip', 'camera', 'name'] as const;
export type HandEditField = typeof HAND_EDIT_FIELDS[number];

export type HandEdit = {
  unit_key?: string | null;
  field?: string | null;
  action?: string | null;
  value?: string | null;
  provider_value?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  reason?: string | null;
  created_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  matched_address?: string | null;
};

export type AppliedHandEdit = {
  value: string | null;
  by: string;
  role: string;
  at: string | null;
  reason: string | null;
  providerValue: string | null;
  providerAgrees: boolean;
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
    // A camera that reports from a site decides where the unit is: a unit is in
    // the field as soon as one of its cameras sits under a customer name.
    const field = members.filter(row => cameraPlacement(row) === 'FIELD');
    const placement: 'FIELD' | 'SHOP' = field.length ? 'FIELD' : 'SHOP';
    // A unit at a customer site is judged by the cameras that are there. One left
    // in root is a spare or a swapped-out camera; root is the shop, and the shop
    // is never a field outage.
    const atSite = placement === 'FIELD' ? named.filter(c => cameraPlacement(c.row) === 'FIELD') : named;
    const awayFromSite = placement === 'FIELD' ? named.filter(c => cameraPlacement(c.row) !== 'FIELD') : [];
    const online = atSite.filter(c => c.status === 'online').length;
    const offline = atSite.filter(c => c.status === 'offline').length;
    const unknown = atSite.length - online - offline;
    const siteRow = field.find(row => cameraStatus(row) === 'online') || field[0];
    const site = placement === 'FIELD' ? text(siteRow?.organization) : null;
    const observed = members.map(row => text(row.source_last_seen_at)).filter(Boolean).sort();
    units.push({
      unit: unitLabel(members[0]),
      placement,
      site: site || null,
      siteNamePending: Boolean(site && PENDING_SITE.test(site)),
      state: unitState(online, offline, unknown),
      cameras: atSite.length, online, offline, unknown,
      down: atSite.filter(c => c.status !== 'online').map(c => ({ name: c.name, status: c.status })),
      ...(awayFromSite.length ? { awayFromSite: awayFromSite.map(c => ({ name: c.name, status: c.status })) } : {}),
      cameraList: named.map(c => ({ name: c.name, status: c.status, atSite: cameraPlacement(c.row) === 'FIELD' })),
      onlineInShop: placement === 'SHOP' && online > 0,
      publicIp: text(members.find(row => text(row.public_ip))?.public_ip) || null,
      observedAt: observed.length ? observed[observed.length - 1] : null,
    });
  }
  units.sort((a, b) => a.unit.localeCompare(b.unit, 'en', { numeric: true }));
  return { contract: STAR_UNIT_STATUS_CONTRACT, units, counts: countUnits(units) };
}

/** One place builds the totals, so every projection of these units agrees. */
export function countUnits(units: UnitCameraStatus[]): UnitCameraStatusReport['counts'] {
  const field = units.filter(u => u.placement === 'FIELD'), shop = units.filter(u => u.placement === 'SHOP');
  return {
    units: units.length,
    cameras: units.reduce((total, u) => total + u.cameras, 0),
    field: {
      units: field.length,
      green: field.filter(u => u.state === 'GREEN').length,
      yellow: field.filter(u => u.state === 'YELLOW').length,
      red: field.filter(u => u.state === 'RED').length,
      unknown: field.filter(u => u.state === 'UNKNOWN').length,
      camerasDown: field.reduce((total, u) => total + u.offline, 0),
    },
    shop: { units: shop.length, onlineInShop: shop.filter(u => u.onlineInShop).length },
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
    ...(unit.awayFromSite ? {awayFromSite: unit.awayFromSite.map(camera => ({...camera, status: 'unknown' as const}))} : {}),
    ...(unit.cameraList ? {cameraList: unit.cameraList.map(camera => ({...camera, status: 'unknown' as const}))} : {}),
    onlineInShop: false,
  }));
  return {...report, feed: stamped, units, counts: countUnits(units)};
}

const unitMatchKey = (value: unknown) => text(value).toUpperCase();

/**
 * Apply hand edits made by the Owner or verified IT on top of the provider's
 * reading. An edit can move a unit between Field and Shop, name its site, or
 * correct its public IP. It can never change whether a camera is online: that
 * stays the provider's word alone.
 *
 * The provider's own values are kept beside the edit, so the board can show
 * both and say when Star4Live has caught up with what a person entered.
 */
/**
 * Drop the cameras a person has said are no longer on this unit, and count the
 * unit again from the ones that are left. A camera taken off never changes
 * whether the remaining ones answered: that is still the provider's word.
 */
export function withoutRemovedCameras(unit: UnitCameraStatus, removed: ReadonlyMap<string, boolean>): UnitCameraStatus {
  const isRemoved = (name: string) => removed.get(name.trim().toUpperCase()) === true;
  const list = (unit.cameraList || []).map(camera => isRemoved(camera.name) ? {...camera, removed: true} : camera);
  const kept = list.filter(camera => !camera.removed);
  const atSite = unit.placement === 'FIELD' ? kept.filter(camera => camera.atSite) : kept;
  const online = atSite.filter(c => c.status === 'online').length;
  const offline = atSite.filter(c => c.status === 'offline').length;
  const unknown = atSite.length - online - offline;
  const away = unit.placement === 'FIELD' ? kept.filter(camera => !camera.atSite) : [];
  return {
    ...unit,
    cameraList: list,
    state: unitState(online, offline, unknown),
    cameras: atSite.length, online, offline, unknown,
    down: atSite.filter(c => c.status !== 'online').map(c => ({name: c.name, status: c.status})),
    ...(away.length ? {awayFromSite: away.map(c => ({name: c.name, status: c.status}))} : {awayFromSite: undefined}),
    onlineInShop: unit.placement === 'SHOP' && online > 0,
  };
}

export function applyHandEdits(
  report: UnitCameraStatusReport,
  edits: HandEdit[] | null | undefined,
): UnitCameraStatusReport {
  const byUnit = new Map<string, Partial<Record<HandEditField, HandEdit>>>();
  // A unit has one of each ordinary edit, but a camera edit per camera: taking
  // one camera off a unit says nothing about the others.
  const removedByUnit = new Map<string, Map<string, boolean>>();
  for (const edit of Array.isArray(edits) ? edits : []) {
    const unit = unitMatchKey(edit?.unit_key), field = text(edit?.field) as HandEditField, action = text(edit?.action);
    if (!unit || !HAND_EDIT_FIELDS.includes(field)) continue;
    if (field === 'camera') {
      const held = removedByUnit.get(unit) || new Map<string, boolean>();
      // Clearing with no camera named puts every camera on this unit back.
      if (action === 'clear' && !text(edit?.value)) held.clear();
      else if (action === 'set' || action === 'clear') held.set(unitMatchKey(edit?.value), action === 'set');
      removedByUnit.set(unit, held);
      continue;
    }
    if (action === 'clear') continue; // A cleared edit leaves the provider's value in place.
    if (action !== 'set' || edit?.value == null) continue;
    const held = byUnit.get(unit) || {};
    held[field] = edit;
    byUnit.set(unit, held);
  }
  if (!byUnit.size && !removedByUnit.size) return report;
  const units = report.units.map(unit => {
    const removedNames = removedByUnit.get(unitMatchKey(unit.unit));
    const base = removedNames?.size ? withoutRemovedCameras(unit, removedNames) : unit;
    const held = byUnit.get(unitMatchKey(unit.unit));
    if (!held) return base;
    unit = base;
    const applied: Partial<Record<HandEditField, AppliedHandEdit>> = {};
    const record = (field: HandEditField, providerValue: string | null) => {
      const edit = held[field];
      if (!edit) return null;
      const value = text(edit.value);
      applied[field] = {
        value, by: text(edit.actor_name) || 'Unknown', role: text(edit.actor_role) || 'unknown',
        at: text(edit.created_at) || null, reason: text(edit.reason) || null,
        providerValue, providerAgrees: providerValue !== null && providerValue === value,
      };
      return value;
    };
    const placement = record('placement', unit.placement) as 'FIELD' | 'SHOP' | null;
    const site = record('site', unit.site);
    const publicIp = record('public_ip', unit.publicIp);
    const address = record('address', null);
    const name = record('name', null);
    // typeof, not Number(): Number(null) is 0, which would drop a pin on the equator.
    const point = held.address, lat = typeof point?.latitude === 'number' ? point.latitude : NaN,
      lng = typeof point?.longitude === 'number' ? point.longitude : NaN;
    // A pin only from a recorded, matched point - never a guess from the text.
    const location: UnitLocation | null = address !== null && Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
      ? {latitude: lat, longitude: lng, matchedAddress: text(point?.matched_address) || null, source: 'hand'} : null;
    const nextPlacement = placement === 'FIELD' || placement === 'SHOP' ? placement : unit.placement;
    const nextSite = nextPlacement === 'FIELD' ? (site ?? unit.site) : null;
    return {
      ...unit,
      placement: nextPlacement,
      site: nextSite,
      siteNamePending: nextSite === null ? false : site !== null ? false : unit.siteNamePending,
      // Where a unit sits never changes whether its cameras answered.
      onlineInShop: nextPlacement === 'SHOP' && unit.online > 0,
      publicIp: publicIp ?? unit.publicIp,
      // A corrected name is what the unit is called on screen; its key is unchanged.
      ...(name ? {displayName: name} : {}),
      // A unit in the shop has no field pin, whatever address it once had.
      // The address is the person's own text and shows whether or not it has a pin.
      address: nextPlacement === 'FIELD' ? address : null,
      location: nextPlacement === 'FIELD' ? location : null,
      providerPlacement: unit.placement,
      providerSite: unit.site,
      providerPublicIp: unit.publicIp,
      handEdits: applied,
    };
  });
  return {...report, units, counts: countUnits(units)};
}
