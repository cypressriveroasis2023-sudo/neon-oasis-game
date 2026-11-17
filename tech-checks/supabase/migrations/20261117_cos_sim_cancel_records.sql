-- James asked on 2026-11-17 for the SIM cancellation step to keep the SIM
-- number. This migration is not applied by the pull request.
-- The full number lives only in this table. Lists show the last four digits.
-- Row level security is on. The anon role has no access.

create table public.cos_sim_cancel_records (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  unit_number text not null,
  outcome text not null check (outcome in ('canceled', 'no_sim')),
  carrier text,
  canceled_on date,
  canceled_by text not null,
  confirmation text,
  sim_number text,
  no_sim_reason text,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid,
  constraint cos_sim_cancel_product check (product_id ~ '^[1-9][0-9]{0,17}$'),
  constraint cos_sim_cancel_shape check (
    (outcome = 'no_sim' and sim_number is null and no_sim_reason is not null and length(btrim(no_sim_reason)) > 0)
    or
    (outcome = 'canceled' and sim_number is not null and length(sim_number) between 8 and 32
      and carrier in ('Verizon', 'AT&T', 'T-Mobile', 'Other')
      and canceled_on is not null
      and no_sim_reason is null)
  )
);

alter table public.cos_sim_cancel_records enable row level security;
alter table public.cos_sim_cancel_records force row level security;

revoke all on table public.cos_sim_cancel_records from public, anon;
grant select, insert on table public.cos_sim_cancel_records to authenticated;

create policy cos_sim_cancel_staff_read
on public.cos_sim_cancel_records
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.active is true
      and p.department in ('owner', 'it', 'service')
  )
);

create policy cos_sim_cancel_staff_insert
on public.cos_sim_cancel_records
for insert
to authenticated
with check (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.active is true
      and p.department in ('owner', 'it', 'service')
  )
);
