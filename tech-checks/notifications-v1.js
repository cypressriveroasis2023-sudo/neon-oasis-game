// Tech Check notification transport — isolated from workflow/UI logic.
// Uses the shared application context so Owner Test and technician identity stay authoritative.
const VAPID_PUBLIC_KEY = 'BAvDfBdTqTbyOxAOYDQ25EfMKregOkdUmOkVW_BlHEQ4CP--otdlOCrDobnj7eVUg-5YMcjVM8sfLHg_qNr2fq0';

function context() {
  const ctx = window.TechCheckContext;
  if (!ctx?.db) throw new Error('Tech Check application context is not ready.');
  return ctx;
}

function vapidKeyBytes(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

async function pushAlertState() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
  if (!supported) return { supported:false, permission:'unsupported', subscribed:false, ready:false };
  const permission = Notification.permission;
  let subscribed = false;
  if (permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      subscribed = Boolean(await reg.pushManager.getSubscription());
    } catch {}
  }
  return { supported:true, permission, subscribed, ready:permission === 'granted' && subscribed };
}

async function registerPhonePush() {
  const ctx = context();
  const tech = ctx.getEffectiveIdentity?.();
  if (!tech?.id) throw new Error('Please sign in again.');
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh || '';
  const auth = json.keys?.auth || '';
  if (!p256dh || !auth) throw new Error('This device did not return a valid push subscription.');
  const { error } = await ctx.db.from('push_subscriptions').upsert({
    user_id: tech.id,
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    user_agent: navigator.userAgent,
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return subscription;
}

async function preferences() {
  const ctx=context(), tech=ctx.getEffectiveIdentity?.();
  if (!tech?.id) throw new Error('Please sign in again.');
  const { data } = await ctx.db.from('notification_preferences').select('*').eq('user_id', tech.id).maybeSingle();
  return data || { new_assignments:true, returned_units:true, equipment_ready_service:true, owner_actions:true, browser_notifications:false };
}

async function inbox(limit=30) {
  const ctx=context(), tech=ctx.getEffectiveIdentity?.();
  if (!tech?.id) return [];
  const { data, error } = await ctx.db.from('app_notifications').select('*').eq('recipient_user_id', tech.id).order('created_at',{ascending:false}).limit(limit);
  return error ? [] : (data || []);
}

async function savePreferences(values={}) {
  const ctx=context(), current=await preferences();
  const { error } = await ctx.db.rpc('save_my_notification_preferences', {
    p_new_assignments: values.new_assignments ?? Boolean(current.new_assignments),
    p_returned_units: values.returned_units ?? Boolean(current.returned_units),
    p_equipment_ready_service: values.equipment_ready_service ?? Boolean(current.equipment_ready_service),
    p_owner_actions: values.owner_actions ?? Boolean(current.owner_actions),
    p_browser_notifications: values.browser_notifications ?? Boolean(current.browser_notifications),
  });
  if (error) throw error;
}

async function showSystemNotification(row) {
  const prefs=await preferences();
  if (!prefs.browser_notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator) {
      const reg=await navigator.serviceWorker.ready;
      await reg.showNotification(row.title,{body:row.body,tag:'techcheck-'+row.id,data:{url:location.href},icon:'./icon-192.png',badge:'./favicon-32x32.png'});
    } else new Notification(row.title,{body:row.body});
  } catch {}
}

let realtimeChannel=null, realtimeUserId=null;
async function setupRealtime(force=false,onInsert=null) {
  const ctx=context(), tech=ctx.getEffectiveIdentity?.();
  if (document.getElementById('appView')?.classList.contains('hidden') || !tech?.id) return;
  if (!force && realtimeUserId===tech.id && realtimeChannel) return;
  if (realtimeChannel) {
    const old=realtimeChannel; realtimeChannel=null; realtimeUserId=null;
    try { await ctx.db.removeChannel(old); } catch {}
  }
  realtimeUserId=tech.id;
  const channel=ctx.db.channel('tech-check-notifications-'+tech.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'app_notifications',filter:'recipient_user_id=eq.'+tech.id},payload=>{
      showSystemNotification(payload.new);
      if (typeof onInsert==='function') onInsert(payload);
      window.dispatchEvent(new CustomEvent('techcheck:notification',{detail:payload}));
    });
  realtimeChannel=channel;
  channel.subscribe(status=>{
    if(channel!==realtimeChannel)return;
    if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
      realtimeUserId=null;
      if(!document.hidden&&navigator.onLine!==false)setTimeout(()=>setupRealtime(true,onInsert),1800);
    }
  });
}


