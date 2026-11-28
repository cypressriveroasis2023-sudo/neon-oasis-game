-- 2026-11-27 Tech Check (goqrnolcvqnirjmzaeyk): tell Owner + IT when the camera sweep stops.
--
-- Why: on 27 Nov the direct camera check published nothing for about 12 hours (mHelpDesk refused
-- COS's login), and the only trace was app_private.cos_sweep_watchdog_log, which nobody reads.
--
-- What: public.cos_sweep_watchdog_alerts_v1() reads the watchdog log (job 15 writes it every
-- 15 minutes) and returns at most one alert, in the same shape as the router-down alerts:
--   * "COS camera check has stopped": the two newest watchdog checks are both `alarm`, the
--     newest under 20 minutes old (so one bad check never alerts). An unknown audit action
--     alerts on the first check, since it never clears by itself. Repeats every 6 hours while
--     it lasts.
--   * "COS camera check is back": the newest check is `ok` after an alert went out.
-- It writes its own in-app notifications (Owner + IT, like the router alerts) and the
-- router-down alert job (16, :11/:41) adds the phone push: cos_router_down_alerts_v1 appends
-- cos_sweep_watchdog_alerts_safe_v1() to its answer, exactly as it already does for the mHelp
-- login alert. The safe wrapper swallows errors, so a fault here never stops router alerts.
-- No cron change, no audit row, no edge function change.
--
-- Status: APPLIED 2026-11-28 00:45 UTC (18:45 CT 27 Nov, James's go); first run: no alert,
-- state seeded `ok`, hook present twice in cos_router_down_alerts_v1. Before that, tested live inside a rolled-back transaction on
-- 2026-11-27: one alarm check -> nothing; second -> "has stopped"; third -> nothing (6 h repeat);
-- ok -> "is back" with the outage length; unknown audit action -> alerts on the first check; in-app
-- notifications written to Owner + IT; hook present in cos_router_down_alerts_v1.
--
-- Rollback:
--   apply the reverse of the two anchored replaces below (remove
--   " || public.cos_sweep_watchdog_alerts_safe_v1()" from cos_router_down_alerts_v1), then
--   drop function public.cos_sweep_watchdog_alerts_safe_v1(); drop function public.cos_sweep_watchdog_alerts_v1();
--   drop table app_private.sweep_watchdog_alert_watch;

create table if not exists app_private.sweep_watchdog_alert_watch (
  singleton boolean primary key default true check (singleton),
  state text not null check (state in ('ok', 'alarm')),
  since timestamptz,
  alerted_at timestamptz,
  log_at timestamptz,
  updated_at timestamptz not null default now());
revoke all on app_private.sweep_watchdog_alert_watch from public, anon, authenticated;

create or replace function public.cos_sweep_watchdog_alerts_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l1 app_private.cos_sweep_watchdog_log; l2 app_private.cos_sweep_watchdog_log;
  w app_private.sweep_watchdog_alert_watch;
  v_alarm boolean; v_unknown boolean; v_cause text; v_body text;
  v_out jsonb := '[]'::jsonb;
  v_recipients uuid[];
  c_repeat constant interval := interval '6 hours';
begin
  select * into l1 from app_private.cos_sweep_watchdog_log order by checked_at desc limit 1;
  if l1.checked_at is null or l1.checked_at < now() - interval '20 minutes' then
    -- The log only gets a row when something is wrong, on recovery, and once a day. No recent row
    -- means the last answer still stands; only an `ok` heartbeat or recovery row can end an alarm.
    if l1.checked_at is null or l1.status <> 'ok' then return v_out; end if;
  end if;
  select * into l2 from app_private.cos_sweep_watchdog_log where checked_at < l1.checked_at order by checked_at desc limit 1;

  v_unknown := l1.status = 'alarm' and 'unknown_audit_action_blocks_endpoint_claims' = any (l1.reasons);
  v_alarm := l1.checked_at >= now() - interval '20 minutes' and l1.status = 'alarm'
             and (v_unknown or (l2.status = 'alarm' and l2.checked_at >= l1.checked_at - interval '20 minutes'));

  select * into w from app_private.sweep_watchdog_alert_watch where singleton for update;
  if not found then
    insert into app_private.sweep_watchdog_alert_watch (state, since, log_at)
    values ('ok', null, l1.checked_at) returning * into w;
  end if;

  if v_alarm and (w.state = 'ok' or w.alerted_at is null or w.alerted_at < now() - c_repeat) then
    v_cause := case
      when v_unknown then ' Cause: a new action value in camera_inventory_audit (' ||
        coalesce(array_to_string(l1.unknown_audit_actions, ', '), '?') ||
        ') that the sweep does not know. It will not clear by itself: add it to the allow-list in cos_tracker_endpoint_claims_v1.'
      when exists (select 1 from app_private.mhelp_auth_watch m where m.state = 'reconnect_required') then
        ' Cause: mHelpDesk is refusing COS''s saved login (see that alert). Reconnecting mHelpDesk clears this too.'
      else ' Cause not known yet: check the camera-health-sweep log in Tech Check.' end;
    v_body := case
        when v_unknown then 'COS''s camera check is holding every Sniper / CAM V'
        when w.state = 'ok' then 'COS''s own camera check has published nothing for about '
          || public.cos_router_alert_span_v1(now() - coalesce(l1.newest_reading, now() - interval '30 minutes'))
        else 'COS''s camera check is still stopped, for about '
          || public.cos_router_alert_span_v1(now() - coalesce(l1.newest_reading, now() - interval '30 minutes')) end
      || ' (' || l1.fresh || ' of ' || l1.eligible || ' fresh). Until it is back they read Not verified on the board.'
      || v_cause;
    v_out := jsonb_build_array(jsonb_build_object('kind', 'down', 'unit', null,
      'title', case when w.state = 'ok' then 'COS camera check has stopped' else 'COS camera check still stopped' end,
      'body', v_body));
    update app_private.sweep_watchdog_alert_watch
       set state = 'alarm', since = case when w.state = 'ok' then coalesce(l1.newest_reading, l1.checked_at) else w.since end,
           alerted_at = now(), log_at = l1.checked_at, updated_at = now() where singleton;
  elsif l1.status = 'ok' and w.state = 'alarm' then
    v_out := jsonb_build_array(jsonb_build_object('kind', 'back', 'unit', null, 'title', 'COS camera check is back',
      'body', 'COS''s camera check is publishing again (' || l1.fresh || ' of ' || l1.eligible ||
              ' Snipers / CAM Vs fresh)' ||
              case when w.since is not null then ' after about ' || public.cos_router_alert_span_v1(l1.checked_at - w.since) else '' end ||
              '. The board catches up within 15 minutes.'));
    update app_private.sweep_watchdog_alert_watch
       set state = 'ok', since = null, alerted_at = now(), log_at = l1.checked_at, updated_at = now() where singleton;
  else
    update app_private.sweep_watchdog_alert_watch set log_at = l1.checked_at, updated_at = now() where singleton;
  end if;

  if jsonb_array_length(v_out) > 0 then
    select array_agg(user_id) into v_recipients from public.profiles
     where active and archived_at is null and role in ('owner', 'it');
    if coalesce(array_length(v_recipients, 1), 0) > 0 then
      insert into public.app_notifications (recipient_user_id, kind, title, body, unit_tag)
      select u, case when a->>'kind' = 'back' then 'camera_recovered' else 'camera_health' end, a->>'title', a->>'body', null
        from unnest(v_recipients) u cross join jsonb_array_elements(v_out) a;
    end if;
  end if;
  return v_out;
end $$;

create or replace function public.cos_sweep_watchdog_alerts_safe_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return coalesce(public.cos_sweep_watchdog_alerts_v1(), '[]'::jsonb);
exception when others then
  return '[]'::jsonb;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.cos_sweep_watchdog_alerts_v1()', 'public.cos_sweep_watchdog_alerts_safe_v1()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Hook into the router-down alert job's answer, after the mHelp login alert. Anchored; does nothing if done.
do $$
declare d text := pg_get_functiondef('public.cos_router_down_alerts_v1()'::regprocedure);
        anchor text := $a$'alerts', v_new || public.cos_mhelp_auth_alerts_safe_v1())$a$;
begin
  if position('cos_sweep_watchdog_alerts_safe_v1' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'cos_router_down_alerts_v1 is not as expected'; end if;
  d := replace(d, anchor, $r$'alerts', v_new || public.cos_mhelp_auth_alerts_safe_v1() || public.cos_sweep_watchdog_alerts_safe_v1())$r$);
  -- Also when the InHand pull is stale: the system alerts do not depend on InHand.
  d := replace(d, $a$'reason', 'no fresh InHand pull', 'alerts', '[]'::jsonb)$a$,
                  $r$'reason', 'no fresh InHand pull', 'alerts', public.cos_mhelp_auth_alerts_safe_v1() || public.cos_sweep_watchdog_alerts_safe_v1())$r$);
  execute d;
end $$;
