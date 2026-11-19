-- Reverses tech-checks/operations/db/20261119_watchful_monitored_units_read.sql.
-- Does not drop the roster table.

alter table public.watchful_monitored_units
  drop constraint if exists watchful_monitored_units_arming_check;

alter table public.watchful_monitored_units
  drop column if exists fetched_at,
  drop column if exists arming,
  drop column if exists project_id;

alter table public.watchful_monitored_units
  alter column snapshot_at set not null;
