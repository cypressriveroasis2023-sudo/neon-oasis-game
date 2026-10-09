-- Add source identity evidence to the native map projection only.
-- Apply after cos-geocode-sources-read-access.sql; preserve its scoped definer reader.
-- The source registry, native/tracker guard, admission rules, auth and ACLs are unchanged.
-- No bridge DTO, camera assignment, provider request or health identity is added.
begin;
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
  'nativeSourceIdentity',case when s.entity_kind='equipment_unit' then jsonb_build_object('contract','COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',
   'nativeUnitId',s.native_unit_id,'productId',s.product_id,'unitNumber',s.unit_number,'trackerId',s.tracker_id,'trackerUnitNumber',s.tracker_unit_number,
   'sourceRevision',s.source_revision,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,'nativeGuardSha256',s.native_guard_sha256) else null end,
  'installation',case when s.source_placement='FIELD' then jsonb_build_object('street',s.street,'city',s.city,'state',s.state,'zip',s.zip) else null end,
  'addressSha256',case when s.source_placement='FIELD' then s.address_sha256 else null end,
  'suppliedComponents',case when s.source_placement='FIELD' then jsonb_build_object('street',true,'city',s.city is not null,'state',true,'zip',s.zip is not null) else null end) order by s.native_unit_id),'[]') into result
 from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.active
  and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
  and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number);
 return result;
end $$;
commit;
