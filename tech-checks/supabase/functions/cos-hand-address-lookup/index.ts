// One address in, one map point out, for a hand edit on Camera status.
//
// COS pays for a second address service whose key lives on this project. The
// Fleet app runs on the other project, which has no copy of that key and should
// not get one: a key copied is a key in two places. So the Fleet app asks here,
// carrying the signed-in person's own token, and this function does the lookup
// with the key that never leaves.
//
// It answers only an active Owner or approved IT, never a browser directly, and
// it changes nothing: no row is written and no unit is touched.
import {geocodioPoint} from '../cos-operations-pages/handAddressPoint.ts';

export type LookupOptions = {
  verifyFleetActor: (authorization: string) => Promise<boolean>;
  geocodioApiKey?: string;
  fetch?: typeof fetch;
};
const MAX_BODY = 2048;
const usableKey = (key: unknown): key is string =>
  typeof key === 'string' && Boolean(key.trim()) && key.length <= 8192 && !/[\r\n]/.test(key);

export function createHandAddressLookup(options: LookupOptions) {
  return async (request: Request): Promise<Response> => {
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers});
    // Server to server only. A page in a browser always sends an origin, and no
    // origin is allowed here, so no CORS headers are offered and none would help.
    if (request.headers.get('origin')) return reply({error: 'This lookup is not available from a browser.'}, 403);
    if (request.method !== 'POST') return reply({error: 'POST required.'}, 405);
    if (!await options.verifyFleetActor(request.headers.get('authorization') || ''))
      return reply({error: 'An active Owner or approved IT account is required.'}, 403);
    let text = '';
    const reader = request.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > MAX_BODY) { await reader.cancel(); return reply({error: 'Request too large.'}, 413); }
        text += decoder.decode(part.value, {stream: true});
      }
      text += decoder.decode();
    }
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { return reply({error: 'Invalid request.'}, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'address'))
      return reply({error: 'Unsupported request.'}, 400);
    if (typeof body.address !== 'string' || !body.address.trim() || body.address.length > 200)
      return reply({error: 'An address is required.'}, 400);
    // No key configured is not an error the caller can fix; it means no pin.
    if (!usableKey(options.geocodioApiKey))
      return reply({status: 'provider_error', reason: 'The second address service is not set up, so there is no pin yet.'});
    const found = await geocodioPoint(body.address, options.geocodioApiKey, options.fetch || fetch);
    return reply(found);
  };
}
