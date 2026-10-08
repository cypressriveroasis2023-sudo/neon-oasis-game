/** Private mHelpDesk imports. The existing bridge resolves Owner identity before calling this module. */
export class MhelpImportError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const MHELP_MAX_BYTES = 10 * 1024 * 1024;
export const MHELP_JSON_LIMIT = Math.ceil(MHELP_MAX_BYTES / 3) * 4 + 524288;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string, status = 400): never => { throw new MhelpImportError(message, status); };
type RecordValue = Record<string, any>;
function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object.');
  return value as RecordValue;
}
function keys(value: RecordValue, fields: string[], label: string) {
  if (Object.keys(value).some(key => !fields.includes(key))) fail(label + ' contains unsupported fields.');
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000') || (required && !value.trim())) fail('Invalid ' + label + '.');
  return value as string;
}
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(label + ' must be a valid identifier.');
  return (value as string).toLowerCase();
}
export function validateMhelpSource(value: unknown) {
  const source = object(value, 'Source');
  keys(source, ['system','sourceTicketId','sha256','filename','byteLength','mimeType','parserId','parserVersion'], 'Source');
  if (source.system !== 'mhelpdesk' || source.mimeType !== 'application/pdf') fail('Only a verified mHelpDesk PDF is supported.');
  text(source.sourceTicketId, 'source ticket ID', 128, true);
  if (source.sourceTicketId !== source.sourceTicketId.trim()) fail('Source ticket ID must not have surrounding whitespace.');
  text(source.filename, 'filename', 255, true);
  if (!/\.pdf$/i.test(source.filename) || /[\x00-\x1f/\\]/.test(source.filename)) fail('Use the PDF filename without a path.');
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) fail('Invalid SHA-256.');
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength <= 0 || source.byteLength > MHELP_MAX_BYTES) fail('Choose a nonempty PDF no larger than 10 MiB.');
  text(source.parserId, 'parser ID', 100, true); text(source.parserVersion, 'parser version', 100, true);
  return structuredClone(source);
}
export function validateMhelpTicket(value: unknown) {
  const ticket = object(value, 'Ticket');
  keys(ticket, ['source','customerId','siteId','jobType','priority','title','description','contactInstructions','unitIds','requestedSchedule','additionalInformation','shopPrep','parserData'], 'Ticket');
  validateMhelpSource(ticket.source);
  id(ticket.customerId, 'Customer'); id(ticket.siteId, 'Site');
  if (!['DELIVERY','SERVICE','SWAP','PICKUP'].includes(ticket.jobType) || !['normal','high','urgent'].includes(ticket.priority)) fail('Review the job type and priority.');
  text(ticket.title, 'title', 500, true);
  for (const key of ['description','contactInstructions','requestedSchedule','additionalInformation']) text(ticket[key], key, 70000);
  if (!Array.isArray(ticket.unitIds) || ticket.unitIds.length !== 0) fail('Physical unit assignment must be completed separately in the native workflow.');
  if (typeof ticket.shopPrep !== 'boolean' || (ticket.shopPrep && ticket.jobType !== 'SERVICE')) fail('Shop preparation is only available for Service imports.');
  const parser = object(ticket.parserData, 'Parser data');
  text(parser.documentText, 'full extracted document text', 250000, true);
  if (object(parser.sourceTicketId, 'Printed source reference').value !== ticket.source.sourceTicketId) fail('The printed source reference must match the original ticket ID.');
  if (!Array.isArray(parser.units) || !Array.isArray(parser.additionalFields) || !Array.isArray(parser.warnings)) fail('Complete parser provenance is required.');
  if (new TextEncoder().encode(JSON.stringify(ticket)).byteLength > 512000) fail('The reviewed ticket data is too large.');
  return structuredClone(ticket);
}
/** Bounded stream read prevents an unbounded request.text() allocation. */
export async function readMhelpAwareJsonWithSize(request: Request, max = 65536, admitLargeBody?: () => void): Promise<{ body: RecordValue; byteLength: number }> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail('Use an application/json request body.', 415);
  if (Number(request.headers.get('Content-Length')) > max) fail('Request body is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('A JSON body is required.');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', count = 0, admitted = false;
  try {
    while (true) {
      const { done, value } = await reader!.read(); if (done) break;
      count += value.byteLength;
      if (count > max) { await reader!.cancel(); fail('Request body is too large.', 413); }
      if (count > 65536 && !admitted) { admitLargeBody?.(); admitted = true; }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    try { await reader!.cancel(); } catch { /* Keep the original body/admission error. */ }
    // Admission errors originate in the bridge and retain their retryable status.
    if (error instanceof MhelpImportError || (error instanceof Error && 'status' in error)) throw error;
    fail('A valid UTF-8 JSON body is required.');
  } finally { reader!.releaseLock(); }
  let body; try { body = JSON.parse(raw); } catch { fail('A valid JSON body is required.'); }
  return { body: object(body, 'Request'), byteLength: count };
}
export async function readMhelpAwareJson(request: Request, max = 65536, admitLargeBody?: () => void): Promise<RecordValue> {
  return (await readMhelpAwareJsonWithSize(request, max, admitLargeBody)).body;
}
export function createMhelpImportHandler(options: {
  rpc: (name: string, payload: RecordValue) => Promise<any>;
  organizationId: string;
}) {
  return async (path: string, method: string, body: unknown, actorId: string) => {
    if (!path.startsWith('/api/mhelpdesk/imports')) return undefined;
    const payload = body == null ? {} : object(body, 'Request');
    const call = (action: string, value: RecordValue = {}) => options.rpc('appdeploy_mhelp_import', {
      p_actor_user_id: actorId, p_organization_id: options.organizationId, p_action: action, p_payload: value,
    });
    if (method === 'GET') {
      keys(payload, [], 'Request');
      if (path === '/api/mhelpdesk/imports') return call('history');
      const route = /^\/api\/mhelpdesk\/imports\/(attempt|jobs|attachments)\/([^/]+)(\/download)?$/.exec(path);
      if (!route || (route[3] && route[1] !== 'attachments')) fail('Import endpoint not found.', 404);
      const identifier = id(route![2], 'Import record');
      return call(route![3] ? 'download' : ({ attempt: 'attempt', jobs: 'readback', attachments: 'attachment' }[route![1]]!), { id: identifier });
    }
    if (method !== 'POST') fail('Method not supported.', 405);
    if (path === '/api/mhelpdesk/imports/stage') {
      keys(payload, ['attemptId','source','bytesBase64'], 'Stage request');
      const attemptId = id(payload.attemptId, 'Import attempt'); const source = validateMhelpSource(payload.source);
      const base64 = text(payload.bytesBase64, 'PDF bytes', Math.ceil(MHELP_MAX_BYTES / 3) * 4, true);
      if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('PDF bytes must be canonical base64.');
      let binary = ''; try { binary = atob(base64); } catch { fail('PDF bytes are invalid.'); }
      if (btoa(binary!) !== base64) fail('PDF bytes must be canonical base64.');
      if (binary!.length !== source.byteLength || !binary!.startsWith('%PDF-')) fail('PDF bytes do not match the source metadata.');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
      if (sha !== source.sha256) fail('PDF hash does not match the source metadata.');
      return call('stage', { attemptId, source, bytesBase64: base64 });
    }
    if (path === '/api/mhelpdesk/imports/commit') {
      keys(payload, ['attachmentId','ticket'], 'Commit request');
      return call('commit', { attachmentId: id(payload.attachmentId, 'Attachment'), ticket: validateMhelpTicket(payload.ticket) });
    }
    const move = /^\/api\/mhelpdesk\/imports\/attachments\/([^/]+)\/(trash|restore)$/.exec(path);
    if (!move) fail('Import endpoint not found.', 404);
    const attachmentId = id(move![1], 'Attachment');
    if (move![2] === 'restore') { keys(payload, [], 'Restore request'); return call('restore', { attachmentId }); }
    keys(payload, ['verifiedJobId','ticket'], 'Trash request');
    return call('trash', { attachmentId, verifiedJobId: id(payload.verifiedJobId, 'Verified job'), ticket: validateMhelpTicket(payload.ticket) });
  };
}