function escHtml(value='') {
  return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
async function refreshBadge(){
  if(document.getElementById('appView')?.classList.contains('hidden'))return;
  try{if('clearAppBadge' in navigator)await navigator.clearAppBadge();}catch{}
}
function ensurePanel(){
  let panel=document.getElementById('wlNotificationPanel'); if(panel)return panel;
  panel=document.createElement('div'); panel.id='wlNotificationPanel'; panel.className='wl-notify-overlay hidden';
  panel.innerHTML=`<div class='wl-notify-sheet'><div class='wl-notify-head'><div><div class='wl-next-kicker'>TECH CHECK</div><h2>Notifications</h2></div><button class='mini' data-wl-notify-close>Close</button></div><div id='wlNotifyBody'></div></div>`;
  document.body.append(panel); return panel;
}
function toggleHtml(id,label,checked,detail=''){return `<label class='wl-notify-toggle'><span><b>${escHtml(label)}</b>${detail?`<small>${escHtml(detail)}</small>`:''}</span><input id='${id}' type='checkbox' ${checked?'checked':''}></label>`;}
async function openPanel(){
  const panel=ensurePanel(),body=document.getElementById('wlNotifyBody');
  const [prefs,rows,pushState]=await Promise.all([preferences(),inbox(30),pushAlertState()]);
  const role=context().getEffectiveRole?.()||context().getRole?.(),permission=pushState.permission,standalone=window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true;
  const status=pushState.ready?'Phone alerts are ON. Tech Check can notify this device even when the app is closed.':permission==='denied'?'Alerts are blocked in this device’s notification settings.':!pushState.supported?'Push alerts are not available in this browser. On iPhone, add Tech Check to the Home Screen and open the installed app.':(!standalone&&/iPhone|iPad|iPod/i.test(navigator.userAgent))?'On iPhone, add Tech Check to the Home Screen first, then open it and enable phone alerts.':'Tap Enable to allow Tech Check to notify this phone when work is assigned.';
  const toggles=[role!=='owner'?toggleHtml('wlPrefAssignments','New job assignments',prefs.new_assignments,'When the Owner assigns an MHelpDesk job directly to you.'):'',role==='it'?toggleHtml('wlPrefReturns','Returned units waiting for IT',prefs.returned_units,'When Service sends a unit back for IT Intake.'):'',role==='service'?toggleHtml('wlPrefService','Equipment ready for Service',prefs.equipment_ready_service,'When IT creates a Service handoff for checkout.'):'',role==='owner'?toggleHtml('wlPrefOwner','Owner actions',prefs.owner_actions,'When IT finishes intake and MHelpDesk inventory confirmation is needed.'):''].join('');
  const rowsHtml=rows.map(n=>`<button class='wl-notify-item ${n.read_at?'':'unread'}' data-wl-notification-id='${escHtml(n.id)}' ${n.assignment_id?`data-wl-notification-assignment='${escHtml(n.assignment_id)}'`:''}><span class='wl-notify-dot'></span><span><b>${escHtml(n.title)}</b><small>${escHtml(n.body)}</small><em>${new Date(n.created_at).toLocaleString()}</em></span></button>`).join('');
  body.innerHTML=`<div class='wl-notify-section'><h3>Alert Settings</h3>${toggles}<div class='wl-notify-system'><div><b>iPhone / Browser Alerts</b><div class='small'>${escHtml(status)}</div></div><button class='mini' data-wl-enable-browser-alerts>${pushState.ready?'Enabled':'Enable'}</button></div><div class='small top8'>Once enabled on this device, new Owner-assigned jobs can appear as phone notifications while Tech Check is closed. The Home Screen app badge also reflects unread Tech Check notifications when supported by the phone.</div><button class='btn' data-wl-save-notify>Save Notification Settings</button></div><div class='wl-notify-section'><div class='sectiontitle'><h3>Notification Inbox</h3><button class='mini' data-wl-notify-read-all>Mark all read</button></div><div class='wl-notify-list'>${rowsHtml||"<div class='ok'><b>✓ No notifications yet.</b></div>"}</div></div>`;
  panel.classList.remove('hidden');
}
async function saveSettings(){
  const prefs=await preferences(),role=context().getEffectiveRole?.()||context().getRole?.(),browserAllowed=typeof Notification!=='undefined'&&Notification.permission==='granted';
  await savePreferences({new_assignments:role==='owner'?Boolean(prefs.new_assignments):Boolean(document.getElementById('wlPrefAssignments')?.checked??prefs.new_assignments),returned_units:role==='it'?Boolean(document.getElementById('wlPrefReturns')?.checked??prefs.returned_units):Boolean(prefs.returned_units),equipment_ready_service:role==='service'?Boolean(document.getElementById('wlPrefService')?.checked??prefs.equipment_ready_service):Boolean(prefs.equipment_ready_service),owner_actions:role==='owner'?Boolean(document.getElementById('wlPrefOwner')?.checked??prefs.owner_actions):Boolean(prefs.owner_actions),browser_notifications:browserAllowed});
  alert('Notification settings saved.'); await openPanel();
}
async function enableBrowserAlerts(){
  const state=await pushAlertState(); if(!state.supported)return alert('Phone push notifications are not available here. On iPhone, add Tech Check to the Home Screen, open the installed app, and try again.');
  const standalone=window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true;
  if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!standalone)return alert('On iPhone, install Tech Check to your Home Screen first. Then open the Home Screen app and tap Enable again.');
  try{const permission=await Notification.requestPermission();if(permission!=='granted')return alert('Notification permission was not enabled on this device.');await registerPhonePush();await saveSettings();alert('Phone alerts are enabled for Tech Check on this device.');}catch(error){console.warn('Could not enable Tech Check push notifications',error);alert(error?.message||'Could not enable phone alerts on this device.');}
}

window.TechCheckNotifications = Object.freeze({
  pushAlertState,
  registerPhonePush,
  preferences,
  inbox,
  savePreferences,
  showSystemNotification,
  setupRealtime,
  refreshBadge,
  openPanel,
  saveSettings,
  enableBrowserAlerts,
});
