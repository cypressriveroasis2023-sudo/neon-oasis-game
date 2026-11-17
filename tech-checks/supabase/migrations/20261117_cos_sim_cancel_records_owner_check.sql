-- Not applied by this pull request. Owner approval is required before this runs.
-- Apply only while the table has no rows. Direct inserts must name the signed-in
-- platform user. One product and return can be recorded once.

do $$
begin
  if exists (select 1 from public.cos_sim_cancel_records) then
    raise exception 'cos_sim_cancel_records already has rows; this migration stops';
  end if;
end $$;

alter table public.cos_sim_cancel_records
  add column if not exists return_id uuid;

alter table public.cos_sim_cancel_records
  alter column return_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cos_sim_cancel_records_product_return_key'
      and conrelid = 'public.cos_sim_cancel_records'::regclass
  ) then
    alter table public.cos_sim_cancel_records
      add constraint cos_sim_cancel_records_product_return_key unique (product_id, return_id);
  end if;
end $$;

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
