-- Refresh runs the camera checks now.
--
-- APPLIED 2026-11-27 ~21:59 UTC on Tech Check (goqrnolcvqnirjmzaeyk), James's go, as migration
-- cos_check_now_v1, text exactly as below. Checked: anonymous call refused (42501); as the Owner
-- at 22:00:04 UTC (rolled back) it answered scheduled_check_running, waitSeconds 71, twice.
-- Operations patch cos-unit-camera-status/check-now-v26 deployed after it (live v27 81a7a8a5).
--
-- James, 27 Nov 2026: "I want to be able to click refresh and it will refresh and update
-- for me. Can it be faster?" Until now the board's Refresh only re-read what the timer had
-- last saved (camera sweep, Star4Live and Recon every 15 minutes).
--
-- public.cos_check_now_v1() starts the same three calls the timer makes, with the same
-- secret read the same way cron jobs 2, 4 and 5 read it, and says when the results should
-- be in. It never starts a check on top of one:
--
--   scheduled_check_running  the timer's own run started at the quarter hour, under 75 s ago
--   scheduled_check_due      the timer's run starts within 20 s
--   checked_recently         someone started one under 2 minutes ago
--   started                  this call started one
--
-- Only an active Owner or approved IT account may call it (the same check the unit card's
-- other buttons use). It reads no camera data, returns no secret, and changes nothing but
-- its own log. No cron job, schedule, table used by the sweep, audit action or allow-list
-- changes. The sweep's own holds are untouched: a check started here is held exactly as a
-- scheduled one would be (for example while the mHelp inventory is not current).

create table if not exists app_private.cos_check_now_log (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  requested_by uuid not null,
  reason text not null check (reason in ('started', 'scheduled_check_running', 'scheduled_check_due', 'checked_recently')),
  request_ids bigint[] not null default '{}'
);
revoke all on table app_private.cos_check_now_log from public, anon, authenticated;

create or replace function public.cos_check_now_v1()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_quarter timestamptz := date_trunc('hour', v_now) + floor(extract(minute from v_now) / 15) * interval '15 minutes';
  v_last timestamptz;
  v_reason text;
  v_started_at timestamptz;
  v_results_by timestamptz;
  v_secret text;
  v_headers jsonb;
  v_ids bigint[] := '{}';
  c_run constant interval := interval '75 seconds';     -- a whole check, from start to saved
  c_lead constant interval := interval '20 seconds';    -- too close to the timer's own run to start another
  c_cooldown constant interval := interval '2 minutes';
  c_base constant text := 'https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/';
begin
  if not app_private.cos_verified_fleet_actor(uid) then
    raise exception 'An active Owner or approved IT account is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cos_check_now', 0));

  select max(l.requested_at) into v_last from app_private.cos_check_now_log l where l.reason = 'started';

  if v_now < v_quarter + c_run then
    v_reason := 'scheduled_check_running'; v_started_at := v_quarter; v_results_by := v_quarter + c_run;
  elsif v_quarter + interval '15 minutes' - v_now <= c_lead then
    v_reason := 'scheduled_check_due'; v_started_at := v_quarter + interval '15 minutes'; v_results_by := v_started_at + c_run;
  elsif v_last is not null and v_now < v_last + c_cooldown then
    v_reason := 'checked_recently'; v_started_at := v_last; v_results_by := v_last + c_run;
  else
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'camera_health_cron_secret' limit 1;
    if v_secret is null or v_secret = '' then
      raise exception 'The check could not be started' using errcode = 'PT503';
    end if;
    v_headers := jsonb_build_object('Content-Type', 'application/json', 'x-camera-cron-secret', v_secret);
    -- The same three calls as cron jobs 2 (camera sweep), 4 (Star4Live) and 5 (Recon).
    v_ids := array[
      net.http_post(url := c_base || 'camera-health-sweep', headers := v_headers, body := '{"batch_size":64}'::jsonb, timeout_milliseconds := 145000),
      net.http_post(url := c_base || 'camera-provider-reconcile', headers := v_headers, body := '{"mode":"vigilant"}'::jsonb, timeout_milliseconds := 60000),
      net.http_post(url := c_base || 'camera-provider-reconcile', headers := v_headers, body := '{"mode":"reconeyez"}'::jsonb, timeout_milliseconds := 60000)
    ];
    v_reason := 'started'; v_started_at := v_now; v_results_by := v_now + c_run;
  end if;

  insert into app_private.cos_check_now_log (requested_at, requested_by, reason, request_ids)
  values (v_now, uid, v_reason, v_ids);

  return jsonb_build_object(
    'contract', 'COS_CHECK_NOW_V1',
    'started', v_reason = 'started',
    'reason', v_reason,
    'checkStartedAt', v_started_at,
    'resultsBy', v_results_by,
    'waitSeconds', greatest(0, least(180, ceil(extract(epoch from (v_results_by - v_now)))::int)));
end
$function$;

revoke all on function public.cos_check_now_v1() from public, anon;
grant execute on function public.cos_check_now_v1() to authenticated, service_role;

-- Check after applying (as the Owner or approved IT, signed in):
--   select public.cos_check_now_v1();               -- reason 'started' unless a check is running or just ran
--   select public.cos_check_now_v1();               -- at once again: 'checked_recently', started false
--   select * from app_private.cos_check_now_log order by id desc limit 5;
-- and about 75 seconds later the board's readings carry the new time.
--
-- Rollback:
--   drop function if exists public.cos_check_now_v1();
--   drop table if exists app_private.cos_check_now_log;
-- The board's Refresh then falls back to the saved reading and says a live check could not run.
