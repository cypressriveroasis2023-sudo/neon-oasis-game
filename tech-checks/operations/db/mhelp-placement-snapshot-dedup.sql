-- Read adapters only. Apply through the fingerprint-guarded rollout script.
-- Every current graph guard is still evaluated in this statement. No persistent cache.
create or replace function cos_mhelp_placement_private.upload_snapshot()
returns jsonb language sql stable set search_path='' as $$
 with active as materialized (
  select b.receipt,b.records,b.payload_sha256
  from cos_mhelp_placement_private.upload_control c
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  where c.singleton
 ), source_rows as materialized (
  select r,
   r->'binding' is not null and r->'binding'<>'null'::jsonb eligible,
   case when r->'binding' is not null and r->'binding'<>'null'::jsonb then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(a.records) r
 ), tracker_rows as materialized (
  select r,r->'binding'->>'state'='linked' eligible,
   case when (r->'binding'->>'state'='linked') is not false then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(coalesce(a.receipt->'trackerRecords','[]'::jsonb)) r
 ), bindings as materialized (
  select binding_key from source_rows where eligible
  union
  select binding_key from tracker_rows where eligible is not false
 ), current_guards as materialized (
  select b.*,cos_mhelp_placement_private.continuity_current((binding_key->>0)::uuid,(binding_key->>1)::uuid,binding_key->>2) guard_current
  from bindings b
 )
 select (a.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object(
  'trackerRecords',(
   select coalesce(jsonb_agg((s.r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object(
    'binding',((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',coalesce(s.eligible and g.guard_current,false)))
    order by s.r->>'recordId'),'[]'::jsonb)
   from tracker_rows s left join current_guards g
    on g.binding_key=s.binding_key
  ),'reviewed',true,'payloadSha256',a.payload_sha256,'records',(
   select jsonb_agg((s.r-'binding')||jsonb_build_object('binding',case when not s.eligible then 'null'::jsonb else
    ((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',g.guard_current) end)
    order by (s.r->>'sourceRow')::integer)
   from source_rows s left join current_guards g
    on g.binding_key=s.binding_key
  )) from active a
$$;

create or replace function public.cos_mhelp_placement_snapshot(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 with checked_links as materialized (
  select l.*,cos_mhelp_placement_private.guard(tracker_id,native_unit_id) current_guard
  from cos_mhelp_placement_private.links l
 )
 select coalesce(jsonb_agg(jsonb_build_object('trackerId',tracker_id,'nativeUnitId',native_unit_id,'trackerLabel',tracker_label,'nativeLabel',native_label,
  'guardCurrent',current_guard=baseline_guard,
  'state',case when observation->>'state'='confirmed' and current_guard=baseline_guard then 'confirmed' else 'held' end,
  'reason',observation->>'reason','placement',observation->>'placement','customerLabel',observation->>'customerLabel','siteLabel',observation->>'siteLabel','observedAt',observed_at,
  'assignmentChanged',(baseline_customer_id is not null and observation->>'customerId' is not null and observation->>'customerId'<>baseline_customer_id) or (baseline_location_id is not null and observation->>'serviceLocationId' is not null and observation->>'serviceLocationId'<>baseline_location_id),
  'locationReview',observation->>'customerId' is distinct from baseline_customer_id or observation->>'serviceLocationId' is distinct from baseline_location_id) order by tracker_id),'[]') into items from checked_links;
 return public.cos_mhelp_placement_status()||jsonb_build_object('items',items,'upload',cos_mhelp_placement_private.upload_snapshot());
end $$;
