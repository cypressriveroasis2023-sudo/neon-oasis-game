-- Not applied by this pull request. Do not run it against the live project from CI.
-- Reverses tech-checks/operations/db/20261119_watchful_monitored_units.sql.
-- Drops the read policy, the grants, and the table. No row data is copied out.

drop policy if exists watchful_monitored_units_authenticated_read on public.watchful_monitored_units;
revoke all on table public.watchful_monitored_units from public, anon, authenticated, service_role;
drop table if exists public.watchful_monitored_units;
