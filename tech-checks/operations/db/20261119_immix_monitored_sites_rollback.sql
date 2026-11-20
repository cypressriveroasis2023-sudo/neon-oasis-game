-- Not applied by this pull request. Do not run it against the live project from CI.
-- Reverses tech-checks/operations/db/20261119_immix_monitored_sites.sql.

drop policy if exists immix_monitored_sites_authenticated_read on public.immix_monitored_sites;
revoke all on table public.immix_monitored_sites from public, anon, authenticated, service_role;
drop table if exists public.immix_monitored_sites;
