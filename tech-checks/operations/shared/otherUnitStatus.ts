// Units Star4Live does not know: Snipers and CAMVs (a direct IP check COS already
// runs) and Recon II (the Reconeyez feed COS already reads). Read-only: nothing
// here starts a check, writes to a provider, or moves a unit.
//
// An IP answer proves the unit can be reached. It never proves each camera works,
// so an IP-checked unit is one line that is Up, Down or Not verified.
import {STAR_FEED_FRESH_MS, type UnitCameraStatus} from './starUnitStatus.ts';

export type OtherDeviceRow = {
  id?: number | string | null;
  device_name?: string | null;
  unit_key?: string | null;
  organization?: string | null;
  source?: string | null;
  activation_state?: string | null;
  source_last_seen_at?: string | null;
  public_ip?: string | null;
};
export type DeviceHealthRow = { camera_device_id?: number | string | null; overall_status?: string | null; checked_at?: string | null };
export type OtherFeed = { syncedAt?: string | null; status?: string | null; enabled?: boolean | null } | null | undefined;

export const IP_CHECK_SOURCE = '2026_unit_tracker';
export const RECON_SOURCE = 'reconeyez';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const SHOP_ORGANIZATIONS = new Set(['', 'root', 'shop']);
// The tracker marks a field unit without naming its site.
const UNNAMED_FIELD = new Set(['tracker field', 'field']);
const NOT_DEPLOYED = /\bshop\b|\broot\b|\bnot in use\b|\bstolen\b/i;

type Status = 'online' | 'offline' | 'unknown';
const state = (online: number, offline: number, unknown: number): UnitCameraStatus['state'] =>
  online > 0 && offline === 0 && unknown === 0 ? 'GREEN'
    : online === 0 && offline === 0 ? 'UNKNOWN'
    : online === 0 && unknown === 0 ? 'RED' : 'YELLOW';

function healthById(health: DeviceHealthRow[] | null | undefined) {
  const map = new Map<string, DeviceHealthRow>();
  for (const row of Array.isArray(health) ? health : []) if (row?.camera_device_id != null) map.set(String(row.camera_device_id), row);
  return map;
}
const active = (row: OtherDeviceRow, source: string) =>
  text(row?.source) === source && text(row?.activation_state).toLowerCase() !== 'deactivated' && Boolean(text(row?.unit_key) || text(row?.device_name));
const fresh = (at: unknown, now: number, maxAgeMs: number) => {
  const time = Date.parse(text(at));
  return Number.isFinite(time) && now - time >= -60000 && now - time <= maxAgeMs;
};

/**
 * Snipers and CAMVs: one line per unit from the saved direct IP check. A check
 * that is missing or older than three sweeps is Not verified, never Down.
 */
export function projectIpCheckUnits(
  devices: OtherDeviceRow[] | null | undefined, health: DeviceHealthRow[] | null | undefined,
  now = Date.now(), maxAgeMs = STAR_FEED_FRESH_MS,
): UnitCameraStatus[] {
  const checks = healthById(health), seen = new Set<string>(), units: UnitCameraStatus[] = [];
  for (const row of Array.isArray(devices) ? devices : []) {
    if (!active(row, IP_CHECK_SOURCE)) continue;
    const unit = text(row.unit_key) || text(row.device_name), key = unit.toUpperCase();
    if (seen.has(key)) continue; // One unit is one line.
    seen.add(key);
    const check = checks.get(String(row.id)), ip = text(row.public_ip) || null;
    const said = text(check?.overall_status).toLowerCase();
    const status: Status = ip && fresh(check?.checked_at, now, maxAgeMs) && (said === 'online' || said === 'offline') ? said : 'unknown';
    const organization = text(row.organization), lower = organization.toLowerCase();
    const placement: 'FIELD' | 'SHOP' = SHOP_ORGANIZATIONS.has(lower) ? 'SHOP' : 'FIELD';
    const online = status === 'online' ? 1 : 0, offline = status === 'offline' ? 1 : 0, unknown = 1 - online - offline;
    units.push({
      unit, placement,
      site: placement === 'FIELD' && !UNNAMED_FIELD.has(lower) ? organization : null,
      siteNamePending: false,
      state: state(online, offline, unknown),
      cameras: 1, online, offline, unknown,
      down: status === 'online' ? [] : [{name: ip ? 'Avigilon check' : 'No IP on file', status}],
      onlineInShop: placement === 'SHOP' && online > 0,
      publicIp: ip,
      observedAt: text(check?.checked_at) || null,
      source: 'ip_check',
    });
  }
  return units;
}

