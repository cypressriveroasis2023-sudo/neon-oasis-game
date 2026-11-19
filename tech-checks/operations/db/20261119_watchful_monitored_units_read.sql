-- Not applied by this pull request. Do not run it against the live project from CI.
-- Additive: our read time, arming, and project id. snapshot_at is no longer required.
-- A missing observation time may be derived from fetched_at by the loader.
-- This file does not load rows.

alter table public.watchful_monitored_units
  add column if not exists fetched_at timestamptz,
  add column if not exists arming text,
  add column if not exists project_id text;

alter table public.watchful_monitored_units
  alter column snapshot_at drop not null;

alter table public.watchful_monitored_units
  drop constraint if exists watchful_monitored_units_arming_check;

alter table public.watchful_monitored_units
  add constraint watchful_monitored_units_arming_check
  check (arming is null or arming in ('armed', 'disarmed', 'paused', 'test', 'unknown'));
