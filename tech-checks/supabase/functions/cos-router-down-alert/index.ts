// cos-router-down-alert: after each InHand pull (cron job 16, :11/:41), find field routers that went offline and
// stayed offline for two pulls, or came back, and tell Owner and IT. The rules live in Tech Check
// public.cos_router_down_alerts_v1(), which also writes the in-app notifications; this function only adds the
// phone push. Read-only towards InHand. Scheduler secret as the camera health sweep.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { pushPayload, readAlerts } from './message.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: valid } = await db.rpc('verify_camera_health_cron_secret', { candidate: req.headers.get('x-camera-cron-secret') });
  if (valid !== true) return json({ error: 'Forbidden' }, 403);

  const { data, error } = await db.rpc('cos_router_down_alerts_v1');
  if (error) return json({ ok: false, error: 'alerts_failed' }, 502);
  const alerts = readAlerts(data);
  if (!alerts.length) return json({ ok: true, alerts: 0, ...(data && typeof data === 'object' ? { result: data } : {}) });

  const { data: cfg } = await db.from('push_config').select('key,value').in('key', ['vapid_public', 'vapid_private', 'vapid_subject']);
  const config = Object.fromEntries((cfg || []).map((row: { key: string; value: string }) => [row.key, row.value]));
  if (!config.vapid_public || !config.vapid_private || !config.vapid_subject) return json({ ok: true, alerts: alerts.length, pushed: 0, note: 'push not configured; in-app only' });
  webpush.setVapidDetails(config.vapid_subject, config.vapid_public, config.vapid_private);

  const { data: targets } = await db.rpc('cos_router_alert_push_targets_v1');
  let pushed = 0, failed = 0;
  for (const alert of alerts) {
    for (const t of (targets || []) as Array<{ endpoint: string; p256dh: string; auth: string; sub_id: string }>) {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, pushPayload(alert, alerts.length), { TTL: 3600 });
        pushed += 1;
      } catch (e) {
        failed += 1;
        const status = Number((e as { statusCode?: number })?.statusCode || 0);
        if (status === 404 || status === 410) await db.from('push_subscriptions').update({ enabled: false, updated_at: new Date().toISOString() }).eq('id', t.sub_id);
      }
    }
  }
  return json({ ok: true, alerts: alerts.length, pushed, failed });
});
