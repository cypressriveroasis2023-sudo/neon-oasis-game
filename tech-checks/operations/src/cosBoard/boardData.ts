import {presentedCameraState, type CountUnit} from '../sharedFleetCounts';
import {unitVerdict, type UnitCameraStatus} from '../../shared/starUnitStatus';
import {exactUnitName, ROUTER_FRESHNESS_MS, type RouterRow} from '../../../supabase/functions/cos-operations-pages/routers';
import type {MhelpAddressMapResult} from '../mhelpAddressMapPins';

/**
 * What the board screen is handed to draw.
 *
 * The board makes no calls of its own here. Shop or field, and up or down, come
 * from the same unit list the shared count reads (cameraFeedCensus), so a tile
 * on the board is always a slice of the app's own headline:
 *   Up = units online, Camera issues + Down = units offline, Unknown = unknown.
 */
export type BoardVerdict = 'up' | 'issues' | 'down' | 'unknown';

export type BoardUnit = {
  /** The unit's own name in the camera feed. */
  k: string;
  /** What COS calls it, when a person corrected the provider's name. */
  nm?: string;
  /** Where the reading came from: Star4Live, COS's own IP check, or the Recon cloud. */
  s: 'v' | 'a' | 'r';
  o: string;
  pl: 'field' | 'shop';
  st: string;
  /** What the provider itself says, before anything a person set by hand: place, site and IP. */
  fp: 'field' | 'shop';
  fst: string;
  fip: string;
  n: number; on: number; off: number;
  /** Reading time and last-online time, in seconds. 0 when there is none. */
  t: number; lo: number;
  ip: string;
  /** Counted cameras that are not online, by name. */
  bad: string;
  pid: string;
  fl: string;
  vd: BoardVerdict;
  /** In the shop and its cameras are answering. */
  so: boolean;
  /** Left out of every total: DO NOT USE or a named exception. */
  x: boolean;
  /** Which parts a person set by hand in COS, and each of those edits with who made it and when. */
  he: string[];
  hx: BoardHandEdit[];
  /** The address a person typed for this unit, and the revision the next address edit must name. */
  ta: string;
  ar: string | null;
  /** The point COS matched to an address typed by hand. */
  hp?: [number, number];
  ad?: string;
  rs: string; rt: number; rr: string; ro: number; rm: string; ri: ''; rp: '';
};

/** One hand edit that is in force. `at` is in milliseconds, 0 when the record has no time. */
export type BoardHandEdit = {f: string; b: string; by: string; role: string; at: number; why: string; pv: string};
export type BoardChange = BoardHandEdit & {k: string; nm: string};

export type BoardCamera = {name: string; type: string; model: string; fw: string; st: 1 | 0 | null; lo: number};

export type BoardMhelpRecord = {
  id: string; label: string; cat: string; flag: '' | 'D' | 'M'; place: 'field' | 'shop';
  cust: string; addr: string; lat: number; lng: number; pk: '' | 'm' | 'r';
};

export type BoardMhelp = {
  meta: {at: number; total: number; field: number; shop: number; stands: number; standsField: number};
  recs: BoardMhelpRecord[];
};

export type BoardData = {
  /** gen and v are times in seconds. rl says whether Fleet has read the routers yet. */
  meta: {gen: number; v: number; rl: boolean};
  units: BoardUnit[];
  cameras: Record<string, BoardCamera[]>;
  mhelp: BoardMhelp | null;
  /** Every hand edit in force across the fleet, newest first. */
  changes: BoardChange[];
};

export type BoardTally = {up: number; issues: number; down: number; unknown: number; shop: number; shopOnline: number; excluded: number};

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const line = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const seconds = (value: unknown) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? Math.round(at / 1000) : 0;
};

const VERDICT: Record<UnitCameraStatus['state'], BoardVerdict> = {GREEN: 'up', YELLOW: 'issues', RED: 'down', UNKNOWN: 'unknown'};

type Call = {excluded: boolean; place: 'field' | 'shop'; verdict: BoardVerdict; online: number; offline: number; cameras: number};

/**
 * One unit's place and verdict, decided the way selectFleetCounts decides it:
 * DO NOT USE and exceptions are out of every total, a shop unit is never down,
 * an unknown placement is Unknown, and a field unit is judged on its fresh camera readings.
 */
function call(feed: UnitCameraStatus, unit: CountUnit | undefined, now: number): Call {
  if (!unit) return {excluded: false, place: 'field', verdict: 'unknown', online: 0, offline: 0, cameras: feed.cameras || 0};
  const excluded = unit.exception === true || unit.doNotUse === true;
  if (unit.placement === 'shop') {
    return {excluded, place: 'shop', verdict: VERDICT[feed.state] || 'unknown', online: feed.online || 0, offline: feed.offline || 0, cameras: feed.cameras || 0};
  }
  if (unit.placement === 'unknown') {
    return {excluded, place: 'field', verdict: 'unknown', online: 0, offline: 0, cameras: unit.cameras.length};
  }
  const states = unit.cameras.map(camera => presentedCameraState(camera, now));
  const online = states.filter(state => state === 'online').length;
  const offline = states.filter(state => state === 'offline').length;
  return {excluded, place: 'field', verdict: VERDICT[unitVerdict(online, offline, states.length - online - offline)], online, offline, cameras: states.length};
}

