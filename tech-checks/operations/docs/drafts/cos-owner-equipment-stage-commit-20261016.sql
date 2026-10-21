-- DESIGN CANDIDATE ONLY. Do not apply to production without independent DB/Owner review.
-- The historic libraryFileId/receivedMessageId fields are compatibility tokens only;
-- the immutable COS-private stage bytes + sourceEvidence contract provide actual
-- source provenance. This alternative must be approved before any production use.
-- This private source-file stage is an evidence store, not a unit, camera, IP, GPS,
-- address or mHelpDesk write. The existing administrator review_upload() stays authoritative.
-- Current 2027 source census is authenticated by the COS Edge Function, never by browser JSON.
-- Shop uses exact known internal company accounts only. The current 2027
-- overview explicitly places ST 239 / CAMERAS ONSITE - TEST UNITS in Shop,
-- matching the corrected Oct 16 complete-source census (287 Field / 714 Shop).
create table if not exists cos_mhelp_placement_private.owner_equipment_stages (
 id uuid primary key,
 organization_id uuid not null,
 actor_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 source_filename text not null,
 source_sha256 text not null,
 expected_active_sha256 text not null,
 verified_2027_sha256 text not null,
 expected_scoped_revision bigint not null,
 expected_scoped_sha256 text not null,
 source_bytes bytea not null,
 records jsonb not null,
 receipt jsonb not null,
 review_receipt jsonb not null,
 applied_at timestamptz,
 applied_receipt jsonb,
 constraint owner_equipment_stage_hashes check(
  source_sha256~'^[a-f0-9]{64}$' and expected_active_sha256~'^[a-f0-9]{64}$'
  and verified_2027_sha256~'^[a-f0-9]{64}$'
  and expected_scoped_sha256~'^[a-f0-9]{64}$' and expected_scoped_revision>=0),
 constraint owner_equipment_stage_source check(octet_length(source_bytes)>0 and octet_length(source_bytes)<=2097152),
 constraint owner_equipment_stage_state check(applied_at is null or applied_receipt is not null)
);
alter table cos_mhelp_placement_private.owner_equipment_stages enable row level security;
alter table cos_mhelp_placement_private.owner_equipment_stages force row level security;
revoke all on cos_mhelp_placement_private.owner_equipment_stages from public,anon,authenticated,service_role;

