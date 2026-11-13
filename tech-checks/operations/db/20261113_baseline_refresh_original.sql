-- Exact production definition captured read-only, for guarded rollback.
CREATE OR REPLACE FUNCTION public.cos_mhelp_inventory_baseline()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET work_mem TO '64MB'
AS $function$
with original(value) as materialized (
with baseline(value) as materialized (
select cos_mhelp_placement_private.upload_snapshot()||jsonb_build_object('publisherRefreshEquipmentIds',(
 select coalesce(jsonb_agg(equipment_id),'[]'::jsonb) from (
 select q.equipment_id from cos_sheets_placement_private.refresh_requests q
 join cos_sheets_placement_private.bindings b using(equipment_id)
 join cos_mhelp_placement_private.links l using(equipment_id)
 where q.requested_at>clock_timestamp()-interval '2 hours' and b.pending_cells is null
 and l.observation->>'state'='confirmed'
 and cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id)=l.baseline_guard
 and not exists(select 1 from cos_operational_private.current_placements p where p.product_id=l.equipment_id)
 order by l.observed_at nulls first,q.equipment_id limit 6
 ) selected))
), tracker_membership as materialized (
 select x->'binding'->>'trackerId' tracker_id, count(distinct x->>'productId') product_count
 from baseline b cross join lateral jsonb_array_elements(
   coalesce(b.value->'records','[]'::jsonb)||coalesce(b.value->'apiMissingRecords','[]'::jsonb)) x
 where x->'binding'->>'trackerId' is not null
 group by x->'binding'->>'trackerId'
)
select b.value || jsonb_build_object('trackerEndpointMembership',jsonb_build_object(
 'contract','COS_TRACKER_ENDPOINT_MEMBERSHIP_V1',
 'sourceSha256',b.value->>'sourceSha256',
 'records',(select coalesce(jsonb_agg(jsonb_build_object(
  'productId',r->>'productId','trackerId',r->'binding'->>'trackerId',
  'bindingGuard',r->'binding'->>'expectedGuard',
  'readOnlyTracker',coalesce(
   r->'binding'->'nativeUnitId'='null'::jsonb and r->'binding'->'guardCurrent'='true'::jsonb
   and t.id is not null and t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
   and not exists(select 1 from public.equipment_units u where u.id=t.id)
   and t.unit_number=r->'binding'->>'trackerLabel'
   and coalesce(r->'binding'->'representedUnitIds',jsonb_build_array(t.id::text))=jsonb_build_array(t.id::text)
   and not exists(select 1 from app_private.cos_geocode_sources s join public.equipment_units u on u.id=s.native_unit_id where s.tracker_id=t.id)
   and not exists(select 1 from app_private.cos_archived_representations a where t.id in(a.archived_tracker_id,a.canonical_tracker_id))
   and (select m.product_count from tracker_membership m where m.tracker_id=t.id::text)=1,false)
 ) order by r->>'productId'),'[]'::jsonb)
 from jsonb_array_elements(b.value->'records')r
 left join app_private.vision_tracker_locations t on t.id=(r->'binding'->>'trackerId')::uuid)
)) from baseline b
)
select original.value || jsonb_build_object('cameraSnapshotSources',jsonb_build_object(
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'organization_id',u.organization_id,'unit_number',u.unit_number,'status',u.status) order by u.id),'[]'::jsonb) from public.equipment_units u where u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'organization_id',m.organization_id,'equipment_unit_id',m.equipment_unit_id,'vigilant_device_id',m.vigilant_device_id,'camera_key',m.camera_key,'match_method',m.match_method,'confidence',m.confidence) order by m.id),'[]'::jsonb) from public.vision_vigilant_unit_matches m where m.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 'providers',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'organization_id',d.organization_id,'external_device_id',d.external_device_id,'device_name',d.device_name,'device_type',d.device_type,'source',d.source) order by d.id),'[]'::jsonb) from public.vision_vigilant_devices d where d.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 'ownerCrosswalk',app_private.cos_owner_identity_snapshot_value('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid),
 'trackerUnits',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'unitNumber',t.unit_number,'modelName',t.family,'readOnly',true,'recordSource',t.source_name,'snapshotImportedAt',t.imported_at,'sourceVerifiedAt',t.source_verified_at) order by t.id),'[]'::jsonb) from app_private.vision_tracker_locations t where t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5')
)) from original;
$function$
