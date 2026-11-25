import {setFieldMapDisplay} from './field-map-display-host.js';
// Isolate the Operations UI while retaining the existing Tech Check session and views.
const ownerView = document.getElementById('view-owner');
const mount = document.getElementById('cosOperationsMount');
const legacy = document.getElementById('cosOperationsLegacy');
// Build presentation-only chrome around existing nodes. The host HTML and its
// account/control content are preserved byte-for-byte in this release.
function ensureTechCheckChrome() {
  const back = document.getElementById('cosOperationsReturn');
  const techBack = document.getElementById('cosOperationsTechReturn');
  if (techBack) techBack.textContent = '← Tech Checks';
  if (!legacy || !back || document.getElementById('cosTechCheckToolTitle')) return;
  back.textContent = '← Tech Checks';
  const header = document.createElement('header');
  header.className = 'cos-tech-check-header';
  header.setAttribute('aria-label', 'Tech Checks tools');
  const copy = document.createElement('div');
  const scope = document.createElement('span');
  scope.textContent = 'VISION · TECH CHECKS';
  const title = document.createElement('b');
  title.id = 'cosTechCheckToolTitle';
  title.textContent = 'Tech Check tools';
  copy.append(scope, title);
  const refresh = document.createElement('button');
  refresh.className = 'mini'; refresh.type = 'button'; refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => window.refreshData?.());
  header.append(back, copy, refresh);
  const note = document.createElement('p');
  note.className = 'cos-tech-check-source';
  note.textContent = 'IT and Service check records, assignments and evidence. Dispatch jobs remain in Operations → Job flow.';
  legacy.prepend(header, note);
}
ensureTechCheckChrome();
const toolTitles = {
  it:'IT', service:'Service', assign:'Check assignments', team:'Truck & team readiness',
  review:'Review completed checks', handoffs:'Check handoffs & returns', calendar:'Check schedule',
  attention:'Checks needing attention', units:'Checked equipment', history:'Check history',
  activity:'Check activity', accounts:'Technician accounts', testcenter:'Owner test center',
};
const ownerRoutes = new Set(Object.keys(toolTitles).filter(route => !['it','service'].includes(route)));
let activeTool = null;
let changingView = false;
let initialRouteApplied = false;
const openedTechViews = new Set();
let nativeWorkspace = null;
let techHomePending = false;
const toolFromHash = () => {
  const match = /^#tech-checks(?:\/([a-z-]+))?$/.exec(window.location.hash || '');
  return match ? (match[1] && Object.hasOwn(toolTitles, match[1]) ? match[1] : 'home') : null;
};
function setToolHash(route, replace = false) {
  const hash = '#tech-checks' + (route ? '/' + route : '');
  if (window.location.hash === hash) return;
  window.history[replace ? 'replaceState' : 'pushState']({ cosTechCheckTool:route || 'home' }, '', hash);
}
function showTechCheckHome() {
  techHomePending = nativeWorkspace !== 'Tech Check';
  frame?.contentWindow?.postMessage({ type:'COS_OPERATIONS_TECH_CHECK_HOME' }, window.location.origin);
}

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
    setFieldMapDisplay(frame,false);frame.remove(); frame = null; frameUser = null; legacyOpen = false; activeTool = null; initialRouteApplied = false; openedTechViews.clear(); nativeWorkspace = null; techHomePending = false;
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
    const mapParams = new URLSearchParams(window.location.search);
    const fieldUnit = mapParams.get('fieldUnit');
    const fieldRoute = mapParams.get('fleetDashboard')==='1'&&!fieldUnit?'#fleet-dashboard':mapParams.get('cameraView')==='1'?'#camera-health':fieldUnit && fieldUnit.length <= 120 && !/[\u0000-\u001f]/.test(fieldUnit) ? '#fleet-dashboard?unitLabel=' + encodeURIComponent(fieldUnit) : '#fleet-dashboard';
    const tvLaunch = mapParams.get('tvBoard') === '1';
    const tvParams = new URLSearchParams();
    if(tvLaunch){tvParams.set('tvBoard','1');if(mapParams.get('tvScope')==='week')tvParams.set('tvScope','week');if(['it','service'].includes(mapParams.get('tvDepartment')))tvParams.set('tvDepartment',mapParams.get('tvDepartment'));}
    const locationParams=new URLSearchParams();if(mapParams.get('locationImport')==='1'&&/^HELIOS\s+\d{1,3}$/i.test(mapParams.get('locationUnit')||'')&&/^[a-f0-9-]{36}$/i.test(mapParams.get('locationNonce')||'')){for(const key of ['locationImport','locationUnit','locationNonce'])locationParams.set(key,mapParams.get(key));}
    frame.src = './operations/dist/index.html?v=' + (locationParams.size?'mhelp-location-import-20261012':'unified-fleet-20261013') + (locationParams.size?'&'+locationParams:'') + (tvLaunch?'&'+tvParams:'') + (tvLaunch?'#daily-board':fieldRoute);
    frame.allow = 'geolocation; fullscreen';frame.allowFullscreen=true;
    frame.referrerPolicy = 'same-origin';
    frame.addEventListener('load', () => {setFieldMapDisplay(frame,false); if (toolFromHash()) showTechCheckHome(); });
    mount.replaceChildren(frame);
    frameUser = user;
  }
  if (frame && (!visible || legacyOpen)) {
    setFieldMapDisplay(frame,false);frame.contentWindow?.postMessage({ type: 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE' }, window.location.origin);
  }
  mount.hidden = legacyOpen;
  legacy.hidden = !legacyOpen;
  const title = document.getElementById('cosTechCheckToolTitle');
  if (title) title.textContent = toolTitles[activeTool] || 'Tech Check tools';
  if (visible && !initialRouteApplied) {
    initialRouteApplied = true;
    const route = toolFromHash();
    if (route) navigate(route === 'home' ? 'operations' : route, false);
  }
}

function navigate(route, updateHistory = true) {
  if (!owner() || context()?.getEffectiveRole() !== 'owner' || document.getElementById('appView')?.classList.contains('hidden')) return;
  if (route === 'logout') { window.logout?.(); return; }
  if (route === 'vision' || route === 'camera-health') {
    window.location.assign(route === 'vision' ? './onsite-vision.html' : './camera-health.html?diagnostics=1');
    return;
  }
  // Old dashboard/More links lead back to the single Tech Checks front door.
  if (['operations','today','more'].includes(route)) {
    activeTool = null; legacyOpen = false; initialRouteApplied = true;
    changingView = true;
    try {
      const tab = document.getElementById('tab-owner');
      if (tab) tab.click(); else window.show?.('owner');
    } finally { changingView = false; }
    present();
    if (updateHistory) setToolHash(null);
    showTechCheckHome();
    return;
  }
  if (!Object.hasOwn(toolTitles, route)) return;
  if (activeTool === route && (legacyOpen || route === 'it' || route === 'service')) return;
  activeTool = route;
  changingView = true;
  try {
    if (route === 'it' || route === 'service') {
      legacyOpen = false;
      // The original tab click opens the home dashboard. Returning from the
      // hub/history should reveal the current checklist instead of restarting it.
      if (openedTechViews.has(route) && typeof window.show === 'function') window.show(route === 'it' ? 'it' : 'svc');
      else document.getElementById(route === 'it' ? 'tab-it' : 'tab-svc')?.click();
      openedTechViews.add(route);
    } else if (ownerRoutes.has(route)) {
      window.show?.('owner');
      legacyOpen = true;
      window.ownerAppNavigate?.(route);
    }
  } finally { changingView = false; }
  present();
  if (updateHistory) setToolHash(route);
  showTechCheckHome();
}
function restoreToolRoute() {
  const route = toolFromHash();
  if (route) navigate(route === 'home' ? 'operations' : route, false);
  else if (activeTool || legacyOpen) navigate('operations', false);
}
window.addEventListener('popstate', restoreToolRoute);
window.addEventListener('hashchange', restoreToolRoute);
// ---- Manager view -----------------------------------------------------------
// The Owner's board asks for what the Tech Check screens already hold: today's
// truck inspections, each truck's stock, and the IT / Service handoffs. Every
// answer goes through the Owner's own signed-in client, so the database decides
// what this account may read or change exactly as it does for the screens here.
const managerUnitTypes = ['Sniper','Ranger','Spotter','Solar Spotter'];
const managerStock = [['Recon Battery','recon_battery_qty','Recon batteries',25],['AGM 12V 110Ah','agm_12v_110ah_qty','AGM 12V 110Ah',4],['LiTime 12V 100Ah','litime_12v_100ah_qty','LiTime 12V 100Ah',2],['12V 35Ah','battery_12v_35ah_qty','12V 35Ah',4]];
const managerPurposes = {truck_replenishment:'Truck replenishment', installation:'Installation'};
const managerId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const managerUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const managerText = (value, max = 120) => (typeof value === 'string' || typeof value === 'number') ? String(value).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max) : '';
const managerTime = value => { const at = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(at) ? new Date(at).toISOString() : null; };
const managerCount = value => { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : 0; };
const managerHeld = status => status === 'assigned' ? 'assigned' : status === 'used_restock_due' ? 'used' : 'missing';
const managerTest = name => /^test\b/i.test(name);
let managerPhotoPaths = new Set();
const managerReady = () => Boolean(owner() && context()?.getEffectiveRole() === 'owner' && typeof context()?.db?.rpc === 'function' &&
  !document.getElementById('appView')?.classList.contains('hidden'));
