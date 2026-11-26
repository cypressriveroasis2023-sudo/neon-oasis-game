// cos-router-details: InHand router facts for the COS unit card, and the Link router button.
//
// Small and standalone, on Tech Check (where camera_unit_routers lives). It checks the caller's own Tech Check
// sign-in and profile: active Owner or IT only. Read returns public.cos_router_details_v1(); link calls
// public.cos_router_link_v1(), which writes one audited ADD_ROUTER_LINK row; trend returns public.cos_router_trend_v1(unit)
// (7 days of signal for one unit's card). Nothing is ever sent to InHand.
import { allowed, readRequest, type Profile } from './rules.ts';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ORIGINS = new Set(['https://cypressriveroasis2023-sudo.github.io', 'https://cos-vision-integration-preview.pages.dev']);

function headers(request: Request): Headers {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const origin = request.headers.get('Origin');
  if (origin && ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Headers', 'authorization, content-type');
    h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    h.set('Vary', 'Origin');
  }
  return h;
}
const reply = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(request) });

async function profileOf(token: string): Promise<Profile | null> {
  const user = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: ANON || SERVICE, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
  if (!user.ok) return null;
  const u = await user.json();
  if (!u || typeof u.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(u.id)) return null;
  const rows = await fetch(URL_ + '/rest/v1/profiles?select=user_id,full_name,role,active,archived_at&user_id=eq.' + u.id + '&limit=1',
    { headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE }, signal: AbortSignal.timeout(10000) });
  if (!rows.ok) return null;
  const list = await rows.json(), p = Array.isArray(list) ? list[0] : null;
  if (!p || p.user_id !== u.id || p.archived_at) return null;
  return { id: u.id, name: typeof p.full_name === 'string' ? p.full_name : '', role: String(p.role || ''), active: p.active === true };
}

async function rpc(name: string, args: unknown) {
  const r = await fetch(URL_ + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Error('rpc');
  return r.json();
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
  if (request.method !== 'POST') return reply(request, { error: 'Use POST.' }, 405);
  if (!URL_ || !SERVICE) return reply(request, { error: 'Router details are unavailable.' }, 503);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 8192) return reply(request, { error: 'Sign in to COS to continue.' }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return reply(request, { error: 'The request could not be read.' }, 400); }
  const ask = readRequest(body);
  if (!ask) return reply(request, { error: 'The request could not be read.' }, 400);
  let profile: Profile | null = null;
  try { profile = await profileOf(token); } catch { return reply(request, { error: 'Your sign-in could not be checked.' }, 503); }
  if (!allowed(profile)) return reply(request, { error: 'Router details are for COS Owner and IT accounts.' }, 403);
  try {
    if (ask.action === 'read') return reply(request, await rpc('cos_router_details_v1', {}));
    if (ask.action === 'trend') return reply(request, await rpc('cos_router_trend_v1', { p_unit_key: ask.unit }));
    const result = await rpc('cos_router_link_v1', {
      p_unit_key: ask.unit, p_serial: ask.serial, p_actor_id: profile!.id,
      p_actor_name: (profile!.name || 'COS user') + ' (' + (profile!.role === 'owner' ? 'Owner' : 'IT') + ', Link router button)',
      p_reason: 'Linked InHand router ' + ask.serial + ' to ' + ask.unit + ' with the Link router button in COS.',
    });
    return reply(request, result, result && result.ok ? 200 : 409);
  } catch {
    return reply(request, { error: 'Router details are unavailable right now.' }, 503);
  }
});
