import {createInhandRouterStatusHandler} from './serve.ts';

// Same publishable key already committed for cos-power-alarm-settings. Not a new secret.
const LEGACY_URL = 'https://goqrnolcvqnirjmzaeyk.supabase.co';
const LEGACY_PUBLISHABLE_KEY = 'sb_publishable__URX6fCOr6KVvGsUsGS7wA_a1AmU7Rw';

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

Deno.serve(createInhandRouterStatusHandler({
  enabled: () => Deno.env.get('COS_INHAND_ROUTER_STATUS_ENABLED') === 'true',
  platformUrl: () => Deno.env.get('SUPABASE_URL'),
  serviceKey: () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  identify: legacyProfile,
}));
