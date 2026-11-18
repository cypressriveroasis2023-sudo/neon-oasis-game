-- Not applied by this pull request. Do not run it against the live project from CI.
--
-- public.camera_unit_routers is the router status table read by the InHand
-- live status work and by GET /api/routers.
--
-- Migration 20260922204706 (add_camera_unit_routers) creates the table, enables
-- row level security, and adds policies. That statement does not GRANT or
-- REVOKE. No later migration grants this table. The table owner is postgres,
-- and that role's default privileges for new tables in schema public were
-- applied when the table was created. The live table ACL matches those
-- defaults exactly, with no column grants and no grant to PUBLIC:
--
--   postgres       SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   anon           SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   authenticated  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   service_role   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--
-- None of those grants are WITH GRANT OPTION.
--
-- Signed-in reads use the authenticated role and need table SELECT only:
--   * GET /api/routers selects the table with the caller's bearer, after the
--     existing sign-in and owner/IT gate.
--   * The unit camera status reader uses that same caller bearer.
--   * Camera Health loads the table with the signed-in session.
-- anon is not used for those reads. The camera health sweep selects and
-- updates with the service role, which this migration does not change.
-- Policies on this table are not changed. No other table is named.

revoke all on table public.camera_unit_routers from anon, authenticated;
grant select on table public.camera_unit_routers to authenticated;
