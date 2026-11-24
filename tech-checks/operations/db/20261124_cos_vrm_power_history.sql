-- Victron battery history: one compact point per Helios per saved Victron reading, kept 8 days.
--
-- Additive only. The Victron sync (cos_vrm_fleet_finish) is not changed: an AFTER trigger on the
-- installations registry copies the newest saved reading into cos_vrm_private.power_history.
-- Saving history can never fail the sync: any error inside the trigger is swallowed.
-- Separate battery monitors are never averaged: the system reading wins, otherwise the lowest one.

create table if not exists cos_vrm_private.power_history (
  installation_id bigint not null,
  observed_at timestamptz not null,
  soc numeric,
  solar_w numeric,
  battery_w numeric,
  voltage numeric,
  primary key (installation_id, observed_at)
);
alter table cos_vrm_private.power_history enable row level security;
revoke all on cos_vrm_private.power_history from public, anon, authenticated;

create or replace function cos_vrm_private.capture_power_history()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  o jsonb := new.power_observations;
  t timestamptz; v_soc numeric; v_solar numeric; v_battery numeric; v_voltage numeric;
begin
  if o is null or jsonb_typeof(o) is distinct from 'array'
    or tg_op = 'UPDATE' and new.power_observations is not distinct from old.power_observations
    or new.name !~* '^HELIOS[[:space:]]+[0-9]{1,3}$' then
    return new;
  end if;
  begin
    select max((x->>'observedAt')::timestamptz) into t from jsonb_array_elements(o) x
      where x->>'metric' in ('battery_soc','solar_power','battery_power','battery_voltage');
    if t is null or t > now() + interval '5 minutes' then return new; end if;
    select coalesce(
      (select (x->>'value')::numeric from jsonb_array_elements(o) x where x->>'metric'='battery_soc' and x->>'source'='system' order by (x->>'instance')::int limit 1),
      (select min((x->>'value')::numeric) from jsonb_array_elements(o) x where x->>'metric'='battery_soc')) into v_soc;
    select coalesce(
      (select (x->>'value')::numeric from jsonb_array_elements(o) x where x->>'metric'='solar_power' and x->>'source'='system' order by (x->>'instance')::int limit 1),
      (select sum((x->>'value')::numeric) from jsonb_array_elements(o) x where x->>'metric'='solar_power' and x->>'source'='solarcharger')) into v_solar;
    select (x->>'value')::numeric into v_battery from jsonb_array_elements(o) x where x->>'metric'='battery_power' and x->>'source'='system' order by (x->>'instance')::int limit 1;
    select coalesce(
      (select (x->>'value')::numeric from jsonb_array_elements(o) x where x->>'metric'='battery_voltage' and x->>'source'='system' order by (x->>'instance')::int limit 1),
      (select min((x->>'value')::numeric) from jsonb_array_elements(o) x where x->>'metric'='battery_voltage')) into v_voltage;
    if v_soc is null and v_solar is null and v_battery is null and v_voltage is null then return new; end if;
    insert into cos_vrm_private.power_history(installation_id, observed_at, soc, solar_w, battery_w, voltage)
      values (new.installation_id, t, v_soc, v_solar, v_battery, v_voltage)
      on conflict (installation_id, observed_at) do nothing;
    delete from cos_vrm_private.power_history
      where installation_id = new.installation_id and observed_at < now() - interval '8 days';
  exception when others then
    -- History is a convenience. It must never stop the Victron sync from saving.
    null;
  end;
  return new;
end $function$;
revoke all on function cos_vrm_private.capture_power_history() from public, anon, authenticated;

drop trigger if exists cos_vrm_power_history_capture on cos_vrm_private.installations;
create trigger cos_vrm_power_history_capture
  after insert or update of power_observations on cos_vrm_private.installations
  for each row execute function cos_vrm_private.capture_power_history();

-- Read-only history for the app: Helios installations only, newest p_hours (1..168), oldest point first.
-- Points are [epoch seconds, battery %, solar W, battery W] with null where Victron sent nothing.
create or replace function public.cos_vrm_power_history(p_hours integer default 48)
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare hours integer := least(168, greatest(1, coalesce(p_hours, 48)));
begin
  return jsonb_build_object('hours', hours, 'units', coalesce((
    select jsonb_agg(jsonb_build_object('installationId', i.installation_id, 'name', i.name, 'points', coalesce((
      select jsonb_agg(jsonb_build_array(floor(extract(epoch from h.observed_at))::bigint, h.soc, h.solar_w, h.battery_w) order by h.observed_at)
      from cos_vrm_private.power_history h
      where h.installation_id = i.installation_id and h.observed_at >= now() - make_interval(hours => hours)
    ), '[]'::jsonb)) order by i.name, i.installation_id)
    from cos_vrm_private.installations i
    where i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$'
  ), '[]'::jsonb));
end $function$;
revoke all on function public.cos_vrm_power_history(integer) from public, anon, authenticated;
grant execute on function public.cos_vrm_power_history(integer) to service_role;

-- Seed one point per Helios from the reading already saved, so the chart has a starting point.
insert into cos_vrm_private.power_history(installation_id, observed_at, soc, solar_w, battery_w, voltage)
select i.installation_id, max((x->>'observedAt')::timestamptz),
  coalesce(max((x->>'value')::numeric) filter (where x->>'metric'='battery_soc' and x->>'source'='system'), min((x->>'value')::numeric) filter (where x->>'metric'='battery_soc')),
  coalesce(max((x->>'value')::numeric) filter (where x->>'metric'='solar_power' and x->>'source'='system'), sum((x->>'value')::numeric) filter (where x->>'metric'='solar_power' and x->>'source'='solarcharger')),
  max((x->>'value')::numeric) filter (where x->>'metric'='battery_power' and x->>'source'='system'),
  coalesce(max((x->>'value')::numeric) filter (where x->>'metric'='battery_voltage' and x->>'source'='system'), min((x->>'value')::numeric) filter (where x->>'metric'='battery_voltage'))
from cos_vrm_private.installations i, jsonb_array_elements(coalesce(i.power_observations, '[]'::jsonb)) x
where i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$' and x->>'metric' in ('battery_soc','solar_power','battery_power','battery_voltage')
group by i.installation_id
on conflict (installation_id, observed_at) do nothing;
