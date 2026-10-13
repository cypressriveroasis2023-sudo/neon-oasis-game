-- Reuse existing administrator-reviewed identities without granting new access.
create or replace function public.cos_mhelp_location_candidates() returns jsonb
language sql security definer set search_path='' as $$
 with proofs as materialized (
  select l.*,cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id)=l.baseline_guard as current
  from cos_mhelp_placement_private.links l
 ), candidates as (
  select 'equipment_unit'::text kind,u.id,u.unit_number,cos_mhelp_placement_private.location_guard('equipment_unit',u.id) guard,
   (u.retired_at is not null or u.status in('retired','missing','stolen','decommissioned')) inactive
  from public.equipment_units u where u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  union all
  select 'tracker',t.id,t.unit_number,cos_mhelp_placement_private.location_guard('tracker',t.id),false
  from app_private.vision_tracker_locations t where t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
   and not exists(select 1 from app_private.cos_geocode_sources s where s.tracker_id=t.id and s.active and s.entity_kind='equipment_unit' and s.native_unit_id is not null)
 ) select coalesce(jsonb_agg(jsonb_build_object('kind',c.kind,'unitId',c.id,'unitNumber',c.unit_number,'guard',c.guard,'inactive',c.inactive,
  'previous',case when saved.guard=c.guard then saved.last_good else null end,
  'reviewedEquipment',case when p.current and c.unit_number=case when c.kind='tracker' then p.tracker_label else p.native_label end then
   jsonb_build_object('equipmentId',p.equipment_id,'fullLabel',p.full_label,'model',p.model,'guardCurrent',true) else null end
 ) order by c.kind,c.id),'[]') from candidates c
 left join cos_mhelp_placement_private.locations saved on saved.kind=c.kind and saved.unit_id=c.id
 left join proofs p on (c.kind='tracker' and c.id=p.tracker_id) or (c.kind='equipment_unit' and c.id=p.native_unit_id)
 where c.guard is not null
$$;

create or replace function public.cos_mhelp_location_snapshot(p_actor_user_id uuid,p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',saved.kind,'unitId',saved.unit_id,'unitNumber',saved.unit_number,
  'guardCurrent',saved.guard=cos_mhelp_placement_private.location_guard(saved.kind,saved.unit_id)
   and not exists(select 1 from cos_mhelp_placement_private.links p where p.equipment_id=saved.observation->>'equipmentId' and (
    saved.unit_id is distinct from case when saved.kind='tracker' then p.tracker_id else p.native_unit_id end
    or saved.unit_number is distinct from case when saved.kind='tracker' then p.tracker_label else p.native_label end
    or cos_mhelp_placement_private.guard(p.tracker_id,p.native_unit_id) is distinct from p.baseline_guard)),
  'state',saved.observation->>'state','reason',saved.observation->>'reason','placement',saved.observation->>'placement',
  'customer',saved.observation->>'customer','site',saved.observation->>'site','address',saved.observation->>'address',
  'point',saved.observation->'point','coordinateSource',saved.observation->>'coordinateSource','observedAt',saved.observed_at
 ) order by saved.unit_id),'[]') into items from cos_mhelp_placement_private.locations saved;
 return public.cos_mhelp_placement_status()||jsonb_build_object('contract','COS_MHELP_FLEET_LOCATIONS_V1','items',items);
end $$;
