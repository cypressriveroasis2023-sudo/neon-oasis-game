/** Preserve complete Recon payloads outside Postgres; only inline binary is relocated.
 * No public bucket, signed URL, deletion, credential export, or health mutation. */
export const ARCHIVE_BUCKET = 'camera-event-archives';
const MARKER = 'cos_private_archive';
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_BINARY_BYTES = 16 * 1024;
type Row = Record<string, any>;
const object = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

export async function ensureArchiveBucket(db: any): Promise<void> {
  let {data, error} = await db.storage.getBucket(ARCHIVE_BUCKET);
  if (error || !data) {
    await db.storage.createBucket(ARCHIVE_BUCKET, {public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ['application/gzip']});
    ({data, error} = await db.storage.getBucket(ARCHIVE_BUCKET));
  }
  // Never silently use a bucket whose privacy or upload restrictions changed.
  if (error || !data || data.public !== false || Number(data.file_size_limit) !== MAX_BYTES
    || !Array.isArray(data.allowed_mime_types) || data.allowed_mime_types.length !== 1 || data.allowed_mime_types[0] !== 'application/gzip') {
    throw Error('Private event archive is unavailable.');
  }
}

export function needsReconArchive(payload: unknown): payload is Row {
  return object(payload) && !Object.hasOwn(payload, MARKER) && Array.isArray(payload.binary)
    && new TextEncoder().encode(JSON.stringify(payload.binary)).byteLength >= MIN_BINARY_BYTES;
}

export async function restoreReconPayload(db: any, marker: Row): Promise<Row> {
  if (!object(marker) || marker.version !== 1 || marker.bucket !== ARCHIVE_BUCKET
    || !/^[a-f0-9]{64}$/.test(marker.sha256 || '') || marker.path !== `reconeyez/${marker.sha256}.json.gz`
    || !Number.isSafeInteger(marker.jsonBytes) || marker.jsonBytes < 1 || marker.jsonBytes > MAX_BYTES
    || !Number.isSafeInteger(marker.storedBytes) || marker.storedBytes < 1 || marker.storedBytes > MAX_BYTES) throw Error('Invalid event archive reference.');
  const {data, error} = await db.storage.from(ARCHIVE_BUCKET).download(marker.path);
  if (error || !data || data.size !== marker.storedBytes) throw Error('Event archive could not be verified.');
  const reader = data.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > marker.jsonBytes || size > MAX_BYTES) throw Error('Event archive exceeds its verified size.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (size !== marker.jsonBytes || await digest(bytes) !== marker.sha256) throw Error('Event archive integrity check failed.');
  const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!object(payload)) throw Error('Event archive has an invalid payload.');
  return payload;
}

/** Upload immutably, download and verify before permitting the database replacement.
 * Any archive failure leaves the original incoming payload intact. */
export async function archiveReconPayload(db: any, payload: unknown): Promise<any> {
  if (!needsReconArchive(payload)) return payload;
  try {
    await ensureArchiveBucket(db);
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.byteLength > MAX_BYTES) return payload;
    const sha256 = await digest(bytes), path = `reconeyez/${sha256}.json.gz`;
    const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    // Storage uses a Blob's own MIME type when building its multipart upload.
    const blob = new Blob([await new Response(compressed).blob()], {type: 'application/gzip'});
    if (blob.size > MAX_BYTES) return payload;
    const {error} = await db.storage.from(ARCHIVE_BUCKET).upload(path, blob, {contentType: 'application/gzip', upsert: false, cacheControl: '31536000'});
    // An immutable existing object is acceptable only after its contents verify.
    if (error && ![409, '409', 'Duplicate'].includes(error.statusCode) && ![409, '409'].includes(error.status)) return payload;
    const marker = {version: 1, bucket: ARCHIVE_BUCKET, path, sha256, jsonBytes: bytes.byteLength, storedBytes: blob.size, archivedFields: ['binary']};
    const restored = await restoreReconPayload(db, marker);
    if (JSON.stringify(restored) !== JSON.stringify(payload)) return payload;
    const compact: Row = {...payload, [MARKER]: marker}; delete compact.binary;
    return compact;
  } catch { return payload; }
}
