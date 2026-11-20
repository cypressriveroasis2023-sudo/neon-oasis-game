-- Not applied by this pull request. Do not run it against the live project from CI.
-- Additive: our read time, arming, and project id. snapshot_at is no longer required.
-- project_id is a uuid. fetched_at may not be in the future.
-- One transaction. A failure leaves the table as it was.
-- This file does not load rows.

begin;

alter table public.watchful_monitored_units
  add column if not exists fetched_at timestamptz,
  add column if not exists arming text,
  add column if not exists project_id uuid;

alter table public.watchful_monitored_units
  alter column snapshot_at drop not null;

alter table public.watchful_monitored_units
  drop constraint if exists watchful_monitored_units_arming_check;

alter table public.watchful_monitored_units
  add constraint watchful_monitored_units_arming_check
  check (arming is null or arming in ('armed', 'disarmed', 'paused', 'test', 'unknown'));

create or replace function public.watchful_monitored_units_reject_future_fetch()
returns trigger
language plpgsql
as $$
begin
  if new.fetched_at is not null and new.fetched_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'fetched_at is in the future';
  end if;
  return new;
end;
$$;

drop trigger if exists watchful_monitored_units_fetched_at_not_future on public.watchful_monitored_units;
create trigger watchful_monitored_units_fetched_at_not_future
  before insert or update of fetched_at on public.watchful_monitored_units
  for each row
  execute function public.watchful_monitored_units_reject_future_fetch();

commit;
