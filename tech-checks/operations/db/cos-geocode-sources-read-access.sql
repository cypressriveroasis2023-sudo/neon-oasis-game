-- Native project: bounded source-read wrappers only. Apply after cos-geocode-sources.sql.

-- Preserve app_private USAGE=false and every unrelated table/schema/function ACL.

-- No credentials, source data, import/revoke permissions or role assignments are changed.

begin;

create or replace function public.cos_geocode_sources_list_changes(p_organization_id uuid,p_after_event_id text,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; last_id text;
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 if p_after_event_id is null or p_after_event_id!~'^(0|[1-9][0-9]{0,18})$' or p_after_event_id::numeric>9223372036854775807
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid bounded source cursor.' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('eventId',e.event_id::text,'entityKind',e.entity_kind,'nativeUnitId',e.native_unit_id,
  'productId',e.product_id,'sourceRevision',e.source_revision,'kind',case when e.eligibility='FIELD' then 'upsert' else 'tombstone' end) order by e.event_id),'[]'),max(e.event_id)::text into result,last_id
 from (select * from app_private.cos_geocode_sources where organization_id=p_organization_id and event_id>p_after_event_id::bigint order by event_id limit p_limit) e;
 return jsonb_build_object('events',result,'nextEventId',coalesce(last_id,p_after_event_id));
end $$;

revoke all on function public.cos_geocode_sources_list_changes(uuid,text,integer) from public,anon,authenticated;

grant execute on function public.cos_geocode_sources_list_changes(uuid,text,integer) to service_role;

create or replace function public.cos_geocode_sources_read_current(p_organization_id uuid,p_entity_kind text,p_native_unit_id uuid,p_product_id text,p_source_revision uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 select app_private.cos_source_record(s) into result from app_private.cos_geocode_sources s
 where s.organization_id=p_organization_id and s.entity_kind=p_entity_kind and s.native_unit_id=p_native_unit_id
  and s.product_id=p_product_id and s.source_revision=p_source_revision
  and (s.eligibility='tombstone' or s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number));
 return jsonb_build_object('source',result);
end $$;

revoke all on function public.cos_geocode_sources_read_current(uuid,text,uuid,text,uuid) from public,anon,authenticated;

grant execute on function public.cos_geocode_sources_read_current(uuid,text,uuid,text,uuid) to service_role;

create or replace function public.cos_geocode_sources_read_many(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_identities) is distinct from 'array' or jsonb_array_length(p_identities)>250 then raise exception 'Invalid source identities.' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_identities) i where jsonb_typeof(i) is distinct from 'object'
  or i->>'entityKind' not in ('equipment_unit','tracker') or i->>'entityKind' is null
  or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or (i-'entityKind'-'nativeUnitId')<>'{}'::jsonb) then raise exception 'Invalid source identity.' using errcode='22023';end if;
 select coalesce(jsonb_agg(app_private.cos_source_record(s) order by s.native_unit_id),'[]') into result
 from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.eligibility='FIELD'
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
  and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return result;
end $$;

revoke all on function public.cos_geocode_sources_read_many(uuid,jsonb) from public,anon,authenticated;

grant execute on function public.cos_geocode_sources_read_many(uuid,jsonb) to service_role;

create or replace function public.cos_geocode_sources_read_current_batch(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i jsonb;result jsonb:='[]';
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 100 then raise exception 'Invalid source batch.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','productId','sourceRevision'])<>'{}'::jsonb
   or coalesce(i->>'entityKind','') not in ('equipment_unit','tracker') or coalesce(i->>'productId','')!~'^[1-9][0-9]{0,18}$'
   or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(i->>'sourceRevision','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Invalid source identity.' using errcode='22023';end if;
  result:=result||jsonb_build_array(public.cos_geocode_sources_read_current(p_organization_id,i->>'entityKind',(i->>'nativeUnitId')::uuid,i->>'productId',(i->>'sourceRevision')::uuid)->'source');
 end loop;
 return jsonb_build_object('sources',result);
end $$;

revoke all on function public.cos_geocode_sources_read_current_batch(uuid,jsonb) from public,anon,authenticated;

grant execute on function public.cos_geocode_sources_read_current_batch(uuid,jsonb) to service_role;

create or replace function public.cos_geocode_sources_map_projection(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 -- SECURITY DEFINER changes current_user; the caller's SET ROLE remains intact.
 if current_setting('role',true) is distinct from 'service_role' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Source service access required.' using errcode='42501';
 end if;
 perform public.cos_geocode_sources_read_many(p_organization_id,p_identities);
 select coalesce(jsonb_agg(app_private.cos_source_record(s)||jsonb_build_object('entityKind',s.entity_kind,'nativeUnitId',s.native_unit_id,'productId',s.product_id,
  'sourceRevision',s.source_revision,'eventId',s.event_id::text,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,
  'nativeGuardSha256',s.native_guard_sha256,'unitNumber',s.unit_number,'placement',s.source_placement,'siteLabel',s.site_label,
  'installation',case when s.source_placement='FIELD' then jsonb_build_object('street',s.street,'city',s.city,'state',s.state,'zip',s.zip) else null end,
  'addressSha256',case when s.source_placement='FIELD' then s.address_sha256 else null end,
  'suppliedComponents',case when s.source_placement='FIELD' then jsonb_build_object('street',true,'city',s.city is not null,'state',true,'zip',s.zip is not null) else null end) order by s.native_unit_id),'[]') into result
 from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.active
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
  and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return result;
end $$;

revoke all on function public.cos_geocode_sources_map_projection(uuid,jsonb) from public,anon,authenticated;

grant execute on function public.cos_geocode_sources_map_projection(uuid,jsonb) to service_role;

commit;
