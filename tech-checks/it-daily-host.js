import {mountTransferDesk} from './transfers/desk.js';
import {isPhoneSurface} from './transfers/model.js';
import {transferReadiness,transferReadinessMessage} from './transfers/readiness.js';
import {IT_DAILY_ONLY} from './it-feature-availability.js';
import {setFieldMapDisplay} from './field-map-display-host.js';
// Reversible UI availability only. Existing authorization and records are unchanged.
window.COS_IT_DAILY_ONLY = IT_DAILY_ONLY;
const context = () => window.TechCheckContext;
// Legacy COS account has no separate native-platform identity. The server RPC below
// remains the authority for IT camera access; this ID only selects the camera UI.
const legacyCameraOnlyIT = '05bf20fe-19f7-4db7-ac05-5b2a5f681fdf';
let disposeTransfer = null;
let root = null, frame = null, scopeKey = '', revision = 0, authObserved = false;
let fitScheduled = false;
function fitDailyFrame() {
  if (!frame?.isConnected || frame.style.position === 'fixed') return;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop || 0, viewportHeight = viewport?.height || window.innerHeight;
  const frameTop = frame.getBoundingClientRect().top;
  if (![viewportTop,viewportHeight,frameTop].every(Number.isFinite) || viewportHeight <= 0) return;
  const remaining = viewportTop + viewportHeight - Math.max(frameTop,viewportTop) - 12;
  const height = Math.max(1, Math.floor(Math.min(viewportHeight,remaining))) + 'px';
  if (frame.style.height !== height) frame.style.height = height;
}
function scheduleFrameFit() {
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => { fitScheduled = false; fitDailyFrame(); });
}
const shielded = new Map();
const transientOverlays = new Set(['wlHelpOverlay','wlGuidedTourLayer','wlTechMenuPanel','wlNotificationPanel']);
const visible = node => Boolean(node && !node.classList.contains('hidden') && node.style.display !== 'none');
function scope() {
  if (!IT_DAILY_ONLY || !visible(document.getElementById('appView'))) return null;
  const c = context(), id = c?.getSession()?.user?.id, p = c?.getProfile(), role = c?.getRole();
  if (!id) return null;
  const profileLive=p?.user_id===id && p?.active===true && !p?.archived_at;
  const effective = c?.getEffectiveRole();
  if (role !== 'it' && !(role === 'owner' && (effective === 'it' || effective === 'owner' && visible(document.getElementById('view-it'))))) return null;
  return {id, role, profileLive, phone:role==='it'&&isPhoneSurface(), preview: document.body.classList.contains('owner-test-role-preview'), effective};
}
function key(value) { return value ? [value.id,value.role,value.effective,value.preview,value.profileLive,value.phone].join(':') : ''; }
function clearFrame() { disposeTransfer?.(); disposeTransfer=null; setFieldMapDisplay(frame,false); frame?.remove(); frame = null; }
function shield(node) {
  if (!node || node === root) return;
  if (!shielded.has(node)) shielded.set(node,{inert:node.inert,display:node.style.getPropertyValue('display'),priority:node.style.getPropertyPriority('display')});
  if (!node.inert) node.inert = true;
  if(node.style.getPropertyValue('display')!=='none'||node.style.getPropertyPriority('display')!=='important')node.style.setProperty('display','none','important');
  if (!node.hasAttribute('data-cos-it-paused')) node.setAttribute('data-cos-it-paused','');
}
function restore() {
  for (const [node,saved] of shielded) {
    if(transientOverlays.has(node.id))node.classList.add('hidden');
    node.inert=saved.inert;
    if(saved.display)node.style.setProperty('display',saved.display,saved.priority);else node.style.removeProperty('display');
    node.removeAttribute('data-cos-it-paused');
  }
  document.getElementById('wlHelpCoachToast')?.classList.remove('show');
  document.querySelectorAll('.wl-guided-tour-target').forEach(node=>node.classList.remove('wl-guided-tour-target'));
  shielded.clear();
}
function status(message, retry = false) {
  if (!root) return;
  clearFrame(); root.replaceChildren();
  const panel = document.createElement('section'); panel.className = 'cos-it-daily-status';
  const title = document.createElement('h1'); title.textContent = scope()?.phone?'Equipment Check Out / Check In':'Camera Health and Fleet Map';
  const note = document.createElement('p'); note.textContent = message; note.setAttribute('role','status');
  panel.append(title,note);
  if (retry) { const button = document.createElement('button'); button.type='button'; button.textContent='Retry daily views'; button.onclick=()=>{scopeKey='';present();}; panel.append(button); }
  root.append(panel);
}
async function verify(value) {
  if (!value.profileLive || value.preview || (value.role === 'it' && value.effective !== 'it')) return false;
  if (value.role === 'owner') return value.effective === 'owner';
  let timer;
  try { const response = await Promise.race([context().db.rpc('cos_verified_fleet_capabilities_v1'),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),12000);})]); return response && !response.error && response.data?.fleetRead === true; } catch { return false; } finally {clearTimeout(timer);}
}
async function open(value, generation, handoffFailure = null) {
  const permitted = await verify(value);
  if (generation !== revision || key(scope()) !== key(value) || !root) return;
  if (!permitted) {
    status(value.preview ? 'Test IT is a preview persona, not a verified IT account. Sign in with an authorized account.' : 'Daily view access could not be verified. Sign in again with your authorized IT account.', !value.preview);
    // An unverified actor cannot mount transfer controls or request private data.
    if(value.phone){
      const actions=document.createElement('div');actions.className='cos-it-handoff-actions';
      for(const label of ['Check Out / Hand Off','Check In / Return']){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=true;actions.append(button);
      }
      root.querySelector('.cos-it-daily-status')?.append(actions);
    } else {
      const link=document.createElement('a');link.href='./camera-health.html?itDaily=1';
      link.textContent='Open Camera Health sign-in';link.className='btn';
      root.querySelector('.cos-it-daily-status')?.append(link);
    }
    return;
  }
  // Phone Tech Check is dedicated to equipment check-out and check-in.
  // Never substitute Camera Health or bypass transfer readiness if unavailable.
  const handoffSelected=value.phone;
  let handoffFallback = null;
  if(handoffSelected){
    const readiness=handoffFailure?{ready:false,reason:handoffFailure}:await transferReadiness(context(),'it');
    if(generation!==revision || key(scope())!==key(value) || !root)return;
    if(readiness.ready){root.replaceChildren();const host=document.createElement('section');root.append(host);disposeTransfer=mountTransferDesk(host,context(),{role:'it',onUnavailable:reason=>{if(generation!==revision||key(scope())!==key(value))return;status('Checking equipment handoff availability…');void open(value,generation,reason);}});return;}
    handoffFallback=document.createElement('section');handoffFallback.className='cos-it-daily-status';
    handoffFallback.setAttribute('aria-label','Equipment handoff availability');
    const note=document.createElement('p');note.setAttribute('role','status');
    note.textContent=transferReadinessMessage(readiness.reason)+' Check Out and Check In remain unavailable until the required backend and inventory safeguards are verified.';
    const retry=document.createElement('button');retry.type='button';retry.textContent='Check handoff availability';
    retry.onclick=()=>{if(generation!==revision || key(scope())!==key(value))return;scopeKey='';present();};
    const actions=document.createElement('div');actions.className='cos-it-handoff-actions';
    for(const label of ['Check Out / Hand Off','Check In / Return']){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=true;actions.append(button);
    }
    handoffFallback.append(actions,note,retry);
  }
  if(value.phone) {
    // A failed rollout must not display a substitute workflow on the phone.
    root.replaceChildren(handoffFallback);
    return;
  }
  frame = document.createElement('iframe'); frame.id='cosITDailyFrame'; frame.title=value.role==='it'&&value.id===legacyCameraOnlyIT?'Camera Health (legacy COS account)':'Fleet Dashboard and Camera Health';
  frame.allow='geolocation; fullscreen'; frame.allowFullscreen=true; frame.referrerPolicy='same-origin';
  frame.src=value.role==='it'&&value.id===legacyCameraOnlyIT
    ? './camera-health.html?itDaily=1'
    : './operations/dist/index.html?mode='+(value.role==='it'?'fleet':'it-daily')+'&v=named-handoffs-v1#fleet-dashboard';
  frame.addEventListener('load',()=>{setFieldMapDisplay(frame,false);scheduleFrameFit();});
  root.replaceChildren(frame);
  scheduleFrameFit();
}
function present() {
  const c=context();
  if (!authObserved && c?.db?.auth?.onAuthStateChange) {
    authObserved=true;
    c.db.auth.onAuthStateChange(event=>{if(event==='TOKEN_REFRESHED')return; revision++; scopeKey=''; clearFrame(); queueMicrotask(present);});
  }
  const value=scope(), next=key(value);
  if (!value) { if (scopeKey || root) {revision++; scopeKey=''; clearFrame(); root?.remove(); root=null; restore();} return; }
  const view=document.getElementById('view-it');
  if (!view) return;
  // Old routes and delayed legacy redraws never expose paused controls.
  if (value.role==='it' && !visible(view)) window.show?.('it');
  if (!root) {root=document.createElement('section');root.id='cosITDailyHost';view.append(root);}
  if (root.parentElement!==view) view.append(root);
  if(root.style.getPropertyValue('display')!=='block'||root.style.getPropertyPriority('display')!=='important')root.style.setProperty('display','block','important');
  for (const child of view.children) shield(child);
  for (const id of ['wlHelpOverlay','wlGuidedTourLayer','wlTechMenuPanel','wlNotificationPanel','techMenuButton','cosProductionAssignmentsButton','cosProductionAssignmentsOverlay']) shield(document.getElementById(id));
  if (value.role==='it') for (const id of ['view-owner','view-svc','view-morning']) shield(document.getElementById(id));
  scheduleFrameFit();
  if (next===scopeKey) return;
  revision++;scopeKey=next;clearFrame();status(value.phone?'Opening equipment Check Out / Check In…':'Opening Camera Health and Fleet Map…');void open(value,revision);
}
if (IT_DAILY_ONLY) {
  const style=document.createElement('style');
  style.textContent='[data-cos-it-paused]{display:none!important}#cosITDailyHost{width:100%;min-width:0;display:block!important}#cosITDailyFrame{display:block;width:100%;height:60dvh;min-height:0;border:0;background:#0b111c}.cos-it-daily-status{padding:28px;background:#111b2a;border:1px solid #2c3b51;border-radius:16px;color:#e6edf7}.cos-it-daily-status button{min-height:44px}.cos-it-handoff-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}.cos-it-handoff-actions button{min-height:58px;font-weight:700;border-radius:10px;white-space:normal}.cos-it-handoff-actions button:disabled{opacity:.6;cursor:not-allowed}@media(max-width:420px){.cos-it-handoff-actions{grid-template-columns:1fr}}';
  document.head.append(style);
  // Runs before protected legacy delegated/inline handlers; inert also blocks keyboard entry.
  for (const type of ['click','submit','change','input']) window.addEventListener(type,event=>{
    if (!scope()) return;
    const target=event.target;
    if (target?.closest?.('#cosITDailyHost')) return;
    if (target?.closest?.('#view-it,[data-cos-it-paused],#techMenuButton')) {event.preventDefault();event.stopImmediatePropagation();}
  },true);
  window.addEventListener('message',async event=>{
    const value=scope(), target=frame?.contentWindow, generation=revision;
    if (!value || event.origin!==location.origin || event.source!==target) return;
    const data=event.data;
    const current=()=>generation===revision && target===frame?.contentWindow && key(scope())===key(value);
    if (data?.type==='COS_OPERATIONS_TOKEN_REQUEST' && typeof data.requestId==='string' && /^[a-zA-Z0-9-]{1,100}$/.test(data.requestId)) {
      let token=null;
      try { const fresh=await context().db.auth.getSession();if(current() && fresh.data?.session?.user?.id===value.id && await verify(value) && current())token=fresh.data.session.access_token; } catch {}
      if (!current()) return;
      target.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:data.requestId,accessToken:token,role:token?value.role:null},location.origin);
      if (!token) status('Your current daily-view access could not be verified. Refresh or sign in again.',true);
    } else if(data?.type==='COS_FIELD_MAP_DISPLAY_MODE' && typeof data.active==='boolean') {setFieldMapDisplay(frame,data.active);scheduleFrameFit();}
    else if(data?.type==='COS_OPERATIONS_NAVIGATE' && data.route==='camera-health') location.assign('./camera-health.html?itDaily=1');
    else if(data?.type==='COS_OPERATIONS_NAVIGATE' && data.route==='logout') window.logout?.();
    // Only the allowed Camera Health tool and sign-out can leave this frame.
  });
  let scheduled=false;
  new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;present();});}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
  for(const name of ['techcheck:view-changed','pageshow','popstate','hashchange'])window.addEventListener(name,present);
  window.addEventListener('resize',()=>{scheduleFrameFit();present();});
  window.addEventListener('scroll',scheduleFrameFit,{passive:true});
  window.visualViewport?.addEventListener('resize',scheduleFrameFit);
  window.visualViewport?.addEventListener('scroll',scheduleFrameFit);
  new ResizeObserver(scheduleFrameFit).observe(document.getElementById('appView') || document.body);
  document.addEventListener('visibilitychange',present);present();
}
