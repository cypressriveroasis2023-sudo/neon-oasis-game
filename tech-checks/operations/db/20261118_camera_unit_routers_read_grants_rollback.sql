-- Restores the anon and authenticated grants removed by
-- tech-checks/supabase/migrations/20261118_camera_unit_routers_read_grants.sql.
-- Not applied by this pull request.
--
-- Current grants on public.camera_unit_routers. Migration 20260922204706
-- (add_camera_unit_routers) does not contain a GRANT. Creating that table as
-- postgres applied the role's default privileges for tables in schema public.
-- The live ACL matches those defaults. No privilege is grantable.
--
--   postgres       SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   anon           SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   authenticated  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   service_role   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--
-- The forward migration revokes only anon and authenticated. Granting the same
-- eight privileges back restores that pair. postgres and service_role are not
-- modified.

grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.camera_unit_routers
  to anon, authenticated;
