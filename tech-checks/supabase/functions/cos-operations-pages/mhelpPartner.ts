/** Owner-only, read-only Partner API review. No fleet, Sheet, or vendor writes. */
export const MHELP_PARTNER_CONTRACT = 'cos-mhelpdesk-partner-review-v1';
export const MHELP_PARTNER_DOCS = 'https://www.mhelpdesk.com/partner-api/index.html';
const API = 'https://connect.mhelpdesk.com/api/v1.0';
const FIELDS = 'equipmentId,portalId,equipmentTypeId,name,model,customerId,serviceLocationId,IsActive,lastUpdateUTC';
export class MhelpPartnerError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
type ObjectValue = Record<string, unknown>;
type Config = {portalId?: string; accessToken?: string};
export type PartnerEquipment = {
  equipmentId: string; portalId: string; name: string; model: string | null;
  equipmentTypeId: string | null; customerId: string | null; serviceLocationId: string | null;
  active: boolean | null; updatedAt: string | null;
};
const fail = (message: string, status = 503): never => { throw new MhelpPartnerError(message, status); };
function object(v: unknown): ObjectValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('mHelpDesk returned an unsupported record.');
  return v as ObjectValue;
}
function numericId(v: unknown, optional = false): string | null {
  if (optional && (v == null || v === 0 || v === '0')) return null;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && /^[1-9][0-9]{0,14}$/.test(v) && Number.isSafeInteger(Number(v))) return v;
  return fail('mHelpDesk returned an invalid equipment identity.');
}
function label(v: unknown, optional = false): string | null {
  if (optional && (v == null || v === '')) return null;
  if (typeof v !== 'string' || !v.trim() || v.length > 180 || /[\x00-\x1f\x7f]/.test(v)) fail('mHelpDesk returned an invalid equipment label.');
  return v as string; // Keep punctuation, leading zeroes and decimal unit labels exactly.
}
export function projectPartnerEquipment(value: unknown, portalId: string): PartnerEquipment {
  const row = object(value);
  if (numericId(row.portalId) !== portalId) fail('mHelpDesk returned equipment from a different portal.');
  const updatedAt = row.lastUpdateUTC == null || row.lastUpdateUTC === '' ? null : row.lastUpdateUTC;
  if (updatedAt !== null && (typeof updatedAt !== 'string' || updatedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !Number.isFinite(Date.parse(updatedAt)))) fail('mHelpDesk returned an invalid update time.');
  if (row.IsActive != null && typeof row.IsActive !== 'boolean') fail('mHelpDesk returned an invalid equipment status.');
  return {
    equipmentId: numericId(row.equipmentId)!, portalId, name: label(row.name)!, model: label(row.model, true),
    equipmentTypeId: numericId(row.equipmentTypeId, true), customerId: numericId(row.customerId, true),
    serviceLocationId: numericId(row.serviceLocationId, true), active: row.IsActive == null ? null : row.IsActive as boolean,
    updatedAt: updatedAt as string | null,
  };
}
/** Legacy Product IDs and name-only matches are candidates, never verified bindings. */
export function reviewPartnerIdentity(equipment: PartnerEquipment, nativeUnits: unknown[]) {
  const units = nativeUnits.map(object);
  if (units.some(row => typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) || typeof row.unit_number !== 'string')) fail('COS returned an invalid equipment identity.');
  const candidates = units.filter(row => row.unit_number === equipment.name).map(row => String(row.id));
  const bindings = units.filter(row => {
    const metadata = row.metadata as ObjectValue | null;
    const binding = metadata?.mhelpdeskPartner as ObjectValue | null;
    return binding?.portalId === equipment.portalId && binding?.equipmentId === equipment.equipmentId;
  });
  const exact = bindings.length === 1 && candidates.length <= 1 &&
    (bindings[0].metadata as any).mhelpdeskPartner.fullLabel === equipment.name &&
    (bindings[0].metadata as any).mhelpdeskPartner.model === equipment.model && bindings[0].unit_number === equipment.name;
  return {
    state: bindings.length > 1 || candidates.length > 1 ? 'ambiguous' : exact ? 'verified_link' : bindings.length ? 'identity_changed' : 'review_needed',
    nativeUnitId: exact && bindings.length === 1 && candidates.length <= 1 ? String(bindings[0].id) : null,
    candidateUnitIds: candidates,
  };
}
async function boundedJson(response: Response, signal: AbortSignal, maxBytes = 1048576) {
  if (!response.body || Number(response.headers.get('Content-Length')) > maxBytes) fail('mHelpDesk returned an oversized response.');
  const reader = response.body.getReader(); let size = 0, raw = '';
  const decoder = new TextDecoder('utf-8', {fatal: true});
  try {
    while (true) {
      if (signal.aborted) fail('The mHelpDesk read timed out. Retry the preview.');
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail('mHelpDesk returned an oversized response.'); }
      raw += decoder.decode(value, {stream: true});
    }
    raw += decoder.decode(); return JSON.parse(raw);
  } catch (cause) {
    if (cause instanceof MhelpPartnerError) throw cause;
    return fail('mHelpDesk returned an incomplete response. Retry the preview.');
  } finally { reader.releaseLock(); }
}
export function createMhelpPartnerHandler(options: {
  getConfig: () => Config;
  fetch: typeof fetch;
  readNativeUnits: () => Promise<unknown[]>;
}) {
  let busy = false;
  return async (path: string, method: string, body: unknown) => {
    if (!['/api/mhelpdesk/partner/status', '/api/mhelpdesk/partner/preview'].includes(path)) fail('mHelpDesk connector endpoint not found.', 404);
    if (method !== (path.endsWith('/status') ? 'GET' : 'POST')) fail('Method not supported.', 405);
    const payload = body == null ? {} : object(body);
    if (Object.keys(payload).some(key => !path.endsWith('/preview') || key !== 'name')) fail('The connector request contains unsupported fields.', 400);
    if (payload.name !== undefined && (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 180 || /[\x00-\x1f\x7f]/.test(payload.name))) fail('Enter a full equipment label.', 400);
    const config = options.getConfig();
    const portalConfigured = typeof config.portalId === 'string' && /^[1-9][0-9]{0,14}$/.test(config.portalId) && Number.isSafeInteger(Number(config.portalId));
    const tokenConfigured = typeof config.accessToken === 'string' && !!config.accessToken && config.accessToken.length <= 16384 && !/\s/.test(config.accessToken);
    const status = {contract: MHELP_PARTNER_CONTRACT, docsUrl: MHELP_PARTNER_DOCS, mode: 'read_only_review',
      state: portalConfigured && tokenConfigured ? 'ready_to_test' : 'setup_required', portalConfigured, tokenConfigured,
      automaticSync: false, sheetsPublisher: false, liveAccessVerified: false};
    if (path.endsWith('/status')) return status;
    if (!tokenConfigured) fail('mHelpDesk needs a server-held access token before previewing equipment.', 503);
    if (config.portalId && !portalConfigured) fail('The saved mHelpDesk portal ID must be a numeric company ID. Correct or remove that setting before previewing equipment.', 503);
    if (busy) fail('A mHelpDesk preview is already running. Wait for it to finish.', 409);
    busy = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const read = async (url: string, maxBytes?: number) => {
        let response: Response;
        try { response = await options.fetch(url, {method: 'GET', headers: {Authorization: 'Bearer ' + config.accessToken, Accept: 'application/json'}, redirect: 'error', cache: 'no-store', signal: controller.signal}); }
        catch { return fail('mHelpDesk could not be reached. Retry the preview.'); }
        // Never echo vendor errors, profile fields, request URLs, headers, or credentials.
        if (response.status === 401 || response.status === 403) fail('mHelpDesk denied API access. Verify the token, portal, and Partner API approval.', 503);
        if (response.status === 429) fail('mHelpDesk is limiting requests. Wait before retrying.', 429);
        if (!response.ok) fail('mHelpDesk could not complete the account or equipment read. Retry later.');
        return object(await boundedJson(response, controller.signal, maxBytes));
      };
      // Resolve identity through the authenticated account, never from caller input or token decoding.
      const account = await read(API + '/me', 16384);
      let verifiedPortalId: string;
      try { verifiedPortalId = numericId(account.portalId)!; }
      catch { return fail('mHelpDesk did not return a valid company portal ID. Contact mHelpDesk Partner API support.'); }
      if (portalConfigured && config.portalId !== verifiedPortalId) fail('The saved portal ID does not match the mHelpDesk account for this token. Correct the server setting before previewing equipment.');
      const url = new URL(API + '/portal/' + verifiedPortalId + '/equipment');
      url.searchParams.set('Fields', FIELDS);
      if (payload.name) url.searchParams.set('Name', payload.name as string);
      const data = await read(url.href);
      if (!Array.isArray(data.results) || data.results.length > 50 || !Number.isSafeInteger(data.totalRows) || Number(data.totalRows) < data.results.length || Number(data.totalRows) < 0) fail('mHelpDesk returned an unsupported equipment page.');
      const rows = (data.results as unknown[]).map(row => projectPartnerEquipment(row, verifiedPortalId));
      if (new Set(rows.map(row => row.equipmentId)).size !== rows.length) fail('mHelpDesk returned duplicate equipment identities.');
      const nativeUnits = await options.readNativeUnits();
      if (!Array.isArray(nativeUnits) || nativeUnits.length > 10000) fail('COS equipment could not be verified. Retry the preview.');
      return {...status, state: 'preview_verified', liveAccessVerified: true, verifiedPortalId, readAt: new Date().toISOString(),
        totalRows: data.totalRows, partial: rows.length < Number(data.totalRows),
        items: rows.map(row => ({...row, identity: reviewPartnerIdentity(row, nativeUnits)}))};
    } finally { clearTimeout(timer); busy = false; }
  };
}
