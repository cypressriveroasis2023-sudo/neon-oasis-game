-- James, 2026-11-17: Service works the tech check inventory list. IT can do the
-- owner's work except account, password, and security changes. The owner keeps
-- those. This migration does not change any existing person's role or department.
-- It is not applied by the pull request.
--
-- A restrictive policy never grants access. It only stops an update of account
-- or security rows unless the signed-in profile is an active owner.

alter table public.user_profiles enable row level security;

drop policy if exists cos_staff_account_owner_update on public.user_profiles;
create policy cos_staff_account_owner_update
on public.user_profiles
as restrictive
for update
to authenticated
using (
  exists (
    select 1 from public.user_profiles self
    where self.user_id = (select auth.uid())
      and self.active is true
      and self.department = 'owner'
  )
)
with check (
  exists (
    select 1 from public.user_profiles self
    where self.user_id = (select auth.uid())
      and self.active is true
      and self.department = 'owner'
  )
);

revoke all on table public.user_profiles from anon;