function cameraRows(feed: UnitCameraStatus, now: number): BoardCamera[] {
  return (feed.cameraList || []).map(camera => {
    const state = camera.removed ? 'unknown' : presentedCameraState({state: camera.status, observedAt: feed.observedAt}, now);
    return {
      name: camera.name,
      type: camera.removed ? 'Taken off this unit by hand' : camera.atSite === false ? 'In the shop, not at the site' : '',
      model: '', fw: '',
      st: state === 'online' ? 1 : state === 'offline' ? 0 : null,
      lo: 0,
    };
  });
}

function notOnline(feed: UnitCameraStatus, place: 'field' | 'shop', now: number): string {
  const listed = (feed.cameraList || []).filter(camera => !camera.removed && (place !== 'field' || camera.atSite !== false));
  const names = listed.length
    ? listed.filter(camera => presentedCameraState({state: camera.status, observedAt: feed.observedAt}, now) !== 'online').map(camera => camera.name)
    : (feed.down || []).map(camera => camera.name);
  return names.map(name => line(name).replace(/;/g, ',')).filter(Boolean).join(';');
}

/** A router reading is reference only. An old or missing reading is Unknown, never Offline. */
function routerFields(row: RouterRow | undefined, now: number) {
  if (!row) return {rs: '', rt: 0, rr: '', ro: 0, rm: ''};
  const fresh = (at: string | null) => {
    const time = at ? Date.parse(at) : NaN;
    return Number.isFinite(time) && time <= now && now - time <= ROUTER_FRESHNESS_MS;
  };
  const word = (status: string, at: string | null) => !fresh(at) ? 'un' : status === 'online' ? 'on' : status === 'offline' ? 'of' : 'un';
  const reported = line(row.reportedStatus).toLowerCase();
  return {
    rs: word(row.probeStatus, row.checkedAt), rt: seconds(row.checkedAt),
    rr: reported === 'online' || reported === 'offline' ? word(reported, row.reportedAt) : '', ro: seconds(row.reportedAt),
    rm: line(row.model),
  };
}

const HAND: Record<string, string> = {placement: 'place', site: 'site', name: 'name', public_ip: 'ip', address: 'address', camera: 'camera'};

function handEdits(unit: UnitCameraStatus): BoardHandEdit[] {
  const list: BoardHandEdit[] = [];
  for (const [field, edit] of Object.entries(unit.handEdits || {})) {
    if (!edit) continue;
    const time = edit.at ? Date.parse(edit.at) : NaN;
    list.push({
      f: HAND[field] || field, b: line(edit.value), by: line(edit.by) || 'Unknown', role: line(edit.role),
      at: Number.isFinite(time) ? time : 0, why: line(edit.reason), pv: line(edit.providerValue),
    });
  }
  return list.sort((left, right) => right.at - left.at || left.f.localeCompare(right.f));
}

/** mHelp counts stands, poles and skids, but they carry no cameras, so the board does not list them. */
const STANDS = new Set(['Stand', 'Solar Stand 72', 'Solar Pole 72', 'Solar Skid 144']);

function address(value: unknown): string {
  if (!record(value)) return '';
  const street = line(value.street), city = line(value.city), region = [line(value.state), line(value.zip)].filter(Boolean).join(' ');
  return [street, city, region].filter(Boolean).join(', ');
}

/** The mHelp list as the board reads it. Null when the reviewed inventory has not loaded. */
export function boardMhelp(upload: unknown, addresses?: MhelpAddressMapResult | null): BoardMhelp | null {
  if (!record(upload) || !Array.isArray(upload.records)) return null;
  const pins = new Map((addresses?.pins || []).map(pin => [pin.productId, pin]));
  const recs: BoardMhelpRecord[] = [];
  let field = 0, stands = 0, standsField = 0, total = 0;
  for (const item of upload.records) {
    if (!record(item) || typeof item.productId !== 'string') continue;
    total += 1;
    const place = item.placement === 'FIELD' ? 'field' : 'shop', cat = line(item.category);
    if (place === 'field') field += 1;
    if (STANDS.has(cat)) { stands += 1; if (place === 'field') standsField += 1; continue; }
    const pin = pins.get(item.productId);
    recs.push({
      id: item.productId, label: line(item.unitNumber), cat,
      flag: item.uploadLifecycle === 'DO_NOT_USE' ? 'D' : item.uploadLifecycle === 'MISSING' ? 'M' : '',
      place,
      cust: place === 'field' ? line(item.customer) : '',
      addr: place === 'field' ? address(item.sourceAddress) : '',
      lat: place === 'field' && pin ? pin.point[0] : 0, lng: place === 'field' && pin ? pin.point[1] : 0,
      pk: place === 'field' && pin ? (pin.state === 'matched' ? 'm' : 'r') : '',
    });
  }
  recs.sort((left, right) => left.cat.localeCompare(right.cat) || left.label.localeCompare(right.label, undefined, {numeric: true}));
  const at = seconds(upload.source === 'mhelpdesk_api' ? upload.lastApiReadAt : upload.receivedAt);
  return {meta: {at, total, field, shop: total - field, stands, standsField}, recs};
}

