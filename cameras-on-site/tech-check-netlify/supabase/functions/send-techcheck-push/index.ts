import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Supabase environment is incomplete.');

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: owner } = await admin.from('profiles').select('role,active').eq('user_id', userData.user.id).maybeSingle();
    if (!owner?.active || owner.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Owner/Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const assignmentId = String(body?.assignment_id || '').trim();
    if (!assignmentId) {
      return new Response(JSON.stringify({ error: 'assignment_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: assignment, error: assignmentError } = await admin
      .from('job_assignments')
      .select('id,ticket_no,assignee_user_id,assignee_name,assigned_role,assignment_scope,assigned_by_name,status')
      .eq('id', assignmentId)
      .maybeSingle();
    if (assignmentError || !assignment) {
      return new Response(JSON.stringify({ error: 'Assignment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let recipientIds: string[] = [];
    if (assignment.assignee_user_id) {
      recipientIds = [assignment.assignee_user_id];
    } else {
      const { data: departmentUsers } = await admin
        .from('profiles')
        .select('user_id')
        .eq('active', true)
        .eq('role', assignment.assigned_role);
      recipientIds = (departmentUsers || []).map((row: { user_id: string }) => row.user_id);
    }

    if (!recipientIds.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, skipped: 'no eligible recipients' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: cfg } = await admin.from('push_config').select('key,value').in('key', ['vapid_public','vapid_private','vapid_subject']);
    const config = Object.fromEntries((cfg || []).map((row: { key: string; value: string }) => [row.key, row.value]));
    if (!config.vapid_public || !config.vapid_private || !config.vapid_subject) throw new Error('Push configuration is missing.');
    webpush.setVapidDetails(config.vapid_subject, config.vapid_public, config.vapid_private);

    let sent = 0;
    let skipped = 0;
    const failed: Array<{ id: string; status?: number }> = [];
    const isDepartment = !assignment.assignee_user_id || assignment.assignment_scope === 'department';
    const roleLabel = assignment.assigned_role === 'it' ? 'IT Department' : 'Service Department';

    for (const recipientId of recipientIds) {
      const [{ data: prefs }, { data: subs }, unreadResult] = await Promise.all([
        admin.from('notification_preferences')
          .select('new_assignments,browser_notifications')
          .eq('user_id', recipientId)
          .maybeSingle(),
        admin.from('push_subscriptions')
          .select('id,endpoint,p256dh,auth')
          .eq('user_id', recipientId)
          .eq('enabled', true),
        admin.from('app_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_user_id', recipientId)
          .is('read_at', null),
      ]);

      if (prefs && (!prefs.new_assignments || !prefs.browser_notifications)) {
        skipped += 1;
        continue;
      }
      if (!subs?.length) {
        skipped += 1;
        continue;
      }

      const payload = JSON.stringify({
        title: isDepartment ? 'New ' + roleLabel + ' job available' : 'New Tech Check job assigned',
        body: isDepartment
          ? 'MHelpDesk #' + assignment.ticket_no + ' is available to claim from ' + (assignment.assigned_by_name || 'Owner') + '.'
          : 'MHelpDesk #' + assignment.ticket_no + ' was assigned to you by ' + (assignment.assigned_by_name || 'Owner') + '.',
        url: '/?assignment=' + encodeURIComponent(assignment.id),
        assignment_id: assignment.id,
        ticket_no: assignment.ticket_no,
        kind: 'new_assignment',
        badge_count: String(Math.max(1, Number(unreadResult.count || 1))),
      });

      for (const sub of subs) {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          }, payload, { TTL: 3600 });
          sent += 1;
        } catch (error) {
          const status = Number((error as { statusCode?: number })?.statusCode || 0);
          failed.push({ id: sub.id, status });
          if (status === 404 || status === 410) {
            await admin.from('push_subscriptions')
              .update({ enabled: false, updated_at: new Date().toISOString() })
              .eq('id', sub.id);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      sent,
      recipients: recipientIds.length,
      skipped,
      failed: failed.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('send-techcheck-push failed', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Push notification failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});