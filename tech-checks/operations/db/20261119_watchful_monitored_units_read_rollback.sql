-- Reverses tech-checks/operations/db/20261119_watchful_monitored_units_read.sql.
-- One transaction. A failure leaves the added columns in place.
-- snapshot_at is Watchful's observation time. NOT NULL is not restored: rows
-- that never had an observation are null, and filling them from fetched_at
-- would make old data look fresher. SET NOT NULL would then fail on those
-- rows. Leaving the column nullable keeps the real observation time.
-- Does not drop the roster table.

begin;

-- Observation time is snapshot_at. Do not copy fetched_at into it.
-- Leave snapshot_at nullable. Report how many rows have no observation time.
do $$
declare
  missing integer;
begin
  select count(*) into missing
  from public.watchful_monitored_units
  where snapshot_at is null;
  raise warning 'snapshot_at stays nullable: % row(s) have no observation time', missing;
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
