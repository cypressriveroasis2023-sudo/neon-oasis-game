// Unit camera status, served on its own.
//
// The Fleet board's own function is a frozen, hash-pinned artifact. Rather than
// rebuild it to add a read-only route, this function imports the same handler
// from the reviewed source and serves only the two unit-camera-status paths.
// Authentication, origin checks, CORS and every other rule stay exactly as the
// shared handler already implements them.
import {createOperationsHandler} from '../cos-operations-pages/index.ts';
import {handlerUrl, servedEnvelopeBody} from './servedPath.ts';
const handler = createOperationsHandler({
  platformUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  // The second address service, for addresses the free US Census file does not
  // carry. Absent, a hand-typed address still saves; it just has no pin.
  geocodioApiKey: Deno.env.get('GEOCODIO_API_KEY'),
});
Deno.serve(async request => {
  if (request.method !== 'POST') return handler(request);
  const text = await request.text();
  return handler(new Request(handlerUrl(request.url), {method: 'POST', headers: request.headers, body: servedEnvelopeBody(text)}));
});
