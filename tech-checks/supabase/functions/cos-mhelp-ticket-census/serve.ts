/// <reference path="./deno.d.ts" />
import {createTicketCensusHandler} from './index.ts';
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
import {readTicketCensus, type CensusCursor, type CensusRow} from './read.ts';

// The data project comes from SUPABASE_URL. The readiness host is the existing
// cron authenticator used by the inventory worker; it is a different project
// and is not a ticket or customer endpoint.
const READINESS = 'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness';
const tokens = nativeMhelpTokens(name => Deno.env.get(name));

function projectUrl(): string {
  const url = Deno.env.get('SUPABASE_URL') || '';
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) throw new Error('Backend unavailable');
  return url;
}
async function json(response: Response, max = 65536): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) throw new Error('Read unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  let raw = '', bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) throw new Error('Read unavailable');
      raw += decoder.decode(chunk.value, {stream: true});
    }
    const value = JSON.parse(raw + decoder.decode());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Read unavailable');
    return value as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => undefined); }
}
async function rpc(name: string, body: unknown) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const base = projectUrl();
  if (!key) throw new Error('Backend unavailable');
  return json(await fetch(base + '/rest/v1/rpc/' + name, {method: 'POST', headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'}, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000)}));
}
function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

Deno.serve(createTicketCensusHandler({
  authenticate: async req => {
    try { projectUrl(); } catch { return false; }
    const secret = req.headers.get('x-camera-cron-secret');
    if (!secret || secret.length > 1024 || /\s/.test(secret)) return false;
    const value = await json(await fetch(READINESS, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret}, body: '{"action":"authenticate"}', redirect: 'error', signal: AbortSignal.timeout(10000)}), 128);
    return value.authenticated === true && Object.keys(value).length === 1;
  },
  run: async persist => {
    const config = await tokens.getPartnerConfig();
    if (typeof config.portalId !== 'string' || !/^[1-9][0-9]{0,14}$/.test(config.portalId) || !config.accessToken) throw new Error('Source unavailable');
    const stored = await rpc('cos_mhelp_census_ticket_cursor', {p_action: 'read', p_cursor: null});
    const cursor = stored.cursor as CensusCursor;
    const equipment = await rpc('cos_mhelp_census_ticket_equipment', {p_offset: cursor.equipmentOrdinal || 0});
    const refresh = await rpc('cos_mhelp_census_ticket_refresh', {p_limit: 4});
    return readTicketCensus({
      fetch: tokens.fetch, accessToken: config.accessToken, portalId: config.portalId, cursor,
      equipmentIds: ids(equipment.equipmentIds), refreshTicketIds: ids(refresh.ticketIds),
      onProgress: persist,
      onMissingTicket: async ticketId => { await rpc('cos_mhelp_census_ticket_touch', {p_ticket_id: ticketId}); },
    });
  },
  saveRows: (rows: CensusRow[]) => rpc('cos_mhelp_census_ticket_upsert', {p_rows: rows}),
  saveCursor: (cursor: CensusCursor) => rpc('cos_mhelp_census_ticket_cursor', {p_action: 'save', p_cursor: cursor}),
  status: () => rpc('cos_mhelp_census_ticket_cursor', {p_action: 'read', p_cursor: null}),
}));
