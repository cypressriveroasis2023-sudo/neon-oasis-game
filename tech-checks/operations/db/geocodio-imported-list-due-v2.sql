-- Additive replacement v2; apply after geocodio-imported-jobs.sql in the legacy
-- geocoder project. Replaces only queue selection, preserving the function ACL.
-- Claim/reserve/finish and all legacy/current-source checks remain unchanged.
begin;
do $$
begin
 if to_regprocedure('public.cos_imported_geocode_list_due(uuid,integer)') is null then
  raise exception 'Apply the imported geocode baseline before queue eligibility v2.';
 end if;
end $$;

create or replace function public.cos_imported_geocode_list_due(p_organization_id uuid,p_limit integer default 80)
returns jsonb language plpgsql set search_path='' as $$
declare job app_private.cos_imported_geocode_jobs; c app_private.cos_imported_census_cache; f app_private.cos_field_geocode_fallback_cache;
 result jsonb:='[]'; seen text[]:='{}'; stage text; v_now timestamptz:=clock_timestamp(); guard jsonb; enabled boolean;
begin
 perform app_private.cos_geocode_assert_service(p_organization_id);
 if p_limit is null or p_limit not between 1 and 80 then raise exception 'At most 80 imported addresses required.' using errcode='22023'; end if;
 if not app_private.cos_imported_try_lock_legacy() then return '[]'::jsonb; end if;
 select exists(select 1 from app_private.cos_geocodio_control ctl where singleton and ctl.enabled and free_only)
  and exists(select 1 from app_private.cos_geocodio_account_state where singleton and (blocked_until is null or blocked_until<=v_now)
   and (cooldown_until is null or cooldown_until<=v_now)) into enabled;
 -- Exclude caches that cannot produce work before scanning legacy devices/audits.
 -- Keep every eligible unit (no LIMIT or address DISTINCT here): a held first
 -- unit must not hide a later allowed unit at the same address.
 for job in
  select j.* from app_private.cos_imported_geocode_jobs j
  left join app_private.cos_imported_census_cache census
   on census.organization_id=j.organization_id and census.address_sha256=j.address_sha256 and census.address=j.address
  left join app_private.cos_field_geocode_fallback_cache fallback
   on fallback.organization_id=j.organization_id and fallback.address_sha256=j.address_sha256 and fallback.address=j.address
  where j.organization_id=p_organization_id and j.binding is not null and not j.invalidated
   and (census.organization_id is null
    or census.status in ('pending','provider_error')
     and (census.lease_until is null or census.lease_until<=v_now)
     and (census.next_attempt_at is null or census.next_attempt_at<=v_now)
    or census.status='no_match' and enabled
     and (fallback.organization_id is null
      or fallback.status in ('pending','provider_error','deferred')
       and (fallback.lease_until is null or fallback.lease_until<=v_now)
       and (fallback.next_attempt_at is null or fallback.next_attempt_at<=v_now)))
  order by j.event_id,j.entity_kind,j.native_unit_id loop
  if job.address_sha256=any(seen) then continue; end if;
  guard:=app_private.cos_imported_legacy_guard(job.unit_number);
  if guard->>'allowed'<>'true' or guard->>'sha256' is distinct from job.legacy_guard_sha256 then continue; end if;
  select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
  stage:=null;
  if not found or c.status in ('pending','provider_error') and (c.lease_until is null or c.lease_until<=v_now) and (c.next_attempt_at is null or c.next_attempt_at<=v_now) then stage:='census';
  elsif c.status='no_match' and enabled then
   select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
   if not found or f.status in ('pending','provider_error','deferred') and (f.lease_until is null or f.lease_until<=v_now) and (f.next_attempt_at is null or f.next_attempt_at<=v_now) then stage:='geocodio'; end if;
  end if;
  if stage is not null then
   result:=result||jsonb_build_array(jsonb_build_object('binding',job.binding,'legacyGuardSha256',job.legacy_guard_sha256,'stage',stage));
   seen:=array_append(seen,job.address_sha256);
   if jsonb_array_length(result)>=p_limit then exit; end if;
  end if;
 end loop;
 return result;
end $$;

commit;
