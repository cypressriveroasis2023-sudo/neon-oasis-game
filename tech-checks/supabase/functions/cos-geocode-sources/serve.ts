import { createGeocodeSourcesHandler } from './index.ts';
// Deploy with verify_jwt=false: this handler validates its dedicated read key.
// Secrets are project-global. The existing native service key stays in this project.
const url = Deno.env.get('SUPABASE_URL');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(createGeocodeSourcesHandler({
  readKey: Deno.env.get('COS_GEOCODE_SOURCE_READ_KEY'),
  rpc: async (name, args) => {
    if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !service) throw Error('Backend unavailable');
    const response = await fetch(url + '/rest/v1/rpc/' + name, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    if (!response.ok) throw Error('Backend unavailable');
    const reader = response.body?.getReader(); if (!reader) throw Error('Backend unavailable');
    let bytes = 0, raw = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength;
      if (bytes > 262144) throw Error('Backend unavailable'); raw += decoder.decode(next.value, { stream: true }); }
      raw += decoder.decode(); return JSON.parse(raw);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  },
}));
