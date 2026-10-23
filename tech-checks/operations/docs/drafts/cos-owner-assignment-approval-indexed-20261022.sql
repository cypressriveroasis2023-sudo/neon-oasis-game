begin;
set local lock_timeout='5s';
do $approval_guard$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>'21cb8f20495b403c997aec9d875d2457af0b2686bca8037f652b09ea676a8e11' then raise exception 'Installed assignment approval changed; fresh review required';end if;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' or not p.prosecdef or p.provolatile<>'v' or p.proconfig is distinct from array['search_path=""','lock_timeout=5s']::text[] then raise exception 'Assignment approval permissions or configuration changed';end if;
end $approval_guard$;
CREATE OR REPLACE FUNCTION public.cos_owner_mhelp_assignment_review_v1(p_actor_user_id uuid, p_organization_id uuid, p_stage_id uuid, p_source_sha256 text, p_current_2027_sha256 text, p_action text DEFAULT 'read'::text, p_expected_digest text DEFAULT NULL::text, p_confirmation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
declare s cos_mhelp_placement_private.owner_equipment_stages; view jsonb; old jsonb; row_data jsonb; b jsonb; item jsonb;
 items_index jsonb; prior_index jsonb; tracker_index jsonb; adjusted_rows jsonb[]:=array[]::jsonb[]; tracker_rows jsonb[]:=array[]::jsonb[];
 identity_evidence jsonb; adjusted jsonb:='[]'; trackers jsonb:='[]'; prior jsonb; prior_receipt jsonb; approval jsonb; checked jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.manage')
 then raise exception 'Owner equipment authorization required' using errcode='42501';end if;
 if p_action not in ('read','approve') then raise exception 'Invalid assignment review action';end if;
 perform 1 from cos_mhelp_placement_private.upload_control where singleton for update;
 select * into strict s from cos_mhelp_placement_private.owner_equipment_stages where id=p_stage_id and actor_id=p_actor_user_id and organization_id=p_organization_id for update;
 if s.source_sha256 is distinct from p_source_sha256 or s.verified_2027_sha256 is distinct from p_current_2027_sha256 then raise exception 'Assignment file or census changed' using errcode='40001';end if;
 perform cos_mhelp_placement_private.assignment_review_lock();
 view:=cos_mhelp_placement_private.assignment_review(s.id);
 if p_action='read' then return view||jsonb_build_object('approved',s.review_receipt ? 'assignmentReview');end if;
 if coalesce(p_expected_digest,'')!~'^[a-f0-9]{64}$' or p_expected_digest is distinct from view->>'reviewDigest'
  or length(btrim(coalesce(p_confirmation,''))) not between 24 and 800
  or jsonb_array_length(view->'items')=0 or exists(select 1 from jsonb_array_elements(view->'items') x where x->>'eligible' is distinct from 'true')
 then raise exception 'Explicit current-state assignment approval required' using errcode='40001';end if;
 if s.review_receipt ? 'assignmentReview' then
  if s.review_receipt->'assignmentReview'->>'reviewDigest' is distinct from p_expected_digest
   or s.review_receipt->'assignmentReview'->>'confirmationSha256' is distinct from encode(sha256(convert_to(btrim(p_confirmation),'UTF8')),'hex')
  then raise exception 'Conflicting assignment approval replay' using errcode='40001';end if;
  return view||jsonb_build_object('approved',true,'idempotent',true);
 end if;
 select records,receipt into strict prior,prior_receipt from cos_mhelp_placement_private.upload_batches where source_sha256=s.expected_active_sha256;
 identity_evidence:=cos_mhelp_placement_private.recover_identity_evidence_records(prior);
 for row_data in select value from jsonb_array_elements(s.records) loop
  if items_index is null then
   select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into items_index from (
    select value->>'productId' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(view->'items') with ordinality e(value,ord)
    where value->>'productId' is not null group by value->>'productId'
   ) grouped;
  end if;
  item:=items_index->(row_data->>'productId')->0;
  if item is not null then
   if prior_index is null then
    select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into prior_index from (
    select value->>'productId' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(prior) with ordinality e(value,ord)
    where value->>'productId' is not null group by value->>'productId'
   ) grouped;
   end if;
   select value into strict old from jsonb_array_elements(coalesce(prior_index->(row_data->>'productId'),'[]'::jsonb));
   b:=identity_evidence->'bindings'->(old->>'productId')->'binding';
   if item->>'guardChanged'='true' then b:=b||jsonb_build_object('expectedGuard',item->>'protectedStateSha256');end if;
   if item->'continuity' is not null and item->'continuity'<>'null'::jsonb then
    b:=jsonb_set(b,'{previousAssignment}',item->'continuity'->'currentAssignment');end if;
   row_data:=(row_data-array['binding','placementHeld','holdReason'])||jsonb_build_object('binding',b);
  end if;
  adjusted_rows:=array_append(adjusted_rows,row_data);
 end loop;
 for row_data in select value from jsonb_array_elements(s.receipt->'trackerRecords') loop
  if items_index is null then
   select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into items_index from (
    select value->>'productId' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(view->'items') with ordinality e(value,ord)
    where value->>'productId' is not null group by value->>'productId'
   ) grouped;
  end if;
  item:=items_index->(row_data->>'matchedProductId')->0;
  if item is not null then
   if tracker_index is null then
    select coalesce(jsonb_object_agg(k,rows),'{}'::jsonb) into tracker_index from (
    select value->>'matchedProductId' k,jsonb_agg(value order by ord) rows
    from jsonb_array_elements(prior_receipt->'trackerRecords') with ordinality e(value,ord)
    where value->>'matchedProductId' is not null group by value->>'matchedProductId'
   ) grouped;
   end if;
   old:=tracker_index->(item->>'productId')->0;
   if old->'binding'->>'state'='linked' and old->>'unitNumber'=row_data->>'unitNumber' then
    row_data:=row_data||jsonb_build_object('binding',old->'binding'||jsonb_build_object('expectedGuard',item->>'protectedStateSha256'));
   end if;
  end if;
  tracker_rows:=array_append(tracker_rows,row_data);
 end loop;
 adjusted:=to_jsonb(adjusted_rows);trackers:=to_jsonb(tracker_rows);
 approval:=jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_APPROVAL_V1','reviewDigest',p_expected_digest,
  'actorId',p_actor_user_id,'approvedAt',clock_timestamp(),'confirmationSha256',encode(sha256(convert_to(btrim(p_confirmation),'UTF8')),'hex'),
  'continuity',s.receipt->'assignmentContinuity',
  'productIds',(select jsonb_agg(x->>'productId') from jsonb_array_elements(view->'items') x),'review',view);
 -- Existing full validator still checks exact links, previous-assignment evidence,
 -- protected guards, competing sources and all represented identity memberships.
 checked:=cos_mhelp_placement_private.review_upload(s.receipt||jsonb_build_object('trackerRecords',trackers),adjusted,s.expected_active_sha256,false);
 update cos_mhelp_placement_private.owner_equipment_stages set records=adjusted,
  receipt=receipt||jsonb_build_object('trackerRecords',trackers,'assignmentApproval',approval),
  review_receipt=review_receipt||jsonb_build_object('assignmentReview',approval) where id=s.id;
 if cos_mhelp_placement_private.assignment_review(s.id)->>'reviewDigest' is distinct from p_expected_digest then
  raise exception 'Assignment review changed during approval' using errcode='40001';end if;
 return view||jsonb_build_object('approved',true,'idempotent',false);
exception when serialization_failure then
 raise exception using errcode='PT409',message=SQLERRM;
end $function$;
commit;
