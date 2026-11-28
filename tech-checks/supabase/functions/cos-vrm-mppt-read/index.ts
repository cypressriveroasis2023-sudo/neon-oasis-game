// cos-vrm-mppt-read: saved Victron MPPT readings for Helios units. Read-only.
//
// Same gate as cos-vrm-history: it does not authenticate anyone itself. It forwards the caller's own
// Authorization and Origin to the Operations function and asks the question the Victron Power page asks
// (GET /api/vrm-fleet). Only a 200 there lets readings through. Then it reads public.cos_vrm_mppt_read
// with the service role, which only that role may call. Nothing is written anywhere.
// It also returns each Helios's Field/Shop from mHelp's current list (public.cos_vrm_placement_read),
// because the saved equipment list does not hold every Helios, and each Helios's nightly battery capacity
// (public.cos_vrm_battery_health_read) for the battery health trend.
import {corsHeaders, gateVerdict, isHistoryRequest} from '../cos-vrm-history/history.ts';
import {safeVrmHealth, safeVrmMppt, safeVrmPlacement} from './read.ts';

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

  const call = (name: string) => fetch(platform + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json'},
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  try {
    // Field/Shop from mHelp's own list rides along. It is an extra: if it cannot be read, the charger
    // readings still go out and the page keeps the placement it already had.
    const [rpc, place, health] = await Promise.allSettled([call('cos_vrm_mppt_read'), call('cos_vrm_placement_read'), call('cos_vrm_battery_health_read')]);
    if (rpc.status !== 'fulfilled' || !rpc.value.ok) throw Error('rpc');
    const body = safeVrmMppt(await rpc.value.json());
    let placements: ReturnType<typeof safeVrmPlacement>['units'] | null = null;
    try { if (place.status === 'fulfilled' && place.value.ok) placements = safeVrmPlacement(await place.value.json()).units; } catch { placements = null; }
    let nights: ReturnType<typeof safeVrmHealth>['units'] | null = null;
    try { if (health.status === 'fulfilled' && health.value.ok) nights = safeVrmHealth(await health.value.json()).units; } catch { nights = null; }
    return reply({...body, placements, health: nights});
  } catch {
    return reply({error: 'Victron MPPT readings are unavailable.'}, 503);
  }
});
