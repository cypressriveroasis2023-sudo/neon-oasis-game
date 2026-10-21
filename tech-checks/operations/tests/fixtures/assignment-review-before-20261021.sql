CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.assignment_review(p_stage uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s cos_mhelp_placement_private.owner_equipment_stages; prior jsonb; original jsonb;
 r jsonb; old jsonb; b jsonb; t jsonb; u jsonb; move jsonb; guard text;
 snapshot jsonb; items jsonb:='[]'; item jsonb; why text; digest text; revision bigint; scoped jsonb;
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
  select value into snapshot from jsonb_array_elements(coalesce(s.receipt->'assignmentContinuity'->'items','[]'::jsonb))
   where value->>'productId'=r->>'productId';
  if s.receipt->'assignmentContinuity'->>'contract' is distinct from 'COS_OWNER_ASSIGNMENT_CONTINUITY_V1'
   or snapshot is distinct from cos_mhelp_placement_private.assignment_review_snapshot(old)
   or (select count(*) from jsonb_array_elements(s.receipt->'assignmentContinuity'->'items') x where x->>'productId'=r->>'productId')<>1
  then raise exception 'Assignment evidence changed after staging; create a fresh stage' using errcode='40001';end if;
  why:=null;move:=null;t:=null;u:=null;
  if snapshot->>'referenceEligible' is distinct from 'true' then
   why:='Missing, ambiguous or unconfirmed exact assignment evidence; continuity cannot be approved';end if;
  select to_jsonb(x) into t from app_private.vision_tracker_locations x where id=(b->>'trackerId')::uuid;
  select to_jsonb(x) into u from public.equipment_units x where id=(b->>'nativeUnitId')::uuid;
  guard:=snapshot->>'protectedStateSha256';
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
   'sourceAssignmentChanged',(old->>'placement' is distinct from r->>'placement' or old->>'customerId' is distinct from r->>'customerId' or old->>'customer' is distinct from r->>'customer'),
   'continuity',snapshot->'continuity',
   'before',jsonb_build_object('placement',old->>'placement','customer',old->>'customer','customerId',old->>'customerId','address',old->'sourceAddress'),
   'after',jsonb_build_object('placement',r->>'placement','customer',r->>'customer','customerId',r->>'customerId','address',r->'sourceAddress'),
   'identity',jsonb_build_object('nativeUnitId',b->>'nativeUnitId','nativeLabel',b->>'nativeLabel','trackerId',b->>'trackerId','trackerLabel',b->>'trackerLabel'),
   'current',jsonb_build_object('nativePlacement',u->>'current_location_type','nativeStatus',u->>'status','internalTrackerPlacement',t->>'placement','internalTrackerCustomer',t->>'customer','internalTrackerSite',t->>'site',
     'gpsPresent',coalesce(u->>'gps_latitude',t->>'latitude') is not null,'shopReceiptId',move->>'id','shopRecordedAt',move->>'created_at'),
   'guardChanged',b->>'expectedGuard' is distinct from guard,'protectedStateSha256',guard,'eligible',why is null,'blocker',why,
   'evidenceSha256',encode(sha256(convert_to(jsonb_build_object('stageSnapshot',snapshot,'binding',b,'move',move,'links',(select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]') from cos_mhelp_placement_private.links l where l.equipment_id=r->>'productId'))::text,'UTF8')),'hex'));
  items:=items||jsonb_build_array(item);
 end loop;
 digest:=encode(sha256(convert_to(jsonb_build_object('stageId',s.id,'actorId',s.actor_id,'organizationId',s.organization_id,'sourceSha256',s.source_sha256,'bytes',encode(sha256(s.source_bytes),'hex'),'records',(select jsonb_agg(x-array['binding','placementHeld','holdReason'] order by x->>'productId') from jsonb_array_elements(s.records) x),
  'activeSource',s.expected_active_sha256,'census',s.verified_2027_sha256,'scopedRevision',revision,'scopedSha256',s.expected_scoped_sha256,'items',items)::text,'UTF8')),'hex');
 return jsonb_build_object('contract','COS_OWNER_ASSIGNMENT_REVIEW_V1','stageId',s.id,'sourceSha256',s.source_sha256,'censusSha256',s.verified_2027_sha256,'reviewDigest',digest,'items',items,'approved',false);
end $function$
