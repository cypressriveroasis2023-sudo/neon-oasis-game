-- Additive Owner CSV intake. Raw bytes remain private; no Library/Google verification is invented.
-- Existing reviewed native identity/installation guards are retained verbatim.
create schema if not exists cos_fleet_import_private;
revoke all on schema cos_fleet_import_private from public,anon,authenticated,service_role;
create table cos_fleet_import_private.stages (
 id uuid primary key, actor_id uuid not null, organization_id uuid not null,
 filename text not null, source_sha text not null check(source_sha~'^[a-f0-9]{64}$'),
 expected_source text not null, scoped_sha text not null,
 source_bytes bytea not null check(octet_length(source_bytes) between 1 and 2097152),
 records jsonb not null, receipt jsonb not null, report jsonb not null,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 committed_at timestamptz, applied jsonb
);
alter table cos_fleet_import_private.stages enable row level security;
alter table cos_fleet_import_private.stages force row level security;
revoke all on cos_fleet_import_private.stages from public,anon,authenticated,service_role;

create function cos_fleet_import_private.valid_provenance(p_receipt jsonb) returns boolean
language sql stable set search_path='' as $proof$
 select coalesce(p_receipt->'sourceEvidence'->>'contract'='COS_PRIVATE_CSV_BYTES_V2'
  and exists(select 1 from cos_fleet_import_private.stages s
   where s.id::text=p_receipt->'sourceEvidence'->>'stageId'
    and s.source_sha=p_receipt->>'sourceSha256'
    and s.source_sha=p_receipt->'sourceEvidence'->>'sha256'
    and octet_length(s.source_bytes)::text=p_receipt->'sourceEvidence'->>'byteLength'
    and encode(sha256(s.source_bytes),'hex')=s.source_sha),false)
$proof$;
revoke all on function cos_fleet_import_private.valid_provenance(jsonb) from public,anon,authenticated,service_role;
-- Extend only provenance validation, with a hash lease on the currently deployed function.
DO $patch$
declare source text; before_sha text; old_clause text;
begin
 source:=pg_get_functiondef('cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)'::regprocedure);
 before_sha:=encode(sha256(convert_to(source,'UTF8')),'hex');
 if before_sha <> 'b572e843f0540743dfe34db9750fbac5342bf1c99708deba141b676c6fc23484' then
  raise exception 'Reviewed upload guard changed; independent reconciliation required';
 end if;
 old_clause:=$q$or coalesce(p_receipt->>'libraryFileId','')!~'^libfile_[a-zA-Z0-9]+$'$q$;
 if position(old_clause in source)=0 then raise exception 'Provenance clause missing';end if;
 source:=replace(source,old_clause,$q$or (coalesce(p_receipt->>'libraryFileId','')!~'^libfile_[a-zA-Z0-9]+$' and not cos_fleet_import_private.valid_provenance(p_receipt))$q$);
 source:=replace(source,$q$or coalesce(p_receipt->>'receivedMessageId','')=''$q$,$q$or (coalesce(p_receipt->>'receivedMessageId','')='' and not cos_fleet_import_private.valid_provenance(p_receipt))$q$);
 execute source;
end $patch$;

