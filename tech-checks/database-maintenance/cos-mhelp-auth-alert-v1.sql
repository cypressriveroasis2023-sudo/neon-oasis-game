-- mHelp alert: tell Owner and IT within minutes when mHelpDesk rejects COS's saved authorization, and again when it
-- is reconnected (Tech Check project, goqrnolcvqnirjmzaeyk).
--
-- James, 2026-11-27: "build the mHelp alert". mHelpDesk rejected COS's renewal at 08:01 UTC and nobody knew until
-- 21:00, while the camera sweep held every Sniper / CAM V as Unknown. It has happened nine times since 29 Oct.
--
-- How it knows: cron job 10 calls Operations cos-mhelp-readiness (renew_access) at :01 every hour; its answer
-- (contract COS_MHELP_RENEWAL_STATUS_V1, state renewed | not_due | reconnect_required) lands in net._http_response.
-- This reads the newest such answer from the last 3 hours. Nothing is called and nothing in Operations is touched.
--
-- How it tells: public.cos_router_down_alerts_v1() (cron job 16, :11/:41, via edge function cos-router-down-alert)
-- appends what this returns to its own alerts, so the existing phone push and in-app notice carry it. No new cron
-- job, no new edge function, no audit row. If this function fails, the router alert carries on without it.
--
-- Alerts: 'mHelpDesk needs reconnecting' on the change to reconnect_required, repeated every 6 hours while it stays
-- that way; 'mHelpDesk reconnected' when a later answer is renewed or not_due. Owner and IT, same as router alerts.
--
-- Rollback:
--   (restore the return line of cos_router_down_alerts_v1 to  'alerts', v_new);  -- see the anchored edit below)
--   drop function if exists public.cos_mhelp_auth_alerts_safe_v1();
--   drop function if exists public.cos_mhelp_auth_alerts_v1();
--   drop table if exists app_private.mhelp_auth_watch;
begin;

create table if not exists app_private.mhelp_auth_watch (
  singleton boolean primary key default true check (singleton),
  state text not null check (state in ('ok', 'reconnect_required')),
  since timestamptz not null,
  answer_at timestamptz not null,
  alerted_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on app_private.mhelp_auth_watch from public, anon, authenticated;
-- Baseline: James reconnected at 21:08 UTC on 27 Nov, so the 21:01 reconnect_required answer is already old news.
insert into app_private.mhelp_auth_watch (state, since, answer_at) values ('ok', now(), now()) on conflict do nothing;

create or replace function public.cos_mhelp_auth_alerts_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz; v_state text; v_body text;
  w app_private.mhelp_auth_watch;
  v_out jsonb := '[]'::jsonb;
  v_recipients uuid[];
  c_repeat constant interval := interval '6 hours';
  c_fix constant text := ' The Owner fixes it in COS: Unit Tracker → Advanced / IT tools → Reconnect mHelpDesk, with a fresh token pair from mHelpDesk Developer Access.';
begin
  select r.created, (r.content::jsonb)->>'state' into v_at, v_state
    from net._http_response r
   where r.created > now() - interval '3 hours'
     and r.content like '{"contract":"COS_MHELP_RENEWAL_STATUS_V1"%'
   order by r.created desc limit 1;
  if v_at is null or v_state is null then return v_out; end if;
  v_state := case when v_state = 'reconnect_required' then 'reconnect_required'
                  when v_state in ('renewed', 'not_due') then 'ok' else null end;
  if v_state is null then return v_out; end if;

  select * into w from app_private.mhelp_auth_watch where singleton for update;
  if not found then
    insert into app_private.mhelp_auth_watch (state, since, answer_at) values (v_state, v_at, v_at) returning * into w;
    -- First sight of a rejection still alerts; first sight of ok is just the baseline.
    if v_state = 'ok' then return v_out; end if;
    w.state := 'ok';
  end if;
  if v_at < w.answer_at then return v_out; end if;

  if v_state = 'reconnect_required' and (w.state = 'ok' or w.alerted_at is null or w.alerted_at < now() - c_repeat) then
    v_body := case when w.state = 'ok'
      then 'mHelpDesk refused COS''s saved login at ' || to_char(v_at at time zone 'America/Chicago', 'HH12:MI AM') || ' CT.'
      else 'mHelpDesk is still refusing COS''s saved login (since ' || to_char(w.since at time zone 'America/Chicago', 'Mon DD HH12:MI AM') || ' CT).' end
      || ' Until it is reconnected the mHelp list stops updating and Snipers / CAM Vs read Unknown on the board.' || c_fix;
    v_out := jsonb_build_array(jsonb_build_object('kind', 'down', 'unit', null, 'title', 'mHelpDesk needs reconnecting', 'body', v_body));
    update app_private.mhelp_auth_watch
       set state = 'reconnect_required', since = case when w.state = 'ok' then v_at else w.since end,
           answer_at = v_at, alerted_at = now(), updated_at = now() where singleton;
  elsif v_state = 'ok' and w.state = 'reconnect_required' then
    v_out := jsonb_build_array(jsonb_build_object('kind', 'back', 'unit', null, 'title', 'mHelpDesk reconnected',
      'body', 'mHelpDesk accepted COS''s login again at ' || to_char(v_at at time zone 'America/Chicago', 'HH12:MI AM') ||
              ' CT. It was out for about ' || public.cos_router_alert_span_v1(v_at - w.since) || '. The board catches up within 15 minutes.'));
    update app_private.mhelp_auth_watch set state = 'ok', since = v_at, answer_at = v_at, alerted_at = now(), updated_at = now() where singleton;
  else
    update app_private.mhelp_auth_watch set answer_at = v_at, updated_at = now() where singleton;
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
revoke all on function public.cos_mhelp_auth_alerts_v1() from public, anon, authenticated;
grant execute on function public.cos_mhelp_auth_alerts_v1() to service_role;

-- What the router alert calls: any failure here gives no mHelp alert, never a failed router run.
create or replace function public.cos_mhelp_auth_alerts_safe_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return coalesce(public.cos_mhelp_auth_alerts_v1(), '[]'::jsonb);
exception when others then
  return '[]'::jsonb;
end $$;
revoke all on function public.cos_mhelp_auth_alerts_safe_v1() from public, anon, authenticated;
grant execute on function public.cos_mhelp_auth_alerts_safe_v1() to service_role;

-- Anchored edit: the router alert run also carries the mHelp alert. Refuses if the anchor is not there exactly once.
do $do$
declare
  v_def text := pg_get_functiondef('public.cos_router_down_alerts_v1'::regproc);
  v_old text := $a$'capped', v_capped, 'alerts', v_new);$a$;
  v_new text := $a$'capped', v_capped, 'alerts', v_new || public.cos_mhelp_auth_alerts_safe_v1());$a$;
  n int;
begin
  if position(v_new in v_def) > 0 then return; end if;
  n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'cos_router_down_alerts_v1 anchor found % times, expected 1', n; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

commit;