/**
 * Recon II: one line per unit, one camera per Reconeyez detector. Detectors
 * report every few hours, so the feed's own sync decides whether the readings
 * are current: when the feed is missing, failed or old, every unit is Not verified.
 */
export function projectReconUnits(
  devices: OtherDeviceRow[] | null | undefined, health: DeviceHealthRow[] | null | undefined,
  feed: OtherFeed, now = Date.now(), maxAgeMs = STAR_FEED_FRESH_MS,
): UnitCameraStatus[] {
  const checks = healthById(health), groups = new Map<string, OtherDeviceRow[]>();
  const feedFresh = feed?.enabled !== false && text(feed?.status) === 'ok' && fresh(feed?.syncedAt, now, maxAgeMs);
  for (const row of Array.isArray(devices) ? devices : []) {
    if (!active(row, RECON_SOURCE)) continue;
    const key = (text(row.unit_key) || text(row.device_name)).toUpperCase();
    (groups.get(key) || groups.set(key, []).get(key)!).push(row);
  }
  const units: UnitCameraStatus[] = [];
  for (const members of groups.values()) {
    const unit = text(members[0].unit_key) || text(members[0].device_name);
    const cameras = members.map(row => {
      const said = text(checks.get(String(row.id))?.overall_status).toLowerCase();
      const status: Status = feedFresh && (said === 'online' || said === 'offline') ? said : 'unknown';
      return {name: text(row.device_name) || unit, status};
    });
    const online = cameras.filter(c => c.status === 'online').length, offline = cameras.filter(c => c.status === 'offline').length;
    const unknown = cameras.length - online - offline;
    const organization = text(members.find(row => text(row.organization))?.organization);
    // Reconeyez has no shop folder; the unit's own label says when it is not out.
    const placement: 'FIELD' | 'SHOP' = NOT_DEPLOYED.test(unit) || SHOP_ORGANIZATIONS.has(organization.toLowerCase()) ? 'SHOP' : 'FIELD';
    const seen = members.map(row => text(row.source_last_seen_at)).filter(Boolean).sort();
    units.push({
      unit, placement,
      site: placement === 'FIELD' && organization.toUpperCase() !== unit.toUpperCase() ? organization : null,
      siteNamePending: false,
      state: state(online, offline, unknown),
      cameras: cameras.length, online, offline, unknown,
      down: cameras.filter(c => c.status !== 'online'),
      onlineInShop: placement === 'SHOP' && online > 0,
      publicIp: null,
      observedAt: seen.length ? seen[seen.length - 1] : null,
      source: 'reconeyez',
    });
  }
  return units;
}

/**
 * Put the other units beside the Star4Live ones. A unit Star4Live already lists
 * keeps its Star4Live line, which carries the per-camera detail.
 */
export function mergeUnitSources(star: UnitCameraStatus[], ...others: UnitCameraStatus[][]): UnitCameraStatus[] {
  const taken = new Set(star.map(unit => unit.unit.toUpperCase()));
  const merged: UnitCameraStatus[] = star.map(unit => ({...unit, source: unit.source ?? 'star4live'}));
  for (const unit of others.flat()) {
    const key = unit.unit.toUpperCase();
    if (taken.has(key)) continue;
    taken.add(key);
    merged.push(unit);
  }
  return merged.sort((a, b) => a.unit.localeCompare(b.unit, 'en', {numeric: true}));
}