create function public.cos_fleet_csv_stage_v2(
 p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_filename text,
 p_source_sha256 text,p_expected_active_sha256 text,p_original_bytes_base64 text,p_records jsonb
) returns jsonb language plpgsql security definer set search_path='' as $fn$
<<stage_v2>>
declare bytes bytea; prior_sha text; n integer; distinct_n integer; receipt_review jsonb;
 existing cos_fleet_import_private.stages; old_batch cos_mhelp_placement_private.upload_batches;
 row_data jsonb; old_row jsonb; old_tracker jsonb; binding jsonb;
 adjusted jsonb:='[]'::jsonb; tracker_rows jsonb:='[]'::jsonb;
 receipt jsonb;company_ids jsonb;received timestamptz:=clock_timestamp();
 prior_rows jsonb;scoped_sha text;report jsonb;changes jsonb;latest_filename text;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.manage') then
  raise exception 'Owner equipment authorization required' using errcode='42501';end if;
 if p_request_id is null or coalesce(p_filename,'')!~'^ServiceItem_List_[0-9]{14}[.]csv$'
  or coalesce(p_source_sha256,'')!~'^[a-f0-9]{64}$' or coalesce(p_expected_active_sha256,'')!~'^[a-f0-9]{64}$'
  or length(coalesce(p_original_bytes_base64,''))>2796208 or jsonb_typeof(p_records) is distinct from 'array'
  or jsonb_array_length(p_records) not between 1 and 10000 then
  raise exception 'Invalid complete CSV staging request' using errcode='22023';end if;
 begin bytes:=decode(p_original_bytes_base64,'base64');exception when others then raise exception 'Invalid source bytes' using errcode='22023';end;
 if octet_length(bytes) not between 1 and 2097152 or encode(sha256(bytes),'hex')<>p_source_sha256 then
  raise exception 'Original CSV checksum mismatch' using errcode='22023';end if;
 select * into existing from cos_fleet_import_private.stages where id=p_request_id for update;
 if found then
  if existing.actor_id<>p_actor_user_id or existing.organization_id<>p_organization_id or existing.source_sha<>p_source_sha256 or existing.expected_source<>p_expected_active_sha256 then raise exception 'Conflicting source request ID' using errcode='40001';end if;
  return existing.report||jsonb_build_object('idempotent',true,'applied',existing.committed_at is not null);end if;
 select count(*),count(distinct r->>'productId') into n,distinct_n from jsonb_array_elements(p_records) r;
 if n<>distinct_n or exists(select 1 from jsonb_array_elements(p_records) r where
  coalesce(r->>'productId','')!~'^[1-9][0-9]{0,14}$' or coalesce(r->>'customerId','')!~'^[1-9][0-9]{0,14}$'
  or coalesce(r->>'unitNumber','')='' or coalesce(r->>'customer','')='' or coalesce(r->>'category','')=''
  or coalesce(r->>'placement','') not in('FIELD','SHOP') or coalesce(r->>'lifecycle','') not in('UNFLAGGED','DO_NOT_USE','MISSING')
  or jsonb_typeof(r->'sourceAddress') is distinct from 'object'
  or (r->>'placement'='SHOP') is distinct from (regexp_replace(lower(r->>'customer'),'[^a-z0-9]','','g') in ('camerasonsite','camerasonsitellc','camerasonsitetestunits'))) then
  raise exception 'Invalid or duplicate source Product IDs' using errcode='22023';end if;
 select active_sha256 into strict prior_sha from cos_mhelp_placement_private.upload_control where singleton for update;
 if prior_sha<>p_expected_active_sha256 then raise exception 'Inventory source changed; read current source before import' using errcode='40001';end if;
 if exists(select 1 from cos_mhelp_placement_private.upload_batches where source_sha256=p_source_sha256) then
  if prior_sha=p_source_sha256 then return jsonb_build_object('contract','COS_FLEET_CSV_STAGE_V2','applied',true,'idempotent',true,'sourceSha256',prior_sha,'records',n);end if;
  raise exception 'Source was previously imported; use audited rollback rather than replay' using errcode='40001';end if;
 select max(b.receipt->>'filename') into latest_filename from cos_mhelp_placement_private.upload_batches b where b.receipt->>'filename'~'^ServiceItem_List_[0-9]{14}[.]csv$';
 if latest_filename is not null and p_filename<latest_filename then raise exception 'Older CSV cannot overwrite a newer accepted file' using errcode='40001';end if;
 select * into strict old_batch from cos_mhelp_placement_private.upload_batches where source_sha256=prior_sha for share;
 prior_rows:=cos_mhelp_placement_private.scoped_records(prior_sha);
 if jsonb_typeof(prior_rows) is distinct from 'array' then raise exception 'Scoped source is unavailable';end if;
 scoped_sha:=encode(sha256(convert_to(prior_rows::text,'UTF8')),'hex');
 -- A drastically shortened export is not silently assumed complete.
 if n*2<jsonb_array_length(prior_rows) then raise exception 'CSV removes more than half of inventory; complete-file review required' using errcode='22023';end if;
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
       or old_row->'sourceAddress' is distinct from row_data->'sourceAddress'
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

 -- Retain actual saved tracker observations, never claim Google has already accepted this CSV.
 -- Absent/currently held Product IDs cannot continue through a stale tracker-side binding.
 for old_tracker in select value from jsonb_array_elements(coalesce(old_batch.receipt->'trackerRecords','[]'::jsonb)) loop
  select value into old_row from jsonb_array_elements(adjusted) value where value->>'productId'=old_tracker->>'matchedProductId';
  if old_row is null then
   tracker_rows:=tracker_rows||jsonb_build_array(old_tracker||jsonb_build_object('matchedProductId',null,'binding',jsonb_build_object('state','held','unitIds','[]'::jsonb,'unitLabels','{}'::jsonb,'guardCurrent',false)));
  elsif old_row->>'placementHeld'='true' or (old_tracker->'binding'->>'state'='linked' and old_tracker->'binding'->>'expectedGuard' is distinct from cos_mhelp_placement_private.upload_binding_guard((old_tracker->'binding'->>'trackerId')::uuid,(old_tracker->'binding'->>'nativeUnitId')::uuid)) then
   tracker_rows:=tracker_rows||jsonb_build_array(old_tracker||jsonb_build_object('binding',jsonb_build_object('state','held','unitIds','[]'::jsonb,'unitLabels','{}'::jsonb,'guardCurrent',false)));
  else tracker_rows:=tracker_rows||jsonb_build_array(old_tracker);end if;
 end loop;
 select coalesce(jsonb_agg(distinct r->>'customerId'),'[]'::jsonb) into company_ids from jsonb_array_elements(adjusted) r where r->>'placement'='SHOP';
 receipt:=(old_batch.receipt-array['receivedMessageId','authorizationSha256','sourceSha256','filename','receivedAt','receivedAtPrecision','exportAsOf','recordCount','libraryFileId','companyCustomerIds','trackerRecords','origin','apiSync','apiMissingRecords','portalId','complete','sourceEvidence'])||jsonb_build_object(
  'contract','COS_MHELP_UPLOAD_V1','reviewed',true,'sourceSha256',p_source_sha256,'filename',p_filename,
  'receivedAt',to_char(received at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'receivedAtPrecision','second','exportAsOf',null,'recordCount',n,
  'authorizationSha256',encode(sha256(convert_to(p_actor_user_id::text||':'||p_request_id::text||':'||p_source_sha256||':'||prior_sha,'UTF8')),'hex'),
  'sourceEvidence',jsonb_build_object('contract','COS_PRIVATE_CSV_BYTES_V2','stageId',p_request_id,'sha256',p_source_sha256,'byteLength',octet_length(bytes)),
  'companyCustomerIds',company_ids,'trackerRecords',tracker_rows,'trackerSynchronization','pending_verified_publish');
 select coalesce(jsonb_agg(jsonb_build_object('productId',coalesce(r->>'productId',o->>'productId'),'unitNumber',coalesce(r->>'unitNumber',o->>'unitNumber'),
  'kind',case when r is null then 'removed' when o is null then 'added' when r->>'unitNumber' is distinct from o->>'unitNumber' or r->>'category' is distinct from o->>'category' then 'identity_review' when r->>'placement' is distinct from o->>'placement' then 'moved' else 'changed' end,
  'previousPlacement',o->>'placement','placement',r->>'placement','customerChanged',r->>'customerId' is distinct from o->>'customerId',
  'addressChanged',r->'sourceAddress' is distinct from o->'sourceAddress','identityHeld',r->>'placementHeld'='true') order by coalesce(r->>'productId',o->>'productId')),'[]'::jsonb) into changes
 from jsonb_array_elements(adjusted) r full join jsonb_array_elements(prior_rows) o on r->>'productId'=o->>'productId'
 where r is null or o is null or (r-array['binding','sourceRow','placementHeld','holdReason']) is distinct from (o-array['binding','sourceRow','placementHeld','holdReason','sourceDates','apiAssignment','addressReview','scopedAuthority','sourceLabelAuthority']);
 report:=jsonb_build_object('contract','COS_FLEET_CSV_STAGE_V2','stageId',p_request_id,'sourceSha256',p_source_sha256,'previousSourceSha256',prior_sha,
  'records',n,'field',(select count(*) from jsonb_array_elements(adjusted) r where r->>'placement'='FIELD'),
  'shop',(select count(*) from jsonb_array_elements(adjusted) r where r->>'placement'='SHOP'),
  'changes',changes,'applied',false,'trackerState','pending','expiresAt',received+interval '1 hour');
 insert into cos_fleet_import_private.stages(id,actor_id,organization_id,filename,source_sha,expected_source,scoped_sha,source_bytes,records,receipt,report,expires_at)
 values(p_request_id,p_actor_user_id,p_organization_id,p_filename,p_source_sha256,prior_sha,scoped_sha,bytes,adjusted,receipt,report,received+interval '1 hour');
 receipt_review:=cos_mhelp_placement_private.review_upload(receipt,adjusted,prior_sha,false);
 if receipt_review->>'sourceSha256'<>p_source_sha256 or (receipt_review->>'records')::integer<>n then raise exception 'Complete source validation failed';end if;
 report:=report||jsonb_build_object('identityHeld',(select count(*) from jsonb_array_elements(adjusted) r where r->>'placementHeld'='true'),'validated',true);
 update cos_fleet_import_private.stages set report=stage_v2.report where id=p_request_id;
 return report;
end $fn$;

create function public.cos_fleet_csv_commit_v2(p_actor_user_id uuid,p_organization_id uuid,p_stage_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare s cos_fleet_import_private.stages;current_sha text;result jsonb;scope_sha text;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.manage') then raise exception 'Owner equipment authorization required' using errcode='42501';end if;
 select active_sha256 into strict current_sha from cos_mhelp_placement_private.upload_control where singleton for update;
 select * into strict s from cos_fleet_import_private.stages where id=p_stage_id and actor_id=p_actor_user_id and organization_id=p_organization_id for update;
 if s.committed_at is not null then return s.applied||jsonb_build_object('idempotent',true);end if;
 if s.expires_at<clock_timestamp() or current_sha<>s.expected_source or not cos_fleet_import_private.valid_provenance(s.receipt) then raise exception 'Staged source is stale or changed' using errcode='40001';end if;
 scope_sha:=encode(sha256(convert_to(cos_mhelp_placement_private.scoped_records(s.expected_source)::text,'UTF8')),'hex');
 if scope_sha<>s.scoped_sha then raise exception 'A newer authorized source edit must not be overwritten' using errcode='40001';end if;
 result:=cos_mhelp_placement_private.review_upload(s.receipt,s.records,s.expected_source,true);
 if result->>'applied'<>'true' or result->>'sourceSha256'<>s.source_sha or (result->>'records')::integer<>jsonb_array_length(s.records) then raise exception 'CSV source commit not verified';end if;
 result:=s.report||result||jsonb_build_object('contract','COS_FLEET_CSV_COMMIT_V2','applied',true,'committedAt',clock_timestamp(),'trackerState','pending_verified_publish');
 update cos_fleet_import_private.stages set committed_at=clock_timestamp(),applied=result where id=s.id;
 return result;
end $fn$;
revoke all on function public.cos_fleet_csv_stage_v2(uuid,uuid,uuid,text,text,text,text,jsonb),public.cos_fleet_csv_commit_v2(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cos_fleet_csv_stage_v2(uuid,uuid,uuid,text,text,text,text,jsonb),public.cos_fleet_csv_commit_v2(uuid,uuid,uuid) to service_role;
