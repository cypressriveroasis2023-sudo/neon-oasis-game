-- Reverses tech-checks/operations/db/20261119_watchful_monitored_units_read.sql.
-- One transaction. A failure leaves the added columns in place.
-- A null snapshot_at is filled from fetched_at. If any row is still null, the
-- NOT NULL constraint is left off instead of failing after the columns are gone.
-- Does not drop the roster table.

begin;

update public.watchful_monitored_units
set snapshot_at = fetched_at
where snapshot_at is null and fetched_at is not null;

do $$
begin
  if not exists (
    select 1 from public.watchful_monitored_units where snapshot_at is null
  ) then
    alter table public.watchful_monitored_units
      alter column snapshot_at set not null;
  end if;
end $$;

drop trigger if exists watchful_monitored_units_fetched_at_not_future on public.watchful_monitored_units;
drop function if exists public.watchful_monitored_units_reject_future_fetch();

alter table public.watchful_monitored_units
  drop constraint if exists watchful_monitored_units_arming_check;

alter table public.watchful_monitored_units
  drop column if exists fetched_at,
  drop column if exists arming,
  drop column if exists project_id;

commit;
