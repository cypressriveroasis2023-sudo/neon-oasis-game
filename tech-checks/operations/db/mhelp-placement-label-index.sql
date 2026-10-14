-- Generic offline proof input only. Production use requires the fingerprint-guarded installer.
-- Non-unique hash index and three exact left-hand predicate expansions; no data, grants, timeouts or graph fields change.
create index cos_equipment_unit_source_label_hash on public.equipment_units using hash (pg_catalog.regexp_replace(pg_catalog.lower(unit_number),'[^a-z0-9]','','g'));

CREATE OR REPLACE FUNCTION app_private.cos_source_native_guard(p_kind text, p_id uuid, p_tracker uuid, p_unit_number text, p_tracker_number text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare u record; t record; guard jsonb; n integer;
begin
 select id,organization_id,unit_number,family,placement,site,address,source_name,source_verified_at,imported_at,latitude,longitude,coordinate_source into t from app_private.vision_tracker_locations where id=p_tracker and organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 if not found or t.unit_number is distinct from p_tracker_number or t.placement not in ('FIELD','SHOP')
  or ((t.latitude is not null or t.longitude is not null or t.coordinate_source is not null)
   and coalesce(t.coordinate_source,'') not in ('us_census_address_range_estimate','geocodio_reviewed_property_estimate'))
  or ((t.latitude is null)<>(t.longitude is null)) then return null; end if;
 guard:=jsonb_build_object('trackerId',t.id,'trackerUnitNumber',t.unit_number,'family',t.family,
  'placement',t.placement,'site',t.site,'address',t.address,'sourceName',t.source_name,
  'sourceVerifiedAt',t.source_verified_at,'importedAt',t.imported_at,
  'latitude',t.latitude,'longitude',t.longitude,'coordinateSource',t.coordinate_source);
 if p_kind='tracker' then
  if p_id<>p_tracker or p_unit_number is distinct from t.unit_number then return null; end if;
  select count(*) into n from public.equipment_units x where x.organization_id=t.organization_id
   and pg_catalog.regexp_replace(pg_catalog.lower(x.unit_number),'[^a-z0-9]','','g')=app_private.cos_source_label(t.unit_number);
  if n<>0 then return null; end if;
 elsif p_kind='equipment_unit' then
  select id,organization_id,unit_number,model_id,status,current_location_type,installed_site_id,gps_latitude,gps_longitude,gps_recorded_at,gps_source,gps_recorded_by,gps_accuracy_m into u from public.equipment_units where id=p_id and organization_id=t.organization_id;
  if not found or u.unit_number is distinct from p_unit_number or u.installed_site_id is not null
   or u.status in ('retired','deleted') or coalesce(u.current_location_type,'') not in ('','field')
   or u.gps_latitude is not null or u.gps_longitude is not null or u.gps_recorded_at is not null
   or u.gps_source is not null then return null; end if;
  select count(*) into n from public.equipment_units x where x.organization_id=t.organization_id
   and pg_catalog.regexp_replace(pg_catalog.lower(x.unit_number),'[^a-z0-9]','','g')=app_private.cos_source_label(u.unit_number);
  if n<>1 then return null; end if;
  guard:=guard||jsonb_build_object('nativeId',u.id,'unitNumber',u.unit_number,'modelId',u.model_id,
   'status',u.status,'currentLocationType',u.current_location_type,'installedSiteId',u.installed_site_id,
   'latitude',u.gps_latitude,'longitude',u.gps_longitude,'gpsSource',u.gps_source,
   'gpsRecordedAt',u.gps_recorded_at,'gpsRecordedBy',u.gps_recorded_by,'gpsAccuracyM',u.gps_accuracy_m);
 else return null; end if;
 return encode(sha256(convert_to(guard::text,'UTF8')),'hex');
end $function$
;

CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.guard(p_tracker uuid, p_native uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t app_private.vision_tracker_locations;u public.equipment_units;s app_private.cos_geocode_sources;data jsonb;
begin
 select * into t from app_private.vision_tracker_locations where id=p_tracker and organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 if not found or (select count(*) from app_private.vision_tracker_locations x where x.organization_id=t.organization_id and x.unit_key=t.unit_key)<>1 then return null;end if;
 select * into s from app_private.cos_geocode_sources where tracker_id=p_tracker and active and source_system='mhelpdesk_product_import';
 if not found or s.tracker_unit_number<>t.unit_number or (p_native is null and s.entity_kind<>'tracker') or (p_native is not null and (s.entity_kind<>'equipment_unit' or s.native_unit_id<>p_native)) then return null;end if;
 if exists(select 1 from app_private.cos_archived_representations a where p_tracker in(a.archived_tracker_id,a.canonical_tracker_id) or p_native in(a.archived_native_id,a.canonical_native_id)) then return null;end if;
 data:=jsonb_build_object('tracker',to_jsonb(t),'sourceIdentity',jsonb_build_array(s.product_id,s.source_revision,s.unit_number,s.tracker_unit_number));
 if p_native is not null then
  select * into u from public.equipment_units where id=p_native and organization_id=t.organization_id;
  if not found or u.unit_number<>s.unit_number or u.retired_at is not null or u.status<>'available' or u.installed_site_id is not null or u.current_location_ref is not null or nullif(u.current_location_type,'') is not null
   or u.gps_latitude is not null or u.gps_longitude is not null or u.gps_recorded_at is not null
   or (select count(*) from public.equipment_units x where x.organization_id=t.organization_id and pg_catalog.regexp_replace(pg_catalog.lower(x.unit_number),'[^a-z0-9]','','g')=app_private.cos_source_label(u.unit_number))<>1
   or exists(select 1 from public.equipment_unit_location_history h where h.equipment_unit_id=p_native)
   or exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=p_native)
  then return null;end if;
  data:=data||jsonb_build_object('native',to_jsonb(u));
 end if;
 return encode(sha256(convert_to(data::text,'UTF8')),'hex');
end $function$
;
