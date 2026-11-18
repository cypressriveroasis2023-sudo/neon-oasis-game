-- Restores the anon and authenticated grants removed by
-- tech-checks/supabase/migrations/20261118_camera_unit_routers_read_grants.sql.
-- Not applied by this pull request.
--
-- Current live grants on public.camera_unit_routers. None are WITH GRANT OPTION.
--
--   postgres       SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   anon           SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   authenticated  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   service_role   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--
-- Granting these eight privileges back to anon and authenticated restores
-- that pair. postgres and service_role are not modified.

grant select, insert, update, delete, truncate, references, trigger, maintain
  on table public.camera_unit_routers
  to anon, authenticated;
