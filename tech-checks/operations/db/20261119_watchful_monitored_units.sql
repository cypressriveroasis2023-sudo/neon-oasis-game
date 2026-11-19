-- Not applied by this pull request. Do not run it against the live project from CI.
-- Private Watchful roster. Authenticated may read. anon has no grant.
-- The owner-approved load uses the service role. This file does not load rows.

create table public.watchful_monitored_units (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null,
  unit_name text not null,
  canonical_unit_key text not null,
  site_name text not null,
  unit_group text not null,
  unit_status text not null,
  cameras_up integer not null,
  cameras_down integer not null,
  snapshot_at timestamptz not null,
  loaded_at timestamptz not null default now(),
  constraint watchful_monitored_units_group_check
    check (unit_group in ('Uniview Spotters', 'Solar Spotters', 'Avigilon', 'Recon', 'Other')),
  constraint watchful_monitored_units_status_check
    check (unit_status in ('up', 'down')),
  constraint watchful_monitored_units_cameras_check
    check (cameras_up >= 0 and cameras_down >= 0),
  constraint watchful_monitored_units_snapshot_key
    unique (snapshot_id, canonical_unit_key)
);

alter table public.watchful_monitored_units enable row level security;

drop policy if exists watchful_monitored_units_authenticated_read on public.watchful_monitored_units;
create policy watchful_monitored_units_authenticated_read
  on public.watchful_monitored_units
  for select
  to authenticated
  using (true);

revoke all on table public.watchful_monitored_units from public, anon, authenticated, service_role;
grant select on table public.watchful_monitored_units to authenticated;
grant select, insert, update, delete on table public.watchful_monitored_units to service_role;
