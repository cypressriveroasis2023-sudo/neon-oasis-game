-- REVIEW ARTIFACT: bounded one-time enrollment only; no HTTP/provider requests.
-- Prerequisites, in this order on the legacy project:
--   1. geocodio-postal-precision-rejections.sql
--   2. geocodio-imported-postal-precision-rejections.sql
--   3. geocodio-postal-retry-v1.sql
--   4. Updated geocoder handler (it reads the dedicated retry cohort first).
-- Keep the live ordinary queue-prefilter v2 functions installed; this rollout does not replace them.
-- Before enrollment: obtain fresh source-bridge bindings for the reviewed cohort,
-- compare every full binding (source revision/file/row/address/native guard hashes),
-- and supply ONLY those historical failed bindings. Exclude fresh source admissions
-- and new safely diagnosed no_match outcomes, even when they share a ZIP+4 format. The first successful manifest is frozen:
-- no later call may add/change entries for us_zip_precision_v1. Maximum 80 entries,
-- deduplicated by exact original full-address SHA256 (never by a ZIP5 hash).
-- Run this script with psql as the authorized SQL administrator or service backend.
-- The required approved_bindings_json psql variable must contain the reviewed JSON array.
-- Default is a rollback preview. Set commit_retry_enrollment=true only after verifying
-- this reviewed cohort is within the user-authorized recovery; commit enrolls the existing worker.
-- Enrollment itself never clears a terminal result, spends credit, or creates a fake lease.
\set ON_ERROR_STOP on
\if :{?approved_bindings_json}
\else
 \echo 'Missing reviewed approved_bindings_json. No enrollment attempted.'
 \quit
\endif
\if :{?commit_retry_enrollment}
\else
 \set commit_retry_enrollment false
\endif
begin;
set local role service_role;
set local lock_timeout='2s';
set local statement_timeout='30s';
select public.cos_imported_geocode_postal_retry_enroll(
 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid, :'approved_bindings_json'::jsonb
) as enrollment;
select public.cos_imported_geocode_postal_retry_list_due(
 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid,80
) as due_cohort;
select policy_version,phase,count(*) as address_count,sum(census_claims) as census_requests,
 sum(geocodio_claims) as charged_geocodio_requests
from app_private.cos_imported_postal_retry_jobs
where organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' and policy_version='us_zip_precision_v1'
group by policy_version,phase order by phase;
\if :commit_retry_enrollment
 commit;
\else
 rollback;
\endif
