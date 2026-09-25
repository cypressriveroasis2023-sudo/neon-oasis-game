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

window.TechCheckNotifications = Object.freeze({
  pushAlertState,
  registerPhonePush,
});
