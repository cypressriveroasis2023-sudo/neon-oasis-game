import {powerAlarmActor} from './access.ts';

const LEGACY_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LEGACY_PUBLISHABLE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const ORIGINS = new Set([
  'https://cypressriveroasis2023-sudo.github.io',
  'https://cos-vision-integration-preview.pages.dev',
]);

function cors(request: Request): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const origin = request.headers.get('Origin');
  if (origin && ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function reply(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: cors(request)});
}

function numberOrNull(value: unknown, min: number, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('range');
  }
  return value;
}

async function legacyProfile(token: string) {
  const headers = {apikey: LEGACY_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token, Accept: 'application/json'};
  const userResponse = await fetch(LEGACY_URL + '/auth/v1/user', {headers});
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  if (!user || typeof user.id !== 'string') return null;
  const profileResponse = await fetch(
    LEGACY_URL + '/rest/v1/profiles?select=user_id,role,active,archived_at&user_id=eq.' + user.id + '&limit=1',
    {headers},
  );
  if (!profileResponse.ok) return null;
  const profiles = await profileResponse.json();
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || profile.user_id !== user.id || profile.archived_at) return null;
  return {id: user.id, role: profile.role, active: profile.active === true};
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return reply(request, {error: 'Use POST.'}, 405);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 8192) return reply(request, {error: 'Sign in to Tech Check to continue.'}, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return reply(request, {error: 'The settings request could not be read.'}, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(request, {error: 'The settings request could not be read.'}, 400);
  const action = (body as {action?: unknown}).action;
  if (action !== 'read' && action !== 'write') return reply(request, {error: 'The settings request could not be read.'}, 400);
  const profile = await legacyProfile(token);
  const actor = profile ? powerAlarmActor(profile) : null;
  if (!actor) return reply(request, {error: 'An active COS account is required.'}, 403);
  if (action === 'write' && !actor.canWrite) return reply(request, {error: 'An active COS Owner or verified IT account is required.'}, 403);
  let settings = {lowVoltageV: null as number | null, lowSocPercent: null as number | null, silentHours: null as number | null};
  if (action === 'write') {
    try {
      const raw = body as {lowVoltageV?: unknown; lowSocPercent?: unknown; silentHours?: unknown};
      settings = {
        lowVoltageV: numberOrNull(raw.lowVoltageV ?? null, 0, 80),
        lowSocPercent: numberOrNull(raw.lowSocPercent ?? null, 0, 100),
        silentHours: numberOrNull(raw.silentHours ?? null, 1, 168),
      };
    } catch {
      return reply(request, {error: 'A threshold is out of range. Leave it empty to keep it unset.'}, 400);
    }
  }
  const platformUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!platformUrl || !serviceKey) return reply(request, {error: 'Shared power settings are unavailable.'}, 503);
  const response = await fetch(platformUrl + '/rest/v1/rpc/cos_power_alarm_settings_for_actor', {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      p_actor: actor.actorId,
      p_write: action === 'write',
      p_low_voltage: settings.lowVoltageV,
      p_low_soc: settings.lowSocPercent,
      p_silent: settings.silentHours,
    }),
  });
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 403 : 503;
    return reply(request, {error: status === 403 ? 'An active COS Owner or verified IT account is required.' : 'Shared power settings are unavailable.'}, status);
  }
  const saved = await response.json();
  return reply(request, {
    lowVoltageV: saved?.lowVoltageV ?? null,
    lowSocPercent: saved?.lowSocPercent ?? null,
    silentHours: saved?.silentHours ?? null,
    canWrite: actor.canWrite,
  });
});
