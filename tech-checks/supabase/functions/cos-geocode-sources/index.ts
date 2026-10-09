import {checkedSourcePrecedence} from '../_shared/sourcePrecedence.ts';
import {checkedAppAddressAuthority} from '../_shared/appUnitAddressContract.ts';
/** Server-to-server, COS-only read bridge. Never accepts a table, RPC or URL. */
export const COS_ORGANIZATION_ID = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const SOURCE_BODY_LIMIT = 32768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(' '));
const KIND = new Set(['equipment_unit', 'tracker']);
type Row = Record<string, any>;
class SourceError extends Error { constructor(readonly status: number) { super('Source request unavailable.'); } }
function fail(status = 400): never { throw new SourceError(status); }
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, zero = false): v is string => typeof v === 'string' && (zero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(v) && BigInt(v) <= 9223372036854775807n;
const fields = (v: Row, allowed: string[]) => { if (Object.keys(v).some(k => !allowed.includes(k))) fail(); };
const clean = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\x00-\x1f\x7f<>]/.test(v);

/** Fixed work for syntactically valid 256-bit keys; no early mismatch exit. */
export function validSourceKey(expected: unknown, supplied: unknown): boolean {
  if (typeof expected === 'string') expected = expected.trim();
  if (typeof expected !== 'string' || typeof supplied !== 'string' || !/^[a-fA-F0-9]{64}$/.test(expected) || !/^[a-fA-F0-9]{64}$/.test(supplied)) return false;
  const a = expected.toLowerCase(), b = supplied.toLowerCase(); let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function body(request: Request): Promise<Row> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) fail(415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > SOURCE_BODY_LIMIT)) fail(413);
  const reader = request.body?.getReader(); if (!reader) fail();
  const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', size = 0;
  try {
    while (true) { const next = await reader!.read(); if (next.done) break; size += next.value.byteLength;
      if (size > SOURCE_BODY_LIMIT) fail(413); raw += decoder.decode(next.value, { stream: true }); }
    raw += decoder.decode();
  } catch (error) { try { await reader!.cancel(); } catch { /* no logs */ } if (error instanceof SourceError) throw error; fail(); }
  finally { reader!.releaseLock(); }
  let parsed; try { parsed = JSON.parse(raw); } catch { fail(); }
  if (!object(parsed)) fail(); return parsed;
}
const trackerRecordId = (v: unknown): v is string => typeof v === 'string' && v.length <= 400 && /^google_sheet:[A-Za-z0-9_-]{10,128}:(?:0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$/.test(v);
const identityFields = ['entityKind','nativeUnitId','productId','sourceSystem','sourceRecordId','sourceRevision'];
function identity(v: Row) {
  if (!KIND.has(v.entityKind) || typeof v.nativeUnitId !== 'string' || !UUID.test(v.nativeUnitId) || typeof v.sourceRevision !== 'string' || !UUID.test(v.sourceRevision)) fail(503);
  if (v.sourceSystem === 'google_sheet_tracker') {
    if (v.entityKind !== 'tracker' || !trackerRecordId(v.sourceRecordId) || Object.hasOwn(v,'productId')) fail(503);
    return {entityKind:v.entityKind,nativeUnitId:v.nativeUnitId,sourceSystem:v.sourceSystem,sourceRecordId:v.sourceRecordId,sourceRevision:v.sourceRevision};
  }
  if (!integer(v.productId) || Object.hasOwn(v,'sourceRecordId') || !(v.sourceSystem === undefined || v.sourceSystem === 'mhelpdesk_product_import')) fail(503);
  return { entityKind: v.entityKind, nativeUnitId: v.nativeUnitId, productId: v.productId, sourceRevision: v.sourceRevision };
}
/** Responses are rebuilt from the allowlist even if a backend adds private columns. */
export function sourceDto(value: unknown): Row {
  if (!object(value) || value.organizationId !== COS_ORGANIZATION_ID || !(value.schemaVersion === 1 && value.sourceSystem === 'mhelpdesk_product_import' || value.schemaVersion === 2 && value.sourceSystem === 'google_sheet_tracker') || !integer(value.eventId)) fail(503);
  const base = { schemaVersion: value.schemaVersion, organizationId: COS_ORGANIZATION_ID, sourceSystem: value.sourceSystem, ...identity(value), eventId: value.eventId };
  if (value.eligibility === 'tombstone') return { ...base, eligibility: 'tombstone' };
  if (value.eligibility !== 'FIELD' || !clean(value.unitNumber, 160) || !clean(value.family, 160) || !(value.variant === null || clean(value.variant, 160)) || !object(value.installation)) fail(503);
  for (const key of ['sourceFileSha256', 'sourceRowSha256', 'addressSha256', 'nativeGuardSha256']) if (typeof value[key] !== 'string' || !SHA.test(value[key])) fail(503);
  const { street, city, state, zip } = value.installation;
  if (!clean(street, 250) || !(city === null || clean(city, 100)) || typeof state !== 'string' || !STATES.has(state) || !(zip === null || typeof zip === 'string' && /^\d{5}(?:-\d{4})?$/.test(zip)) || city === null && zip === null) fail(503);
  if (!/^[0-9]{1,8}[A-Za-z]? +[A-Za-z0-9 .'-]+$/.test(street) || (city !== null && !/^[A-Za-z][A-Za-z .'-]*$/.test(city)) || /\b(?:gate|password|passcode|access\s*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|apt|apartment|suite|ste|unit|floor|bldg|building|customer|username|passwd|pwd|token|secret|credential|code)\b/i.test(street + ' ' + city) || /\d{3}[ .)-]+\d{3}[ .-]+\d{4}/.test(street)) fail(503);
  if (/(?:password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox)[A-Za-z0-9_-]*|(?:gate|access)[\s-]*code[A-Za-z0-9_-]*/i.test(street+' '+(city||''))) fail(503);
  const precedence=checkedSourcePrecedence(value);if(Object.hasOwn(value,'sourcePrecedence')&&!precedence)fail(503);
  const authority=checkedAppAddressAuthority(value.addressAuthority,value.sourceRevision);if(Object.hasOwn(value,'addressAuthority')&&(!authority||value.entityKind!=='tracker'||precedence))fail(503);
  const suppliedComponents = { street: true, city: city !== null, state: true, zip: zip !== null };
  if (!object(value.suppliedComponents) || Object.keys(value.suppliedComponents).length !== 4 || Object.entries(suppliedComponents).some(([k,v]) => value.suppliedComponents[k] !== v)) fail(503);
  return { ...base, unitNumber: value.unitNumber, family: value.family, variant: value.variant,
    sourceFileSha256: value.sourceFileSha256, sourceRowSha256: value.sourceRowSha256,
    addressSha256: value.addressSha256, nativeGuardSha256: value.nativeGuardSha256,
    installation: { street, city, state, zip }, suppliedComponents, eligibility: 'FIELD',...(precedence?{sourcePrecedence:precedence}:{}),...(authority?{addressAuthority:authority}:{}) };
}
export function createGeocodeSourcesHandler(options: {
  readKey?: string;
  rpc: (name: 'cos_geocode_sources_list_changes' | 'cos_geocode_sources_read_current' | 'cos_geocode_sources_read_current_batch', args: Row) => Promise<unknown>;
}) {
  return async (request: Request): Promise<Response> => {
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    try {
      if (!validSourceKey(options.readKey, request.headers.get('x-cos-geocode-source-key'))) fail(401);
      if (request.method !== 'POST') fail(405);
      if (new URL(request.url).search) fail();
      const input = await body(request);
      if (input.action === 'list_changes') {
        fields(input, ['action', 'afterEventId', 'limit']);
        if (!integer(input.afterEventId, true) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) fail();
        const raw = await options.rpc('cos_geocode_sources_list_changes', { p_organization_id: COS_ORGANIZATION_ID, p_after_event_id: input.afterEventId, p_limit: input.limit });
        if (!object(raw) || !Array.isArray(raw.events) || raw.events.length > input.limit || !integer(raw.nextEventId, true)) fail(503);
        let previous = BigInt(input.afterEventId);
        const events = raw.events.map((event: unknown) => {
          if (!object(event) || !integer(event.eventId) || BigInt(event.eventId) <= previous || !['upsert', 'tombstone'].includes(event.kind)) fail(503);
          previous = BigInt(event.eventId); return { ...identity(event), eventId: event.eventId, kind: event.kind };
        });
        if (raw.nextEventId !== previous.toString()) fail(503);
        return response({ events, nextEventId: raw.nextEventId });
      }
      if (input.action === 'read_current') {
        if ('sources' in input) {
          fields(input, ['action', 'sources']);
          if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 100) fail();
          for (const item of input.sources) { if (!object(item)) fail(); fields(item, identityFields); try { identity(item); } catch { fail(); } }
          const raw = await options.rpc('cos_geocode_sources_read_current_batch', { p_organization_id: COS_ORGANIZATION_ID, p_sources: input.sources });
          if (!object(raw) || !Array.isArray(raw.sources) || raw.sources.length !== input.sources.length) fail(503);
          const sources = raw.sources.map((item: unknown, i: number) => { const source = item === null ? null : sourceDto(item);
            if (source && identityFields.filter(k=>k!=='sourceSystem'||input.sources[i].sourceSystem!==undefined).some(k => source[k] !== input.sources[i][k])) fail(503); return source; });
          return response({ sources });
        }
        fields(input, ['action', 'entityKind', 'nativeUnitId', 'productId', 'sourceRevision']);
        try { identity(input); } catch { fail(); }
        const raw = await options.rpc('cos_geocode_sources_read_current', { p_organization_id: COS_ORGANIZATION_ID, p_entity_kind: input.entityKind, p_native_unit_id: input.nativeUnitId, p_product_id: input.productId, p_source_revision: input.sourceRevision });
        if (!object(raw) || !('source' in raw)) fail(503);
        const source = raw.source === null ? null : sourceDto(raw.source);
        if (source && ['entityKind', 'nativeUnitId', 'productId', 'sourceRevision'].some(k => source[k] !== input[k])) fail(503);
        return response({ source });
      }
      fail();
    } catch (error) { return response({ error: 'Source request unavailable.' }, error instanceof SourceError ? error.status : 503); }
  };
}
