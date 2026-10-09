-- Camera Health only. Read-local batching; no records, indexes, roles, or
-- existing function permissions are changed. Keep the scalar guard authoritative
-- for reviewed source-precedence bindings and all existing writer paths.
begin;
set local lock_timeout = '1s';
set local statement_timeout = '30s';

-- Private implementation detail of the SECURITY DEFINER reader below. The
-- caller already holds the same NOWAIT SHARE locks; take them again here so
-- this helper cannot accidentally calculate an unlocked legacy snapshot.
create function app_private.cos_imported_legacy_guards_many(p_unit_numbers text[])
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;
begin
 if p_unit_numbers is null or cardinality(p_unit_numbers)>250
  or exists(select 1 from unnest(p_unit_numbers) label where label is null or length(label) not between 1 and 160) then
  raise exception 'At most 250 valid imported unit labels required.' using errcode='22023';
 end if;
 if not app_private.cos_imported_try_lock_legacy() then return null; end if;
 with concerns as materialized (
  select distinct app_private.cos_imported_concern_key(label) concern from unnest(p_unit_numbers) label
 ), devices as materialized (
  select d.id,d.unit_key,app_private.cos_imported_concern_key(d.unit_key) concern from public.camera_devices d
 ), audits as materialized (
  select a.id,a.unit_key,a.action::text action,a.after_state,a.device_ids,
   app_private.cos_imported_concern_key(a.unit_key) concern from public.camera_inventory_audit a
 ), guards as (
  select k.concern,d.devices,d.ids,d.variants,a.audits,a.suppressed
  from concerns k
  cross join lateral (
   select coalesce(jsonb_agg(jsonb_build_array(d.id::text,d.unit_key) order by d.id),'[]') devices,
    array_agg(d.id) ids,count(distinct upper(btrim(d.unit_key))) variants
   from devices d where d.concern=k.concern
  ) d
  cross join lateral (
   select coalesce(jsonb_agg(jsonb_build_array(a.id::text,a.unit_key,a.action,a.after_state->>'placement_contract',a.after_state->>'placement',a.device_ids) order by a.id),'[]') audits,
    coalesce(bool_or(a.after_state->>'placement_contract'='COS_CAMERA_PLACEMENT_V2'
     or a.device_ids&&coalesce(d.ids,'{}'::bigint[]) and a.concern is distinct from k.concern
     or a.action in ('MOVE_TO_ROOT','MOVE_TO_SHOP') or a.after_state->>'placement'='SHOP'),false) suppressed
   from audits a where a.concern=k.concern or a.device_ids&&coalesce(d.ids,'{}'::bigint[])
  ) a
 )
 select coalesce(jsonb_object_agg(concern,jsonb_build_object('allowed',not suppressed and variants<=1,
  'sha256',encode(sha256(convert_to(jsonb_build_object('concern',concern,'devices',devices,'audits',audits)::text,'UTF8')),'hex'))),'{}')
 into result from guards;
 return result;
end $$;
-- Never expose a caller-supplied batch snapshot or broaden private helper access.
revoke all on function app_private.cos_imported_legacy_guards_many(text[]) from public,anon,authenticated,service_role;

create or replace function public.cos_imported_geocode_read_many(p_organization_id uuid,p_bindings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_binding jsonb; job app_private.cos_imported_geocode_jobs; guard jsonb; c app_private.cos_imported_census_cache;
 f app_private.cos_field_geocode_fallback_cache; result jsonb:='[]'; record jsonb; legacy_locked boolean; legacy_guards jsonb;
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
  if job.binding ? 'sourcePrecedence' then
   -- Preserve the exact registered-review check and its fresh scalar guard.
   guard:=app_private.cos_imported_precedence_guard(job.binding);
  else
   if legacy_guards is null then
    legacy_guards:=app_private.cos_imported_legacy_guards_many(array(
     select value->>'unitNumber' from jsonb_array_elements(p_bindings)));
   end if;
   guard:=legacy_guards->app_private.cos_imported_concern_key(job.binding->>'unitNumber');
   if guard is null then raise exception 'Current imported legacy guards are unavailable.' using errcode='40001'; end if;
  end if;
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

commit;
