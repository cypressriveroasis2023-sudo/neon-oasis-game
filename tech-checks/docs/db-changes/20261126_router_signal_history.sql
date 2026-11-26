-- 2026-11-26 — Router signal history for the unit card's 7-day trend (Tech Check `goqrnolcvqnirjmzaeyk`)
--
-- James (25 Nov): "Go" on the signal trend, so a slowly failing antenna can be told from a one-off drop.
--
-- * inhand_private.signal_history keeps one row per linked router per InHand pull: RSRP, InHand's 0-5 level and
--   whether the router was online. Rows older than 8 days are pruned on every run.
-- * It is filled by public.cos_router_signal_record_v1(), called at the start of public.cos_router_down_alerts_v1()
--   (cron job 16, :11/:41, after the pull at :07/:37). No new cron job, no change to the InHand pull or to
--   camera_unit_routers. Re-running for the same pull adds nothing (unique serial + time).
-- * public.cos_router_trend_v1(unit) gives the card hourly points for 7 days plus a plain verdict: the last 24 hours
--   against the 6 days before. Service role only; reached through the cos-router-details function (Owner/IT).
-- * No camera_inventory_audit row.
--
-- Rollback:
--   re-run cos_router_down_alerts_v1 from 20261126_router_down_alert.sql (drops the record call);
--   drop function if exists public.cos_router_trend_v1(text); drop function if exists public.cos_router_signal_record_v1();
--   drop table if exists inhand_private.signal_history;

create table if not exists inhand_private.signal_history (
  serial text not null,
  unit_key text not null,
  at timestamptz not null,
  rsrp numeric,
  level smallint,
  online boolean not null,
  primary key (serial, at)
);
create index if not exists signal_history_unit_at on inhand_private.signal_history (unit_key, at desc);
revoke all on inhand_private.signal_history from public, anon, authenticated;

create or replace function public.cos_router_signal_record_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into inhand_private.signal_history (serial, unit_key, at, rsrp, level, online)
  select upper(btrim(r.inhand_serial)), r.unit_key, r.status_observed_at,
         case when (r.inhand_signal->>'rsrp') ~ '^-?\d{1,3}(\.\d+)?$' then (r.inhand_signal->>'rsrp')::numeric end,
         case when (r.inhand_signal->>'level') ~ '^[0-5]$' then (r.inhand_signal->>'level')::smallint end,
         r.reported_status = 'online'
    from public.camera_unit_routers r
   where nullif(btrim(r.inhand_serial), '') is not null
     and r.status_source = 'InHand live pull'
     and r.reported_status in ('online', 'offline')
     and r.status_observed_at > now() - interval '40 minutes'
  on conflict (serial, at) do nothing;
  get diagnostics n = row_count;
  delete from inhand_private.signal_history where at < now() - interval '8 days';
  return n;
end $$;

create or replace function public.cos_router_trend_v1(p_unit_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with h as (
    select s.* from inhand_private.signal_history s
     where s.unit_key = p_unit_key and s.at > now() - interval '7 days'
  ), pts as (
    select date_trunc('hour', at) t, round(avg(rsrp) filter (where online and rsrp is not null))::int rsrp,
           round(avg(level) filter (where online and level is not null))::int level, bool_or(online) online
      from h group by 1 order by 1
  ), cmp as (
    select avg(rsrp) filter (where online and at > now() - interval '24 hours') recent,
           avg(rsrp) filter (where online and at <= now() - interval '24 hours') before,
           count(*) filter (where online and rsrp is not null and at > now() - interval '24 hours') n_recent,
           count(*) filter (where online and rsrp is not null and at <= now() - interval '24 hours') n_before,
           count(*) filter (where not online and at > now() - interval '24 hours') off_recent,
           count(*) filter (where at > now() - interval '24 hours') all_recent,
           min(at) first_at
      from h
  )
  select jsonb_build_object(
    'unit', p_unit_key,
    'since', (select first_at from cmp),
    'points', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('t', t, 'rsrp', rsrp, 'level', level, 'on', online))) from pts), '[]'::jsonb),
    'recent', (select round(recent)::int from cmp),
    'before', (select round(before)::int from cmp),
    'verdict', (select case
        when all_recent = 0 then 'none'
        when off_recent * 2 >= all_recent then 'offline'
        when n_before < 12 or n_recent < 4 then 'young'
        when recent - before <= -8 then 'worse'
        when recent - before >= 8 then 'better'
        else 'steady' end from cmp));
$$;

do $$
declare f text;
begin
  foreach f in array array['public.cos_router_signal_record_v1()', 'public.cos_router_trend_v1(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Hook the recorder into the alert run: one added line at the top of cos_router_down_alerts_v1, applied by
-- replacing the anchor below in the live definition (fails if the anchor is not found).
do $$
declare d text := pg_get_functiondef('public.cos_router_down_alerts_v1()'::regprocedure);
        anchor text := 'select array_agg(user_id) into v_recipients from public.profiles';
begin
  if position('cos_router_signal_record_v1' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'cos_router_down_alerts_v1 is not as expected'; end if;
  execute replace(d, anchor, 'perform public.cos_router_signal_record_v1();' || chr(10) || '  ' || anchor);
end $$;
