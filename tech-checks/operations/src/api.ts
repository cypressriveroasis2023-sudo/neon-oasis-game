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
  '/api/field-map', '/api/routers', '/api/camera-health/summary-v3',
]);
const pendingReads = new Map<string, Promise<ApiResponse>>();
let tokenRequest: Promise<ParentSession> | null = null;
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
      } else resolve({ token: message.accessToken, role: message.role });
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
async function request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse<T>> {
  const mode = new URLSearchParams(location.search).get('mode');
  if (!/^\/api\/[a-zA-Z0-9_\-\/]+$/.test(path)) throw new OperationsApiError('This Operations request is unavailable.', 400);
  if (mode === 'production-assignments' && !permitsTechnicianRequest(method, path, body)) throw new OperationsApiError('This assignment view permits technician reads and taking an available IT queue visit only.', 403);
  // Always verify the current parent session before consulting pending reads.
  // A path-only promise could otherwise expose a previous account's response.
  const session = await requestParentToken();
  if (mode !== new URLSearchParams(location.search).get('mode')) throw new OperationsApiError('The Operations view changed. Refresh to verify the current session.', 401);
  if (method === 'POST' && path.startsWith('/api/tech/') && session.role !== 'it') throw new OperationsApiError('Only an IT technician can take shared IT work.', 403);
  if (method === 'POST') {
    // Reads started before or during a save cannot satisfy its fresh readback.
    // Forget their lookup entries without cancelling their existing callers.
    pendingReads.clear();
    try { return await sendRequest<T>(method, path, session.token, body); }
    finally { pendingReads.clear(); }
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
async function sendRequest<T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<ApiResponse<T>> {
  const controller = new AbortController();
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
    let data: any;
    try { data = await response.json(); } catch { throw new OperationsApiError('Operations returned an incomplete response. Please refresh.', response.status || 503); }
    if (!response.ok) throw new OperationsApiError(typeof data?.error === 'string' ? data.error : 'Operations request failed.', response.status);
    return { data };
  } finally { window.clearTimeout(timer); }
}
export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
};
const legacyRoutes = new Set(['today', 'calendar', 'attention', 'review', 'assign', 'team', 'units', 'handoffs', 'history', 'activity', 'accounts', 'more', 'testcenter', 'it', 'service', 'vision', 'camera-health', 'logout', 'operations', 'production-return']);
export function openLegacy(route: string) {
  if (!legacyRoutes.has(route) || window.parent === window || location.origin === 'null') return;
  window.parent.postMessage({ type: 'COS_OPERATIONS_NAVIGATE', route }, location.origin);
}
