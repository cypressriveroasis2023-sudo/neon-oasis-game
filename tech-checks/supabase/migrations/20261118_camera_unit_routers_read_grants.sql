-- Not applied by this pull request. Do not run it against the live project from CI.
--
-- public.camera_unit_routers is the router status table. Signed-in reads use
-- the authenticated role. The live Camera Detail page upserts a row on this
-- table as the signed-in owner; row level security allows that owner write.
-- This migration does not change policies, postgres, or service_role.
--
-- Current live grants. None are WITH GRANT OPTION. There are no column
-- grants and no grant to PUBLIC.
--
--   postgres       SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   anon           SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   authenticated  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   service_role   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--
-- authenticated keeps SELECT, INSERT and UPDATE for those reads and the owner
-- upsert. TRUNCATE, DELETE, REFERENCES, TRIGGER and MAINTAIN are revoked from
-- authenticated. anon loses every privilege. The camera health sweep still
-- uses the service role.

revoke truncate, delete, references, trigger, maintain on table public.camera_unit_routers from authenticated;
revoke all on table public.camera_unit_routers from anon;
