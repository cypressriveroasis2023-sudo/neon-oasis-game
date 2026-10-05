/** Private, bounded evidence delivery. The caller supplies an already authenticated Owner ID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
type Row = Record<string, unknown>;
export class PrivateEvidenceError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'PrivateEvidenceError';
  }
}
const fail = (message: string, status: number): never => { throw new PrivateEvidenceError(message, status); };
const unavailable = () => fail('Evidence preview is unavailable. Please retry.', 503);
const notFound = () => fail('Evidence file is unavailable for this account. The record is preserved.', 404);
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value.toLowerCase())) notFound();
  return (value as string).toLowerCase();
}
function records(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) unavailable();
  return value as Row[];
}
function single(value: unknown): Row {
  const rows = records(value);
  if (rows.length !== 1) notFound();
  return rows[0];
}
function mime(value: unknown): string {
  return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
}
function imageType(bytes: Uint8Array): string {
  const starts = (prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (bytes.length >= 8 && starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (bytes.length >= 3 && starts([255, 216, 255])) return 'image/jpeg';
  if (bytes.length >= 12 && starts([82, 73, 70, 70]) &&
      [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte)) return 'image/webp';
  if (bytes.length >= 6 && (starts([71, 73, 70, 56, 55, 97]) || starts([71, 73, 70, 56, 57, 97]))) return 'image/gif';
  return '';
}
async function limitedBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const header = response.headers.get('content-length');
  if (header !== null && (!/^\d+$/.test(header) || Number(header) > MAX_EVIDENCE_BYTES)) {
    await response.body?.cancel();
    fail('This file is too large for the private preview (4 MiB maximum). The record is preserved.', 413);
  }
  if (!response.body) unavailable();
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) unavailable();
      const result = await reader.read();
      if (signal.aborted) unavailable();
      if (result.done) break;
      size += result.value.length;
      if (size > MAX_EVIDENCE_BYTES) {
        await reader.cancel();
        fail('This file is too large for the private preview (4 MiB maximum). The record is preserved.', 413);
      }
      chunks.push(result.value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  if (!size || header !== null && Number(header) !== size) unavailable();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
export function createPrivateEvidenceReader(options: {
  organizationId: string;
  read: (path: string) => Promise<unknown>;
  readObject: (bucket: string, path: string, signal: AbortSignal) => Promise<Response>;
}) {
  const organizationId = uuid(options.organizationId);
  return async (verifiedOwnerId: string, evidenceId: unknown) => {
    const actorId = uuid(verifiedOwnerId), id = uuid(evidenceId);
    try {
      // Re-check the effective existing permission for every read. No cached grants or provisioning.
      const profile = single(await options.read('user_profiles?select=user_id,organization_id,active,department&user_id=eq.' + actorId + '&organization_id=eq.' + organizationId + '&limit=2'));
      if (profile.user_id !== actorId || profile.organization_id !== organizationId || profile.active !== true || profile.department !== 'owner') {
        fail('Your existing Owner access is no longer active.', 403);
      }
      const role = single(await options.read('roles?select=id,organization_id,code&organization_id=eq.' + organizationId + '&code=eq.owner&limit=2'));
      const roleId = uuid(role.id);
      if (role.organization_id !== organizationId || role.code !== 'owner') fail('Owner access is required.', 403);
      const link = single(await options.read('user_roles?select=user_id,role_id&user_id=eq.' + actorId + '&role_id=eq.' + roleId + '&limit=2'));
      if (link.user_id !== actorId || link.role_id !== roleId) fail('Owner access is required.', 403);
      const permission = single(await options.read('role_permissions?select=role_id,permission_code&role_id=eq.' + roleId + '&permission_code=eq.job.view_all&limit=2'));
      if (permission.role_id !== roleId || permission.permission_code !== 'job.view_all') fail('Job viewing permission is required.', 403);
      const document = single(await options.read('documents?select=id,organization_id,job_id,document_type,storage_bucket,storage_path,content_type&id=eq.' + id + '&organization_id=eq.' + organizationId + '&limit=2'));
      if (document.id !== id || document.organization_id !== organizationId) notFound();
      const jobId = uuid(document.job_id);
      const job = single(await options.read('jobs?select=id,organization_id&id=eq.' + jobId + '&organization_id=eq.' + organizationId + '&limit=2'));
      if (job.id !== jobId || job.organization_id !== organizationId) notFound();
      const isPhoto = document.document_type === 'workflow_photo';
      const isSignature = ['technician_signature', 'customer_signature'].includes(String(document.document_type));
      const bucket = isPhoto ? 'job-photos' : isSignature ? 'signatures' : '';
      if (!bucket || document.storage_bucket !== bucket) notFound();
      const path = document.storage_path;
      if (typeof path !== 'string' || path.length > 1024 || !/^[a-zA-Z0-9._/-]+$/.test(path)) notFound();
      const parts = (path as string).split('/');
      if (parts.length < 3 || parts.some(part => !part || part === '.' || part === '..') || parts[0] !== organizationId || parts[1] !== jobId) notFound();
      const contentType = mime(document.content_type);
      if (!RASTER.has(contentType) || isSignature && contentType === 'image/gif') {
        fail('This file format is not supported by the private image preview. The record is preserved.', 415);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        // readObject is server-owned and fixed to the production Storage host; never accepts a client URL.
        const response = await options.readObject(bucket, path as string, controller.signal);
        if ([400, 404].includes(response.status)) { await response.body?.cancel(); notFound(); }
        if (response.status !== 200 || response.redirected) { await response.body?.cancel(); unavailable(); }
        if (mime(response.headers.get('content-type')) !== contentType) {
          await response.body?.cancel();
          fail('The stored file type could not be verified. The record is preserved.', 415);
        }
        const bytes = await limitedBytes(response, controller.signal);
        if (imageType(bytes) !== contentType) fail('The stored file type could not be verified. The record is preserved.', 415);
        return { documentId: id, contentType, content: base64(bytes), byteLength: bytes.length };
      } finally { clearTimeout(timeout); }
    } catch (cause) {
      if (cause instanceof PrivateEvidenceError) throw cause;
      return unavailable();
    }
  };
}
