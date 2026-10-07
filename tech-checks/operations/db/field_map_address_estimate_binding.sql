-- Add exact tracker provenance to the existing field-map read projection.
-- No placement, GPS, history, authorization, permission or health writes.
-- Only SOLAR SPOTTER numeric labels allow an optional family/unit separator hyphen.
CREATE OR REPLACE FUNCTION public.appdeploy_field_map_snapshot(p_actor_user_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_items jsonb;
begin
  perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
  if not app_private.has_permission(p_organization_id,'equipment.view') then
    raise exception 'Equipment view permission required';
  end if;
  with native as (
    select u.*,regexp_replace(lower(u.unit_number),'[^a-z0-9]','','g') as unit_key,
      count(*) over(partition by regexp_replace(lower(u.unit_number),'[^a-z0-9]','','g')) as identity_count
    from public.equipment_units u where u.organization_id=p_organization_id
  ), rows as (
    select u.id,u.unit_number,m.name as model_name,m.category,
      case when u.status in ('assigned','in_transit','installed','returning') then u.status else 'field' end as status,
      u.current_location_type,u.installed_site_id,
      case when u.installed_site_id is not null then s.name else t.site end as site,
      case when u.installed_site_id is not null then c.name else t.customer end as customer,
      case when u.installed_site_id is not null then concat_ws(', ',nullif(s.address_line1,''),nullif(s.address_line2,''),nullif(s.city,''),nullif(s.state_region,''),nullif(s.postal_code,'')) else t.address end as address,
      case when u.installed_site_id is not null then 'Installed site record' else t.source_name end as address_source,
      u.gps_latitude,u.gps_longitude,u.gps_source,u.gps_accuracy_m,u.gps_recorded_at,
      case when u.installed_site_id is not null then s.latitude else t.latitude end as address_latitude,
      case when u.installed_site_id is not null then s.longitude else t.longitude end as address_longitude,
      case when u.installed_site_id is not null then 'site' else t.coordinate_source end as address_coordinate_source,
      case when u.installed_site_id is null and lower(btrim(regexp_replace(regexp_replace(u.unit_number,'^(solar[[:space:]]+spotter)[[:space:]]*-[[:space:]]*([0-9]+)$','\1 \2','i'),'\s+',' ','g')))=lower(btrim(regexp_replace(regexp_replace(t.unit_number,'^(solar[[:space:]]+spotter)[[:space:]]*-[[:space:]]*([0-9]+)$','\1 \2','i'),'\s+',' ','g'))) then t.id else null end as estimate_tracker_id,
      case when u.installed_site_id is null and lower(btrim(regexp_replace(regexp_replace(u.unit_number,'^(solar[[:space:]]+spotter)[[:space:]]*-[[:space:]]*([0-9]+)$','\1 \2','i'),'\s+',' ','g')))=lower(btrim(regexp_replace(regexp_replace(t.unit_number,'^(solar[[:space:]]+spotter)[[:space:]]*-[[:space:]]*([0-9]+)$','\1 \2','i'),'\s+',' ','g'))) then t.unit_number else null end as estimate_unit_number,
      false as read_only,t.source_name,t.source_verified_at,t.imported_at,t.location_note,
      (select split_part(h.note,E'\n',1) from public.equipment_unit_location_history h
       where h.equipment_unit_id=u.id and h.organization_id=p_organization_id
         and h.recorded_at=u.gps_recorded_at and h.latitude=u.gps_latitude and h.longitude=u.gps_longitude
         and h.source=u.gps_source and h.accuracy_m is not distinct from u.gps_accuracy_m and h.recorded_by=u.gps_recorded_by
         and (select count(*) from public.equipment_unit_location_history tied where tied.organization_id=p_organization_id and tied.equipment_unit_id=u.id and tied.recorded_at=h.recorded_at)=1

         and h.recorded_at=(select max(h2.recorded_at) from public.equipment_unit_location_history h2 where h2.equipment_unit_id=u.id and h2.organization_id=p_organization_id)
       order by h.recorded_at desc limit 1) as verification_note,
      (select h.id::text from public.equipment_unit_location_history h where h.equipment_unit_id=u.id and h.organization_id=p_organization_id and h.recorded_at=u.gps_recorded_at order by h.recorded_at desc limit 1) as verification_history_id,
      exists(select 1 from public.user_roles ur join public.roles role on role.id=ur.role_id
        join public.user_profiles profile on profile.user_id=ur.user_id and profile.organization_id=p_organization_id
        where ur.user_id=u.gps_recorded_by and role.organization_id=p_organization_id and role.code='owner' and profile.active and profile.department='owner') as verifier_is_owner,
      (select j.job_number from public.equipment_assignments ea join public.jobs j on j.id=ea.job_id
       where ea.equipment_unit_id=u.id and ea.status='active' order by ea.assigned_at desc limit 1) as active_job_number
    from native u join public.equipment_models m on m.id=u.model_id
    left join public.sites s on s.id=u.installed_site_id and s.organization_id=p_organization_id
    left join public.customers c on c.id=s.customer_id and c.organization_id=p_organization_id
    left join app_private.vision_tracker_locations t on t.organization_id=p_organization_id and t.unit_key=u.unit_key and u.identity_count=1 and t.placement='FIELD'
    where u.status in ('assigned','in_transit','installed','returning')
      or (t.id is not null and u.installed_site_id is null and nullif(u.current_location_type,'') is null and u.status not in ('retired','deleted'))
    union all
    select t.id,t.unit_number,t.family,null,'field','field',null,t.site,t.customer,t.address,t.source_name,
      null,null,null,null,null,t.latitude,t.longitude,t.coordinate_source,t.id,t.unit_number,true,t.source_name,t.source_verified_at,t.imported_at,
      case when exists(select 1 from native u where u.unit_key=t.unit_key and u.identity_count>1)
        then 'Multiple registered equipment units match this tracker label. Resolve identity before saving a location.' else t.location_note end,
      null,null,false,null
    from app_private.vision_tracker_locations t where t.organization_id=p_organization_id and t.placement='FIELD'
      and not exists(select 1 from native u where u.unit_key=t.unit_key and u.identity_count=1)
  ), evaluated as (
    select r.*,
      (gps_latitude is not null and gps_longitude is not null) as has_unit_gps,
      verification_note ~ '^COS_FIELD_LOCATION_V1\|address_sha256=[a-f0-9]{64}\|confirmed=true$' as has_verification,
      nullif(btrim(address),'') is not null and verification_note = 'COS_FIELD_LOCATION_V1|address_sha256='||encode(sha256(convert_to(lower(btrim(regexp_replace(address,'\s+',' ','g'))),'UTF8')),'hex')||'|confirmed=true' as address_matches
    from rows r
  ), projected as (
    select jsonb_build_object(
      'id',id,'unitNumber',unit_number,'modelName',model_name,'category',category,'status',status,
      'currentLocationType',current_location_type,'installedSiteId',installed_site_id,
      'site',site,'customer',customer,'address',address,'addressSource',address_source,
      'latitude',case when has_unit_gps and address_matches and verifier_is_owner then gps_latitude else null end,
      'longitude',case when has_unit_gps and address_matches and verifier_is_owner then gps_longitude else null end,
      'coordinateSource',case when has_unit_gps and address_matches and verifier_is_owner then gps_source else null end,
      'historicalLatitude',case when has_unit_gps then gps_latitude else address_latitude end,
      'historicalLongitude',case when has_unit_gps then gps_longitude else address_longitude end,
      'historicalCoordinateSource',case when has_unit_gps then coalesce(gps_source,'unit_gps') else address_coordinate_source end,
      'historicalRecordedAt',case when has_unit_gps then gps_recorded_at else null end,
      'gpsAccuracyM',gps_accuracy_m,'gpsRecordedAt',gps_recorded_at,'hasUnitGps',has_unit_gps,
      'addressEstimateTrackerId',estimate_tracker_id,'addressEstimateUnitNumber',estimate_unit_number,
      'readOnly',read_only,'recordSource',source_name,'sourceVerifiedAt',source_verified_at,'snapshotImportedAt',imported_at,'locationNote',location_note,
      'activeJobNumber',active_job_number,
      'locationVerification',case when has_verification and not address_matches then 'address_changed' when has_unit_gps and address_matches and verifier_is_owner then 'owner_verified' when has_unit_gps or (address_latitude is not null and address_longitude is not null) then 'coordinates_unverified' when nullif(btrim(address),'') is not null then 'address_only' else 'location_missing' end,
      'locationVerifiedAt',case when has_unit_gps and address_matches and verifier_is_owner then gps_recorded_at else null end,
      'locationHistoryId',case when has_unit_gps and address_matches and verifier_is_owner then verification_history_id else null end
    ) as item from evaluated
  )
  select coalesce(jsonb_agg(item order by item->>'modelName',item->>'unitNumber'),'[]'::jsonb) into v_items from projected;
  return jsonb_build_object('items',v_items,'generatedAt',now(),
    'summary',jsonb_build_object(
      'fieldUnits',jsonb_array_length(v_items),
      'mappedUnits',(select count(*) from jsonb_array_elements(v_items) x where x->>'latitude' is not null and x->>'longitude' is not null),
      'unitGps',(select count(*) from jsonb_array_elements(v_items) x where x->>'hasUnitGps'='true'),
      'missingGps',(select count(*) from jsonb_array_elements(v_items) x where x->>'latitude' is null or x->>'longitude' is null),
      'addressUnits',(select count(*) from jsonb_array_elements(v_items) x where nullif(x->>'address','') is not null)),
    'trackerSnapshot',jsonb_build_object('source','2027 Unit Tracker','importedAt',(select max(imported_at) from app_private.vision_tracker_locations where organization_id=p_organization_id),
      'fieldRows',(select count(*) from app_private.vision_tracker_locations where organization_id=p_organization_id and placement='FIELD')));
end;
$function$
