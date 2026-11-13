// This function serves unit camera status and nothing else.
//
// It reuses the Operations handler, which carries the custom authentication,
// the origin checks and the CORS replies. To avoid standing up a second copy of
// the whole API, every other path is rewritten to one the handler does not know,
// so the handler answers "not found" in its own words, with its own headers.
export const UNIT_CAMERA_STATUS_PATHS = ['/api/unit-camera-status', '/api/unit-camera-status/edit'];
export const NOT_SERVED_HERE = '/api/not-served-by-this-function';

/**
 * Given the raw request body, return the body to hand the shared handler.
 * A body that is not a transport envelope is passed through untouched: the
 * handler already validates it and answers.
 */
export function servedEnvelopeBody(text: string): string {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return text; }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return text;
  const record = envelope as Record<string, unknown>;
  if (typeof record.path !== 'string') return text;
  const path = record.path.replace(/\/$/, '');
  if (UNIT_CAMERA_STATUS_PATHS.includes(path)) return JSON.stringify({...record, path});
  return JSON.stringify({...record, path: NOT_SERVED_HERE});
}
