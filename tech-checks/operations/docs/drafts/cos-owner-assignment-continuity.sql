-- Successor to the installed PR263 review path. Private evidence only.
-- The snapshot preserves the old binding and exact current links; it never
-- writes equipment, guards, observations, history, or the active source.
create or replace function cos_mhelp_placement_private.assignment_review_snapshot(p_record jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb:=p_record->'binding'; links jsonb; link jsonb; previous jsonb;
 current_assignment jsonb; continuity jsonb:=null; move jsonb; exact_link boolean;
 reference_eligible boolean; same_assignment boolean;
begin
 select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]'::jsonb)
 into links from cos_mhelp_placement_private.links l where l.equipment_id=p_record->>'productId';
 link:=links->0; previous:=b->'previousAssignment';
 exact_link:=jsonb_array_length(links)=1
  and link->>'equipment_id'=p_record->>'productId'
  and link->>'tracker_id' is not distinct from b->>'trackerId'
  and link->>'native_unit_id' is not distinct from b->>'nativeUnitId'
  and link->>'full_label'=p_record->>'unitNumber';
 reference_eligible:=coalesce(b->>'matchMethod'<>'reviewed_product_id' or exact_link,false);
 if previous is not null and previous<>'null'::jsonb then
  reference_eligible:=coalesce(exact_link
   and previous->>'productId'=p_record->>'productId'
   and link->'observation'->>'state'='confirmed'
   and link->'observation'->>'equipmentId'=p_record->>'productId'
   and coalesce(link->'observation'->>'customerId','')~'^[1-9][0-9]{0,14}$'
   and link->'observation'->>'placement' in ('SHOP','FIELD')
   and link->>'observed_at' is not null,false);
  if reference_eligible then
   current_assignment:=jsonb_build_object('productId',p_record->>'productId',
    'customerId',link->'observation'->>'customerId','placement',link->'observation'->>'placement',
    'serviceLocationId',link->'observation'->>'serviceLocationId','observedAt',link->>'observed_at');
   same_assignment:=previous->>'customerId' is not distinct from current_assignment->>'customerId'
    and previous->>'placement' is not distinct from current_assignment->>'placement'
    and previous->>'serviceLocationId' is not distinct from current_assignment->>'serviceLocationId';
   if not same_assignment or (previous->>'observedAt')::timestamptz is distinct from (current_assignment->>'observedAt')::timestamptz then
    continuity:=jsonb_build_object('kind',case when same_assignment then 'timestamp_only' else 'assignment_difference' end,
     'previousAssignment',previous,'currentAssignment',current_assignment);
   end if;
  end if;
 end if;
 select to_jsonb(m) into move from app_private.cos_fleet_shop_moves m
  where m.unit_id=(b->>'nativeUnitId')::uuid
   and m.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
  order by m.created_at desc,m.id desc limit 1;
 return jsonb_build_object('productId',p_record->>'productId','originalBinding',b,
  'currentLinks',links,'shopReceipt',move,'referenceEligible',reference_eligible,
  'protectedStateSha256',cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid),
  'continuity',continuity);
end $$;
revoke all on function cos_mhelp_placement_private.assignment_review_snapshot(jsonb) from public,anon,authenticated,service_role;
