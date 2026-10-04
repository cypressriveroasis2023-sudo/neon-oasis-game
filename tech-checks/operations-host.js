// Isolate the Operations UI while retaining the existing Tech Check session and views.
const ownerView = document.getElementById('view-owner');
const mount = document.getElementById('cosOperationsMount');
const legacy = document.getElementById('cosOperationsLegacy');
const ownerRoutes = new Set(['today','calendar','attention','review','assign','team','units','handoffs','history','activity','accounts','more','testcenter']);
let frame = null;
let frameUser = null;
let legacyOpen = false;
const context = () => window.TechCheckContext;
let ownerAuthSubject;
let ownerAuthObserved = false;
const owner = () => {
  const id = context()?.getRole() === 'owner' && context()?.getSession()?.user?.id;
  return id && (ownerAuthSubject === undefined || ownerAuthSubject === id) ? id : null;
};
function observeOwnerAuth() {
  const auth = context()?.db.auth;
  if (ownerAuthObserved || typeof auth?.onAuthStateChange !== 'function') return;
  ownerAuthObserved = true;
  auth.onAuthStateChange((_event, session) => { ownerAuthSubject = session?.user?.id || null; present(); });
}
function present() {
  observeOwnerAuth();
  const user = owner();
  const effectiveOwner = context()?.getEffectiveRole() === 'owner';
  const appVisible = !document.getElementById('appView')?.classList.contains('hidden');
  if (frame && (frameUser !== user || !effectiveOwner || !appVisible)) {
    frame.remove(); frame = null; frameUser = null; legacyOpen = false;
  }
  const visible = Boolean(user && effectiveOwner && appVisible && !ownerView?.classList.contains('hidden'));
  document.body.classList.toggle('cos-operations-host', visible && !legacyOpen);
  document.body.classList.toggle('cos-operations-legacy', visible && legacyOpen);
  const techReturn = document.getElementById('cosOperationsTechReturn');
  if (techReturn) techReturn.hidden = !(user && effectiveOwner && appVisible && ownerView?.classList.contains('hidden'));
  if (!mount || !legacy) return;
  if (visible && !frame) {
    frame = document.createElement('iframe');
    frame.id = 'cosOperationsFrame';
    frame.title = 'COS Operations';
    frame.src = './operations/dist/index.html?v=operations-v100-20261004';
    frame.allow = 'geolocation';
    frame.referrerPolicy = 'same-origin';
    mount.replaceChildren(frame);
    frameUser = user;
  }
  mount.hidden = legacyOpen;
  legacy.hidden = !legacyOpen;
}
function navigate(route) {
  if (!owner()) return;
  if (route === 'logout') { window.logout?.(); return; }
  if (route === 'vision' || route === 'camera-health') {
    window.location.assign(route === 'vision' ? './onsite-vision.html' : './camera-health.html');
    return;
  }
  if (route === 'it' || route === 'service') {
    document.getElementById(route === 'it' ? 'tab-it' : 'tab-svc')?.click();
    return;
  }
  if (route === 'operations') {
    legacyOpen = false;
    const tab = document.getElementById('tab-owner');
    if (tab) tab.click(); else window.show?.('owner');
    present(); return;
  }
  if (ownerRoutes.has(route)) {
    window.show?.('owner');
    legacyOpen = true; present();
    window.ownerAppNavigate?.(route);
  }
}
window.addEventListener('message', async event => {
  if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || !owner()) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'COS_OPERATIONS_TOKEN_REQUEST' && typeof data.requestId === 'string' && data.requestId.length <= 100) {
    const requestedUser = owner();
    let token = null;
    try {
      const result = await context()?.db.auth.getSession();
      if (event.source === frame?.contentWindow && result?.data?.session?.user?.id !== requestedUser) {
        ownerAuthSubject = result?.data?.session?.user?.id || null;
        present();
      }
      if (!document.getElementById('appView')?.classList.contains('hidden') && context()?.getEffectiveRole() === 'owner' && owner() === requestedUser &&
          result?.data?.session?.user?.id === requestedUser &&
          event.source === frame?.contentWindow) token = result.data.session.access_token;
    } catch {}
    if (event.source === frame?.contentWindow) event.source.postMessage({ type:'COS_OPERATIONS_TOKEN_RESPONSE', requestId:data.requestId, accessToken:token, role:token?'owner':null }, event.origin);
  }
  if (data.type === 'COS_OPERATIONS_NAVIGATE' && typeof data.route === 'string') navigate(data.route);
});
window.addEventListener('techcheck:view-changed', event => {
  if (event.detail?.view === 'owner') legacyOpen = false;
  present();
});
document.getElementById('cosOperationsReturn')?.addEventListener('click', () => navigate('operations'));
document.getElementById('cosOperationsTechReturn')?.addEventListener('click', () => navigate('operations'));
const observer = new MutationObserver(present);
if (ownerView) observer.observe(ownerView, {attributes:true, attributeFilter:['class']});
const appView = document.getElementById('appView');
if (appView) observer.observe(appView, {attributes:true, attributeFilter:['class']});
const authView = document.getElementById('authView');
if (authView) observer.observe(authView, {attributes:true, attributeFilter:['class']});
window.addEventListener('techcheck:data-refreshed', present);
let lastPreview = document.body.classList.contains('owner-test-role-preview');
const previewObserver = new MutationObserver(() => {
  const preview = document.body.classList.contains('owner-test-role-preview');
  if (preview !== lastPreview) { lastPreview = preview; present(); }
});
previewObserver.observe(document.body, {attributes:true, attributeFilter:['class']});
present();
