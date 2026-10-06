-- Read-only VISION tracker projection. Native equipment, sites and jobs remain authoritative.
create table if not exists app_private.vision_tracker_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  unit_number text not null check(length(unit_number) between 1 and 160),
  unit_key text generated always as (regexp_replace(lower(unit_number), '[^a-z0-9]', '', 'g')) stored,
  family text not null,
  placement text not null check (placement in ('FIELD','SHOP')),
  customer text, site text, address text, location_note text,
  latitude double precision, longitude double precision,
  coordinate_source text, source_verified_at timestamptz,
  source_name text not null default '2027 Unit Tracker',
  imported_at timestamptz not null default now(),
  unique (organization_id,unit_key),
  check ((latitude is null and longitude is null) or
         (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180))
);
alter table app_private.vision_tracker_locations enable row level security;
revoke all on app_private.vision_tracker_locations from public, anon, authenticated;
grant select, insert, update on app_private.vision_tracker_locations to service_role;
create policy vision_tracker_server_only on app_private.vision_tracker_locations for all to service_role using (true) with check (true);
comment on table app_private.vision_tracker_locations is 'Selected operational location fields only. Credentials and network settings are never imported.';

CREATE OR REPLACE FUNCTION public.appdeploy_equipment_registry_snapshot(p_actor_user_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_snapshot jsonb;
  v_items jsonb;
begin
  perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
  if not app_private.has_permission(p_organization_id,'equipment.view') then
    raise exception 'Equipment view permission required';
  end if;

  v_snapshot := jsonb_build_object(
    'models',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'code',m.code,'name',m.name,'category',m.category,'manufacturer',m.manufacturer,'active',m.active
      ) order by m.name,m.code)
      from public.equipment_models m
      where m.organization_id=p_organization_id and m.active
    ),'[]'::jsonb),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,
        'modelId',u.model_id,
        'modelCode',m.code,
        'modelName',m.name,
        'unitNumber',u.unit_number,
        'serialNumber',u.serial_number,
        'status',u.status,
        'currentLocationType',u.current_location_type,
        'installedSiteId',u.installed_site_id,
        'installedSite',s.name,
        'customer',c.name,
        'activeJobNumber',(
          select j.job_number
          from public.equipment_assignments ea
          join public.jobs j on j.id=ea.job_id
          where ea.equipment_unit_id=u.id and ea.status='active'
          order by ea.assigned_at desc limit 1
        ),
        'createdAt',u.created_at,
        'updatedAt',u.updated_at
      ) order by m.name,u.unit_number)
      from public.equipment_units u
      join public.equipment_models m on m.id=u.model_id
      left join public.sites s on s.id=u.installed_site_id
      left join public.customers c on c.id=s.customer_id
      where u.organization_id=p_organization_id
    ),'[]'::jsonb)
  );
  return v_snapshot || jsonb_build_object(
    'trackerUnits',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,'unitNumber',t.unit_number,'modelName',t.family,
        'status',case when t.placement='SHOP' then 'readiness_unverified' else 'field' end,
        'currentLocationType',lower(t.placement),'readOnly',true,
        'recordSource',t.source_name,'sourceVerifiedAt',t.source_verified_at,'snapshotImportedAt',t.imported_at
      ) order by t.family,t.unit_number)
      from app_private.vision_tracker_locations t where t.organization_id=p_organization_id
    ),'[]'::jsonb),
    'trackerSnapshot',jsonb_build_object(
      'source','2027 Unit Tracker',
      'importedAt',(select max(imported_at) from app_private.vision_tracker_locations where organization_id=p_organization_id)
    )
  );

end;
$function$
;

