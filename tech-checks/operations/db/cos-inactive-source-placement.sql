-- REVIEW ARTIFACT: native database, after the reviewed mHelp source importer.
-- A source disposition is neither a Shop move nor provider deactivation.
-- V1/V2 bridge tombstones, native inventory, GPS and history remain unchanged.
begin;

alter table app_private.cos_geocode_sources
 drop constraint cos_geocode_sources_source_placement_check,
 add constraint cos_geocode_sources_source_placement_check check(source_placement in ('FIELD','SHOP','INACTIVE')),
 drop constraint cos_geocode_sources_check1,
 add constraint cos_geocode_sources_check1 check(
  (active and source_placement='FIELD' and eligibility='FIELD' and street is not null and state is not null
   and (city is not null or zip is not null) and address_sha256 is not null)
  or ((not active or source_placement in ('SHOP','INACTIVE')) and eligibility='tombstone'));

-- Reuse the byte-reviewed importer guards and locking without changing the
-- original FIELD/SHOP entry point or the support-creation hash gate. Fail closed
-- on any unexpected importer body. The generated private function has the same
-- invoker security and empty search_path; it receives no API/role grants.
do $$
declare definition text; original text; old_fragment text; new_fragment text; source_properties_ok boolean;
begin
 select pg_get_functiondef(oid),prosrc,
  not prosecdef and proconfig=array['search_path=""']::text[] and not proretset
  and prorettype='jsonb'::regtype and prolang=(select oid from pg_language where lanname='plpgsql')
  and proowner=(select oid from pg_roles where rolname='postgres')
 into definition,original,source_properties_ok from pg_proc
 where oid='app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb)'::regprocedure;
 if source_properties_ok is distinct from true or encode(sha256(convert_to(original,'UTF8')),'hex') is distinct from
  '45a4071388d9823fc9d4442c66012458f8eff56f78957674f27a8625fcbc405d' then
  raise exception 'Reviewed source importer changed.' using errcode='40001';end if;
 for old_fragment,new_fragment in select * from (values
  ('cos_geocode_sources_admin_import_reviewed','cos_geocode_sources_admin_inactive_reviewed'),
  ($a$'previousSourceRevision','placement','siteLabel'$a$,
   $a$'previousSourceRevision','placement','siteLabel','sourceStatus','sourceFullLabel','sourceObservedAt'$a$),
  ($a$coalesce(r->>'placement','') not in ('FIELD','SHOP')$a$,
   $a$coalesce(r->>'placement','') <> 'INACTIVE'$a$),
  ($a$v_id:=(r->>'nativeUnitId')::uuid;v_tracker:=(r->>'trackerId')::uuid;$a$,
   $a$-- Exact full label, not a numeric/family alias. Keep the immutable source
  -- file/row evidence in the private operator package. All address material is
  -- forbidden, including an address mask or stale customer/site display.
  if r->>'sourceStatus' is distinct from 'DO NOT USE'
   or r->>'sourceFullLabel' is distinct from (r->>'unitNumber')||' - DO NOT USE'
   or r->>'trackerUnitNumber' is distinct from r->>'unitNumber'
   or coalesce(r->>'sourceObservedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   or not isfinite((r->>'sourceObservedAt')::timestamptz)
   or (r->>'sourceObservedAt')::timestamptz>clock_timestamp()
   or r->>'siteLabel' is not null
   or r->'installation' is distinct from 'null'::jsonb
   or r->>'addressSha256' is not null
   or (r ? 'suppliedComponents' and r->'suppliedComponents' is distinct from 'null'::jsonb) then
   raise exception 'Explicit exact inactive source evidence required.' using errcode='22023';end if;
  v_id:=(r->>'nativeUnitId')::uuid;v_tracker:=(r->>'trackerId')::uuid;$a$),
  ('Shop has no geocoding address.','Inactive source has no geocoding address.')
 ) replacements(old_text,new_text) loop
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then
   raise exception 'Inactive source importer patch mismatch.' using errcode='40001';end if;
  definition:=replace(definition,old_fragment,new_fragment);
 end loop;
 execute definition;
end $$;
revoke all on function app_private.cos_geocode_sources_admin_inactive_reviewed(uuid,jsonb) from public,anon,authenticated,service_role;
commit;
