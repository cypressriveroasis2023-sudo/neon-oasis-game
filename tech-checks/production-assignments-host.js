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
function queueIdentity() {
  const c = queueContext(), role = c?.getRole(), id = c?.getSession()?.user?.id;
  const profile = c?.getProfile();
  if (!['it','service'].includes(role) || c?.getEffectiveRole() !== role || !id ||
      profile?.user_id !== id || profile?.active !== true || profile?.archived_at ||
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
  const identity = queueIdentity();
  queueButton.hidden = !identity;
  if (queueFrame && !sameQueueIdentity(identity, queueFrameIdentity)) closeQueue();
}
function openQueue() {
  const identity = queueIdentity();
  if (!identity) return;
  closeQueue();
  queueFrame = document.createElement('iframe');
  queueFrame.id = 'cosProductionAssignmentsFrame';
  queueFrame.title = 'Your Operations assignments';
  queueFrame.src = './operations/dist/index.html?mode=production-assignments&v=operations-v100-phase2-20261004';
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
window.addEventListener('techcheck:data-refreshed', presentQueue);
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeQueue(); });
const queueObserver = new MutationObserver(presentQueue);
if (queueApp) queueObserver.observe(queueApp, {attributes:true,attributeFilter:['class']});
const queueAuth = document.getElementById('authView');
if (queueAuth) queueObserver.observe(queueAuth, {attributes:true,attributeFilter:['class']});
let queuePreview = document.body.classList.contains('owner-test-role-preview');
new MutationObserver(() => {
  const current = document.body.classList.contains('owner-test-role-preview');
  if (current !== queuePreview) { queuePreview = current; presentQueue(); }
}).observe(document.body, {attributes:true,attributeFilter:['class']});
presentQueue();
