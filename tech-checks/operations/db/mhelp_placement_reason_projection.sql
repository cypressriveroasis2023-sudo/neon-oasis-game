-- Additive read-receipt change only. Deploy separately after exact-current
-- function review; do not update inventory, placement observations, or grants.
create or replace function public.cos_mhelp_placement_snapshot(p_actor_user_id uuid,p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('trackerId',tracker_id,'nativeUnitId',native_unit_id,'trackerLabel',tracker_label,'nativeLabel',native_label,
  'guardCurrent',cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard,
  'state',case when observation->>'state'='confirmed' and cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard then 'confirmed' else 'held' end,
  'reason',observation->>'reason',
  'assignmentChanged',(baseline_customer_id is not null and observation->>'customerId' is not null and observation->>'customerId'<>baseline_customer_id) or (baseline_location_id is not null and observation->>'serviceLocationId' is not null and observation->>'serviceLocationId'<>baseline_location_id),
  'placement',observation->>'placement','customerLabel',observation->>'customerLabel','siteLabel',observation->>'siteLabel','observedAt',observed_at,
  'locationReview',observation->>'customerId' is distinct from baseline_customer_id or observation->>'serviceLocationId' is distinct from baseline_location_id) order by tracker_id),'[]') into items from cos_mhelp_placement_private.links;
 return public.cos_mhelp_placement_status()||jsonb_build_object('items',items);
end $$;
