import {assessSimCancel} from './simCancelRules.mjs';

const LEGACY_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LEGACY_PUBLISHABLE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';
const ORGANIZATION_ID = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGINS = new Set([
  'https://cypressriveroasis2023-sudo.github.io',
  'https://cos-vision-integration-preview.pages.dev',
]);
const OWNER_LINKS = Object.freeze({
  'e4abc521-1ef3-45a6-9829-b87faff78210': '3f073784-96e7-43d8-b9e0-33ab31c3c8b1',
});
const TECHNICIAN_LINKS = Object.freeze({
  '4f7044b5-86b6-411f-8898-39bb64b4ddbc': { actorId: 'd0757b64-9623-4adc-afff-21cc7853e88a', name: 'Teddy Hopper', department: 'it', roleCode: 'it_technician' },
  'b7cc3cbf-d11e-4d4a-9742-c07701857911': { actorId: '3caf7c00-627f-445f-bce4-ddeae574ee5c', name: 'Victor Garcia', department: 'it', roleCode: 'it_technician' },
  '05bf20fe-19f7-4db7-ac05-5b2a5f681fdf': { actorId: 'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7', name: 'Test IT', department: 'it', roleCode: 'it_technician' },
  '78e54fbd-c2db-4d18-8e3d-a9740adcf285': { actorId: '7b3b8561-5dc1-46ff-8cdd-129ce2a2afb8', name: 'Abel Cervantes', department: 'service', roleCode: 'service_technician' },
  '49dce28e-099a-40bb-a8d8-b39f9ffbabee': { actorId: '1a7d3523-8a3c-488a-9216-4e37f4f7ecb9', name: 'Josh Mireles', department: 'service', roleCode: 'service_technician' },
});
const SAVED = 'The SIM step could not be saved.';
const CONFLICT = 'This return already has a different SIM record.';

function cors(request) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const origin = request.headers.get('Origin');
  if (origin && ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function reply(request, body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: cors(request)});
}

function same(left, right) {
  return (left ?? null) === (right ?? null);
}

function sameDay(left, right) {
  const day = value => value == null || value === '' ? null : String(value).slice(0, 10);
  return day(left) === day(right);
}

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

export function simRowMatches(existing, intended) {
  return same(existing?.product_id, intended.product_id)
    && same(existing?.unit_number, intended.unit_number)
    && same(existing?.outcome, intended.outcome)
    && same(existing?.carrier, intended.carrier)
    && sameDay(existing?.canceled_on, intended.canceled_on)
    && same(existing?.canceled_by, intended.canceled_by)
    && same(existing?.confirmation, intended.confirmation)
    && same(existing?.sim_number, intended.sim_number)
    && same(existing?.no_sim_reason, intended.no_sim_reason)
    && sameId(existing?.recorded_by, intended.recorded_by)
    && sameId(existing?.return_id, intended.return_id);
}

