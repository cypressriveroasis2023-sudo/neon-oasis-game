-- REVIEW ARTIFACT ONLY. Default rollback; no production application authorized.
-- Current bindings and cache timestamps must come from the separately reviewed
-- private manifest. Never commit actual source bindings or address hashes here.
-- Each entry: {binding: <exact current bridge binding>,
--              censusUpdatedAt: <reviewed timestamp>, geocodioUpdatedAt: <reviewed timestamp>}.
-- Existing administrative enrollment path only; no new callable RPC or grants.
\set ON_ERROR_STOP on
\if :{?reviewed_diagnostic_manifest_json}
\else
 \echo 'Missing reviewed_diagnostic_manifest_json; no enrollment attempted.'
 \quit
\endif
\if :{?commit_diagnostic_enrollment}
\else
 \set commit_diagnostic_enrollment false
\endif
begin;
set local role service_role;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local cos.reviewed_diagnostic_manifest = :'reviewed_diagnostic_manifest_json';
do $$
declare manifest jsonb:=current_setting('cos.reviewed_diagnostic_manifest')::jsonb;
 member jsonb; binding jsonb; jobs jsonb:='{}'; prior jsonb; c app_private.cos_imported_census_cache;
 f app_private.cos_field_geocode_fallback_cache; sha text;
begin
 if jsonb_typeof(manifest) is distinct from 'array' or jsonb_array_length(manifest) not between 1 and 35 then
  raise exception 'Reviewed diagnostic manifest requires 1 through 35 exact unique addresses.'; end if;
 -- Lock legacy/source bindings before the common account serialization row.
 for member in select value from jsonb_array_elements(manifest) order by value#>>'{binding,addressSha256}' loop
  if jsonb_typeof(member) is distinct from 'object' or (select count(*) from jsonb_object_keys(member))<>3
   or not(member ?& array['binding','censusUpdatedAt','geocodioUpdatedAt']) then raise exception 'Invalid reviewed member.'; end if;
  binding:=member->'binding';
  if not app_private.cos_imported_lock_binding('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',binding) then
   raise exception 'Reviewed diagnostic source changed or is held.' using errcode='40001'; end if;
 end loop;
 select diagnostic_recovery_v1 into prior from app_private.cos_geocodio_account_state where singleton for update;
 if not found then raise exception 'Geocoder account state missing.'; end if;
 if prior is not null then
  if jsonb_array_length(manifest)<>(select count(*) from jsonb_object_keys(prior->'jobs')) or exists(
   select 1 from jsonb_array_elements(manifest) m where prior#>array['jobs',m#>>'{binding,addressSha256}','binding'] is distinct from m->'binding'
    or (prior#>>array['jobs',m#>>'{binding,addressSha256}','censusBefore','updated_at'])::timestamptz is distinct from (m->>'censusUpdatedAt')::timestamptz
    or (prior#>>array['jobs',m#>>'{binding,addressSha256}','fallbackBefore','updated_at'])::timestamptz is distinct from (m->>'geocodioUpdatedAt')::timestamptz
  ) then raise exception 'Diagnostic cohort is frozen.'; end if;
  return;
 end if;
 for member in select value from jsonb_array_elements(manifest) order by value#>>'{binding,addressSha256}' loop
  binding:=member->'binding';sha:=binding->>'addressSha256';
  if jobs ? sha then raise exception 'Diagnostic manifest must deduplicate exact addresses.'; end if;
  select * into c from app_private.cos_imported_census_cache where organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' and address_sha256=sha for update;
  select * into f from app_private.cos_field_geocode_fallback_cache where organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' and address_sha256=sha for update;
  if c.updated_at is distinct from (member->>'censusUpdatedAt')::timestamptz or f.updated_at is distinct from (member->>'geocodioUpdatedAt')::timestamptz then
   raise exception 'Reviewed diagnostic cache changed.' using errcode='40001'; end if;
  jobs:=jobs||jsonb_build_object(sha,jsonb_build_object('binding',binding,'censusBefore',to_jsonb(c),
   'fallbackBefore',to_jsonb(f),'censusRequestId',null,'geocodioRequestId',null));
 end loop;
 update app_private.cos_geocodio_account_state set diagnostic_recovery_v1=jsonb_build_object(
  'policyVersion','pre_selector_diagnostic_v1','manifestSha256',encode(sha256(convert_to(jobs::text,'UTF8')),'hex'),'jobs',jobs) where singleton;
end $$;
select diagnostic_recovery_v1->>'policyVersion' as policy,
 diagnostic_recovery_v1->>'manifestSha256' as manifest_sha256,
 (select count(*) from jsonb_object_keys(diagnostic_recovery_v1->'jobs')) as addresses
from app_private.cos_geocodio_account_state where singleton;
\if :commit_diagnostic_enrollment
 commit;
\else
 rollback;
\endif
