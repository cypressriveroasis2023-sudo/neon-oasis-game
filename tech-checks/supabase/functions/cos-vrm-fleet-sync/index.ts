import { createVrmFleetReader } from '../cos-operations-pages/vrmDiscovery.ts';

type Options = { platformUrl: string; serviceKey: string; getAccessToken: () => string | undefined; fetch?: typeof fetch };
export function createVrmScheduledHandler(options: Options) {
  const fetcher = options.fetch || fetch;
  const rpc = async (name: string, payload: Record<string,unknown>): Promise<unknown> => {
    const response = await fetcher(options.platformUrl + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: options.serviceKey, Authorization: 'Bearer ' + options.serviceKey, 'Content-Type':'application/json' },
      body: JSON.stringify(payload), redirect:'error', signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Registry unavailable');
    return response.json();
  };
  const sync = createVrmFleetReader({fetch:fetcher,rpc,getAccessToken:options.getAccessToken});
  return async (request: Request): Promise<Response> => {
    const reply = (data: unknown,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
    if (request.method !== 'POST' || new URL(request.url).search || request.headers.has('origin')) return reply({error:'Scheduled request required'},405);
    const secret = request.headers.get('x-cos-vrm-sync');
    if (!secret || !/^[0-9a-f]{64}$/.test(secret)) return reply({error:'Unauthorized'},401);
    try {
      if (await rpc('cos_vrm_scheduler_authorized',{p_secret:secret}) !== true) return reply({error:'Unauthorized'},401);
      if (Number(request.headers.get('content-length')) > 128) return reply({error:'Invalid request'},400);
      const result = await sync(true);
      // Scheduled callers receive no installation names, portal links, account details, or credentials.
      return reply({ok: result.sync.state === 'current', state:result.sync.state, lastSuccessAt:result.sync.lastSuccessAt}, result.sync.state === 'current' || result.sync.state === 'syncing' ? 200 : 503);
    } catch { return reply({error:'Fleet sync unavailable'},503); }
  };
}
