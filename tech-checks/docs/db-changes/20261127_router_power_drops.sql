-- 2026-11-27 — "Power, not router": overnight router drops (Tech Check `goqrnolcvqnirjmzaeyk`)
--
-- James (26 Nov): "go" on telling a power problem from a router problem, so the tech brings a battery, not a router.
-- Seen on 26 Nov: Solar Spotter 050 down 6:41 AM, back 7:41; Solar Spotter 056 back 1:41 AM; Solar Spotter 059 down
-- and back within half an hour. A router that drops overnight and returns after sunrise is almost always power.
--
-- * public.cos_router_night_drops_v1(): per unit, the number of recent days (last 7, Central time) with an overnight
--   drop that came back in daylight. Two sources, either counts: the half-hourly signal history (offline at some point
--   00:00-09:59 and online at some point 10:00-17:59 the same day) and the router-down alerts (a down alert 00:00-09:59
--   followed by a back note before 18:00 the same day). Service role only.
-- * public.cos_router_down_hint_v1(unit, since): the advice line at the end of a router-down alert. Two or more night
--   days -> "almost always power"; a solar unit (Solar Spotter, SS Hybrid, Helios) that went down overnight -> "usually
--   the battery"; otherwise the old line, unchanged.
-- * cos_router_down_alerts_v1: the down body's fixed advice line is replaced by the hint (anchored replace; fails if the
--   anchor is missing). cos_router_details_v1: each router also carries nightDrops (only when > 0).
-- * Read only towards everything; no audit row; no cron change.
--
-- Rollback: re-run cos_router_down_alerts_v1 from 20261126_router_down_alert.sql and then the hook block in
-- 20261126_router_signal_history.sql; re-run cos_router_details_v1 from
-- 20261126_router_details_trust_inhand_ip_only_when_online.md's definition;
-- drop function public.cos_router_down_hint_v1(text, timestamptz); drop function public.cos_router_night_drops_refresh_v1();
-- drop function public.cos_router_night_drops_v1(); drop table inhand_private.router_night_drops;

create or replace function public.cos_router_night_drops_v1()
returns table (unit_key text, night_days integer, last_day date)
language sql stable security definer set search_path = '' as $$
  with h as (
    select s.unit_key, (s.at at time zone 'America/Chicago') lt, s.online
      from inhand_private.signal_history s where s.at > now() - interval '7 days'
  ), hist_days as (
    select unit_key, lt::date dd
      from h group by 1, 2
     having bool_or(not online and extract(hour from lt) < 10) and bool_or(online and extract(hour from lt) between 10 and 17)
  ), alert_days as (
    select a.unit_key, (a.created_at at time zone 'America/Chicago')::date dd
      from inhand_private.router_alerts a
     where a.kind = 'down' and a.created_at > now() - interval '7 days'
       and extract(hour from a.created_at at time zone 'America/Chicago') < 10
       and exists (select 1 from inhand_private.router_alerts b
                    where b.serial = a.serial and b.kind = 'back' and b.created_at > a.created_at
                      and (b.created_at at time zone 'America/Chicago')::date = (a.created_at at time zone 'America/Chicago')::date
                      and extract(hour from b.created_at at time zone 'America/Chicago') < 18)
  ), days as (select * from hist_days union select * from alert_days)
  select unit_key, count(*)::int, max(dd) from days group by unit_key;
$$;

-- Kept as a small table, refreshed once per alert run, so the card and the alert read it cheaply.
create table if not exists inhand_private.router_night_drops (
  unit_key text primary key, night_days integer not null, last_day date, refreshed_at timestamptz not null default now());
revoke all on inhand_private.router_night_drops from public, anon, authenticated;

create or replace function public.cos_router_night_drops_refresh_v1()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from inhand_private.router_night_drops where true;
  insert into inhand_private.router_night_drops (unit_key, night_days, last_day)
  select unit_key, night_days, last_day from public.cos_router_night_drops_v1();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.cos_router_down_hint_v1(p_unit text, p_since timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  with n as (select coalesce((select night_days from inhand_private.router_night_drops where unit_key = p_unit), 0) d),
       s as (select coalesce(p_unit, '') ~* '(SOLAR|^SS[ -]|HYBRID|HELIOS)' solar,
                    p_since is not null and (extract(hour from p_since at time zone 'America/Chicago') >= 18
                                          or extract(hour from p_since at time zone 'America/Chicago') < 9) night)
  select case
    when (select d from n) >= 2 then
      '. It has dropped overnight on ' || (select d from n) || ' recent days and come back after sunrise: that is almost always power (a weak battery or a dirty or shaded solar panel), not the router. Bring a charged battery and check the panel.'
    when (select solar and night from s) then
      '. It went down overnight; on a solar unit that usually means the battery ran flat. If it comes back after sunrise, check the battery and the panel before swapping anything.'
    else
      '. The cameras behind it cannot be reached either. Check power first, then the SIM and antenna.'
  end;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.cos_router_night_drops_v1()', 'public.cos_router_night_drops_refresh_v1()', 'public.cos_router_down_hint_v1(text, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Refresh the night-drop table at the start of each alert run, right after the signal history is recorded.
do $$
declare d text := pg_get_functiondef('public.cos_router_down_alerts_v1()'::regprocedure);
        anchor text := 'perform public.cos_router_signal_record_v1();';
begin
  if position('cos_router_night_drops_refresh_v1' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'cos_router_down_alerts_v1 has no signal record line'; end if;
  execute replace(d, anchor, anchor || chr(10) || '  perform public.cos_router_night_drops_refresh_v1();');
end $$;

-- The alert's down body: swap the fixed advice line for the hint. Anchored; does nothing if already done.
do $$
declare d text := pg_get_functiondef('public.cos_router_down_alerts_v1()'::regprocedure);
        anchor text := $a$'. The cameras behind it cannot be reached either. Check power first, then the SIM and antenna.'$a$;
begin
  if position('cos_router_down_hint_v1' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'cos_router_down_alerts_v1 is not as expected'; end if;
  execute replace(d, anchor, 'public.cos_router_down_hint_v1(r.unit_key, w.since)');
end $$;

-- The card: each router carries nightDrops. Anchored on the details function's detailsAt line.
do $$
declare d text := pg_get_functiondef('public.cos_router_details_v1()'::regprocedure);
        anchor text := $a$'detailsAt', r.inhand_details_at)) order by r.unit_key)$a$;
begin
  if position('nightDrops' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception 'cos_router_details_v1 is not as expected'; end if;
  execute replace(d, anchor, $r$'detailsAt', r.inhand_details_at,
        'nightDrops', nullif((select nd.night_days from inhand_private.router_night_drops nd where nd.unit_key = r.unit_key), 0))) order by r.unit_key)$r$);
end $$;
