-- Helios battery health trend (Operations project tughscoxralhofrckvxy). 2026-11-28, James's go.
-- Each completed night, how much a Field Helios battery really held: energy out after dark (no sun) over the
-- charge it took, x100. GAGO DD3 is rated 2772 Wh. Kept 400 days so the page can show a 30-day trend and a
-- year-on-year comparison. The Victron sync is unchanged; this only reads cos_vrm_private.power_history.
-- Rollback:
--   select cron.unschedule('cos-vrm-battery-health');
--   drop function if exists public.cos_vrm_battery_health_read();
--   drop function if exists cos_vrm_private.battery_health_refresh();
--   drop table if exists cos_vrm_private.battery_health_nights;

create table if not exists cos_vrm_private.battery_health_nights (
  installation_id bigint not null,
  night date not null,                       -- the evening the night started (America/Chicago)
  energy_wh numeric not null check (energy_wh > 0),
  soc_drop numeric not null check (soc_drop >= 8),
  capacity_wh integer not null check (capacity_wh between 200 and 20000),
  saved_at timestamptz not null default now(),
  primary key (installation_id, night)
);
revoke all on cos_vrm_private.battery_health_nights from public, anon, authenticated;

create or replace function cos_vrm_private.battery_health_refresh()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with p as (
    select h.installation_id, h.observed_at t, h.soc, h.battery_w bw, h.solar_w sw,
      lead(h.observed_at) over w t2, lead(h.soc) over w soc2, lead(h.battery_w) over w bw2, lead(h.solar_w) over w sw2,
      ((h.observed_at at time zone 'America/Chicago') - interval '12 hours')::date night
    from cos_vrm_private.power_history h
    window w as (partition by h.installation_id order by h.observed_at)),
  nights as (
    select installation_id, night, sum(-(bw + bw2) / 2 * extract(epoch from t2 - t) / 3600) wh, max(soc) - min(soc2) soc_drop, count(*) k
    from p
    where t2 - t <= interval '1 hour' and t2 > t and bw < 0 and bw2 < 0 and coalesce(sw, 0) < 5 and coalesce(sw2, 0) < 5
      and soc is not null and soc2 is not null
      and (extract(hour from t at time zone 'America/Chicago') >= 19 or extract(hour from t at time zone 'America/Chicago') < 6)
      and night < ((now() at time zone 'America/Chicago') - interval '12 hours')::date   -- completed nights only
    group by 1, 2)
  insert into cos_vrm_private.battery_health_nights (installation_id, night, energy_wh, soc_drop, capacity_wh)
  select installation_id, night, round(wh::numeric, 1), soc_drop, round(wh / soc_drop * 100)::int
  from nights where k >= 8 and soc_drop >= 8 and wh > 0 and wh / soc_drop * 100 between 200 and 20000
  on conflict (installation_id, night) do update
    set energy_wh = excluded.energy_wh, soc_drop = excluded.soc_drop, capacity_wh = excluded.capacity_wh, saved_at = now();
  get diagnostics n = row_count;
  delete from cos_vrm_private.battery_health_nights where night < current_date - 400;
  return n;
end $$;
revoke all on function cos_vrm_private.battery_health_refresh() from public, anon, authenticated;

-- Read for the Victron page (through the cos-vrm-mppt-read edge function): last 60 nights per installation.
create or replace function public.cos_vrm_battery_health_read()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('units', coalesce(jsonb_agg(jsonb_build_object('installationId', u.installation_id, 'nights', u.nights) order by u.installation_id), '[]'::jsonb))
  from (select installation_id, jsonb_agg(jsonb_build_array(to_char(night, 'YYYY-MM-DD'), capacity_wh) order by night) nights
        from cos_vrm_private.battery_health_nights where night >= current_date - 60 group by 1) u;
$$;
revoke all on function public.cos_vrm_battery_health_read() from public, anon, authenticated;
grant execute on function public.cos_vrm_battery_health_read() to service_role;

-- Every morning at 7:17 AM Central (13:17 UTC; 12:17 in summer), after the night has ended. Free minute on Operations.
select cron.schedule('cos-vrm-battery-health', '17 13 * * *', $$select cos_vrm_private.battery_health_refresh()$$);
select cos_vrm_private.battery_health_refresh();
