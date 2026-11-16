-- Not applied by this pull request, and not placed under supabase/migrations.
-- CI pins that directory to one reviewed file, so a new migration there fails
-- the operations check. Apply this only after a reviewed function can read it.
--
-- Every column is nullable on purpose. An empty row means the check is unset.
-- The app must say "threshold not set" rather than invent a voltage, a charge
-- percentage, or a silence window.

create table if not exists cos_vrm_private.power_alarm_settings (
  singleton boolean primary key default true check (singleton),
  low_voltage_v numeric,
  low_soc_percent numeric,
  silent_hours numeric,
  updated_at timestamptz not null default clock_timestamp(),
  constraint power_alarm_voltage_range check (low_voltage_v is null or (low_voltage_v >= 0 and low_voltage_v <= 80)),
  constraint power_alarm_soc_range check (low_soc_percent is null or (low_soc_percent >= 0 and low_soc_percent <= 100)),
  constraint power_alarm_silent_range check (silent_hours is null or (silent_hours >= 1 and silent_hours <= 168))
);

alter table cos_vrm_private.power_alarm_settings enable row level security;
revoke all on table cos_vrm_private.power_alarm_settings from public, anon, authenticated, service_role;
