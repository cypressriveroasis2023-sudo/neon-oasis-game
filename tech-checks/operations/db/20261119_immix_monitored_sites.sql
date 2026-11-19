-- Not applied by this pull request. Do not run it against the live project from CI.
-- Private list of sites monitored on Immix instead of Watchful.
-- Site names are loaded later by the owner. This file inserts none.

create table public.immix_monitored_sites (
  site_name text primary key,
  source text not null default 'immix',
  loaded_at timestamptz not null default now(),
  constraint immix_monitored_sites_source_check check (source in ('watchful', 'immix')),
  constraint immix_monitored_sites_name_check check (length(btrim(site_name)) > 0)
);

alter table public.immix_monitored_sites enable row level security;

drop policy if exists immix_monitored_sites_authenticated_read on public.immix_monitored_sites;
create policy immix_monitored_sites_authenticated_read
  on public.immix_monitored_sites
  for select
  to authenticated
  using (true);

revoke all on table public.immix_monitored_sites from public, anon, authenticated, service_role;
grant select on table public.immix_monitored_sites to authenticated;
grant select, insert, update, delete on table public.immix_monitored_sites to service_role;
