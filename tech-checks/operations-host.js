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
const serviceOwnerStatus = 'Service Tech sign-in required';
const serviceOwnerNotice = 'You are viewing Service tools as Owner. Daily truck, trailer and inventory checks belong to the signed-in Service Tech. Sign in with your own Service Tech account to complete them.';
let serviceOwnerPresentation = null;
function restoreServiceOwnerPresentation() {
  if (!serviceOwnerPresentation) return;
  const { help, helpText, helpId, helpRole, buttons } = serviceOwnerPresentation;
  if (help.textContent === serviceOwnerNotice) help.textContent = helpText;
  if (help.id === 'cosOwnerServiceNotice') helpId ? help.id = helpId : help.removeAttribute('id');
  if (help.getAttribute('role') === 'note') helpRole === null ? help.removeAttribute('role') : help.setAttribute('role', helpRole);
  for (const saved of buttons) {
    const { button, status, icon } = saved;
    if (status.textContent === serviceOwnerStatus) status.textContent = saved.statusText;
    if (icon?.textContent === '→') icon.textContent = saved.iconText;
    button.disabled = saved.disabled;
    button.classList.toggle('complete', saved.complete);
    if (button.getAttribute('aria-describedby') === 'cosOwnerServiceNotice') {
      saved.description === null ? button.removeAttribute('aria-describedby') : button.setAttribute('aria-describedby', saved.description);
    }
  }
  serviceOwnerPresentation = null;
}
function presentServiceOwnerContext() {
  const service = document.getElementById('view-svc');
  const home = service?.querySelector?.('#wlSvcHome');
  const help = home?.querySelector('.wl-service-help');
  // This is an Owner-view explanation, never a readiness result or a technician
  // identity override. The protected Service workflow and RPC stay unchanged.
  const active = owner() && context()?.getEffectiveRole() === 'owner' &&
    !document.body.classList.contains('owner-test-role-preview') &&
    !document.getElementById('appView')?.classList.contains('hidden') &&
    !service?.classList.contains('hidden') && home?.style.display !== 'none' && help;
  if (!active) { restoreServiceOwnerPresentation(); return; }
  if (serviceOwnerPresentation?.help !== help) restoreServiceOwnerPresentation();
  if (!serviceOwnerPresentation) {
    const buttons = [...home.querySelectorAll('[data-wl-svc="inspect"], [data-wl-service-trailer-inspection], [data-wl-service-truck-inventory]')]
      .map(button => ({ button, status:button.querySelector('small'), icon:button.querySelector('b') }))
      .filter(({ status }) => status)
      .map(({ button, status, icon }) => ({ button, status, icon, statusText:status.textContent, iconText:icon?.textContent,
        disabled:button.disabled, complete:button.classList.contains('complete'), description:button.getAttribute('aria-describedby') }));
    serviceOwnerPresentation = { help, helpText:help.textContent, helpId:help.id, helpRole:help.getAttribute('role'), buttons };
  }
  // The legacy refresh may repaint its helper text after its expected Owner
  // role rejection. Reapply only this explanation; do not retry the RPC.
  if (help.textContent !== serviceOwnerNotice) {
    serviceOwnerPresentation.helpText = help.textContent;
    help.textContent = serviceOwnerNotice;
  }
  if (help.id !== 'cosOwnerServiceNotice') help.id = 'cosOwnerServiceNotice';
  if (help.getAttribute('role') !== 'note') help.setAttribute('role', 'note');
  for (const { button, status, icon } of serviceOwnerPresentation.buttons) {
    if (status.textContent !== serviceOwnerStatus) status.textContent = serviceOwnerStatus;
    if (icon && icon.textContent !== '→') icon.textContent = '→';
    if (!button.disabled) button.disabled = true;
    if (button.classList.contains('complete')) button.classList.remove('complete');
    if (button.getAttribute('aria-describedby') !== 'cosOwnerServiceNotice') button.setAttribute('aria-describedby', 'cosOwnerServiceNotice');
  }
}
function observeOwnerAuth() {
  const auth = context()?.db.auth;
  if (ownerAuthObserved || typeof auth?.onAuthStateChange !== 'function') return;
  ownerAuthObserved = true;
  auth.onAuthStateChange((_event, session) => { ownerAuthSubject = session?.user?.id || null; present(); });
}
function present() {
  observeOwnerAuth();
  presentServiceOwnerContext();
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
    frame.src = './operations/dist/index.html?v=operations-v100-phase2-20261004';
    frame.allow = 'geolocation';
    frame.referrerPolicy = 'same-origin';
    mount.replaceChildren(frame);
    frameUser = user;
  }
  if (frame && (!visible || legacyOpen)) {
    frame.contentWindow?.postMessage({ type: 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE' }, window.location.origin);
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
const serviceView = document.getElementById('view-svc');
if (serviceView) new MutationObserver(presentServiceOwnerContext).observe(serviceView, {
  childList:true, subtree:true, attributes:true, attributeFilter:['class','style']
});
present();