export function createSimCancelHandler({platformUrl, serviceKey, fetch: requestFetch = fetch}) {
  const platformHeaders = () => ({
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
    const origin = request.headers.get('Origin');
    if (!origin || !ORIGINS.has(origin)) return reply(request, {error: 'This origin is not allowed.'}, 403);
    if (request.method !== 'POST') return reply(request, {error: 'Use POST to save the SIM step.'}, 405);
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) return reply(request, {error: 'Sign in to Tech Check to continue.'}, 401);
    let platformHost = '';
    try { platformHost = new URL(platformUrl).hostname; } catch { platformHost = ''; }
    if (platformHost === 'goqrnolcvqnirjmzaeyk.supabase.co' || !serviceKey) return reply(request, {error: SAVED}, 503);
    const legacyHeaders = {apikey: LEGACY_PUBLISHABLE_KEY, Authorization: authorization, Accept: 'application/json'};
    let user;
    try {
      const userResponse = await requestFetch(LEGACY_URL + '/auth/v1/user', {headers: legacyHeaders, redirect: 'error', cache: 'no-store'});
      if (!userResponse.ok) return reply(request, {error: 'Your sign-in has expired. Sign in again.'}, 401);
      user = await userResponse.json();
    } catch {
      return reply(request, {error: SAVED}, 503);
    }
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) return reply(request, {error: 'A verified Tech Check account is required.'}, 401);
    let profile;
    try {
      const profileResponse = await requestFetch(LEGACY_URL + '/rest/v1/profiles?select=user_id,full_name,role,active,archived_at&user_id=eq.' + user.id + '&limit=1', {headers: legacyHeaders, redirect: 'error', cache: 'no-store'});
      if (!profileResponse.ok) return reply(request, {error: SAVED}, 503);
      const profiles = await profileResponse.json();
      profile = Array.isArray(profiles) ? profiles[0] : null;
    } catch {
      return reply(request, {error: SAVED}, 503);
    }
    if (!profile || profile.user_id !== user.id || !['owner', 'it'].includes(profile.role) || profile.active !== true || profile.archived_at) return reply(request, {error: 'An active IT account is required.'}, 403);
    const legacyOwner = profile.role === 'owner';
    const link = legacyOwner ? null : TECHNICIAN_LINKS[user.id.toLowerCase()];
    const actorId = legacyOwner ? OWNER_LINKS[user.id.toLowerCase()] : link?.actorId;
    if (!actorId) return reply(request, {error: 'An active IT account is required.'}, 403);
    if (link && (profile.role !== link.department || String(profile.full_name || '').trim().toLowerCase() !== link.name.toLowerCase())) return reply(request, {error: 'Your linked technician identity details have changed. Ask an Owner to review the link.'}, 403);
    const roleCode = legacyOwner ? 'owner' : link.roleCode;
    try {
      const actorResponse = await requestFetch(platformUrl + '/rest/v1/user_profiles?select=user_id,display_name,active,department&organization_id=eq.' + ORGANIZATION_ID + '&user_id=eq.' + actorId + '&limit=1', {headers: platformHeaders(), redirect: 'error', cache: 'no-store'});
      if (!actorResponse.ok) return reply(request, {error: SAVED}, 503);
      const actors = await actorResponse.json();
      const actor = Array.isArray(actors) ? actors[0] : null;
      const expectedDepartment = legacyOwner ? 'owner' : link.department;
      if (!actor || actor.user_id !== actorId || actor.active !== true || actor.department !== expectedDepartment) return reply(request, {error: 'Your linked COS production account is inactive or has a different department.'}, 403);
      if (link && String(actor.display_name || '').trim().toLowerCase() !== link.name.toLowerCase()) return reply(request, {error: 'Your linked production technician identity details have changed.'}, 403);
      const roleResponse = await requestFetch(platformUrl + '/rest/v1/user_roles?select=role_id,roles!inner(code,organization_id)&user_id=eq.' + actorId + '&roles.organization_id=eq.' + ORGANIZATION_ID + '&roles.code=eq.' + roleCode + '&limit=1', {headers: platformHeaders(), redirect: 'error', cache: 'no-store'});
      if (!roleResponse.ok) return reply(request, {error: SAVED}, 503);
      const roles = await roleResponse.json();
      if (!Array.isArray(roles) || !roles.some(row => row.roles?.code === roleCode && row.roles?.organization_id === ORGANIZATION_ID)) return reply(request, {error: 'Your linked COS production role is not active.'}, 403);
    } catch {
      return reply(request, {error: SAVED}, 503);
    }
    let body;
    try { body = await request.json(); } catch { return reply(request, {error: 'This cancellation is not complete.'}, 400); }
    const gate = assessSimCancel(body);
    if (!gate.ok) return reply(request, {error: gate.error}, 400);
    const returnId = typeof body?.returnId === 'string' ? body.returnId : '';
    if (!UUID.test(returnId)) return reply(request, {error: 'This cancellation is not complete.'}, 400);
    const row = gate.record;
    const intended = {
      product_id: row.productId,
      unit_number: row.unit,
      outcome: row.outcome,
      carrier: row.carrier,
      canceled_on: row.canceledOn,
      canceled_by: row.canceledBy,
      confirmation: row.confirmation,
      sim_number: row.simNumber,
      no_sim_reason: row.noSimReason,
      recorded_by: actorId,
      return_id: returnId.toLowerCase(),
    };
    let response;
    try {
      response = await requestFetch(platformUrl + '/rest/v1/cos_sim_cancel_records', {
        method: 'POST',
        headers: {...platformHeaders(), Prefer: 'return=minimal'},
        body: JSON.stringify(intended),
        redirect: 'error',
        cache: 'no-store',
      });
    } catch {
      return reply(request, {error: SAVED}, 503);
    }
    if (response.status === 201 || response.status === 204) return reply(request, {ok: true});
    let code = '';
    try {
      const data = await response.clone().json();
      code = data && typeof data.code === 'string' ? data.code : '';
    } catch { /* The database body is not returned. */ }
    if (code !== '23505' && response.status !== 409) return reply(request, {error: SAVED}, 503);
    let existing;
    try {
      const read = await requestFetch(platformUrl + '/rest/v1/cos_sim_cancel_records?select=product_id,unit_number,outcome,carrier,canceled_on,canceled_by,confirmation,sim_number,no_sim_reason,recorded_by,return_id&product_id=eq.' + encodeURIComponent(intended.product_id) + '&return_id=eq.' + intended.return_id + '&limit=2', {
        headers: platformHeaders(),
        redirect: 'error',
        cache: 'no-store',
      });
      if (!read.ok) return reply(request, {error: SAVED}, 503);
      const rows = await read.json();
      existing = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    } catch {
      return reply(request, {error: SAVED}, 503);
    }
    if (existing && simRowMatches(existing, intended)) return reply(request, {ok: true});
    return reply(request, {error: CONFLICT}, 409);
  };
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(createSimCancelHandler({
    platformUrl: Deno.env.get('SUPABASE_URL'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    fetch,
  }));
}
