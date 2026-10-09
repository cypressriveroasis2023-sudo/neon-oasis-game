import {archiveReconPayload, needsReconArchive} from '../_shared/reconEventArchive.ts';
type Dependencies = {createClient: (...args: any[]) => any; url: string; serviceKey: string; now?: () => number};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
export function createEventArchiveHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return reply({error: 'POST required'}, 405);
    const now = deps.now || Date.now, started = now();
    const db = deps.createClient(deps.url, deps.serviceKey, {global: {fetch: (input: any, init: any = {}) => fetch(input, {...init, signal: AbortSignal.any([
      ...(init.signal ? [init.signal] : []), AbortSignal.timeout(Math.max(1, Math.min(15000, started + 48_000 - now())))
    ])})}});
    const {data: valid, error: authError} = await db.rpc('verify_camera_health_cron_secret', {candidate: req.headers.get('x-camera-cron-secret')});
    if (authError || valid !== true) return reply({error: 'Forbidden'}, 403);
    const body = await req.json().catch(() => null);
    if (!body || Object.keys(body).some(k => k !== 'ids') || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 25
      || body.ids.some((id: unknown) => typeof id !== 'string' || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
      || new Set(body.ids).size !== body.ids.length) return reply({error: 'Provide 1–25 unique event IDs.'}, 400);
    const {data: rows, error} = await db.from('camera_integration_events').select('id,payload').eq('provider', 'reconeyez').in('id', body.ids).limit(25);
    if (error || !Array.isArray(rows)) return reply({error: 'Event archive source is unavailable.'}, 503);
    let cursor = 0, archived = 0, unchanged = 0, deferred = 0, failed = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        if (now() + 9000 >= started + 48_000) { deferred++; continue; }
        if (!needsReconArchive(row.payload)) { unchanged++; continue; }
        try {
          const compact = await archiveReconPayload(db, row.payload);
          if (compact === row.payload) { failed++; continue; }
          const {data: committed, error: commitError} = await db.rpc('cos_archive_camera_event_v1', {p_id: row.id, p_expected: row.payload, p_archived: compact});
          if (commitError || committed !== true) failed++; else archived++;
        } catch { failed++; }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return reply({ok: failed === 0, requested: body.ids.length, found: rows.length, archived, unchanged, deferred, failed});
  };
}