CREATE OR REPLACE FUNCTION public.appdeploy_field_map_snapshot(p_actor_user_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_snapshot jsonb;
  v_items jsonb;
begin
  perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);

  if not app_private.has_permission(p_organization_id,'equipment.view') then
    raise exception 'Equipment view permission required';
  end if;

  v_snapshot := jsonb_build_object(
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,
        'unitNumber',u.unit_number,
        'modelName',m.name,
        'category',m.category,
        'status',u.status,
        'currentLocationType',u.current_location_type,
        'installedSiteId',u.installed_site_id,
        'site',s.name,
        'customer',c.name,
        'address',concat_ws(', ',
          nullif(s.address_line1,''),
          nullif(s.city,''),
          nullif(s.state_region,''),
          nullif(s.postal_code,'')
        ),
        'latitude',coalesce(u.gps_latitude,s.latitude),
        'longitude',coalesce(u.gps_longitude,s.longitude),
        'coordinateSource',case
          when u.gps_latitude is not null and u.gps_longitude is not null then coalesce(u.gps_source,'unit_gps')
          when s.latitude is not null and s.longitude is not null then 'site'
          else null
        end,
        'gpsAccuracyM',u.gps_accuracy_m,
        'gpsRecordedAt',u.gps_recorded_at,
        'activeJobNumber',(
          select j.job_number
          from public.equipment_assignments ea
          join public.jobs j on j.id=ea.job_id
          where ea.equipment_unit_id=u.id and ea.status='active'
          order by ea.assigned_at desc
          limit 1
        ),
        'hasUnitGps',(u.gps_latitude is not null and u.gps_longitude is not null)
      ) order by m.name,u.unit_number)
      from public.equipment_units u
      join public.equipment_models m on m.id=u.model_id
      left join public.sites s on s.id=u.installed_site_id
      left join public.customers c on c.id=s.customer_id
      where u.organization_id=p_organization_id
        and u.status in ('assigned','in_transit','installed','returning')
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'fieldUnits',(select count(*) from public.equipment_units u where u.organization_id=p_organization_id and u.status in ('assigned','in_transit','installed','returning')),
      'mappedUnits',(select count(*) from public.equipment_units u left join public.sites s on s.id=u.installed_site_id where u.organization_id=p_organization_id and u.status in ('assigned','in_transit','installed','returning') and coalesce(u.gps_latitude,s.latitude) is not null and coalesce(u.gps_longitude,s.longitude) is not null),
      'unitGps',(select count(*) from public.equipment_units u where u.organization_id=p_organization_id and u.status in ('assigned','in_transit','installed','returning') and u.gps_latitude is not null and u.gps_longitude is not null),
      'missingGps',(select count(*) from public.equipment_units u left join public.sites s on s.id=u.installed_site_id where u.organization_id=p_organization_id and u.status in ('assigned','in_transit','installed','returning') and coalesce(u.gps_latitude,s.latitude) is null)
    ),
    'generatedAt',now()
  );
  v_items := (v_snapshot->'items') || coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',t.id,'unitNumber',t.unit_number,'modelName',t.family,
      'status','field','currentLocationType','field','site',t.site,
      'customer',t.customer,'address',t.address,'latitude',t.latitude,'longitude',t.longitude,
      'coordinateSource',t.coordinate_source,'gpsRecordedAt',null,'hasUnitGps',false,
      'readOnly',true,'recordSource',t.source_name,'sourceVerifiedAt',t.source_verified_at,
      'snapshotImportedAt',t.imported_at,'locationNote',t.location_note
    ) order by t.family,t.unit_number)
    from app_private.vision_tracker_locations t
    where t.organization_id=p_organization_id and t.placement='FIELD'
      and not exists (
        select 1 from public.equipment_units u
        where u.organization_id=p_organization_id
          and regexp_replace(lower(u.unit_number),'[^a-z0-9]','','g')=t.unit_key
          and (u.current_location_type is not null or u.status in ('assigned','in_transit','installed','returning'))
      )
  ),'[]'::jsonb);
  return v_snapshot || jsonb_build_object(
    'items',v_items,
    'summary',jsonb_build_object(
      'fieldUnits',jsonb_array_length(v_items),
      'mappedUnits',(select count(*) from jsonb_array_elements(v_items) x where x->>'latitude' is not null and x->>'longitude' is not null),
      'unitGps',(select count(*) from jsonb_array_elements(v_items) x where x->>'hasUnitGps'='true'),
      'missingGps',(select count(*) from jsonb_array_elements(v_items) x where x->>'latitude' is null or x->>'longitude' is null),
      'addressUnits',(select count(*) from jsonb_array_elements(v_items) x where nullif(x->>'address','') is not null)
    ),
    'trackerSnapshot',jsonb_build_object(
      'source','2027 Unit Tracker',
      'importedAt',(select max(imported_at) from app_private.vision_tracker_locations where organization_id=p_organization_id),
      'fieldRows',(select count(*) from app_private.vision_tracker_locations where organization_id=p_organization_id and placement='FIELD')
    )
  );

end;
$function$
;