export type BoardInput = {
  /** The camera feed, and the counted unit for each feed unit in the same order (cameraFeedCensus). */
  feed: readonly UnitCameraStatus[];
  census: readonly CountUnit[];
  now: number;
  routers?: readonly RouterRow[] | null;
  upload?: unknown;
  addresses?: MhelpAddressMapResult | null;
};

export function boardData({feed, census, now, routers, upload, addresses}: BoardInput): BoardData {
  const routerByUnit = new Map<string, RouterRow>();
  for (const router of routers || []) {
    const key = exactUnitName(router.unitKey), held = routerByUnit.get(key);
    if (!held || seconds(router.checkedAt) > seconds(held.checkedAt)) routerByUnit.set(key, router);
  }
  const cameras: Record<string, BoardCamera[]> = {};
  const changes: BoardChange[] = [];
  let newestStar = 0;
  const units = feed.map((unit, index): BoardUnit => {
    const counted = census[index] && census[index].name === unit.unit ? census[index] : undefined;
    const decided = call(unit, counted, now);
    const source = unit.source === 'ip_check' ? 'a' : unit.source === 'reconeyez' ? 'r' : 'v';
    const observed = seconds(unit.observedAt);
    if (source === 'v' && observed > newestStar) newestStar = observed;
    const list = cameraRows(unit, now);
    if (list.length) cameras[unit.unit] = list;
    const point = unit.location && Number.isFinite(unit.location.latitude) && Number.isFinite(unit.location.longitude)
      ? [unit.location.latitude, unit.location.longitude] as [number, number] : undefined;
    const typed = line(unit.location?.matchedAddress) || line(unit.address);
    const edits = handEdits(unit);
    for (const edit of edits) changes.push({...edit, k: unit.unit, nm: line(unit.displayName)});
    return {
      k: unit.unit,
      ...(line(unit.displayName) ? {nm: line(unit.displayName)} : {}),
      s: source,
      o: line(unit.providerSite),
      pl: decided.place,
      st: line(unit.site),
      fp: (unit.providerPlacement ?? unit.placement) === 'SHOP' ? 'shop' : 'field',
      fst: line(unit.providerSite !== undefined ? unit.providerSite : unit.site),
      fip: line(unit.providerPublicIp !== undefined ? unit.providerPublicIp : unit.publicIp),
      n: decided.cameras, on: decided.online, off: decided.offline,
      t: observed, lo: 0,
      ip: line(unit.publicIp),
      bad: notOnline(unit, decided.place, now),
      pid: line(unit.productId),
      fl: counted?.doNotUse === true || counted?.exception === true ? 'x' : '',
      vd: decided.verdict,
      so: decided.place === 'shop' && (unit.onlineInShop === true || (unit.placement !== 'SHOP' && (unit.online || 0) > 0)),
      x: decided.excluded,
      he: Object.keys(unit.handEdits || {}).map(field => HAND[field] || field),
      hx: edits,
      // Exactly as the person typed it: this is what the address form opens with.
      ta: typeof unit.address === 'string' ? unit.address.trim() : '',
      ar: typeof unit.addressRevision === 'string' ? unit.addressRevision : null,
      ...(point && decided.place === 'field' ? {hp: point} : {}),
      ...(typed ? {ad: typed} : {}),
      ...routerFields(routerByUnit.get(exactUnitName(unit.unit)), now),
      ri: '', rp: '',
    };
  });
  changes.sort((left, right) => right.at - left.at || left.k.localeCompare(right.k, undefined, {numeric: true}) || left.f.localeCompare(right.f));
  return {meta: {gen: Math.round(now / 1000), v: newestStar, rl: Array.isArray(routers)}, units, cameras, mhelp: boardMhelp(upload, addresses), changes};
}

/** The board's tiles when it counts by the camera systems. Checked against the shared count in the tests. */
export function boardTally(units: readonly BoardUnit[]): BoardTally {
  const tally: BoardTally = {up: 0, issues: 0, down: 0, unknown: 0, shop: 0, shopOnline: 0, excluded: 0};
  for (const unit of units) {
    if (unit.x) tally.excluded += 1;
    else if (unit.pl === 'shop') { tally.shop += 1; if (unit.so) tally.shopOnline += 1; }
    else tally[unit.vd] += 1;
  }
  return tally;
}
