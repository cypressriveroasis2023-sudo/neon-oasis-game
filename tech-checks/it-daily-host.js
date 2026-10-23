import {mountTransferDesk} from './transfers/desk.js';
import {isPhoneSurface} from './transfers/model.js';
import {transferReadiness,transferReadinessMessage} from './transfers/readiness.js';
import {IT_DAILY_ONLY} from './it-feature-availability.js';
import {setFieldMapDisplay} from './field-map-display-host.js';
// Reversible UI availability only. Existing authorization and records are unchanged.
window.COS_IT_DAILY_ONLY = IT_DAILY_ONLY;
const context = () => window.TechCheckContext;
let disposeTransfer = null, phoneBoard = false;
let root = null, frame = null, scopeKey = '', revision = 0, authObserved = false;
let fitScheduled = false;
let boardLoadTimer = null;
let accessRecheck = null;
let authSubject; // undefined until the auth listener has supplied its first session.
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
function mainWorkspaceLink(href){
  try{
    const home=new URL('./',location.href),url=new URL(href,location.href);
    return url.origin===home.origin && [home.pathname,home.pathname+'index.html'].includes(url.pathname)?url:null;
  }catch{return null;}
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
  if (!id || (authSubject !== undefined && authSubject !== id)) return null;
  const profileLive=p?.user_id===id && p?.active===true && !p?.archived_at;
  const effective = c?.getEffectiveRole();
  if (role !== 'it' && !(role === 'owner' && (effective === 'it' || effective === 'owner' && visible(document.getElementById('view-it'))))) return null;
  const preview=document.body.classList.contains('owner-test-role-preview');
  // An Owner's IT phone preview shows the intended actions as disabled; preview
  // remains unauthorized by verify() and cannot mount or submit transfers.
  return {id, role, profileLive, phone:isPhoneSurface()&&(role==='it'||preview), preview, effective};
}
function key(value) { return value ? [value.id,value.role,value.effective,value.preview,value.profileLive,value.phone].join(':') : ''; }
function clearFrame() {
  clearTimeout(boardLoadTimer);boardLoadTimer=null;
  // Retire references before DOM teardown: detaching a loading iframe can fire
  // its load/unload callbacks synchronously. Those callbacks must see it as stale.
  const obsolete=frame, dispose=disposeTransfer;frame=null;disposeTransfer=null;
  dispose?.();setFieldMapDisplay(obsolete,false);obsolete?.remove();
}

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
  panel.append(title);
  // Show the two safe, disabled phone actions immediately while the live
  // account and backend readiness checks run; this is not a custody form.
  if (scope()?.phone) {
    const actions=document.createElement('div');actions.className='cos-it-handoff-actions';
    for (const label of ['Check Out / Hand Off','Check In / Return']) {
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.disabled=true;actions.append(button);
    }
    panel.append(actions);
  }
  panel.append(note);
  if (retry) { const button = document.createElement('button'); button.type='button'; button.textContent='Retry access check'; button.onclick=()=>{scopeKey='';present();}; panel.append(button); }
  root.append(panel);
}
async function verify(value) {
  if (!value.profileLive || value.preview || (value.role === 'it' && value.effective !== 'it')) return false;
  if (value.role === 'owner') return value.effective === 'owner';
  let timer;
  try { const response = await Promise.race([context().db.rpc('cos_verified_fleet_capabilities_v1'),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),12000);})]); return response && !response.error && response.data?.fleetRead === true; } catch { return false; } finally {clearTimeout(timer);}
}
function reconfirmAccess(value,generation){
  if(accessRecheck?.generation===generation)return;
  const check={generation};accessRecheck=check;
  // Leave the auth callback before making another authenticated request.
  setTimeout(async()=>{
    try{
      if(generation!==revision || key(scope())!==key(value))return;
      const permitted=await verify(value);
      if(generation===revision && key(scope())===key(value) && !permitted){
        revision++; // Discard in-flight opens/token responses from the old access check.
        status('Your current daily-view access could not be verified. Refresh or sign in again.',true);
      }
    }finally{if(accessRecheck===check)accessRecheck=null;}
  },0);
}
function phoneNavigation(value,generation){
  const nav=document.createElement('nav');nav.className='cos-it-handoff-actions';nav.setAttribute('aria-label','IT daily views');
  for(const [label,board] of [['Check out / check in',false],['Fleet map & troubleshooting',true]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(phoneBoard===board));
    button.onclick=()=>{
      if(generation!==revision||key(scope())!==key(value)||board===phoneBoard)return;
      if(root.querySelector('form')){let note=root.querySelector('[data-daily-switch-note]');if(!note){note=document.createElement('p');note.dataset.dailySwitchNote='';note.setAttribute('role','status');nav.after(note);}note.textContent='Finish or close the current handoff form before switching views.';return;}
      phoneBoard=board;clearFrame();root.replaceChildren();void open(value,++revision);
    };nav.append(button);
  }
  return nav;
}
async function open(value, generation, handoffFailure = null) {
  const permitted = await verify(value);
  if (generation !== revision || key(scope()) !== key(value) || !root) return;
  if (!permitted) {
    status(value.preview ? 'This IT preview persona is not a verified IT account. Sign in with an authorized account.' : 'Daily view access could not be verified. Sign in again with your authorized IT account.', !value.preview);
    // An unverified actor cannot mount transfer controls or request private data.
    if(!value.phone){
      const link=document.createElement('a');link.href='./camera-health.html?itDaily=1';
      link.textContent='Open Camera Health sign-in';link.className='btn';
      root.querySelector('.cos-it-daily-status')?.append(link);
    }
    return;
  }
  // Handoffs remain the phone default and are reachable on desktop. Fleet is a verified read view,
  // never an automatic substitute for an unavailable transfer backend.
  const handoffSelected=!phoneBoard;
  let handoffFallback = null;
  if(handoffSelected){
    const readiness=handoffFailure?{ready:false,reason:handoffFailure}:await transferReadiness(context(),'it');
    if(generation!==revision || key(scope())!==key(value) || !root)return;
    if(readiness.ready){root.replaceChildren(phoneNavigation(value,generation));const host=document.createElement('section');root.append(host);disposeTransfer=mountTransferDesk(host,context(),{role:'it',onUnavailable:reason=>{if(generation!==revision||key(scope())!==key(value))return;status('Checking equipment handoff availability…');void open(value,generation,reason);}});return;}
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
    const title=document.createElement('h1');title.textContent='Equipment Check Out / Check In';
    handoffFallback.append(title,actions,note,retry);
  }
  if(handoffSelected) {
    // A failed rollout must not display a substitute workflow on the phone.
    root.replaceChildren(phoneNavigation(value,generation),handoffFallback);
    return;
  }
  frame = document.createElement('iframe'); frame.id='cosITDailyFrame'; frame.title='Fleet Dashboard and Camera Health';
  frame.allow='geolocation; fullscreen'; frame.allowFullscreen=true; frame.referrerPolicy='same-origin';
  frame.src='./operations/dist/index.html?mode='+(value.role==='it'?'fleet':'it-daily')+'&v=it-fleet-parity-20261022#fleet-dashboard';
  const board=document.createElement('section');board.className='cos-it-board-loading';board.style.position='relative';board.setAttribute('aria-busy','true');
  const pending=document.createElement('section');pending.className='cos-it-daily-status';pending.style.cssText='position:absolute;inset:0;z-index:1;margin:0;min-height:180px';
  const heading=document.createElement('h1');heading.textContent='Camera Health and Fleet Map';
  const note=document.createElement('p');note.setAttribute('role','status');note.textContent='Opening your board…';
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry opening board';retry.hidden=true;
  const currentFrame=frame;
  const current=()=>generation===revision && frame===currentFrame && key(scope())===key(value);
  retry.onclick=()=>{if(!current())return;clearFrame();status('Opening Camera Health and Fleet Map…');void open(value,++revision);};
  pending.append(heading,note,retry);
  frame.style.visibility='hidden';frame.inert=true;
  frame.addEventListener('load',()=>{
    if(!current())return;
    try{
      const href=currentFrame.contentWindow.location.href,doc=currentFrame.contentDocument;
      if(href==='about:blank'||!doc)return;
      // A root COS page must never become another board inside this board.
      // Cover scripted navigation as well as links from older cached diagnostics.
      const home=mainWorkspaceLink(href);
      if(home){location.assign(home.href);return;}
      const targetHome=link=>{if(link && mainWorkspaceLink(link.href))link.target='_top';};
      for(const link of doc.querySelectorAll('a[href]'))targetHome(link);
      doc.addEventListener('click',event=>{if(current())targetHome(event.target?.closest?.('a[href]'));},true);
    }catch{note.textContent='The board could not finish opening. Retry to open it again.';retry.hidden=false;return;}
    clearTimeout(boardLoadTimer);boardLoadTimer=null;
    pending.remove();board.setAttribute('aria-busy','false');currentFrame.style.visibility='';currentFrame.inert=false;
    setFieldMapDisplay(currentFrame,false);scheduleFrameFit();
  });
  board.append(frame,pending);
  root.replaceChildren(phoneNavigation(value,generation),board);
  boardLoadTimer=setTimeout(()=>{if(!current())return;note.textContent='The board is taking longer than usual to open. You can keep waiting or retry.';retry.hidden=false;},20000);
  scheduleFrameFit();
}
function present() {
  const c=context();
  if (!authObserved && c?.db?.auth?.onAuthStateChange) {
    authObserved=true;
    c.db.auth.onAuthStateChange((event,session)=>{
      const value=scope(), subject=session?.user?.id || null;
      authSubject=subject;
      // Auth can reconfirm SIGNED_IN when a tab regains focus. Keep the same
      // verified workspace (and any handoff draft) mounted for the same scope.
      // A different subject, sign-out or role/profile change still clears it.
      const reaffirmed=['SIGNED_IN','INITIAL_SESSION','TOKEN_REFRESHED'].includes(event);
      if(reaffirmed && value?.profileLive && subject===value.id && key(value)===scopeKey){
        reconfirmAccess(value,revision);queueMicrotask(present);return;
      }
      revision++; scopeKey=''; clearFrame(); queueMicrotask(present);
    });
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
  revision++;scopeKey=next;phoneBoard=!value.phone;clearFrame();status(value.phone?'Opening equipment Check Out / Check In…':'Opening Camera Health and Fleet Map…');void open(value,revision);
}
if (IT_DAILY_ONLY) {
  const style=document.createElement('style');
  style.textContent='[data-cos-it-paused]{display:none!important}#cosITDailyHost{width:100%;min-width:0;display:block!important}#cosITDailyFrame{display:block;width:100%;height:60dvh;min-height:0;border:0;background:#0b111c}.cos-it-daily-status{padding:28px;background:#111b2a;border:1px solid #2c3b51;border-radius:16px;color:#e6edf7}.cos-it-daily-status button{min-height:44px;padding:10px 14px;background:#303a44;color:#fff;border:1px solid #6b7785;border-radius:9px}.cos-it-daily-status h1{font-size:24px;line-height:1.25;margin:0 0 12px}.cos-it-handoff-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}.cos-it-handoff-actions button{min-height:58px;padding:12px;font-size:16px;font-weight:700;border:1px solid #66717d;border-radius:10px;white-space:normal;background:#252d36;color:#fff}.cos-it-handoff-actions button[aria-pressed=true]{background:#97132c;border-color:#ed3652;color:#fff}.cos-it-handoff-actions button:disabled{opacity:1;background:#252d36;color:#cbd4dd;border-color:#566371;cursor:not-allowed}@media(max-width:420px){.cos-it-handoff-actions{grid-template-columns:1fr}}';
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
    else if(data?.type==='COS_OPERATIONS_NAVIGATE' && data.route==='camera-health') location.assign('./camera-health.html?itDaily=1&diagnostics=1');
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
