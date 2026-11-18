import {createTicketCensusHandler} from './index.ts';
import {nativeMhelpTokens} from '../cos-operations-pages/mhelpTokenRuntime.ts';
import {readTicketCensus, type CensusCursor, type CensusRow} from './read.ts';

const NATIVE = 'https://tughscoxralhofrckvxy.supabase.co';
const tokens = nativeMhelpTokens(name => Deno.env.get(name));

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
  if (!key || Deno.env.get('SUPABASE_URL') !== NATIVE) throw new Error('Backend unavailable');
  return json(await fetch(NATIVE + '/rest/v1/rpc/' + name, {method: 'POST', headers: {apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'}, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000)}));
}

Deno.serve(createTicketCensusHandler({
  authenticate: async req => {
    if (Deno.env.get('SUPABASE_URL') !== NATIVE) return false;
    const secret = req.headers.get('x-camera-cron-secret');
    if (!secret || secret.length > 1024 || /\s/.test(secret)) return false;
    const value = await json(await fetch('https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-mhelp-readiness', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-camera-cron-secret': secret}, body: '{"action":"authenticate"}', redirect: 'error', signal: AbortSignal.timeout(10000)}), 128);
    return value.authenticated === true && Object.keys(value).length === 1;
  },
  run: async () => {
    const config = await tokens.getPartnerConfig();
    if (config.portalId !== '224643' || !config.accessToken) throw new Error('Source unavailable');
    const stored = await rpc('cos_mhelp_census_ticket_cursor', {p_action: 'read', p_cursor: null});
    const cursor = stored.cursor as CensusCursor;
    const equipment = await rpc('cos_mhelp_census_ticket_equipment', {p_offset: cursor.equipmentOrdinal || 0});
    const equipmentIds = Array.isArray(equipment.equipmentIds) ? equipment.equipmentIds.filter((id): id is string => typeof id === 'string') : [];
    return readTicketCensus({fetch: tokens.fetch, accessToken: config.accessToken, cursor, equipmentIds});
  },
  saveRows: (rows: CensusRow[]) => rpc('cos_mhelp_census_ticket_upsert', {p_rows: rows}),
  saveCursor: (cursor: CensusCursor) => rpc('cos_mhelp_census_ticket_cursor', {p_action: 'save', p_cursor: cursor}),
  status: () => rpc('cos_mhelp_census_ticket_cursor', {p_action: 'read', p_cursor: null}),
}));
