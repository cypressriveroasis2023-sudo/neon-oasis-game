-- SUPPLEMENTAL REVIEW ARTIFACT: existing Owner one-shot claim lease only.
-- Apply only to the installed reviewed guard, before allowance enrollment.
-- No source/cache/account writes, reset/rearm, trigger/table DDL, roles or grants.
-- Reviewed deadline chain: guarded220s; ordinary60s; drain480s unchanged.
-- Canonical fresh-install SQL is separate. Never broadly reapply it here.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $lease_budget$
declare
 identity regprocedure:='public.cos_field_geocode_claim(uuid,text,text,text,text)'::regprocedure;
 definition text; current_sha text; account_before jsonb; metadata_before jsonb;
 before_sha constant text:='124661b8b86f20955b8f243724c345472915c618c105ff0931aa6921838ba08a';
 after_sha constant text:='29cc852e0646957d17abd80d6cc206fc326532db7f87cc233336b0f56b6d5947';
begin
 -- Serialize with enrollment at its last lock. This migration acquires no source
 -- or Census-cache lock, so it cannot invert source -> cache -> account ordering.
 select to_jsonb(g) into account_before from app_private.cos_geocodio_account_state g where singleton for update;
 if not found or (select count(*) from app_private.cos_geocodio_account_state)<>1 then
  raise exception 'Owner lease budget requires the existing singleton account.' using errcode='40001'; end if;
 if account_before->'owner_one_census_v1' is distinct from 'null'::jsonb then
  raise exception 'Owner lease budget requires no enrolled allowance; never revise an active attempt.' using errcode='40001'; end if;
 select to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid),encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
  into metadata_before,definition,current_sha from pg_proc p where p.oid=identity;
 if metadata_before->>'proowner' is distinct from (select oid::text from pg_roles where rolname='postgres')
  or metadata_before->'proacl' is distinct from '["postgres=X/postgres","service_role=X/postgres"]'::jsonb
  or metadata_before->'prosecdef' is distinct from 'false'::jsonb
  or metadata_before->'proconfig' is distinct from '["search_path=\"\""]'::jsonb then
  raise exception 'Owner lease budget security catalog drift; do not add permissions.' using errcode='40001'; end if;
 if current_sha not in (before_sha,after_sha) then
  raise exception 'Owner lease budget claim-definition drift.' using errcode='40001'; end if;
 if current_sha=before_sha then
  if length(definition)-length(replace(definition,'lease_until=v_now+interval ''120 seconds''',''))<>length('lease_until=v_now+interval ''120 seconds''') then
   raise exception 'Owner lease budget expected exactly one guarded interval.' using errcode='40001'; end if;
  definition:=replace(definition,'lease_until=v_now+interval ''120 seconds''','lease_until=v_now+interval ''220 seconds''');
  if encode(sha256(convert_to(definition,'UTF8')),'hex')<>after_sha then
   raise exception 'Owner lease budget replacement mismatch.' using errcode='40001'; end if;
  execute definition;
 end if;
 if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=identity) is distinct from metadata_before
  or encode(sha256(convert_to(pg_get_functiondef(identity),'UTF8')),'hex')<>after_sha then
  raise exception 'Owner lease budget changed routine metadata or unexpected definition.' using errcode='40001'; end if;
 if (select to_jsonb(g) from app_private.cos_geocodio_account_state g where singleton) is distinct from account_before then
  raise exception 'Owner lease budget changed account/preparation evidence.' using errcode='40001'; end if;
end $lease_budget$;
-- Sanitized readback only; existing preparation remains byte-identical.
select encode(sha256(convert_to(pg_get_functiondef('public.cos_field_geocode_claim(uuid,text,text,text,text)'::regprocedure),'UTF8')),'hex') claim_definition_sha256,
 encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') account_sha256,
 owner_census_preparation_v1 is not null preparation_present,
 case when owner_census_preparation_v1 is not null then encode(sha256(convert_to(owner_census_preparation_v1::text,'UTF8')),'hex') end preparation_sha256,
 owner_one_census_v1 is null allowance_absent
from app_private.cos_geocodio_account_state g where singleton;
commit;
