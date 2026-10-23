/* Cameras Onsite Vision — read-only, evidence-scoped fleet intelligence.
 * The existing COS Operations Owner bridge remains the source of truth.
 * This module never probes devices, edits placements, or declares outage
 * duration from a single status snapshot.
 */
const OPERATIONS_URL = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const SOURCE_FRESH_MS = 20 * 60 * 1000;
type Dict = Record<string, any>;
export type FleetQuestion = {
  scope: 'summary' | 'offline' | 'attention' | 'unit' | 'location' | 'history';
  unit_reference: string;
  location_query: string;
  limit: number;
};
const object = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const text = (v: unknown) => string(v).replace(/\s+/g, ' ');
const unitKey = (v: unknown) => {
  const s = text(v).toUpperCase().replace(/\s*[-#]\s*/g, ' ').replace(/\s+/g, ' ');
  const m = /^([A-Z][A-Z0-9 ]*?)[ ]*0*(\d+)([A-Z]*)$/.exec(s);
  return m ? m[1].replace(/\s/g, '') + '|' + Number(m[2]) + '|' + m[3] : s;
};
function verifiedTime(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > 0 && t <= now ? new Date(t).toISOString() : null;
}
function evidenceState(e: unknown, active: boolean, resource: string, now: number): 'online' | 'offline' | 'unverified' {
  if (!active || !object(e) || e.kind !== 'provider' || e.active !== true || e.resource !== resource || !['Star4Live', 'Reconeyez'].includes(e.source)) return 'unverified';
  const at = verifiedTime(e.observedAt, now);
  return at && now - Date.parse(at) <= SOURCE_FRESH_MS && ['online', 'offline'].includes(e.status) ? e.status : 'unverified';
}
function portState(e: unknown, active: boolean, now: number): 'online' | 'offline' | 'unverified' {
  if (!active || !object(e) || e.kind !== 'service_port' || e.active !== true) return 'unverified';
  const at = verifiedTime(e.observedAt, now);
  if (!at || now - Date.parse(at) > SOURCE_FRESH_MS) return 'unverified';
  if (e.status === 'online' && e.reachable === true) return 'online';
  if (e.status === 'offline' && (e.confirmedOutage === true || Number.isInteger(e.consecutiveFailures) && e.consecutiveFailures >= 3)) return 'offline';
  return 'unverified';
}
function assertHealth(health: unknown, now: number): asserts health is Dict {
  if (!object(health) || health.evidenceVersion !== 2 || !Array.isArray(health.rows) ||
    !Number.isSafeInteger(health.totalDevices) || health.totalDevices < 0 ||
    health.rows.length !== health.totalDevices || !object(health.inventory) ||
    !verifiedTime(health.refreshedAt, now)) throw new Error('Verified Camera Health is unavailable; do not report fleet counts.');
  const unique = new Set<string>(), counts: Dict = {field: 0, shop: 0, inactive: 0, unknown: 0};
  const states: Dict = {online: 0, offline: 0, review: 0};
  for (const row of health.rows) {
    if (!object(row) || !['field','shop','inactive','unknown'].includes(row.scope) ||
      !['online','offline','review'].includes(row.status) || !String(row.id ?? '').trim() ||
      unique.has(String(row.id))) throw new Error('Camera Health identity or placement evidence is inconsistent.');
    unique.add(String(row.id));
    counts[row.scope]++;
    if (row.scope === 'field') states[row.status]++;
  }
  const inv = health.inventory;
  if (inv.allRecords !== health.totalDevices || inv.activeFieldRecords !== counts.field ||
    inv.activeShopRecords !== counts.shop || inv.inactiveRecords !== counts.inactive ||
    inv.unknownScopeRecords !== counts.unknown || health.fieldDevices !== counts.field ||
    health.shopRoot !== counts.shop || health.online !== states.online ||
    health.offline !== states.offline || health.review !== states.review)
    throw new Error('Camera Health census does not reconcile; do not report fleet counts.');
}
function makeLocations(map: unknown): Map<string, Dict[]> | null {
  if (!object(map) || !Array.isArray(map.items) || !object(map.summary) ||
    !Number.isSafeInteger(map.summary.fieldUnits) || map.summary.fieldUnits !== map.items.length ||
    map.items.some((u: unknown) => !object(u) || typeof u.id !== 'string' || !u.id ||
      typeof u.unitNumber !== 'string')) return null;
  if (new Set(map.items.map((u: Dict) => u.id)).size !== map.items.length) return null;
  const byUnit = new Map<string, Dict[]>();
  for (const unit of map.items) {
    const k = unitKey(unit.unitNumber);
    if (!k) continue;
    byUnit.set(k, [...(byUnit.get(k) || []), unit]);
  }
  return byUnit;
}
const tally = (rows: Dict[]) => ({
  total: rows.length,
  online: rows.filter(x => x.status === 'online').length,
  offline: rows.filter(x => x.status === 'offline').length,
  unverified: rows.filter(x => x.status === 'unverified').length,
});
function resourceType(row: Dict): 'camera' | 'detector' | 'recorder' | null {
  const type = text(row.type).toLowerCase();
  return ['ipc', 'camera'].includes(type) ? 'camera' :
    ['detector', 'reconeyez detector'].includes(type) ? 'detector' : type === 'nvr' ? 'recorder' : null;
}
/** All counts are *saved source records*, never an estimate of physical channels. */
export function projectVisionFleet(health: unknown, fieldMap: unknown, filters: FleetQuestion, now = Date.now()) {
  assertHealth(health, now);
  const locations = makeLocations(fieldMap);
  const limit = Math.max(1, Math.min(Number(filters?.limit) || 30, 100));
  const unitFilter = unitKey(filters?.unit_reference || '');
  const areaFilter = text(filters?.location_query).toLowerCase();
  const rows: Dict[] = [];
  const service: Dict[] = [];
  let unmatchedLocations = 0;
  for (const row of health.rows) {
    if (row.scope !== 'field') continue; // Shop, inactive, and unresolved scope do NOT become Field outages.
    const type = resourceType(row);
    const direct = !row.trackerOnly && !type &&
      /^(?:CAM[\s-]*V|SNIPER(?:\s*[24])?)[\s#-]*0*\d+/i.test(text(row.unit));
    if (!type && !direct) continue;
    const matches = locations?.get(unitKey(row.unit)) || [];
    const location = matches.length === 1 ? {
      customer: text(matches[0].customer) || null,
      site: text(matches[0].site) || null,
      address: text(matches[0].address) || null,
      source: 'COS Field Map recorded service address (not live GPS)',
      matching_method: 'uniquely matching unit label; not a verified camera-to-unit binding',
    } : null;
    if (!location) unmatchedLocations++;
    const active = text(row.activationState).toUpperCase() === 'ACTIVE';
    const e = type ? row.evidence : row.serviceEvidence || row.evidence;
    const status = type ? evidenceState(e, active, type, now) : portState(e, active, now);
    const record: Dict = {
      resource_id: String(row.id),
      unit: text(row.unit) || 'Unit identity unavailable',
      name: text(row.name) || 'Unnamed source resource',
      kind: type || 'IP/port connection (not camera-video verification)',
      provider: type && object(e) && ['Star4Live','Reconeyez'].includes(e.source) ? e.source : (type ? 'Unverified source' : 'Direct saved service-port check'),
      status, location,
      observed_at: object(e) ? verifiedTime(e.observedAt, now) : null,
      last_online_at: object(e) ? verifiedTime(e.lastOnlineAt, now) : null,
      minutes_since_last_reported_online: object(e) && verifiedTime(e.lastOnlineAt, now) ?
        Math.floor((now - Date.parse(verifiedTime(e.lastOnlineAt, now)!)) / 60000) : null,
      outage_started_at: null,
      outage_duration: 'NOT RECORDED — last online is not proof of the first offline transition',
    };
    (type ? rows : service).push(record);
  }
  const bySource = ['Star4Live', 'Reconeyez', 'Unverified source'].map(provider => ({
    provider, ...tally(rows.filter(r => r.provider === provider)),
  })).filter(r => r.total > 0);
  const cameraRows = rows.filter(row => row.kind === 'camera');
  const detectorRows = rows.filter(row => row.kind === 'detector');
  const recorderRows = rows.filter(row => row.kind === 'recorder');
  const allowed = (r: Dict) => (!unitFilter || unitKey(r.unit) === unitFilter) &&
    (!areaFilter || Boolean(r.location && [r.location.customer,r.location.site,r.location.address]
      .some((v: unknown) => text(v).toLowerCase().includes(areaFilter))));
  const filtered = rows.filter(allowed), filteredService = service.filter(allowed);
  const scope = filters?.scope || 'summary';
  const chosen = scope === 'offline' ? filtered.filter(r => r.status === 'offline') :
    scope === 'attention' ? filtered.filter(r => r.status !== 'online') : filtered;
  const order = (a: Dict, b: Dict) => (a.status === 'offline' ? 0 : a.status === 'unverified' ? 1 : 2) -
    (b.status === 'offline' ? 0 : b.status === 'unverified' ? 1 : 2) ||
    String(a.unit).localeCompare(String(b.unit), undefined, {numeric: true});
  return {
    data_source: 'COS Operations saved Camera Health v3 and Field Map; read-only',
    health_refreshed_at: health.refreshedAt,
    location_data: locations ? 'available; exact unique unit match only' : 'unavailable — cannot identify customer, site, or address',
    completeness: 'Only currently confirmed Field source records; expected physical camera/channel coverage is not verified',
    field_resource_census: {online:health.online,offline:health.offline,unverified:health.review,
      total:health.fieldDevices,notice:'All Field resources, including non-camera resources; NOT a count of camera channels'},
    monitored_cameras: tally(cameraRows),
    monitored_detectors: tally(detectorRows),
    monitored_recorders: tally(recorderRows),
    camera_and_detector_records_by_provider: bySource.map(({provider}) => ({provider,...tally([...cameraRows,...detectorRows].filter(r => r.provider === provider))})).filter(r => r.total > 0),
    recorder_records_by_provider: bySource.map(({provider}) => ({provider,...tally(recorderRows.filter(r => r.provider === provider))})).filter(r => r.total > 0),
    service_port_checks: tally(service),
    unknown_scope_resources: health.inventory.unknownScopeRecords,
    shop_resources_excluded: health.inventory.activeShopRecords,
    unmatched_field_resource_locations: unmatchedLocations,
    query: {scope,unit_reference: filters?.unit_reference || '',location_query:filters?.location_query || ''},
    matching_cameras_and_detectors: tally(filtered.filter(r => r.kind !== 'recorder')),
    matching_recorders: tally(filtered.filter(r => r.kind === 'recorder')),
    matching_service_port_checks: tally(filteredService),
    items_returned: Math.min(chosen.length, limit),
    items_truncated: chosen.length > limit,
    items: chosen.sort(order).slice(0,limit),
    service_items: (scope === 'offline' ? filteredService.filter(r => r.status === 'offline') :
      scope === 'attention' ? filteredService.filter(r => r.status !== 'online') : filteredService).sort(order).slice(0, Math.min(limit,30)),
    location_filter_unverifiable: Boolean(areaFilter && !locations),
    limitations: [
      'ONLINE means fresh saved provider status, not that video playback was independently tested.',
      'IP/port reachability is listed separately from verified camera/detector status.',
      'NVR recorder observations are reported separately from cameras; recorder availability is not proof of every individual video channel.',
      'UNVERIFIED means missing, stale, conflicting or unmapped evidence; it must not count as OFFLINE.',
      'A latest offline observation and last_online_at do NOT establish total outage duration. A persisted first-offline transition is required.',
      'Recorded address is a service placement, not a new GPS measurement; location may be missing or ambiguous.',
      'No status probes, service orders, customer contacts, or inventory movements were performed.',
    ],
  };
}
/** Existing Owner bridge authenticates this same legacy user and enforces its own COS permissions. */
export async function readVisionFleetHealth(token: string, question: FleetQuestion,
  fetcher: typeof fetch = fetch) {
  if (!token || typeof token !== 'string') throw new Error('Verified Owner session required.');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 55000);
  const read = async (path: string): Promise<unknown> => {
    const response = await fetcher(OPERATIONS_URL, {
      method: 'POST',
      headers: {'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body: JSON.stringify({path,method:'GET',body:null}),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('COS Operations could not verify ' + (path.includes('health')?'Camera Health':'Field Map') + ' (' + response.status + ').');
    return response.json();
  };
  try {
    // Both source reads start together so a slow map cannot steal the entire
    // request budget after the health request has already settled.
    const [health, map] = await Promise.all([
      read('/api/camera-health/summary-v3'),
      // Map location is optional; Camera Health census is not.
      read('/api/field-map').catch(() => null),
    ]);
    return projectVisionFleet(health, map, question, Date.now());
  } finally { clearTimeout(deadline); }
}


/** Enrich *source-observed* offline spans from existing RLS-protected history.
 * A span of logged OFFLINE observations is not proof of continuous downtime:
 * sources poll periodically, may miss recoveries, and recorded placement can change.
 * Never turn a missing/stale history read into a synthesized outage time.
 */
export async function enrichVisionOfflineHistory(
  fleet: ReturnType<typeof projectVisionFleet>,
  client: {from: (table: string) => any},
): Promise<ReturnType<typeof projectVisionFleet> & Dict> {
  const historySource: Dict = {Star4Live: 'vigilant_star4live', Reconeyez: 'reconeyez_webhook'};
  const offline = fleet.items.filter(item => item.status === 'offline' &&
    (item.kind === 'camera' || item.kind === 'detector') &&
    Boolean(historySource[item.provider]) &&
    /^[1-9]\d{0,15}$/.test(String(item.resource_id)) && item.observed_at);
  const targets = offline.slice(0, 30);
  let matched = 0, failed = 0;
  const read = async (id: string, source: string, direction: 'newest'|'first', cutoff: string, since?: string) => {
    let query = client.from('camera_health_history').select('observed_at,status,check_source')
      .eq('camera_device_id',id).eq('check_source',source)
      .lte('observed_at',cutoff);
    if (since) query=query.gt('observed_at',since);
    const {data,error}=await query.order('observed_at',{ascending:direction==='first'}).limit(1);
    if (error) throw Error('Camera history source unavailable');
    return Array.isArray(data) && data.length===1 && object(data[0]) ? data[0] as Dict : null;
  };
  const find = async (item: Dict) => {
    const id=String(item.resource_id),source=historySource[item.provider],asOf=item.observed_at;
    try {
      const latest=await read(id,source,'newest',asOf);
      if (!latest || latest.status!=='offline') return;
      const latestAt=verifiedTime(latest.observed_at,Date.parse(asOf));
      if (!latestAt || Date.parse(asOf)-Date.parse(latestAt)>SOURCE_FRESH_MS) return;

      // Locate the latest online, degraded, unknown or verifying observation.
      // Any non-offline observation breaks the recorded offline window.
      const {data, error}=await client.from('camera_health_history')
        .select('observed_at,status').eq('camera_device_id',id)
        .eq('check_source',source).neq('status','offline')
        .lte('observed_at',latestAt).order('observed_at',{ascending:false}).limit(1);
      if (error) throw Error('Camera history source unavailable');
      const boundary=Array.isArray(data)&&data.length===1?verifiedTime(data[0]?.observed_at,Date.parse(latestAt)):null;
      const first=await read(id,source,'first',latestAt,boundary || undefined);
      if (!first || first.status!=='offline')return;
      const firstAt=verifiedTime(first.observed_at,Date.parse(latestAt));
      if (!firstAt || boundary && Date.parse(firstAt)<=Date.parse(boundary))return;
      const minutes=Math.floor((Date.parse(asOf)-Date.parse(firstAt))/60000);
      if (!Number.isSafeInteger(minutes) || minutes<0) return;
      matched++;
      item.outage_observed_since=firstAt;
      item.outage_observed_through=asOf;
      item.outage_observation_span_minutes=minutes;
      item.outage_duration='SOURCE OBSERVATIONS: '+minutes+
        ' minutes from the first logged OFFLINE status after the latest recorded non-offline status through this saved OFFLINE observation. Actual continuous downtime and exact physical outage onset are unverified.';
      item.outage_duration_basis='RLS-protected camera_health_history; '+source+' observations for this exact resource ID';
    } catch { failed++; }
  };
  // Bounded read-only fan-out; no provider requests or database writes.
  for(let i=0;i<targets.length;i+=4) await Promise.all(targets.slice(i,i+4).map(find));
  return {...fleet,history_enrichment:{
    eligible_offline_records:offline.length,checked:targets.length,matched,failed,
    truncated:offline.length>targets.length,
    note:'A recorded OFFLINE observation span is not a verified uninterrupted camera outage. Unverified duration remains unavailable.',
  }};
}
