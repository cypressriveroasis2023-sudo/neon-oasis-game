-- A real, recorded Shop return must not require reactivating its old Field
-- geocoding source or erasing its placement history.
create function cos_mhelp_placement_private.recorded_shop_return_current(p_product text,p_tracker uuid,p_native uuid)
returns boolean language sql stable set search_path='' as $function$
 select coalesce(exists(
  select 1 from cos_mhelp_placement_private.links l
  join public.equipment_units u on u.id=l.native_unit_id and u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  join app_private.vision_tracker_locations t on t.id=l.tracker_id and t.organization_id=u.organization_id
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=t.id and s.native_unit_id=u.id
   and s.organization_id=u.organization_id and s.entity_kind='equipment_unit' and s.source_system='mhelpdesk_product_import'
  cross join lateral(select m.* from app_private.cos_fleet_shop_moves m where m.unit_id=u.id and m.organization_id=u.organization_id order by m.created_at desc,m.id desc limit 1) m
  where l.equipment_id=p_product and l.tracker_id=p_tracker and l.native_unit_id=p_native
   and l.reviewed_at is not null and l.authorization_sha256~'^[a-f0-9]{64}$'
   and u.unit_number=l.native_label and t.unit_number=l.tracker_label
   and u.current_location_type='shop' and u.status='available' and u.retired_at is null
   and u.installed_site_id is null and u.current_location_ref is null
   and u.gps_latitude is null and u.gps_longitude is null
   and not s.active and s.eligibility='tombstone'
   and m.unit_number=u.unit_number and m.model_id=u.model_id
   and exists(select 1 from jsonb_array_elements(m.source_bindings) b where b->>'productId'=p_product and b->>'sourceUnitNumber'=btrim(l.full_label))
   and exists(select 1 from app_private.cos_geocode_source_events e where e.event_id=s.event_id and e.kind='tombstone' and e.product_id=p_product and e.native_unit_id=u.id and e.source_revision=s.source_revision)
   and not exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=u.id)
   and not exists(select 1 from app_private.cos_archived_representations a where t.id in(a.archived_tracker_id,a.canonical_tracker_id) or u.id in(a.archived_native_id,a.canonical_native_id))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>p_product and (other.tracker_id=t.id or other.native_unit_id=u.id))
 ),false)
$function$;
revoke all on function cos_mhelp_placement_private.recorded_shop_return_current(text,uuid,uuid) from public,anon,authenticated,service_role;
