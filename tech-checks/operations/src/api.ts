import {IT_DAILY_ONLY} from '../../it-feature-availability';
import {reconcileFleetSnapshot,type FleetSnapshot} from './fleetSnapshot';
export type ApiResponse<T = any> = { data: T };
export class OperationsApiError extends Error {
  response: { status: number; data: { error: string } };
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'OperationsApiError';
    this.response = { status, data: { error: message } };
  }
}
const endpoint = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
type ParentSession = { token: string; role: string };
// Only reviewed snapshot routes may share a pending read. A logical GET alone
// is not enough: new routes can perform work or have independent-read semantics.
const sharedReadPaths = new Set([
  '/api/jobs', '/api/quotes', '/api/ar', '/api/purchasing', '/api/owner-tasks',
  '/api/field-map', '/api/routers', '/api/camera-health/summary-v3', '/api/vrm-portal', '/api/vrm-fleet',
]);
const pendingReads = new Map<string, Promise<ApiResponse>>();
const fleetSnapshots=new Map<string,{value:FleetSnapshot;at:number}>();
const pendingFleetSnapshots=new Map<string,Promise<FleetSnapshot>>();
let fleetRevision=0;
function clearSharedReads(){pendingReads.clear();fleetSnapshots.clear();pendingFleetSnapshots.clear();fleetRevision++;}
if(typeof window!=='undefined'){
 window.addEventListener?.('cos-private-data-invalidated',clearSharedReads);
 window.addEventListener?.('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')clearSharedReads();});
}
let tokenRequest: Promise<ParentSession> | null = null;
let lastVerifiedSession: ParentSession | null = null;
function requestParentToken(): Promise<ParentSession> {
  if (window.parent === window || location.origin === 'null') {
    return Promise.reject(new OperationsApiError('Open Operations from the Tech Check platform to use your existing account.', 401));
  }
  if (tokenRequest) return tokenRequest;
  const requestId = crypto.randomUUID();
  const request = new Promise<ParentSession>((resolve, reject) => {
    let timer = 0;
    const cleanup = () => { window.removeEventListener('message', receive); window.clearTimeout(timer); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.type !== 'COS_OPERATIONS_TOKEN_RESPONSE' || message.requestId !== requestId) return;
      cleanup();
      const queueMode = new URLSearchParams(location.search).get('mode') === 'production-assignments';
      if (!(queueMode ? ['it','service'].includes(message.role) : new URLSearchParams(location.search).get('mode') === 'fleet' ? message.role === 'it' : message.role === 'owner') || typeof message.accessToken !== 'string' || !message.accessToken.trim()) {
        reject(new OperationsApiError('Your existing Tech Check session is unavailable. Return to Tech Check and sign in again.', 401));
      } else {
        const session = { token: message.accessToken, role: message.role };
        if (lastVerifiedSession && (lastVerifiedSession.token !== session.token || lastVerifiedSession.role !== session.role)) {
          clearSharedReads();
          window.dispatchEvent?.(new Event('cos-private-data-invalidated'));
        }
        lastVerifiedSession = session;
        resolve(session);
      }
    };
    window.addEventListener('message', receive);
    timer = window.setTimeout(() => {
      cleanup();
      reject(new OperationsApiError('Operations could not verify the current Tech Check session. Return to the platform and refresh.', 401));
    }, 10000);
    window.parent.postMessage({ type: 'COS_OPERATIONS_TOKEN_REQUEST', requestId }, location.origin);
  });
  tokenRequest = request;
  void request.then(() => { if (tokenRequest === request) tokenRequest = null; }, () => { if (tokenRequest === request) tokenRequest = null; });
  return request;
}
export function permitsTechnicianRequest(method: string, path: string, body?: unknown): boolean {
  if (method === 'GET') return path.startsWith('/api/tech/');
  return method === 'POST' && /^\/api\/tech\/it-queue\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/claim$/i.test(path) &&
    (body == null || typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);
}
async function request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<ApiResponse<T>> {
  if (options?.signal?.aborted) throw new OperationsApiError('The read was cancelled.', 499);
  const mode = new URLSearchParams(location.search).get('mode');
  if (!/^\/api\/[a-zA-Z0-9_\-\/]+$/.test(path) && !(method === 'GET' && path === '/api/mhelpdesk/intake/status?capability=pending_schedule_v1')) throw new OperationsApiError('This Operations request is unavailable.', 400);
  if (mode === 'production-assignments' && !permitsTechnicianRequest(method, path, body)) throw new OperationsApiError('This assignment view permits technician reads and taking an available IT queue visit only.', 403);
  // Always verify the current parent session before consulting pending reads.
  // A path-only promise could otherwise expose a previous account's response.
  let session: ParentSession;
  try { session = await requestParentToken(); }
  catch (cause) { if (cause instanceof OperationsApiError && [401,403].includes(cause.response.status)) window.dispatchEvent?.(new Event('cos-private-data-invalidated')); throw cause; }
  if (options?.signal?.aborted) throw new OperationsApiError('The read was cancelled.', 499);
  if (mode !== new URLSearchParams(location.search).get('mode')) throw new OperationsApiError('The Operations view changed. Refresh to verify the current session.', 401);
  if (IT_DAILY_ONLY && session.role === 'it' && path.startsWith('/api/tech/') && path !== '/api/tech/session') throw new OperationsApiError('IT assignment workflows are paused until further notice.', 403);
  if (method === 'POST' && path.startsWith('/api/tech/') && session.role !== 'it') throw new OperationsApiError('Only an IT technician can take shared IT work.', 403);
  if (method === 'POST') {
    // Reads started before or during a save cannot satisfy its fresh readback.
    // Forget their lookup entries without cancelling their existing callers.
    clearSharedReads();
    try { return await sendRequest<T>(method, path, session.token, body, options?.signal); }
    finally { clearSharedReads(); }
  }
  if (!sharedReadPaths.has(path)) return sendRequest<T>(method, path, session.token, body);
  const key = JSON.stringify([session.token, session.role, mode, path]);
  const existing = pendingReads.get(key);
  if (existing) return existing;
  const pending = sendRequest<T>(method, path, session.token, body);
  pendingReads.set(key, pending);
  try { return await pending; }
  finally { if (pendingReads.get(key) === pending) pendingReads.delete(key); }
}
async function sendRequest<T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown, signal?: AbortSignal): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = window.setTimeout(() => controller.abort(), 30000);
  try {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, method, body: body ?? null }),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (cause) {
      throw new OperationsApiError(method === 'POST'
        ? 'The save could not be confirmed. Refresh this workspace before trying again.'
        : 'Operations could not connect. Retry to verify the current records.', 503);
    }
    if (!response.ok && [401,403].includes(response.status)) window.dispatchEvent?.(new Event('cos-private-data-invalidated'));
    let data: any;
    try { data = await response.json(); } catch { throw new OperationsApiError('Operations returned an incomplete response. Please refresh.', response.status || 503); }
    if (!response.ok) throw new OperationsApiError(typeof data?.error === 'string' ? data.error : 'Operations request failed.', response.status);
    return { data };
  } finally { window.clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown, options?: { signal?: AbortSignal }) => request<T>('POST', path, body, options),
  fleet: async(force=false):Promise<FleetSnapshot>=>{
    const mode=new URLSearchParams(location.search).get('mode');
    if(mode==='production-assignments')throw new OperationsApiError('Open Camera Health from your fleet dashboard.',403);
    // Re-authorize the parent before using even a cached snapshot.
    let session:ParentSession;try{session=await requestParentToken();}catch(cause){clearSharedReads();window.dispatchEvent?.(new Event('cos-private-data-invalidated'));throw cause;}
    if(mode!==new URLSearchParams(location.search).get('mode'))throw new OperationsApiError('The fleet view changed. Reload your session.',401);
    const key=JSON.stringify([session.token,session.role,mode]);
    if(force&&!pendingFleetSnapshots.has(key))clearSharedReads();
    const saved=fleetSnapshots.get(key);if(saved&&Date.now()-saved.at<15*60*1000)return saved.value;
    const pending=pendingFleetSnapshots.get(key);if(pending)return pending;
    const revision=fleetRevision;
    const read=Promise.all([sendRequest('GET','/api/camera-health/summary-v3',session.token),sendRequest('GET','/api/field-map',session.token)]).then(([health,map])=>{
      if(revision!==fleetRevision||lastVerifiedSession?.token!==session.token||mode!==new URLSearchParams(location.search).get('mode'))throw new OperationsApiError('Your fleet session or records changed. Reload the shared view.',409);
      const value=reconcileFleetSnapshot(health.data,map.data);fleetSnapshots.set(key,{value,at:Date.now()});window.dispatchEvent?.(new Event('cos-fleet-snapshot-updated'));return value;
    }).finally(()=>{if(pendingFleetSnapshots.get(key)===read)pendingFleetSnapshots.delete(key);});
    pendingFleetSnapshots.set(key,read);return read;
  },
};
const legacyRoutes = new Set(['today', 'calendar', 'attention', 'review', 'assign', 'team', 'units', 'handoffs', 'history', 'activity', 'accounts', 'more', 'testcenter', 'it', 'service', 'vision', 'camera-health', 'logout', 'operations', 'production-return']);
export function openLegacy(route: string) {
  if (!legacyRoutes.has(route) || window.parent === window || location.origin === 'null') return;
  window.parent.postMessage({ type: 'COS_OPERATIONS_NAVIGATE', route }, location.origin);
}
