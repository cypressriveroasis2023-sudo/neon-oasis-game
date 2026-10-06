// A separate read-only Operations queue; existing IT/Service views stay mounted.
const queueContext = () => window.TechCheckContext;
const queueApp = document.getElementById('appView');
const queueButton = document.createElement('button');
queueButton.id = 'cosProductionAssignmentsButton';
queueButton.type = 'button';
queueButton.textContent = 'Operations assignments';
queueButton.hidden = true;
document.body.appendChild(queueButton);
const queueOverlay = document.createElement('section');
queueOverlay.id = 'cosProductionAssignmentsOverlay';
queueOverlay.setAttribute('aria-label', 'Operations assignments');
queueOverlay.hidden = true;
const queueClose = document.createElement('button');
queueClose.id = 'cosProductionAssignmentsClose';
queueClose.type = 'button';
queueClose.textContent = '×';
queueClose.setAttribute('aria-label', 'Close Operations assignments');
queueOverlay.appendChild(queueClose);
document.body.appendChild(queueOverlay);
let queueFrame = null;
let queueFrameIdentity = null;
let queueAuthSubject;
let queueAuthObserved = false;
let queueSummary = null, queueSummaryIdentity = null, queueSummaryRequest = 0, queueSummaryController = null;
const queueEndpoint = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
function clearQueueSummary() {
  queueSummaryRequest++; queueSummaryController?.abort(); queueSummaryController = null;
  queueSummary?.remove(); queueSummary = null; queueSummaryIdentity = null;
}
function queueText(tag, value, className) {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  return node;
}
async function refreshQueueSummary() {
  const identity = queueIdentity(), summary = queueSummary;
  if (!summary || !sameQueueIdentity(identity, queueSummaryIdentity)) return;
  const request = ++queueSummaryRequest;
  queueSummaryController?.abort(); const controller = new AbortController(); queueSummaryController = controller;
  const content = summary.querySelector('.cos-native-assignment-content');
  const refresh = summary.querySelector('[data-native-queue-refresh]');
  content.replaceChildren(queueText('p', 'Checking your Operations assignments…'));
  refresh.disabled = true;
  const current = () => request === queueSummaryRequest && summary === queueSummary && sameQueueIdentity(identity, queueIdentity());
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const fresh = await queueContext().db.auth.getSession();
    if (!current()) return;
    if (fresh?.data?.session?.user?.id !== identity.id) {
      queueAuthSubject = fresh?.data?.session?.user?.id || null; presentQueue(); return;
    }
    const token = fresh.data.session.access_token;
    if (typeof token !== 'string' || !token) throw new Error('Sign in again to load your Operations assignments.');
    const read = async path => {
      const response = await fetch(queueEndpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ path, method: 'GET', body: null }), cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Operations assignments could not be loaded.');
      return data;
    };
    const session = await read('/api/tech/session');
    if (!current()) return;
    if (session?.legacyTechnician !== true || session.department !== identity.role || session.authorized !== true) throw new Error(session?.reason || 'Your Operations identity could not be verified.');
    const day = await read('/api/tech/assignments');
    if (!current()) return;
    if (!day || !Array.isArray(day.visits) || day.profile?.department !== identity.role || day.visits.some(visit => !visit || typeof visit.visit_id !== 'string' || !visit.visit_id || visit.department !== identity.role)) throw new Error('Operations returned an incomplete assignment list. Refresh to retry.');
    content.replaceChildren();
    if (!day.visits.length) content.appendChild(queueText('p', 'No active Operations jobs assigned to you.'));
    for (const visit of day.visits) {
      const row = queueText('button', '', 'cos-native-assignment-row'); row.type = 'button';
      row.appendChild(queueText('strong', [visit.job_number || 'Assigned job', visit.customer_name].filter(Boolean).join(' · ')));
      const schedule = visit.scheduled_start ? new Date(visit.scheduled_start).toLocaleString() : 'Not scheduled';
      row.appendChild(queueText('span', [visit.site_name, String(visit.visit_type || '').replaceAll('_', ' '), schedule].filter(Boolean).join(' · ')));
      row.appendChild(queueText('small', ['ready','not_dispatched'].includes(visit.dispatch_status) ? 'ASSIGNED · NOT DISPATCHED' : String(visit.dispatch_status || visit.status || 'Assigned').replaceAll('_', ' ').toUpperCase()));
      row.addEventListener('click', () => { if (current()) openQueue(); });
      content.appendChild(row);
    }
  } catch (error) {
    if (current()) { const message = queueText('p', error?.name === 'AbortError' ? 'Operations assignments could not be verified in time. Refresh to retry.' : error?.message || 'Operations assignments could not be verified. Refresh to retry.'); message.setAttribute('role', 'alert'); content.replaceChildren(message); }
  } finally {
    window.clearTimeout(timer);
    if (current()) { refresh.disabled = false; queueSummaryController = null; }
  }
}
function presentQueueSummary(identity) {
  // This augments the existing IT landing. It never creates legacy checks or assignments.
  const landing = identity?.role === 'it' ? document.querySelector?.('#wlItHome .wl-it-command-workspace') : null;
  if (!identity || !landing || !sameQueueIdentity(identity, queueSummaryIdentity) || queueSummary?.parentNode !== landing) {
    clearQueueSummary();
    if (!identity || !landing) return;
    queueSummaryIdentity = identity;
    queueSummary = document.createElement('section'); queueSummary.className = 'cos-native-assignments';
    queueSummary.setAttribute('aria-label', 'Operations assigned jobs');
    const head = document.createElement('div'); head.className = 'cos-native-assignment-head';
    head.appendChild(queueText('h2', 'Operations assigned jobs'));
    const refresh = queueText('button', 'Refresh'); refresh.type = 'button'; refresh.setAttribute('data-native-queue-refresh', ''); refresh.addEventListener('click', refreshQueueSummary); head.appendChild(refresh);
    const open = queueText('button', 'Open assignments'); open.type = 'button'; open.addEventListener('click', openQueue); head.appendChild(open);
    queueSummary.appendChild(head);
    queueSummary.appendChild(queueText('p', 'Jobs assigned by Operations appear here. Open a job to review its saved assignment and next step.'));
    const content = document.createElement('div'); content.className = 'cos-native-assignment-content'; queueSummary.appendChild(content);
    const heading = landing.querySelector('.wl-it-command-head');
    if (heading) heading.after(queueSummary); else landing.prepend(queueSummary);
    void refreshQueueSummary();
  }
}
function observeQueueAuth() {
  const auth = queueContext()?.db.auth;
  if (queueAuthObserved || typeof auth?.onAuthStateChange !== 'function') return;
  queueAuthObserved = true;
  auth.onAuthStateChange((_event, session) => { queueAuthSubject = session?.user?.id || null; presentQueue(); });
}
function queueIdentity() {
  const c = queueContext(), role = c?.getRole(), id = c?.getSession()?.user?.id;
  const profile = c?.getProfile();
  if (!['it','service'].includes(role) || c?.getEffectiveRole() !== role || !id ||
      (queueAuthSubject !== undefined && queueAuthSubject !== id) || profile?.user_id !== id || profile?.active !== true || profile?.archived_at ||
      !queueApp || queueApp.classList.contains('hidden') ||
      document.body.classList.contains('owner-test-role-preview')) return null;
  return { id, role };
}
function sameQueueIdentity(a, b) { return Boolean(a && b && a.id === b.id && a.role === b.role); }
function closeQueue() {
  queueFrame?.remove();
  queueFrame = null; queueFrameIdentity = null; queueOverlay.hidden = true;
  document.body.classList.remove('cos-production-assignments-open');
}
function presentQueue() {
  observeQueueAuth();
  const identity = queueIdentity();
  queueButton.hidden = !identity;
  presentQueueSummary(identity);
  if (queueFrame && !sameQueueIdentity(identity, queueFrameIdentity)) closeQueue();
}
function openQueue() {
  const identity = queueIdentity();
  if (!identity) return;
  closeQueue();
  queueFrame = document.createElement('iframe');
  queueFrame.id = 'cosProductionAssignmentsFrame';
  queueFrame.title = 'Your Operations assignments';
  queueFrame.src = './operations/dist/index.html?mode=production-assignments&v=operations-assigned-prep-20261006';
  queueFrame.referrerPolicy = 'same-origin';
  queueFrameIdentity = identity;
  queueOverlay.appendChild(queueFrame);
  queueOverlay.hidden = false;
  document.body.classList.add('cos-production-assignments-open');
}
queueButton.addEventListener('click', openQueue);
queueClose.addEventListener('click', closeQueue);
window.addEventListener('message', async event => {
  if (event.origin !== window.location.origin || event.source !== queueFrame?.contentWindow || !sameQueueIdentity(queueIdentity(), queueFrameIdentity)) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'COS_OPERATIONS_TOKEN_REQUEST' && typeof data.requestId === 'string' && data.requestId.length <= 100) {
    const identity = queueIdentity(), requestedFrame = queueFrame;
    let token = null;
    try {
      const fresh = await queueContext()?.db.auth.getSession();
      if (requestedFrame === queueFrame && fresh?.data?.session?.user?.id !== identity.id) {
        queueAuthSubject = fresh?.data?.session?.user?.id || null;
        presentQueue();
      }
      if (requestedFrame === queueFrame && sameQueueIdentity(identity, queueIdentity()) &&
          sameQueueIdentity(identity, queueFrameIdentity) && fresh?.data?.session?.user?.id === identity.id)
        token = fresh.data.session.access_token;
    } catch {}
    if (requestedFrame === queueFrame && event.source === queueFrame?.contentWindow)
      event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:data.requestId,accessToken:token,role:token?identity.role:null}, event.origin);
  }
  if (data.type === 'COS_OPERATIONS_NAVIGATE' && data.route === 'production-return') closeQueue();
});
window.addEventListener('techcheck:view-changed', presentQueue);
window.addEventListener('techcheck:data-refreshed', () => { presentQueue(); void refreshQueueSummary(); });
window.addEventListener('focus', () => { presentQueue(); void refreshQueueSummary(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeQueue(); });
const queueObserver = new MutationObserver(presentQueue);
if (queueApp) queueObserver.observe(queueApp, {attributes:true,attributeFilter:['class'],childList:true,subtree:true});
const queueAuth = document.getElementById('authView');
if (queueAuth) queueObserver.observe(queueAuth, {attributes:true,attributeFilter:['class']});
let queuePreview = document.body.classList.contains('owner-test-role-preview');
new MutationObserver(() => {
  const current = document.body.classList.contains('owner-test-role-preview');
  if (current !== queuePreview) { queuePreview = current; presentQueue(); }
}).observe(document.body, {attributes:true,attributeFilter:['class']});
presentQueue();
