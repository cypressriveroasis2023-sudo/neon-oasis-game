// cos-vrm-mppt-read: saved Victron MPPT readings for Helios units. Read-only.
//
// Same gate as cos-vrm-history: it does not authenticate anyone itself. It forwards the caller's own
// Authorization and Origin to the Operations function and asks the question the Victron Power page asks
// (GET /api/vrm-fleet). Only a 200 there lets readings through. Then it reads public.cos_vrm_mppt_read
// with the service role, which only that role may call. Nothing is written anywhere.
import {corsHeaders, gateVerdict, isHistoryRequest} from '../cos-vrm-history/history.ts';
import {safeVrmMppt} from './read.ts';

const platform = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const operations = platform + '/functions/v1/cos-operations-pages';

Deno.serve(async request => {
  const origin = request.headers.get('Origin');
  const headers = corsHeaders(origin);
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers});
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (request.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const text = await request.text();
  if (!isHistoryRequest(text)) return reply({error: 'The request could not be read.'}, 400);
  const authorization = request.headers.get('Authorization');
  if (!authorization || !platform || !serviceKey) return reply({error: 'Victron MPPT readings are unavailable.'}, authorization ? 503 : 401);

  let verdict: ReturnType<typeof gateVerdict>, gateStatus = 503;
  try {
    const gate = await fetch(operations, {
      method: 'POST',
      headers: {'Authorization': authorization, 'Content-Type': 'application/json', ...(origin ? {'Origin': origin} : {})},
      body: JSON.stringify({path: '/api/vrm-fleet', method: 'GET', body: null}),
      signal: AbortSignal.timeout(20000),
    });
    gateStatus = gate.status;
    verdict = gateVerdict(gate.status);
    await gate.body?.cancel().catch(() => {});
  } catch { verdict = 'unavailable'; }
  if (verdict === 'denied') return reply({error: 'Victron MPPT readings are not available for this sign-in.'}, gateStatus);
  if (verdict !== 'allow') return reply({error: 'Victron MPPT readings are unavailable.'}, 503);

  try {
    const rpc = await fetch(platform + '/rest/v1/rpc/cos_vrm_mppt_read', {
      method: 'POST',
      headers: {'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json'},
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    if (!rpc.ok) throw Error('rpc');
    return reply(safeVrmMppt(await rpc.json()));
  } catch {
    return reply({error: 'Victron MPPT readings are unavailable.'}, 503);
  }
});
