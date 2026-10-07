import { gpsWrite, gpsMatches, type GpsCoordinates } from '../shared/gpsValidation';
type Row = Record<string, any>;
type Api = { get(path: string): Promise<{ data: any }>; post(path: string, body: unknown): Promise<{ data: any }> };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export class GpsSaveUnverifiedError extends Error {
  readonly mayHaveSaved = true;
  constructor() { super('GPS may have been saved, but could not be verified. Refresh the unit before saving again.'); this.name = 'GpsSaveUnverifiedError'; }
}
const object = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stamp = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN;
// Preserve database sub-millisecond precision when confirming the latest write.
function preciseStamp(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  const millis=Date.parse(value);
  if (!match || !Number.isFinite(millis)) return null;
  return BigInt(Math.floor(millis/1000))*1_000_000_000n+BigInt((match[1]||'').padEnd(9,'0'));
}
const sameStamp=(a: unknown,b: unknown) => preciseStamp(a)!==null && preciseStamp(a)===preciseStamp(b);

export function checkedFieldMap(value: unknown): Row {
  if (!object(value) || !Array.isArray(value.items) || !object(value.summary) || !Number.isFinite(stamp(value.generatedAt))) throw new Error('Field Map returned an incomplete response.');
  if(value.placementReviews!==undefined&&(!Array.isArray(value.placementReviews)||value.placementReviews.some((row:unknown)=>!object(row)||typeof row.unitNumber!=='string'||typeof row.reason!=='string'||!(row.placementAuditId===null||typeof row.placementAuditId==='string'))))throw new Error('Field placement review list is incomplete.');
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !uuid(item.id) || seen.has(item.id) || typeof item.unitNumber !== 'string' || typeof item.status !== 'string') throw new Error('Field Map returned inconsistent unit records.');
    seen.add(item.id);
  }
  for (const key of ['fieldUnits', 'mappedUnits', 'unitGps', 'missingGps']) {
    if (!Number.isSafeInteger(value.summary[key]) || value.summary[key] < 0) throw new Error('Field Map summary is unavailable.');
  }
  if (value.summary.fieldUnits !== value.items.length) throw new Error('Field Map returned an incomplete unit list.');
  return value;
}
function assertResult(result: unknown, unitId: string, expected: GpsCoordinates, owner: boolean): Row {
  if (!object(result) || (owner ? result.id : result.unitId) !== unitId || !Number.isFinite(stamp(result.recordedAt)) || !gpsMatches(result, expected)) throw new GpsSaveUnverifiedError();
  return result;
}
/** Writes are sent once. A failed confirmation is never retried as a write. */
export function createGpsSaver(api: Api) {
  let running = false, ownerRefreshRequired = false;
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (running) throw new Error('A GPS save is already in progress.');
    running = true;
    try { return await work(); } finally { running = false; }
  }
  return {
    get needsRefresh() { return ownerRefreshRequired; },
    acknowledgeRefresh(value: unknown) { checkedFieldMap(value); if (!running) ownerRefreshRequired = false; },
    owner: (unitId: string, input: unknown) => exclusive(async () => {
      if (ownerRefreshRequired) throw new Error('Refresh the Field Map before saving GPS again.');
      if (!uuid(unitId)) throw new Error('Select a valid unit before saving GPS.');
      const payload = gpsWrite(input, 'owner');
      try {
        const result = assertResult((await api.post('/api/field-map/' + unitId + '/gps', payload)).data, unitId, payload, true);
        const snapshot = checkedFieldMap((await api.get('/api/field-map')).data);
        const saved = snapshot.items.find((item: Row) => item.id === unitId);
        if (!saved || saved.hasUnitGps !== true || saved.coordinateSource !== payload.source || result.source !== payload.source || !sameStamp(saved.gpsRecordedAt,result.recordedAt) || !gpsMatches({ ...saved, accuracyM: saved.gpsAccuracyM }, payload)) throw new GpsSaveUnverifiedError();
        if (payload.note?.startsWith('COS_FIELD_LOCATION_V1|')) {
          if (!/^COS_FIELD_LOCATION_V1\|address_sha256=[a-f0-9]{64}\|confirmed=true$/.test(payload.note.split('\n')[0]) || saved.locationVerification !== 'owner_verified' || !sameStamp(saved.locationVerifiedAt,result.recordedAt)) throw new GpsSaveUnverifiedError();
          const history = (await api.get('/api/field-map/' + unitId + '/history')).data;
          if (!Array.isArray(history?.items) || !history.items.length) throw new GpsSaveUnverifiedError();
          const dates=history.items.map((row: Row)=>preciseStamp(row.recordedAt));
          if (dates.some((date: bigint|null)=>date===null)) throw new GpsSaveUnverifiedError();
          const latest=dates.reduce((a: bigint,b: bigint)=>a>b?a:b);
          const newestRows=history.items.filter((row: Row)=>preciseStamp(row.recordedAt)===latest);
          if (newestRows.length!==1) throw new GpsSaveUnverifiedError();
          const newest = newestRows[0];
          if (!uuid(newest.id) || newest.id !== saved.locationHistoryId || newest.source !== payload.source || newest.note !== payload.note || !sameStamp(newest.recordedAt,result.recordedAt) || !gpsMatches(newest,payload)) throw new GpsSaveUnverifiedError();
        }
        return snapshot;
      } catch { ownerRefreshRequired = true; throw new GpsSaveUnverifiedError(); }
    }),
    technician: (jobId: string, unitId: string, visitId: string, input: unknown) => exclusive(async () => {
      if (![jobId, unitId, visitId].every(uuid)) throw new Error('The assigned job, visit and unit must be available before saving GPS.');
      const checked = gpsWrite(input, 'technician');
      const payload = { latitude: checked.latitude, longitude: checked.longitude, accuracyM: checked.accuracyM, note: checked.note };
      try {
        const result = assertResult((await api.post('/api/tech/jobs/' + jobId + '/field-gps', payload)).data, unitId, payload, false);
        const saved = (await api.get('/api/tech/jobs/' + jobId + '/field-gps')).data;
        if (result.saved !== true || result.jobId !== jobId || result.visitId !== visitId || !object(saved) || saved.jobId !== jobId || saved.unitId !== unitId || saved.visitId !== visitId || !['dispatched', 'accepted'].includes(saved.dispatchStatus) || saved.source !== 'phone_gps' || result.source !== 'phone_gps' || !sameStamp(saved.recordedAt,result.recordedAt) || !gpsMatches(saved, payload)) throw new GpsSaveUnverifiedError();
        return saved;
      } catch { throw new GpsSaveUnverifiedError(); }
    }),
  };
}
/** Build Leaflet popups with text nodes, never HTML from customer/site names. */
export function gpsPopup(documentObject: Document, unit: { unitNumber: string; customer?: string; site?: string; coordinateSource?: string | null }): HTMLElement {
  const root = documentObject.createElement('div');
  const title = documentObject.createElement('strong');
  title.textContent = unit.unitNumber;
  root.append(title, documentObject.createElement('br'));
  root.append(documentObject.createTextNode([unit.customer, unit.site].filter(Boolean).join(' · ')), documentObject.createElement('br'));
  root.append(documentObject.createTextNode(unit.coordinateSource ? unit.coordinateSource.replaceAll('_', ' ') : 'No coordinates'));
  return root;
}
