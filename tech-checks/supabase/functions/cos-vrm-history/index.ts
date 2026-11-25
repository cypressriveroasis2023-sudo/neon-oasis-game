// cos-vrm-history: saved Victron battery history for Helios units. Read-only.
//
// Deliberately small and standalone. It does not authenticate anyone itself: it forwards the caller's own
// Authorization and Origin to the Operations function and asks the same question the Victron Power page asks
// (GET /api/vrm-fleet). Only a 200 there lets history through. Then it reads public.cos_vrm_power_history
// with the service role, which only that role may call. Nothing is written anywhere.
import {corsHeaders, gateVerdict, HISTORY_HOURS, isHistoryRequest, safeVrmHistory} from './history.ts';

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
  if (!isHistoryRequest(text)) return reply({error: 'The history request could not be read.'}, 400);
  const authorization = request.headers.get('Authorization');
  if (!authorization || !platform || !serviceKey) return reply({error: 'Victron history is unavailable.'}, authorization ? 503 : 401);

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
  // The same refusal Operations gave, so the app treats it exactly as it would treat Operations.
  if (verdict === 'denied') return reply({error: 'Victron history is not available for this sign-in.'}, gateStatus);
  if (verdict !== 'allow') return reply({error: 'Victron history is unavailable.'}, 503);

  try {
    const rpc = await fetch(platform + '/rest/v1/rpc/cos_vrm_power_history', {
      method: 'POST',
      headers: {'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({p_hours: HISTORY_HOURS}),
      signal: AbortSignal.timeout(15000),
    });
    if (!rpc.ok) throw Error('rpc');
    return reply(safeVrmHistory(await rpc.json()));
  } catch {
    return reply({error: 'Victron history is unavailable.'}, 503);
  }
});
