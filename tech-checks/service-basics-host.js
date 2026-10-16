// Service's basic daily tools use the existing inspection and inventory writers.
// This is product presentation, not a replacement for server authorization.
import './auth-mobile-host.js?v=20261016';
import './service-daily-report-host.js?v=20261016';
export const SERVICE_BASICS_ONLY = true;
window.COS_SERVICE_BASICS_ONLY = SERVICE_BASICS_ONLY;
const context = () => window.TechCheckContext;
const savedAttributes = new Map();
let scheduled = false;
let observingAuth = false;

function active() {
  const c = context();
  return SERVICE_BASICS_ONLY && c?.getRole() === 'service' &&
    c?.getSession()?.user?.id &&
    !document.getElementById('appView')?.classList.contains('hidden');
}

function attribute(node, name, value) {
  if (!savedAttributes.has(node)) savedAttributes.set(node, new Map());
  const saved = savedAttributes.get(node);
  if (!saved.has(name)) saved.set(name, node.getAttribute(name));
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function present() {
  const auth = context()?.db?.auth;
  if (!observingAuth && auth?.onAuthStateChange) {
    observingAuth = true;
    auth.onAuthStateChange(schedule);
  }
  const enabled = Boolean(active());
  document.body.classList.toggle('cos-service-basics', enabled);
  if (!enabled) {
    document.querySelectorAll('[data-cos-service-basics-copy]').forEach(node => node.remove());
    for (const [node, attributes] of savedAttributes) {
      for (const [name, value] of attributes) {
        value === null ? node.removeAttribute(name) : node.setAttribute(name, value);
      }
    }
    savedAttributes.clear();
    return;
  }

  const service = document.getElementById('view-svc');
  if (service?.classList.contains('hidden')) window.show?.('svc');
  const home = service?.querySelector('#wlSvcHome .wl-service-simple-shell');
  if (home && !home.querySelector('[data-cos-service-basics-copy]')) {
    const copy = document.createElement('p');
    copy.dataset.cosServiceBasicsCopy = '';
    copy.className = 'cos-service-basics-flow';
    copy.textContent = 'Truck inspection → Trailer inspection if you are taking a trailer → Required truck inventory';
    home.querySelector('.wl-service-action-list')?.before(copy);
  }
  // Supply accessible names without moving inputs or replacing saved values.
  for (const input of service?.querySelectorAll('[data-wl-truck-unit-entry]') || []) {
    attribute(input, 'aria-label', input.dataset.wlTruckUnitEntry + ' unit number');
    attribute(input, 'required', '');
  }
  for (const input of service?.querySelectorAll('[data-wl-truck-sim-entry]') || []) {
    attribute(input, 'aria-label', 'SIM card ' + input.dataset.wlTruckSimEntry + ' number');
    attribute(input, 'required', '');
  }
  // Drop detached redraw nodes; do not retain old unit/SIM inputs in memory.
  for (const node of savedAttributes.keys()) if (!node.isConnected) savedAttributes.delete(node);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; present(); });
}

for (const event of ['techcheck:view-changed', 'techcheck:data-refreshed', 'pageshow']) {
  window.addEventListener(event, schedule);
}
new MutationObserver(schedule).observe(document.body, {
  childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
});
present();