-- Owner actor scope. The Edge Function resolves the actor from the authenticated
-- Tech Check session. This is repeated in Postgres, not delegated to client claims.
create or replace function public.cos_owner_mhelp_equipment_stage_v1(
 p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,
 p_filename text,p_source_sha256 text,p_expected_active_sha256 text,
 p_current_2027_sha256 text,p_current_2027_rows jsonb,
 p_original_bytes_base64 text,p_records jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare bytes bytea; prior_sha text; n integer; distinct_n integer;
  receipt_review jsonb; stage_response jsonb;
  existing cos_mhelp_placement_private.owner_equipment_stages;
  old_batch cos_mhelp_placement_private.upload_batches;
  row_data jsonb; old_row jsonb; old_tracker jsonb; tracker_row jsonb;
  binding jsonb; adjusted jsonb:='[]'::jsonb; tracker_rows jsonb:='[]'::jsonb;
  receipt jsonb; company_ids jsonb; received timestamptz:=clock_timestamp();
  prior_rows jsonb; scoped_revision bigint; scoped_sha text; shop_baseline jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
    or not app_private.has_permission(p_organization_id,'equipment.manage') then
   raise exception 'Owner equipment authorization required' using errcode='42501';
 end if;
 if p_request_id is null or coalesce(p_filename,'')!~'^ServiceItem_List_[0-9]{14}[.]csv$'
    or coalesce(p_source_sha256,'')!~'^[a-f0-9]{64}$'
    or coalesce(p_expected_active_sha256,'')!~'^[a-f0-9]{64}$'
    or coalesce(p_current_2027_sha256,'')!~'^[a-f0-9]{64}$'
    or length(coalesce(p_original_bytes_base64,''))>2796208
    or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_typeof(p_current_2027_rows) is distinct from 'array'
    or jsonb_array_length(p_records)>10000
    or jsonb_array_length(p_records)<1
    or jsonb_array_length(p_current_2027_rows) is distinct from jsonb_array_length(p_records)
 then raise exception 'Malformed equipment staging evidence' using errcode='22023';end if;
 begin bytes:=decode(p_original_bytes_base64,'base64');
 exception when others then raise exception 'Invalid original file bytes' using errcode='22023';end;
 if octet_length(bytes)<1 or octet_length(bytes)>2097152 or
    encode(pg_catalog.sha256(bytes),'hex') is distinct from p_source_sha256
 then raise exception 'Original file checksum mismatch' using errcode='22023';end if;
 select count(*),count(distinct r->>'productId') into n,distinct_n
 from jsonb_array_elements(p_records) r;
 if n<>distinct_n or n<>jsonb_array_length(p_current_2027_rows)
   or exists(select 1 from jsonb_array_elements(p_records) r
      where coalesce(r->>'productId','')!~'^[1-9][0-9]{0,14}$'
       or coalesce(r->>'customerId','')!~'^[1-9][0-9]{0,14}$'
       or coalesce(r->>'customer','')='' or coalesce(r->>'unitNumber','')=''
       or coalesce(r->>'category','')='' or r->>'placement' not in('SHOP','FIELD')
       or r->>'lifecycle' not in('UNFLAGGED','DO_NOT_USE','MISSING')
       or jsonb_typeof(r->'sourceAddress') is distinct from 'object'
       or (r->>'placement'='SHOP') is distinct from
          (regexp_replace(lower(r->>'customer'),'[^a-z0-9]','','g') in
          ('camerasonsite','camerasonsitellc','camerasonsitetestunits')))
   or exists(select 1 from jsonb_array_elements(p_current_2027_rows) r
      where coalesce(r->>'productId','')!~'^[1-9][0-9]{0,14}$'
       or coalesce(r->>'unitLabel','')='' or coalesce(r->>'family','')=''
       or coalesce(r->>'customer','')='' or coalesce(r->>'placement','') not in('FIELD','SHOP'))
   or (select count(distinct r->>'productId') from jsonb_array_elements(p_current_2027_rows) r)<>n
   or exists(select 1 from jsonb_array_elements(p_current_2027_rows) x
      where not exists(select 1 from jsonb_array_elements(p_records) r
       where r->>'productId'=x->>'productId' and r->>'placement'=x->>'placement'
        and r->>'customer'=x->>'customer'))
 then raise exception '2027 Product ID authority mismatch' using errcode='40001';end if;
 -- A stage records a real private source-file ID and source bytes in this table.
 -- The existing reviewed-upload validator is mandatory and executes again at commit.
 select active_sha256 into strict prior_sha from cos_mhelp_placement_private.upload_control
 where singleton for update;
 if prior_sha is distinct from p_expected_active_sha256 then
  raise exception 'Previously reviewed source changed' using errcode='40001';end if;
 select * into strict old_batch from cos_mhelp_placement_private.upload_batches
 where source_sha256=prior_sha for share;
 -- Scoped Owner corrections are part of the current identity authority, even
 -- when the raw upload pointer has not changed. All scoped writers take this
 -- same upload_control lock before changing their revision or effective rows.
 select coalesce(max(revision),0) into scoped_revision
 from cos_mhelp_placement_private.scoped_control where base_sha256=prior_sha;
 prior_rows:=cos_mhelp_placement_private.scoped_records(prior_sha);
 if jsonb_typeof(prior_rows) is distinct from 'array' then
  raise exception 'Current scoped source authority unavailable' using errcode='40001';end if;
 scoped_sha:=encode(pg_catalog.sha256(pg_catalog.convert_to(prior_rows::text,'UTF8')),'hex');
 shop_baseline:=cos_mhelp_placement_private.shop_address_baseline(prior_sha);
 -- All business-readable identities are matched ONLY on Product ID. A changed
 -- label, a missing product or an ambiguous previous Product ID never inherits
 -- a native camera, router, site, GPS or tracker association.
 for row_data in select value from jsonb_array_elements(p_records) loop
  old_row:=null;
  select value into old_row from jsonb_array_elements(prior_rows) value
  where value->>'productId'=row_data->>'productId' limit 1;
  old_tracker:=null;
  select value into old_tracker from jsonb_array_elements(
    coalesce(old_batch.receipt->'trackerRecords','[]'::jsonb)) value
   where value->>'matchedProductId'=row_data->>'productId' limit 1;
  if old_row is not null and (old_row ? 'scopedAuthority' or old_row ? 'sourceLabelAuthority') then
    adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object(
      'binding','null'::jsonb,'placementHeld',true,
      'holdReason','Prior reviewed scoped identity or assignment requires Owner installation review'));
  elsif old_row is not null and (
    (old_row->'binding' is not null and old_row->'binding'<>'null'::jsonb
      and old_row->'binding'->>'expectedGuard' is distinct from
       cos_mhelp_placement_private.upload_binding_guard(
        (old_row->'binding'->>'trackerId')::uuid,(old_row->'binding'->>'nativeUnitId')::uuid))
    or (old_tracker->'binding'->>'state'='linked'
      and old_tracker->'binding'->>'expectedGuard' is distinct from
       cos_mhelp_placement_private.upload_binding_guard(
        (old_tracker->'binding'->>'trackerId')::uuid,(old_tracker->'binding'->>'nativeUnitId')::uuid))) then
    -- Preserve newer native GPS/history/identity exactly. A stale link is held,
    -- never repaired by copying the current digest over its old authorization.
    adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object(
      'binding','null'::jsonb,'placementHeld',true,
      'holdReason','Native identity or location evidence changed; fresh association review required'));
  elsif old_row is not null and old_row->>'unitNumber'=row_data->>'unitNumber'
     and old_row->>'category'=row_data->>'category' then
    -- A newer CSV receipt has no independently authenticated installation
    -- observation timestamp. Never let its stage/received time displace a
    -- technician's subsequent Owner/GPS change. Changed assignments stay in
    -- source inventory, but their previous device/location link is HELD.
    if old_row->>'placement' is distinct from row_data->>'placement'
       or old_row->>'customerId' is distinct from row_data->>'customerId'
       or old_row->>'customer' is distinct from row_data->>'customer'
       or (old_row->'sourceAddress' is distinct from row_data->'sourceAddress' and not coalesce((
        old_row->>'placement'='SHOP' and row_data->>'placement'='SHOP'
        and old_row->'sourceAddress'='{"street":"","city":"","state":"","zip":""}'::jsonb
        and old_row->'apiAssignment'->'placementProof'->>'version'='1'
        and old_row->'apiAssignment'->'placementProof'->>'serviceVerified'='false'
        and old_row->'apiAssignment'->'placementProof'->>'siteLabel'=''
        and coalesce(old_row->'addressReview','null'::jsonb)='null'::jsonb
        and (exists(select 1 from jsonb_array_elements(shop_baseline->'records') h
          where h->>'productId'=row_data->>'productId' and h->>'unitNumber'=row_data->>'unitNumber'
           and h->>'category'=row_data->>'category' and h->>'customerId'=row_data->>'customerId'
           and h->>'customer'=row_data->>'customer' and h->>'placement'=row_data->>'placement'
           and h->>'lifecycle'=row_data->>'lifecycle' and h->'sourceAddress'=row_data->'sourceAddress')
         or (not exists(select 1 from jsonb_array_elements(shop_baseline->'records') h where h->>'productId'=row_data->>'productId')
          and exists(select 1 from jsonb_array_elements(shop_baseline->'records') h
           where h->>'customerId'=row_data->>'customerId' and h->>'customer'=row_data->>'customer')
          and not exists(select 1 from jsonb_array_elements(shop_baseline->'records') h
           where h->>'customerId'=row_data->>'customerId' and h->>'customer'=row_data->>'customer'
            and h->'sourceAddress' is distinct from row_data->'sourceAddress')))
       ),false))
       or old_row->>'lifecycle' is distinct from row_data->>'lifecycle'
       or old_row->>'placementHeld'='true' then
      adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object(
       'binding','null'::jsonb,'placementHeld',true,
       'holdReason','Source assignment or protection changed; Owner installation review required'));
    else
      binding:=coalesce(old_row->'binding','null'::jsonb);
      adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object('binding',binding));
    end if;
  elsif old_row is not null then
    adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object(
      'binding','null'::jsonb,'placementHeld',true,
      'holdReason','Product ID identity label changed; confirm before linking'));
  elsif exists(select 1 from jsonb_array_elements(prior_rows||old_batch.records) other
          where other->>'category'=row_data->>'category'
           and other->>'unitNumber'=row_data->>'unitNumber') then
    adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object(
      'binding','null'::jsonb,'placementHeld',true,
      'holdReason','A different Product ID previously carried the same equipment name'));
  else
    adjusted:=adjusted||jsonb_build_array(row_data||jsonb_build_object('binding','null'::jsonb));
  end if;
 end loop;
 -- Build complete current 2027 membership WITHOUT inventing UUID/native links.
 -- Existing exact 2027 rows may retain their stored guarded binding; other
 -- current Product IDs are represented as source-only, with camera evidence absent.
 for row_data in select value from jsonb_array_elements(p_current_2027_rows) loop
  old_tracker:=null;
  select value into old_tracker from jsonb_array_elements(
    coalesce(old_batch.receipt->'trackerRecords','[]'::jsonb)) value
   where value->>'matchedProductId'=row_data->>'productId' limit 1;
  select value into old_row from jsonb_array_elements(adjusted) value
   where value->>'productId'=row_data->>'productId' limit 1;
  if old_row->>'placementHeld'='true' then
    -- The current mHelp customer/placement changed; a tracker-side binding
    -- must not silently reintroduce the old native camera/location identity.
    binding:=jsonb_build_object('state','held','unitIds','[]'::jsonb,
      'unitLabels','{}'::jsonb,'guardCurrent',null);
  elsif old_tracker is not null
    and old_tracker->>'unitNumber'=row_data->>'unitLabel'
    and old_tracker->'binding'->>'state'='linked' then
      binding:=old_tracker->'binding';
  else binding:=jsonb_build_object('state','unlinked','unitIds','[]'::jsonb,
      'unitLabels','{}'::jsonb,'guardCurrent',null);end if;
  tracker_row:=jsonb_build_object(
    'recordId',coalesce(old_tracker->>'recordId',
       'tracker_row:2027_product:'||(row_data->>'productId')),
    'unitNumber',row_data->>'unitLabel','category',row_data->>'family',
    'placement',row_data->>'placement','lifecycle',case when old_row->>'lifecycle'='UNFLAGGED' then 'ACTIVE' else old_row->>'lifecycle' end,
    'customer',row_data->>'customer','site',null,'sourceAddress',null,
    'matchedProductId',row_data->>'productId','binding',binding);
  tracker_rows:=tracker_rows||jsonb_build_array(tracker_row);
 end loop;
 select coalesce(jsonb_agg(distinct value->>'customerId'),'[]'::jsonb)
 into company_ids from jsonb_array_elements(adjusted) value where value->>'placement'='SHOP';
 receipt:=(old_batch.receipt-array['receivedMessageId','authorizationSha256',
   'sourceSha256','filename','receivedAt','receivedAtPrecision','exportAsOf',
   'recordCount','libraryFileId','companyCustomerIds','trackerSource','trackerRecords'])
   ||jsonb_build_object(
    'contract','COS_MHELP_UPLOAD_V1','reviewed',true,
    'sourceSha256',p_source_sha256,'filename',p_filename,
    'receivedAt',to_char(received at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'receivedAtPrecision','second','exportAsOf',null,
    'recordCount',n,'libraryFileId','libfile_'||replace(p_request_id::text,'-',''),
    'receivedMessageId','cos_owner_equipment_stage:'||p_request_id::text,
    -- A new COS-private source byte record is the durable authority. These
    -- legacy receipt compatibility fields are NOT external Library/email proof.
    'sourceEvidence',jsonb_build_object(
      'contract','COS_PRIVATE_OWNER_EQUIPMENT_SOURCE_V1',
      'stageId',p_request_id::text,
      'byteLength',octet_length(bytes),
      'sha256',p_source_sha256),
    'companyCustomerIds',company_ids,
    'authorizationSha256',encode(pg_catalog.sha256(pg_catalog.convert_to(
      p_actor_user_id::text||':'||p_request_id::text||':'||p_source_sha256||':'||
      p_expected_active_sha256||':'||p_current_2027_sha256,'UTF8')),'hex'),
    'trackerSource',jsonb_build_object('contract','COS_CURRENT_TRACKER_CENSUS_V1',
       'complete',true,'sourceSha256',p_current_2027_sha256,
       'observedAt',to_char(received at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'totalSourceRecords',n),
    'trackerRecords',tracker_rows);

 select * into existing from cos_mhelp_placement_private.owner_equipment_stages
 where id=p_request_id for update;
 if found then
   if existing.actor_id is distinct from p_actor_user_id
      or existing.source_sha256 is distinct from p_source_sha256
      or existing.expected_active_sha256 is distinct from p_expected_active_sha256
      or existing.verified_2027_sha256 is distinct from p_current_2027_sha256
      or existing.expected_scoped_revision is distinct from scoped_revision
      or existing.expected_scoped_sha256 is distinct from scoped_sha
   then raise exception 'Conflicting source stage request' using errcode='40001';end if;
   return existing.review_receipt;
 end if;
 receipt_review:=cos_mhelp_placement_private.review_upload(
   receipt,adjusted,p_expected_active_sha256,false);
 if receipt_review->>'sourceSha256' is distinct from p_source_sha256
    or (receipt_review->>'records')::integer<>n then
   raise exception 'Full source review failed' using errcode='40001';end if;
 stage_response:=receipt_review||jsonb_build_object('contract','COS_OWNER_EQUIPMENT_STAGE_V1',
  'stageId',p_request_id,'previewOnly',true,'readyToCommit',false,
  'expiresInMinutes',60,'productIdsMatched',n);
 insert into cos_mhelp_placement_private.owner_equipment_stages(
  id,organization_id,actor_id,expires_at,source_filename,source_sha256,
  expected_active_sha256,verified_2027_sha256,expected_scoped_revision,expected_scoped_sha256,source_bytes,records,receipt,review_receipt)
 values(p_request_id,p_organization_id,p_actor_user_id,clock_timestamp()+interval '60 minutes',
  p_filename,p_source_sha256,p_expected_active_sha256,p_current_2027_sha256,
  scoped_revision,scoped_sha,bytes,adjusted,receipt,stage_response);
 return stage_response;
end $function$;

-- Commit cannot use an old browser preview. It repeats Owner permissions, the
-- 2027 digest, current source compare-and-swap and every upload/native guard,
-- under the same transaction and locks held by the existing review_upload().
create or replace function public.cos_owner_mhelp_equipment_commit_v1(
 p_actor_user_id uuid,p_organization_id uuid,p_stage_id uuid,
 p_expected_previous_source_sha256 text,p_current_2027_sha256 text,
 p_confirmation_text text
) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare stage cos_mhelp_placement_private.owner_equipment_stages; applied jsonb; current_sha text;
 scoped_revision bigint; scoped_sha text;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
    or not app_private.has_permission(p_organization_id,'equipment.manage') then
  raise exception 'Owner equipment authorization required' using errcode='42501';end if;
 if p_stage_id is null or coalesce(p_expected_previous_source_sha256,'')!~'^[a-f0-9]{64}$'
    or coalesce(p_current_2027_sha256,'')!~'^[a-f0-9]{64}$'
    or length(btrim(coalesce(p_confirmation_text,'')))<24
    or length(p_confirmation_text)>800
 then raise exception 'Explicit source approval is required' using errcode='22023';end if;
 -- Match the scoped writer/stage lock order, including the first scoped edit
 -- where no scoped_control row exists yet.
 select active_sha256 into strict current_sha from cos_mhelp_placement_private.upload_control
 where singleton for update;
 select * into strict stage from cos_mhelp_placement_private.owner_equipment_stages
 where id=p_stage_id and actor_id=p_actor_user_id and organization_id=p_organization_id for update;
 if stage.applied_at is not null then return stage.applied_receipt||jsonb_build_object(
  'contract','COS_OWNER_EQUIPMENT_COMMIT_V1','stageId',stage.id,
  'sourceReceiptsApplied',true,'idempotent',true);end if;
 select coalesce(max(revision),0) into scoped_revision
 from cos_mhelp_placement_private.scoped_control where base_sha256=stage.expected_active_sha256;
 scoped_sha:=encode(pg_catalog.sha256(pg_catalog.convert_to(
  cos_mhelp_placement_private.scoped_records(stage.expected_active_sha256)::text,'UTF8')),'hex');
 if stage.expected_scoped_revision is distinct from scoped_revision
  or stage.expected_scoped_sha256 is distinct from scoped_sha then
  raise exception 'Reviewed scoped source changed after staging' using errcode='40001';end if;
 if stage.expires_at<clock_timestamp() or
  stage.expected_active_sha256 is distinct from p_expected_previous_source_sha256 or
  stage.verified_2027_sha256 is distinct from p_current_2027_sha256 or
  encode(pg_catalog.sha256(stage.source_bytes),'hex') is distinct from stage.source_sha256 or
  stage.receipt->'sourceEvidence'->>'contract' is distinct from 'COS_PRIVATE_OWNER_EQUIPMENT_SOURCE_V1' or
  stage.receipt->'sourceEvidence'->>'stageId' is distinct from stage.id::text or
  stage.receipt->'sourceEvidence'->>'sha256' is distinct from stage.source_sha256 or
  (stage.receipt->'sourceEvidence'->>'byteLength')::integer is distinct from octet_length(stage.source_bytes)
 then raise exception 'Equipment source review is stale' using errcode='40001';end if;
 applied:=cos_mhelp_placement_private.review_upload(
  stage.receipt,stage.records,stage.expected_active_sha256,true);
 select active_sha256 into strict current_sha from cos_mhelp_placement_private.upload_control where singleton;
 if current_sha is distinct from stage.source_sha256 or
  applied->>'sourceSha256' is distinct from stage.source_sha256
  or applied->>'applied' is distinct from 'true'
  or (applied->>'records')::integer is distinct from (stage.review_receipt->>'records')::integer
  or (applied->>'recordedField')::integer is distinct from (stage.review_receipt->>'recordedField')::integer
  or (applied->>'recordedShop')::integer is distinct from (stage.review_receipt->>'recordedShop')::integer then
  raise exception 'Equipment admission did not commit' using errcode='40001';end if;
 update cos_mhelp_placement_private.owner_equipment_stages
 set applied_at=clock_timestamp(),applied_receipt=applied||jsonb_build_object(
  'confirmationSha256',encode(pg_catalog.sha256(pg_catalog.convert_to(p_confirmation_text,'UTF8')),'hex')) where id=stage.id;
 return applied||jsonb_build_object('contract','COS_OWNER_EQUIPMENT_COMMIT_V1',
  'stageId',stage.id,'sourceReceiptsApplied',true);
end $function$;

-- Only the COS server's existing service key may invoke the endpoint; the
-- function independently checks the verified actor's equipment.manage role.
revoke all on function public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.cos_owner_mhelp_equipment_commit_v1(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cos_owner_mhelp_equipment_stage_v1(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb) to service_role;
grant execute on function public.cos_owner_mhelp_equipment_commit_v1(uuid,uuid,uuid,text,text,text) to service_role;
