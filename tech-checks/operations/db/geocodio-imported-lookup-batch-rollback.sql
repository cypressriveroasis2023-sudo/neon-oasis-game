-- Restore the prior reader before removing its private batch helper.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '30s';

create or replace function public.cos_imported_geocode_read_many(p_organization_id uuid,p_bindings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_binding jsonb; job app_private.cos_imported_geocode_jobs; guard jsonb; c app_private.cos_imported_census_cache;
 f app_private.cos_field_geocode_fallback_cache; result jsonb:='[]'; record jsonb; legacy_locked boolean;
begin
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501'; end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' then
  if not app_private.cos_verified_fleet_actor(auth.uid()) then raise exception 'Owner account required.' using errcode='42501'; end if;
 end if;
 if p_bindings is null or jsonb_typeof(p_bindings) is distinct from 'array' then raise exception 'Imported bindings required.' using errcode='22023'; end if;
 if jsonb_array_length(p_bindings)>250 then raise exception 'At most 250 imported bindings required.' using errcode='22023'; end if;
 legacy_locked:=app_private.cos_imported_try_lock_legacy();
 for v_binding in select value from jsonb_array_elements(p_bindings) loop
  perform app_private.cos_imported_assert_binding(p_organization_id,v_binding);
  select * into job from app_private.cos_imported_geocode_jobs j where j.organization_id=p_organization_id and j.entity_kind=v_binding->>'entityKind'
   and j.native_unit_id=(v_binding->>'nativeUnitId')::uuid and j.binding=v_binding for share;
  if not found then continue; end if;
  if not legacy_locked then
   result:=result||jsonb_build_array(app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'held','legacy_busy'));
   continue;
  end if;
  guard:=app_private.cos_imported_precedence_guard(job.binding);
  if job.invalidated or guard->>'allowed'<>'true' or guard->>'sha256' is distinct from job.legacy_guard_sha256 then
   record:=app_private.cos_imported_status_record(v_binding,guard->>'sha256','held',case when job.invalidated then 'source_changed' else 'legacy_override' end);
  else
   select * into c from app_private.cos_imported_census_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
   if not found then record:=app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'pending','census_pending');
   elsif c.status<>'no_match' then record:=app_private.cos_imported_census_record(v_binding,job.legacy_guard_sha256,c);
   else
    select * into f from app_private.cos_field_geocode_fallback_cache where organization_id=p_organization_id and address_sha256=job.address_sha256 and address=job.address;
    if found then record:=app_private.cos_imported_record(v_binding,job.legacy_guard_sha256,f);
    elsif not exists(select 1 from app_private.cos_geocodio_control where singleton and enabled and free_only) then
     record:=app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'deferred','configuration_unavailable');
    else record:=app_private.cos_imported_status_record(v_binding,job.legacy_guard_sha256,'pending','geocodio_pending'); end if;
   end if;
  end if;
  result:=result||jsonb_build_array(record);
 end loop;
 return result;
end $$;

drop function app_private.cos_imported_legacy_guards_many(text[]);
commit;
