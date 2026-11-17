-- Not applied by this pull request. Owner approval is required before this runs.
-- Direct inserts must name the signed-in platform user. One product and return
-- can be recorded once, so a retry does not create a second row.

alter table public.cos_sim_cancel_records
  add column return_id uuid not null;

alter table public.cos_sim_cancel_records
  add constraint cos_sim_cancel_records_product_return_key unique (product_id, return_id);

drop policy if exists cos_sim_cancel_staff_insert on public.cos_sim_cancel_records;

create policy cos_sim_cancel_staff_insert
on public.cos_sim_cancel_records
for insert
to authenticated
with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.active is true
      and p.department in ('owner', 'it', 'service')
  )
);
