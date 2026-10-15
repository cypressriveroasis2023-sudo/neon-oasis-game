-- Generic disposable-hosted-fixture setup only. Run only through bootstrap.mjs.
-- The fixture has already created anon, authenticated and service_role.
DO $guard$
BEGIN
 IF current_database() <> 'cos_camera_receipt_test_ci' OR current_user <> 'postgres' THEN
  RAISE EXCEPTION 'Dedicated synthetic proof database and owner required';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN
  RAISE EXCEPTION 'Fresh isolated cluster required: authenticator already exists';
 END IF;
END $guard$;
CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
 PASSWORD 'synthetic-authenticator-ci-only';
ALTER ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT anon, authenticated, service_role TO authenticator;
GRANT CONNECT ON DATABASE cos_camera_receipt_test_ci TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- No table grants, bypass-RLS privileges or broad function execute grants.
-- Existing fixture function ACLs remain the authority for RPC access.
ALTER DATABASE cos_camera_receipt_test_ci SET statement_timeout='8s';
ALTER DATABASE cos_camera_receipt_test_ci SET lock_timeout='8s';
ALTER DATABASE cos_camera_receipt_test_ci SET work_mem='2184kB';
ALTER DATABASE cos_camera_receipt_test_ci SET timezone='UTC';
ALTER ROLE postgres SET statement_timeout='8s';
ALTER ROLE postgres SET lock_timeout='8s';
ALTER ROLE postgres SET work_mem='2184kB';
ALTER ROLE authenticator SET statement_timeout='8s';
ALTER ROLE authenticator SET lock_timeout='8s';
ALTER ROLE authenticator SET work_mem='2184kB';
ALTER ROLE anon SET statement_timeout='8s';
ALTER ROLE anon SET lock_timeout='8s';
ALTER ROLE anon SET work_mem='2184kB';
ALTER ROLE authenticated SET statement_timeout='8s';
ALTER ROLE authenticated SET lock_timeout='8s';
ALTER ROLE authenticated SET work_mem='2184kB';
ALTER ROLE service_role SET statement_timeout='8s';
ALTER ROLE service_role SET lock_timeout='8s';
ALTER ROLE service_role SET work_mem='2184kB';
-- Synthetic-only probe: proves actual PostgREST role/session limits without granting table access.
CREATE FUNCTION public.synthetic_camera_runtime_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $probe$
 SELECT jsonb_build_object(
  'statement_timeout',current_setting('statement_timeout'),
  'lock_timeout',current_setting('lock_timeout'),
  'work_mem',current_setting('work_mem'),
  'transaction_isolation',current_setting('transaction_isolation'),
  'enable_seqscan',current_setting('enable_seqscan'),
  'enable_indexscan',current_setting('enable_indexscan'),
  'enable_indexonlyscan',current_setting('enable_indexonlyscan'),
  'enable_bitmapscan',current_setting('enable_bitmapscan'),
  'enable_hashjoin',current_setting('enable_hashjoin'),
  'enable_mergejoin',current_setting('enable_mergejoin'),
  'enable_nestloop',current_setting('enable_nestloop'))
$probe$;
REVOKE ALL ON FUNCTION public.synthetic_camera_runtime_settings() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.synthetic_camera_runtime_settings() TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
