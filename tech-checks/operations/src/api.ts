import {IT_DAILY_ONLY} from '../../it-feature-availability';
import {reconcileFleetSnapshot,type FleetSnapshot} from './fleetSnapshot';
import {validateCameraHealth} from './fieldCameraHealth';
import {checkedFieldMap} from './gpsPersistence';
import {CAMERA_AUTO_REFRESH_MS} from './refreshCadence';
import {readExactProductConnections} from './exactProductConnection';
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
type FleetReads={health:Promise<FleetSnapshot['health']>;fieldMap:Promise<FleetSnapshot['fieldMap']>;paired:Promise<FleetSnapshot>};
const pendingFleetSnapshots=new Map<string,FleetReads>();
let fleetRevision=0,privateSessionRevision=0;
// Reasons contain no token or identity. Missing/unknown reasons remain hard stops.
function invalidatePrivateData(reason:'token-renewed'|'parent-timeout'|'authentication-denied'|'security-hide') {
 window.dispatchEvent?.(Object.assign(new Event('cos-private-data-invalidated'),{detail:{reason}}));
}
function clearSharedReads(){pendingReads.clear();fleetSnapshots.clear();pendingFleetSnapshots.clear();fleetRevision++;}
if(typeof window!=='undefined'){
 window.addEventListener?.('cos-private-data-invalidated',()=>{privateSessionRevision++;clearSharedReads();});
 window.addEventListener?.('pagehide',()=>{privateSessionRevision++;clearSharedReads();});
 window.addEventListener?.('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'){privateSessionRevision++;clearSharedReads();}});
}
let tokenRequest: Promise<ParentSession> | null = null;
let lastVerifiedSession: ParentSession | null = null;
function requestParentToken(): Promise<ParentSession> {
  if (window.parent === window || location.origin === 'null') {
    invalidatePrivateData('authentication-denied');
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
        invalidatePrivateData('authentication-denied');
        reject(new OperationsApiError('Your existing Tech Check session is unavailable. Return to Tech Check and sign in again.', 401));
      } else {
        const session = { token: message.accessToken, role: message.role };
        if (lastVerifiedSession && (lastVerifiedSession.token !== session.token || lastVerifiedSession.role !== session.role)) {
          clearSharedReads();
          // A changed bearer is only a recovery candidate, never proof of the same actor.
          invalidatePrivateData(lastVerifiedSession.role === session.role ? 'token-renewed' : 'authentication-denied');
        }
        lastVerifiedSession = session;
        resolve(session);
      }
    };
    window.addEventListener('message', receive);
    timer = window.setTimeout(() => {
      cleanup();
      invalidatePrivateData('parent-timeout');
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
  const sessionRevision = privateSessionRevision;
  const session = await requestParentToken();
  // A write still waiting for authorization belongs to its original private view.
  // Revalidation may start fresh reads, never submit that old unsent intent.
  if (method === 'POST' && sessionRevision !== privateSessionRevision) throw new OperationsApiError('Your session changed before the save. Reload COS Operations before trying again.', 401);
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
  const sessionRevision = privateSessionRevision;
  const sessionMode = location.search;
  const obsolete = () => sessionRevision !== privateSessionRevision || token !== lastVerifiedSession?.token || sessionMode !== location.search;
  const ownerAction = method === 'POST' && /^\/api\/field-map\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/owner-census-(prepare|once)$/.test(path);
  const preparation = ownerAction && path.endsWith('/owner-census-prepare');
  // Saved map reads can exceed 30s. Owner actions have a75s native admission
  // bound including authentication. These are observation limits, never retry grants.
  const connectionCheck = method === 'POST' && /^\/api\/camera-health\/devices\/[0-9]+\/check$/.test(path);
  const timeoutMs = connectionCheck ? 60000 : ownerAction ? 120000 : method === 'GET' && path === '/api/field-map' ? 90000 : 30000;
  const controller = new AbortController();
  let abortKind: 'timeout' | 'cancelled' | null = null;
  const cancel = () => { abortKind ??= 'cancelled'; controller.abort(); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = window.setTimeout(() => { abortKind ??= 'timeout'; controller.abort(); }, timeoutMs);
  const preparationFailure = (category: 'timeout' | 'auth' | 'source_hold' | 'upstream_failure' | 'cancelled', status = 503) =>
    Object.assign(new OperationsApiError('Approved lookup preparation could not be confirmed.', status), { preparationFailure: category });
  const requireCurrent = () => {
    if (!obsolete()) return;
    if (preparation) throw preparationFailure('auth', 409);
    throw new OperationsApiError(method === 'POST'
      ? 'The save could not be confirmed. Refresh this workspace before trying again.'
      : 'Your session changed. Reload the shared view.', method === 'POST' ? 503 : 409);
  };
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
      if (preparation) throw preparationFailure(abortKind || 'upstream_failure');
      throw new OperationsApiError(connectionCheck ? 'The connection check could not be completed. No new result is confirmed.' : method === 'POST'
        ? 'The save could not be confirmed. Refresh this workspace before trying again.'
        : 'Operations could not connect. Retry to verify the current records.', 503);
    }
    // An obsolete request still fails, but cannot revoke a newer session. No
    // data (including a late successful body) may cross this private-view fence.
    if (obsolete()) { void response.body?.cancel().catch(() => {}); requireCurrent(); }
    const authenticationDenied = !response.ok && [401,403].includes(response.status);
    if (authenticationDenied) invalidatePrivateData('authentication-denied');
    if (preparation && !response.ok) {
      // Only bounded categories escape this read-only path; do not parse or expose raw errors.
      void response.body?.cancel().catch(() => {});
      throw preparationFailure([401,403].includes(response.status) ? 'auth' : response.status === 409 ? 'source_hold' : [408,504].includes(response.status) ? 'timeout' : 'upstream_failure', response.status);
    }
    let data: any;
    try { data = await response.json(); } catch {
      if (preparation) throw preparationFailure(abortKind || 'upstream_failure');
      throw new OperationsApiError('Operations returned an incomplete response. Please refresh.', response.status || 503);
    }
    if (!authenticationDenied) requireCurrent();
    if (ownerAction && abortKind) {
      if (preparation) throw preparationFailure(abortKind);
      throw new OperationsApiError('The save could not be confirmed. Refresh this workspace before trying again.', 503);
    }
    if (!response.ok) throw new OperationsApiError(typeof data?.error === 'string' ? data.error : 'Operations request failed.', response.status);
    return { data };
  } finally { window.clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
/** Dashboard sources can settle separately; complete views still require the pair.
 * Every source completion carries the same actor and invalidation checks. */
async function readFleet(force=false,onSaved?:(snapshot:FleetSnapshot)=>void):Promise<FleetReads>{
    // Match the camera hook's attempt clock, including parent-auth and response
    // latency. Dating the cache at completion can skip the next scheduled read.
    const requestedAt=Date.now();
    const mode=new URLSearchParams(location.search).get('mode');
    if(mode==='production-assignments')throw new OperationsApiError('Open Camera Health from your fleet dashboard.',403);
    // Re-authorize the parent before using even a cached snapshot.
    const session=await requestParentToken();
    if(mode!==new URLSearchParams(location.search).get('mode'))throw new OperationsApiError('The fleet view changed. Reload your session.',401);
    const key=JSON.stringify([session.token,session.role,mode]);
    if(force&&!pendingFleetSnapshots.has(key))clearSharedReads();
    const saved=fleetSnapshots.get(key);if(saved&&Date.now()-saved.at<CAMERA_AUTO_REFRESH_MS)return {health:Promise.resolve(saved.value.health),fieldMap:Promise.resolve(saved.value.fieldMap),paired:Promise.resolve(saved.value)};
    // Only the newly authorized actor may see the dated complete saved pair.
    // This callback does not renew the cache or any observation timestamps.
    if(saved)onSaved?.(saved.value);
    const pending=pendingFleetSnapshots.get(key);if(pending)return pending;
    const revision=fleetRevision;
    const current=()=>{
      if(revision!==fleetRevision||lastVerifiedSession?.token!==session.token||mode!==new URLSearchParams(location.search).get('mode'))throw new OperationsApiError('Your fleet session or records changed. Reload the shared view.',409);
    };
    const health=sendRequest('GET','/api/camera-health/summary-v3',session.token).then(result=>{current();return validateCameraHealth(result.data);});
    // Optional protected Product-ID proof has its own bounded time budget.
    // Never block a valid saved map/health pair on a missing Sheets read.
    const productConnections=async()=>{
      let timer=0;
      const limited=new Promise<null>(resolve=>{timer=window.setTimeout(()=>resolve(null),6500);});
      try{return await Promise.race([sendRequest('GET','/api/product-connections',session.token).then(r=>r.data).catch(()=>null),limited]);}
      finally{window.clearTimeout(timer);}
    };
    // Native-only Fleet pages cannot attribute any Product-ID TCP results.
    // Avoid an unnecessary protected source read until this authenticated map
    // supplies a reviewed, complete Field Product-ID census.
    const fieldMap=sendRequest('GET','/api/field-map',session.token).then(async result=>{
      current();
      const map=checkedFieldMap(result.data),upload=(map as any).uploadInventory;
      const records=Array.isArray(upload?.records)?upload.records:[];
      const fieldIds=records.filter((r:any)=>r?.placement==='FIELD').map((r:any)=>r.productId);
      const sourceReady=upload?.contract==='COS_MHELP_UPLOAD_INVENTORY_V1'
        &&upload.countBasis==='mhelp_product_records_not_unique_physical_units'
        &&typeof upload.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(upload.sourceSha256)
        &&records.length>0&&records.length<=10000
        &&upload.summary?.totalRecords===records.length
        &&upload.summary?.fieldRecords===fieldIds.length
        &&fieldIds.length>0&&new Set(fieldIds).size===fieldIds.length
        &&fieldIds.every((id:unknown)=>typeof id==='string'&&/^[1-9][0-9]{0,14}$/.test(id));
      if(!sourceReady)return map;
      const receipt=await productConnections();
      current();
      const accepted=receipt&&readExactProductConnections(receipt,upload.sourceSha256,fieldIds);
      // Explicit null means the required exact-product read failed or was
      // rejected. Keep the inventory, but never silently substitute provider
      // health for a missing TCP observation. Native-only maps omit the field.
      return {...map,productConnections:accepted?receipt:null};
    });
    const read: FleetReads={health,fieldMap,paired:Promise.all([health,fieldMap]).then(([health,map])=>{
      current();const value={...reconcileFleetSnapshot(health,map),readStartedAt:requestedAt};fleetSnapshots.set(key,{value,at:requestedAt});window.dispatchEvent?.(new Event('cos-fleet-snapshot-updated'));return value;
    }).catch(cause=>{if(revision===fleetRevision&&lastVerifiedSession?.token===session.token&&mode===new URLSearchParams(location.search).get('mode')){fleetSnapshots.delete(key);window.dispatchEvent?.(new Event('cos-fleet-snapshot-failed'));}throw cause;})};
    // A source-only caller must not leave the optional pair's rejection unhandled.
    void read.paired.catch(()=>{});
    // Deliver pair errors immediately, but keep sharing a still-running source.
    // Invalidated reads may settle after a newer read has claimed the same key.
    void Promise.allSettled([health,fieldMap]).then(()=>{if(pendingFleetSnapshots.get(key)===read)pendingFleetSnapshots.delete(key);});
    pendingFleetSnapshots.set(key,read);return read;
}
export const api = {
  // Capture before asynchronous draft preparation, not after it has already crossed a session boundary.
  captureSession: () => { const revision=privateSessionRevision; return () => revision===privateSessionRevision; },
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown, options?: { signal?: AbortSignal }) => request<T>('POST', path, body, options),
  fleet: async(force=false,onSaved?:(snapshot:FleetSnapshot)=>void):Promise<FleetSnapshot>=>(await readFleet(force,onSaved)).paired,
  fleetSource:async<K extends 'health'|'fieldMap'>(source:K,force=false):Promise<FleetSnapshot[K]>=>await (await readFleet(force))[source] as FleetSnapshot[K],
};
const legacyRoutes = new Set(['today', 'calendar', 'attention', 'review', 'assign', 'team', 'units', 'handoffs', 'history', 'activity', 'accounts', 'more', 'testcenter', 'it', 'service', 'vision', 'camera-health', 'logout', 'operations', 'production-return']);
export function openLegacy(route: string) {
  if (!legacyRoutes.has(route) || window.parent === window || location.origin === 'null') return;
  window.parent.postMessage({ type: 'COS_OPERATIONS_NAVIGATE', route }, location.origin);
}
