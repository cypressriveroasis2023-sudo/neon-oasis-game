-- Review candidate only. Requires separate production approval.
-- No native, tracker, provider, GPS, history or active-source writes.
-- Uses the existing immutable private stage and existing equipment.manage gate.
create or replace function cos_mhelp_placement_private.assignment_review(p_stage uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare s cos_mhelp_placement_private.owner_equipment_stages; prior jsonb; original jsonb;
 r jsonb; old jsonb; b jsonb; t jsonb; u jsonb; move jsonb; guard text;
 items jsonb:='[]'; item jsonb; why text; digest text; revision bigint; scoped jsonb;
begin
 select * into strict s from cos_mhelp_placement_private.owner_equipment_stages where id=p_stage;
 if s.applied_at is not null or s.expires_at<clock_timestamp()
  or encode(sha256(s.source_bytes),'hex') is distinct from s.source_sha256
  or (select active_sha256 from cos_mhelp_placement_private.upload_control where singleton) is distinct from s.expected_active_sha256
 then raise exception 'Assignment source stage is stale' using errcode='40001';end if;
 select coalesce(max(c.revision),0) into revision from cos_mhelp_placement_private.scoped_control c where base_sha256=s.expected_active_sha256;
 scoped:=cos_mhelp_placement_private.scoped_records(s.expected_active_sha256);
 if revision is distinct from s.expected_scoped_revision or encode(sha256(convert_to(scoped::text,'UTF8')),'hex') is distinct from s.expected_scoped_sha256
 then raise exception 'Assignment scoped authority changed' using errcode='40001';end if;
 select records into strict original from cos_mhelp_placement_private.upload_batches where source_sha256=s.expected_active_sha256;
 for r in select value from jsonb_array_elements(s.records) order by value->>'productId' loop
  select value into old from jsonb_array_elements(scoped) where value->>'productId'=r->>'productId';
  b:=old->'binding';
  -- Existing linked rows held by staging are mandatory review items. Once approved,
  -- retain the exact item set so the same digest can be checked again at commit.
  if b is null or b='null'::jsonb or not (coalesce(r->>'placementHeld'='true',false) or
    coalesce(s.review_receipt->'assignmentReview'->'productIds','[]'::jsonb) ? (r->>'productId')) then continue;end if;
  why:=null;move:=null;t:=null;u:=null;
  select to_jsonb(x) into t from app_private.vision_tracker_locations x where id=(b->>'trackerId')::uuid;
  select to_jsonb(x) into u from public.equipment_units x where id=(b->>'nativeUnitId')::uuid;
  guard:=cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid);
  if old ? 'scopedAuthority' or old ? 'sourceLabelAuthority' or old->>'placementHeld'='true'
   or old->>'unitNumber' is distinct from r->>'unitNumber' or old->>'category' is distinct from r->>'category'
   or old->>'lifecycle' is distinct from 'UNFLAGGED' or r->>'lifecycle' is distinct from 'UNFLAGGED'
   or b->>'productId' is distinct from r->>'productId' or b->>'fullLabel' is distinct from r->>'unitNumber'
   or b->>'matchMethod' not in ('reviewed_product_id','exact_family_unit')
   or (t is null and u is null)
   or (b->>'trackerId' is not null and (t is null or t->>'organization_id' is distinct from s.organization_id::text or t->>'unit_number' is distinct from b->>'trackerLabel'))
   or (b->>'nativeUnitId' is not null and (u is null or u->>'organization_id' is distinct from s.organization_id::text or u->>'unit_number' is distinct from b->>'nativeLabel' or u->>'status' in ('retired','deleted') or u->>'retired_at' is not null))
   or exists(select 1 from app_private.cos_archived_representations a where (b->>'trackerId')::uuid in(a.archived_tracker_id,a.canonical_tracker_id) or (b->>'nativeUnitId')::uuid in(a.archived_native_id,a.canonical_native_id))
   or exists(select 1 from app_private.cos_geocode_sources x where x.active and (x.tracker_id=(b->>'trackerId')::uuid or x.native_unit_id=(b->>'nativeUnitId')::uuid) and x.product_id is distinct from r->>'productId')
   or exists(select 1 from jsonb_array_elements(original) x where x->>'productId'<>r->>'productId' and
      ((b->>'trackerId' is not null and x->'binding'->>'trackerId'=b->>'trackerId') or (b->>'nativeUnitId' is not null and x->'binding'->>'nativeUnitId'=b->>'nativeUnitId')))
  then why:='Identity, lifecycle or scoped conflict; assignment approval cannot resolve it';end if;
  if b->>'expectedGuard' is distinct from guard then
   -- A receipt anchors the existing exact link, but does not auto-approve the
   -- changed protected graph. Owner must explicitly confirm its current state.
   select to_jsonb(m) into move from app_private.cos_fleet_shop_moves m
    where m.unit_id=(b->>'nativeUnitId')::uuid and m.organization_id=s.organization_id order by m.created_at desc,m.id desc limit 1;
   if exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=(b->>'nativeUnitId')::uuid)
    or coalesce(u->>'gps_latitude',u->>'gps_longitude',u->>'installed_site_id',u->>'current_location_ref',t->>'latitude',t->>'longitude') is not null
    or r->>'placement' is distinct from 'SHOP' or u->>'current_location_type' is distinct from 'shop' or u->>'status' is distinct from 'available'
    or move->>'unit_number' is distinct from b->>'nativeLabel' or move->>'model_id' is distinct from u->>'model_id'
    or not exists(select 1 from jsonb_array_elements(coalesce(move->'source_bindings','[]')) x where x->>'productId'=r->>'productId' and x->>'sourceSha256'=s.expected_active_sha256 and x->>'sourceUnitNumber'=r->>'unitNumber')
   then why:='Changed protected state lacks an exact recorded Shop receipt';end if;
  end if;
  item:=jsonb_build_object('productId',r->>'productId','unitNumber',r->>'unitNumber',
   'before',jsonb_build_object('placement',old->>'placement','customer',old->>'customer','customerId',old->>'customerId','address',old->'sourceAddress'),
   'after',jsonb_build_object('placement',r->>'placement','customer',r->>'customer','customerId',r->>'customerId','address',r->'sourceAddress'),
   'identity',jsonb_build_object('nativeUnitId',b->>'nativeUnitId','nativeLabel',b->>'nativeLabel','trackerId',b->>'trackerId','trackerLabel',b->>'trackerLabel'),
   'current',jsonb_build_object('nativePlacement',u->>'current_location_type','nativeStatus',u->>'status','internalTrackerPlacement',t->>'placement','internalTrackerCustomer',t->>'customer','internalTrackerSite',t->>'site',
     'gpsPresent',coalesce(u->>'gps_latitude',t->>'latitude') is not null,'shopReceiptId',move->>'id','shopRecordedAt',move->>'created_at'),
   'guardChanged',b->>'expectedGuard' is distinct from guard,'protectedStateSha256',guard,'eligible',why is null,'blocker',why,
   'evidenceSha256',encode(sha256(convert_to(jsonb_build_object('binding',b,'move',move,'links',(select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]') from cos_mhelp_placement_private.links l where l.equipment_id=r->>'productId'))::text,'UTF8')),'hex'));
  items:=items||jsonb_build_array(item);
 end loop;
 digest:=encode(sha256(convert_to(jsonb_build_object('stageId',s.id,'actorId',s.actor_id,'organizationId',s.organization_id,'sourceSha256',s.source_sha256,'bytes',encode(sha256(s.source_bytes),'hex'),'records',(select jsonb_agg(x-array['binding','placementHeld','holdReason'] order by x->>'productId') from jsonb_array_elements(s.records) x),
  'activeSource',s.expected_active_sha256,'census',s.verified_2027_sha256,'scopedRevision',revision,'scopedSha256',s.expected_scoped_sha256,'items',items)::text,'UTF8')),'hex');
 return jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_REVIEW_V1','stageId',s.id,'sourceSha256',s.source_sha256,'censusSha256',s.verified_2027_sha256,'reviewDigest',digest,'items',items,'approved',false);
end $$;
revoke all on function cos_mhelp_placement_private.assignment_review(uuid) from public,anon,authenticated,service_role;

-- Serializes the guarded graph, including absent archive/source rows, against
-- concurrent writers. Short lock timeout fails atomically instead of waiting.
create or replace function cos_mhelp_placement_private.assignment_review_lock()
returns void language plpgsql set search_path='' set lock_timeout='5s' as $$begin
 lock table public.equipment_units,app_private.vision_tracker_locations,
 app_private.cos_geocode_sources,app_private.cos_archived_representations,
 public.equipment_unit_location_history,app_private.cos_owner_identity_claims,
 cos_mhelp_placement_private.links,app_private.cos_fleet_shop_moves in share mode;
end $$;
revoke all on function cos_mhelp_placement_private.assignment_review_lock() from public,anon,authenticated,service_role;

create or replace function public.cos_owner_mhelp_assignment_review_v1(
 p_actor_user_id uuid,p_organization_id uuid,p_stage_id uuid,p_source_sha256 text,p_current_2027_sha256 text,
 p_action text default 'read',p_expected_digest text default null,p_confirmation text default null
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s cos_mhelp_placement_private.owner_equipment_stages; view jsonb; old jsonb; row_data jsonb; b jsonb; item jsonb;
 adjusted jsonb:='[]'; trackers jsonb:='[]'; prior jsonb; prior_receipt jsonb; approval jsonb; checked jsonb;
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
 for row_data in select value from jsonb_array_elements(s.records) loop
  select value into item from jsonb_array_elements(view->'items') where value->>'productId'=row_data->>'productId';
  if item is not null then
   select value into strict old from jsonb_array_elements(prior) where value->>'productId'=row_data->>'productId';
   b:=old->'binding'||jsonb_build_object('expectedGuard',item->>'protectedStateSha256');
   row_data:=(row_data-array['binding','placementHeld','holdReason'])||jsonb_build_object('binding',b);
  end if;
  adjusted:=adjusted||jsonb_build_array(row_data);
 end loop;
 for row_data in select value from jsonb_array_elements(s.receipt->'trackerRecords') loop
  select value into item from jsonb_array_elements(view->'items') where value->>'productId'=row_data->>'matchedProductId';
  if item is not null then
   select value into old from jsonb_array_elements(prior_receipt->'trackerRecords') where value->>'matchedProductId'=item->>'productId';
   if old->'binding'->>'state'='linked' and old->>'unitNumber'=row_data->>'unitNumber' then
    row_data:=row_data||jsonb_build_object('binding',old->'binding'||jsonb_build_object('expectedGuard',item->>'protectedStateSha256'));
   end if;
  end if;
  trackers:=trackers||jsonb_build_array(row_data);
 end loop;
 approval:=jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_APPROVAL_V1','reviewDigest',p_expected_digest,
  'actorId',p_actor_user_id,'approvedAt',clock_timestamp(),'confirmationSha256',encode(sha256(convert_to(btrim(p_confirmation),'UTF8')),'hex'),
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
end $$;
revoke all on function public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text) to service_role;

create or replace function cos_mhelp_placement_private.assert_assignment_review(p_stage uuid)
returns void language plpgsql set search_path='' as $$
declare s cos_mhelp_placement_private.owner_equipment_stages; view jsonb;
begin
 perform cos_mhelp_placement_private.assignment_review_lock();
 select * into strict s from cos_mhelp_placement_private.owner_equipment_stages where id=p_stage;
 view:=cos_mhelp_placement_private.assignment_review(p_stage);
 if jsonb_array_length(view->'items')>0 and (
  s.review_receipt->'assignmentReview'->>'contract' is distinct from 'COS_OWNER_ASSIGNMENT_APPROVAL_V1'
  or s.review_receipt->'assignmentReview'->>'reviewDigest' is distinct from view->>'reviewDigest'
  or exists(select 1 from jsonb_array_elements(view->'items') x where x->>'eligible' is distinct from 'true'))
 then raise exception 'Current Owner assignment review required before source activation' using errcode='40001';end if;
end $$;
revoke all on function cos_mhelp_placement_private.assert_assignment_review(uuid) from public,anon,authenticated,service_role;
