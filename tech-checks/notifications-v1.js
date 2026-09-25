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


window.TechCheckNotifications = Object.freeze({
  pushAlertState,
  registerPhonePush,
  preferences,
  inbox,
  savePreferences,
  showSystemNotification,
  setupRealtime,
});