function managerTech(row) {
  const id = managerText(row?.user_id || row?.service_tech_id, 36);
  if (!managerUuid(id)) return null;
  const name = managerText(row.name, 80) || 'Service tech';
  const inspection = row.inspection || {}, check = row.inventory_check || {}, stock = row.stock || {};
  const units = Array.isArray(row.units) ? row.units : [], sims = Array.isArray(row.sims) ? row.sims : [];
  return {
    id, name, test:managerTest(name), ready:row.truck_ready === true,
    inspection:{ done:inspection.submitted === true, at:managerTime(inspection.submitted_at), truck:inspection.truck_complete === true,
      trailer:inspection.trailer_state === 'not_taking' ? 'not_taking' : inspection.trailer_complete === true && inspection.submitted === true ? 'done' : 'not_done' },
    stockCheck:{ state:check.ready === true ? 'done' : check.stock_complete === true && check.verification_required === true ? 'verify' : 'missing', at:managerTime(check.submitted_at) },
    units:managerUnitTypes.map(type => {
      const unit = units.find(item => item?.equipment_type === type) || {};
      const tag = managerText(unit.unit_tag, 40), held = tag ? managerHeld(unit.status) : 'missing';
      return { type, tag, status:held, ticket:held === 'used' ? managerText(unit.last_used_ticket_no, 40) : '' };
    }),
    sims:[1,2,3].map(slot => {
      const sim = sims.find(item => Number(item?.slot_no) === slot) || {};
      const number = managerText(sim.sim_number, 40), held = number ? managerHeld(sim.status) : 'missing';
      return { slot, number, status:held, ticket:held === 'used' ? managerText(sim.last_used_ticket_no, 40) : '' };
    }),
    stock:managerStock.map(([key, column, label, need]) => ({ key, label, have:managerCount(stock[column]), need })),
    restock:(Array.isArray(row.restock_requests) ? row.restock_requests : []).slice(0, 20)
      .map(item => ({ item:managerText(item?.item_type, 60), status:managerText(String(item?.status || 'requested').replaceAll('_', ' '), 40) })).filter(item => item.item),
  };
}
function managerExchange(row, paths) {
  if (!managerUuid(row?.id)) return null;
  const items = (Array.isArray(row.manifest) ? row.manifest : []).slice(0, 20)
    .map(item => [managerText(item?.family, 40), managerText(item?.unit_tag, 40)].filter(Boolean).join(' ')).filter(Boolean);
  const events = (Array.isArray(row.events) ? row.events : []).slice(-40).map(event => {
    const photos = (Array.isArray(event?.photos) ? event.photos : []).slice(0, 30)
      .filter(photo => typeof photo?.path === 'string' && /^[A-Za-z0-9._/-]{10,300}$/.test(photo.path) && !photo.path.includes('..'))
      .map(photo => ({ path:photo.path, kind:photo.kind === 'signature' ? 'signature' : 'photo' }));
    for (const photo of photos) paths.add(photo.path);
    const report = typeof event?.report_url === 'string' && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view$/.test(event.report_url) ? event.report_url : null;
    return { kind:event?.kind === 'checkout' ? 'checkout' : event?.kind === 'receipt' ? 'receipt' : event?.kind === 'owner_resolution' ? 'owner' : 'other',
      who:managerText(event?.actor_name, 80) || 'Unknown', at:managerTime(event?.signed_at), photos,
      differences:Array.isArray(event?.snapshot?.differences) ? Math.min(99, event.snapshot.differences.length) : 0, report };
  });
  return { id:row.id.toLowerCase(), items, purpose:managerPurposes[row.purpose] || 'Purpose not set',
    from:managerText(row.it_name, 80) || 'IT', to:managerText(row.service_name, 80) || 'Service',
    state:managerText(row.state, 40) || 'unknown', at:managerTime(row.updated_at) || managerTime(row.created_at), events };
}
const MANAGER_SIM_STATUS = ['in_drawer','in_unit','on_truck','bad','deactivated','removed'];
function managerSims(data) {
  const rows = (value, max) => Array.isArray(value) ? value.slice(0, max).filter(row => row && typeof row === 'object') : [];
  return {
    cards:rows(data.cards, 2000).map(row => ({ sim:managerText(row.sim, 24), carrier:managerText(row.carrier, 40),
      status:MANAGER_SIM_STATUS.includes(row.status) ? row.status : 'removed', location:managerText(row.location, 120), note:managerText(row.note, 300),
      by:managerText(row.updated_by || row.added_by, 80), at:managerTime(row.updated_at || row.added_at) })).filter(row => /^[0-9A-Z]{8,24}$/.test(row.sim)),
    notListed:rows(data.not_in_drawer, 100).map(row => ({ sim:managerText(row.sim, 24), detail:managerText(row.detail, 160), by:managerText(row.by, 80), at:managerTime(row.at) })).filter(row => row.sim),
  };
}
function managerGaps(data) {
  const rows = (value, max) => Array.isArray(value) ? value.slice(0, max).filter(row => row && typeof row === 'object') : [];
  const unit = row => [managerText(row.equipment_type, 40), managerText(row.unit_tag, 40)].filter(Boolean).join(' ');
  return {
    enforced:data.mode !== 'log',
    noHandoff:rows(data.on_truck_without_handoff, 100).map(row => ({ tech:managerText(row.service_tech, 80) || 'Service tech', unit:unit(row),
      by:managerText(row.loaded_by, 80), at:managerTime(row.loaded_at), listed:row.in_equipment_list !== false })).filter(row => row.unit),
    loaded:rows(data.loaded_without_handoff, 100).map(row => ({ tech:managerText(row.service_tech, 80) || 'Service tech', unit:unit(row),
      by:managerText(row.by, 80) || 'Unknown', reason:managerText(row.reason, 200), at:managerTime(row.at),
      kind:['owner_override','owner_edit_no_reason','system','log_mode'].includes(row.kind) ? row.kind : 'other' })).filter(row => row.unit),
    late:rows(data.handoffs_not_finished, 100).map(row => ({ units:(Array.isArray(row.units) ? row.units : []).slice(0, 20).map(item => managerText(item, 90)).filter(Boolean),
      from:managerText(row.from, 80) || 'IT', to:managerText(row.to, 80) || 'Service', state:managerText(row.state, 40) || 'unknown',
      hours:typeof row.hours_waiting === 'number' && Number.isFinite(row.hours_waiting) ? Math.max(0, Math.min(99999, row.hours_waiting)) : null })),
  };
}
async function managerRead() {
  const db = context().db;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Chicago' }).format(new Date());
  const board = await db.rpc('owner_tech_command_board_v2', { p_date:day });
  if (board?.error || !Array.isArray(board?.data?.service_techs)) throw new Error('unavailable');
  let exchanges = null;
  const paths = new Set();
  try {
    const handoffs = await db.rpc('techcheck_transfer_context_v1');
    if (!handoffs?.error && Array.isArray(handoffs?.data?.transfers)) exchanges = handoffs.data.transfers.slice(0, 100).map(row => managerExchange(row, paths)).filter(Boolean);
  } catch {}
  managerPhotoPaths = paths;
  // Units that went on a truck without a signed handoff, and handoffs left unsigned. Read only.
  let gaps = null;
  try {
    const read = await db.rpc('techcheck_handoff_gaps_v1', { p_since:new Date(Date.now() - 7 * 864e5).toISOString() });
    if (!read?.error && read?.data && typeof read.data === 'object') gaps = managerGaps(read.data);
  } catch {}
  // The SIM drawer: every card on hand and where each went. Read only here.
  let sims = null;
  try {
    const read = await db.rpc('sim_drawer_v1');
    if (!read?.error && read?.data && typeof read.data === 'object') sims = managerSims(read.data);
  } catch {}
  return { day, at:new Date().toISOString(), gaps, sims,
    techs:board.data.service_techs.slice(0, 100).map(managerTech).filter(Boolean),
    it:(Array.isArray(board.data.it_techs) ? board.data.it_techs : []).slice(0, 100).map(row => managerText(row?.name, 80)).filter(Boolean).map(name => ({ name, test:managerTest(name) })),
    exchanges };
}
// One truck, written with the same call and the same shape as the truck editor on Truck & team readiness.
function managerKit(value) {
  const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
  if (!exact(value, ['units','sims','stock']) || !exact(value.units, managerUnitTypes) || !exact(value.sims, ['1','2','3']) || !exact(value.stock, managerStock.map(([key]) => key))) return null;
  const label = text => typeof text === 'string' && text.length <= 40 && !/[\u0000-\u001f\u007f]/.test(text) ? text.trim() : null;
  const units = {}, sims = {}, stock = {};
  for (const type of managerUnitTypes) { const tag = label(value.units[type]); if (tag === null) return null; units[type] = tag; }
  for (const slot of ['1','2','3']) { const number = label(value.sims[slot]); if (number === null) return null; sims[slot] = number; }
  for (const [key] of managerStock) { const count = value.stock[key]; if (!Number.isSafeInteger(count) || count < 0 || count > 9999) return null; stock[key] = count; }
  return { units, sims, stock };
}
async function managerAnswer(data) {
  if (data.kind === 'hello') return {};
  if (data.kind === 'read') return { snapshot:await managerRead() };
  if (data.kind === 'photo') {
    if (typeof data.path !== 'string' || !managerPhotoPaths.has(data.path)) return { error:'invalid' };
    const signed = await context().db.storage.from('techcheck-transfer-evidence').createSignedUrl(data.path, 300);
    return !signed?.error && typeof signed?.data?.signedUrl === 'string' ? { url:signed.data.signedUrl } : { error:'unavailable' };
  }
  if (data.kind === 'simAdd') {
    const numbers = Array.isArray(data.numbers) ? data.numbers.filter(n => typeof n === 'string').slice(0, 500).map(n => n.slice(0, 40)) : null;
    if (!numbers?.length) return { error:'invalid' };
    const saved = await context().db.rpc('sim_drawer_add_v1', { p_numbers:numbers, p_carrier:managerText(data.carrier, 40) || null, p_note:managerText(data.note, 300) || null });
    if (saved?.error) return { error:'rejected', message:managerText(saved.error.message, 200) };
    const list = value => Array.isArray(value) ? value.slice(0, 500).map(v => managerText(v, 24)).filter(Boolean) : [];
    return { added:list(saved?.data?.added), already:list(saved?.data?.already_listed), bad:list(saved?.data?.not_a_sim_number) };
  }
  if (data.kind === 'simMark') {
    if (typeof data.sim !== 'string' || !['in_drawer','bad','deactivated','removed'].includes(data.status)) return { error:'invalid' };
    const saved = await context().db.rpc('sim_drawer_mark_v1', { p_number:data.sim.slice(0, 40), p_status:data.status, p_note:managerText(data.note, 300) || null });
    if (saved?.error) return { error:'rejected', message:managerText(saved.error.message, 200) };
    return {};
  }
  if (data.kind === 'truck') {
    const kit = managerKit(data.kit);
    if (!managerUuid(data.techId) || !kit) return { error:'invalid' };
    const saved = await context().db.rpc('owner_save_service_truck_inventory_batch_v1', { p_service_tech_id:data.techId, p_payload:kit });
    if (saved?.error) return { error:'rejected', message:managerText(saved.error.message, 200) };
    // The older truck screen keeps its own copy of the board. Let it read the change too.
    try { Promise.resolve(window.refreshData?.()).catch(() => {}); } catch {}
    return {};
  }
  return { error:'invalid' };
}
window.addEventListener('message', async event => {
  if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || !owner()) return;
  const data = event.data;
  if(data?.type==='COS_MHELP_LOCATION_EXPORT'){
    const launch=new URLSearchParams(window.location.search),value=data.location;
    if(launch.get('locationImport')!=='1'||data.nonce!==launch.get('locationNonce')||!window.opener||value?.contract!=='COS_MHELP_UNIT_LOCATION_V1'||value.unitName?.toUpperCase()!==launch.get('locationUnit')?.toUpperCase())return;
    window.opener.postMessage({type:'COS_MHELP_LOCATION_RESULT',nonce:data.nonce,location:value},'https://cos-camera-health-field-map.units581037.chatgpt.site');return;
  }
  if(data?.type==='COS_TV_BOARD_DISPLAY_MODE'&&typeof data.active==='boolean'&&context()?.getEffectiveRole()==='owner'){
    setFieldMapDisplay(frame,data.active);
    if(!data.active&&new URLSearchParams(location.search).get('tvBoard')==='1'){
      const url=new URL(location.href);for(const key of ['tvBoard','tvScope','tvDepartment'])url.searchParams.delete(key);history.replaceState(history.state,'',url);
    }
    return;
  }
  if(data?.type==='COS_FIELD_MAP_DISPLAY_MODE'&&typeof data.active==='boolean'){setFieldMapDisplay(frame,data.active);return;}
  if (!data || typeof data !== 'object') return;
  if (data.type === 'COS_MANAGER_REQUEST' && managerId(data.requestId) && typeof data.kind === 'string') {
    const requestedUser = owner(), target = event.source;
    let reply = { error:'unavailable' };
    if (!managerReady()) reply = { error:typeof context()?.db?.rpc === 'function' ? 'forbidden' : 'unavailable' };
    else { try { reply = await managerAnswer(data); } catch {} }
    // An answer read for one account is never handed to another.
    if (target === frame?.contentWindow && requestedUser && owner() === requestedUser && managerReady()) target.postMessage({ ...reply, type:'COS_MANAGER_RESPONSE', requestId:data.requestId }, event.origin);
    else if (target === frame?.contentWindow) target.postMessage({ type:'COS_MANAGER_RESPONSE', requestId:data.requestId, error:reply.error === 'unavailable' ? 'unavailable' : 'forbidden' }, event.origin);
    return;
  }
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
  if (data.type === 'COS_OPERATIONS_WORKSPACE_ACTIVE' && typeof data.workspace === 'string') {
    nativeWorkspace = data.workspace;
    if (nativeWorkspace === 'Tech Check') techHomePending = false;
    else if (techHomePending) showTechCheckHome();
    else if (!techHomePending && !activeTool && toolFromHash() === 'home') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
  if (data.type === 'COS_OPERATIONS_NAVIGATE' && typeof data.route === 'string') navigate(data.route);
});
window.addEventListener('techcheck:view-changed', event => {
  if (!changingView && event.detail?.view === 'owner') {
    legacyOpen = false;
    if (activeTool) { activeTool = null; setToolHash(null); showTechCheckHome(); }
  }
  present();
});
document.getElementById('cosOperationsReturn')?.addEventListener('click', () => navigate('operations'));
document.getElementById('cosOperationsTechReturn')?.addEventListener('click', () => navigate('operations'));
const observer = new MutationObserver(present);
if (ownerView) {
  observer.observe(ownerView, {attributes:true, attributeFilter:['class']});
  new MutationObserver(() => {
    if (!legacyOpen || changingView || !owner()) return;
    const route = ownerView.dataset?.ownerRoute;
    if (route === 'today' || route === 'more') { navigate('operations'); return; }
    if (ownerRoutes.has(route) && route !== activeTool) {
      activeTool = route; setToolHash(route); present();
    }
  }).observe(ownerView, {attributes:true, attributeFilter:['data-owner-route']});
}
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

