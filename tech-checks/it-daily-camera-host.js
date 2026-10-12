import {IT_DAILY_ONLY, itDailyCameraUrl} from './it-feature-availability.js';
// Presentation-only boundary for the two existing Camera Health tools. Reads the
// profile they already verify; no new account, permission, data or auth request.
const explicit = new URLSearchParams(location.search).get('itDaily') === '1';
const role = () => typeof profile === 'undefined' ? null : profile?.role;
const paused = () => IT_DAILY_ONLY && (explicit || role() !== 'owner');
const daily = () => IT_DAILY_ONLY && (explicit || role() === 'it');
const cameraUrl = href => daily() ? itDailyCameraUrl(href, '?itDaily=1') : href;
const shielded = new Map(), links = new Map();
function workflowLink(node) {
  if (!node?.matches?.('a[href]')) return false;
  try { const url = new URL(node.getAttribute('href'), location.href); return url.origin === location.origin && /\/(?:onsite-vision|it-send-repair)\.html$/.test(url.pathname); } catch { return false; }
}
function blocked(node) { return Boolean(node?.closest?.('.ticket-unit,[data-cos-it-camera-paused]') || workflowLink(node?.closest?.('a[href]'))); }
function present() {
  if (!IT_DAILY_ONLY) return;
  if (paused()) {
    for (const node of document.querySelectorAll('.ticket-unit,a[href]')) {
      if (!node.matches('.ticket-unit') && !workflowLink(node)) continue;
      if (!shielded.has(node)) shielded.set(node, {inert:node.inert, display:node.style.getPropertyValue('display'), priority:node.style.getPropertyPriority('display')});
      if (!node.inert) node.inert = true;
      if (node.style.getPropertyValue('display') !== 'none' || node.style.getPropertyPriority('display') !== 'important') node.style.setProperty('display','none','important');
      if (!node.hasAttribute('data-cos-it-camera-paused')) node.setAttribute('data-cos-it-camera-paused','');
    }
  } else {
    for (const [node, saved] of shielded) {
      node.inert = saved.inert;
      if (saved.display) node.style.setProperty('display',saved.display,saved.priority); else node.style.removeProperty('display');
      node.removeAttribute('data-cos-it-camera-paused');
    }
    shielded.clear();
  }
  for (const node of document.querySelectorAll('a[href]')) {
    const before = links.get(node) || node.getAttribute('href'), after = cameraUrl(before);
    if (before !== after && !links.has(node)) links.set(node,before);
    if (node.getAttribute('href') !== after) node.setAttribute('href',after);
  }
  if (!daily()) links.clear();
}
if (IT_DAILY_ONLY) {
  // Capture before the protected legacy ticket handler, including programmatic
  // clicks. Existing monitoring, provider links, IP and placement tools remain.
  window.addEventListener('click', event => {
    if (paused() && blocked(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (daily() && event.target?.closest?.('#backBtn')) {
      event.preventDefault(); event.stopImmediatePropagation();
      try { sessionStorage.setItem('cameraHealthReturnRequested','1'); } catch {}
      location.assign(cameraUrl('./camera-health.html'));
    }
  }, true);
  const originalOpen = window.openCameraDetail;
  if (typeof originalOpen === 'function') window.openCameraDetail = function(id) {
    if (!daily()) return originalOpen.apply(this,arguments);
    window.saveCameraHealthReturnState?.();
    location.assign(cameraUrl('./camera-detail.html?id=' + encodeURIComponent(id)));
  };
  let scheduled = false;
  new MutationObserver(() => {if (scheduled) return; scheduled = true; queueMicrotask(() => {scheduled = false; present();});})
    .observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','href']});
  for (const name of ['pageshow','popstate']) window.addEventListener(name,present);
  document.addEventListener('visibilitychange',present); present();
}
