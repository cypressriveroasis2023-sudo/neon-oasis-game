-- James authorized this on 2026-11-16 at 4:35 PM CST.
-- Shared COS power-alarm thresholds on the Tech Check Platform project.
-- Every threshold column is nullable. No row and a null column both mean the
-- check is unset. This migration does not insert a voltage, a charge, or a
-- silence window.
--
-- Direct reads and writes use the platform session. The operations board's
-- bearer is a camera-project token, so the board calls
-- cos-power-alarm-settings, which rechecks the same Owner / verified-IT rule
-- inside cos_vrm_private before it writes.

create table public.cos_power_alarm_settings (
  singleton boolean primary key default true check (singleton),
  low_voltage_v numeric,
  low_soc_percent numeric,
  silent_hours numeric,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  constraint cos_power_alarm_voltage_range check (low_voltage_v is null or (low_voltage_v >= 0 and low_voltage_v <= 80)),
  constraint cos_power_alarm_soc_range check (low_soc_percent is null or (low_soc_percent >= 0 and low_soc_percent <= 100)),
  constraint cos_power_alarm_silent_range check (silent_hours is null or (silent_hours >= 1 and silent_hours <= 168))
);

alter table public.cos_power_alarm_settings enable row level security;

revoke all on table public.cos_power_alarm_settings from public, anon;
grant select, insert, update on table public.cos_power_alarm_settings to authenticated;

create policy cos_power_alarm_settings_read
on public.cos_power_alarm_settings
for select
to authenticated
using (true);

-- Owner, or one of the three verified IT production accounts, and only while
-- that profile is still active. These are the same production user ids the
-- fleet function already treats as verified IT. A name or department change
-- removes the match because department is checked here too.
create policy cos_power_alarm_settings_insert
on public.cos_power_alarm_settings
for insert
to authenticated
with check (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.active is true
      and (
        p.department = 'owner'
        or (
          p.department = 'it'
          and p.user_id in (
            'd0757b64-9623-4adc-afff-21cc7853e88a'::uuid,
            '3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid,
            'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'::uuid
          )
        )
      )
  )
);

create policy cos_power_alarm_settings_update
on public.cos_power_alarm_settings
for update
to authenticated
using (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.active is true
      and (
        p.department = 'owner'
        or (
          p.department = 'it'
          and p.user_id in (
            'd0757b64-9623-4adc-afff-21cc7853e88a'::uuid,
            '3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid,
            'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'::uuid
          )
        )
      )
  )
)
with check (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.active is true
      and (
        p.department = 'owner'
        or (
          p.department = 'it'
          and p.user_id in (
            'd0757b64-9623-4adc-afff-21cc7853e88a'::uuid,
            '3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid,
            'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'::uuid
          )
        )
      )
  )
);

create or replace function public.cos_power_alarm_settings_stamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.singleton := true;
  new.updated_at := pg_catalog.clock_timestamp();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.cos_power_alarm_settings_stamp() from public, anon, authenticated;

create trigger cos_power_alarm_settings_stamp
before insert or update on public.cos_power_alarm_settings
for each row execute function public.cos_power_alarm_settings_stamp();

-- Service path used by cos-power-alarm-settings. It does not trust the caller
-- to have already decided. Execute stays with service_role.
create or replace function cos_vrm_private.power_alarm_settings_for_actor(p_actor uuid, p_write boolean, p_low_voltage numeric, p_low_soc numeric, p_silent numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
  can_write boolean;
  saved public.cos_power_alarm_settings;
begin
  if p_actor is null then
    raise exception 'An active COS account is required' using errcode = '42501';
  end if;
  select p.active is true,
         p.active is true and (
           p.department = 'owner'
           or (p.department = 'it' and p.user_id in (
             'd0757b64-9623-4adc-afff-21cc7853e88a'::uuid,
             '3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid,
             'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'::uuid
           ))
         )
    into allowed, can_write
  from public.user_profiles p
  where p.user_id = p_actor;
  if allowed is not true then
    raise exception 'An active COS account is required' using errcode = '42501';
  end if;
  if p_write then
    if can_write is not true then
      raise exception 'An active COS Owner or verified IT account is required' using errcode = '42501';
    end if;
    if p_low_voltage is not null and (p_low_voltage < 0 or p_low_voltage > 80) then
      raise exception 'Voltage threshold is out of range' using errcode = '22023';
    end if;
    if p_low_soc is not null and (p_low_soc < 0 or p_low_soc > 100) then
      raise exception 'Charge threshold is out of range' using errcode = '22023';
    end if;
    if p_silent is not null and (p_silent < 1 or p_silent > 168) then
      raise exception 'Silence window is out of range' using errcode = '22023';
    end if;
    insert into public.cos_power_alarm_settings as settings (singleton, low_voltage_v, low_soc_percent, silent_hours, updated_by)
    values (true, p_low_voltage, p_low_soc, p_silent, p_actor)
    on conflict (singleton) do update
      set low_voltage_v = excluded.low_voltage_v,
          low_soc_percent = excluded.low_soc_percent,
          silent_hours = excluded.silent_hours,
          updated_by = excluded.updated_by;
  end if;
  select * into saved from public.cos_power_alarm_settings where singleton;
  if not found then
    return jsonb_build_object('lowVoltageV', null, 'lowSocPercent', null, 'silentHours', null);
  end if;
  return jsonb_build_object(
    'lowVoltageV', saved.low_voltage_v,
    'lowSocPercent', saved.low_soc_percent,
    'silentHours', saved.silent_hours
  );
end;
$$;

revoke all on function cos_vrm_private.power_alarm_settings_for_actor(uuid, boolean, numeric, numeric, numeric) from public, anon, authenticated;
grant usage on schema cos_vrm_private to service_role;
grant execute on function cos_vrm_private.power_alarm_settings_for_actor(uuid, boolean, numeric, numeric, numeric) to service_role;

-- PostgREST only exposes public. This wrapper adds no check of its own.
-- Execute is service_role only, and the private function checks the actor again.
create or replace function public.cos_power_alarm_settings_for_actor(p_actor uuid, p_write boolean, p_low_voltage numeric, p_low_soc numeric, p_silent numeric)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cos_vrm_private.power_alarm_settings_for_actor(p_actor, p_write, p_low_voltage, p_low_soc, p_silent);
$$;

revoke all on function public.cos_power_alarm_settings_for_actor(uuid, boolean, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.cos_power_alarm_settings_for_actor(uuid, boolean, numeric, numeric, numeric) to service_role;
