-- Reviewed deployment candidate only. No API leases, provider timestamps, source
-- records, native inventory, GPS, location history, credentials or grants change.
-- Private functions use the existing administrator role; the read payload is
-- added to the already authorized equipment-view RPC with its ACL preserved.
create table cos_mhelp_placement_private.upload_batches(
 source_sha256 text primary key check(source_sha256~'^[a-f0-9]{64}$'),
 payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),
 receipt jsonb not null,records jsonb not null,admitted_at timestamptz not null default clock_timestamp()
);
create table cos_mhelp_placement_private.upload_control(
 singleton boolean primary key default true check(singleton),active_sha256 text references cos_mhelp_placement_private.upload_batches
);
create table cos_mhelp_placement_private.upload_audit(
 id bigint generated always as identity primary key,action text not null check(action in('activate','rollback')),
 source_sha256 text,previous_sha256 text,authorization_sha256 text not null,at timestamptz not null default clock_timestamp()
);
alter table cos_mhelp_placement_private.upload_batches enable row level security;
alter table cos_mhelp_placement_private.upload_control enable row level security;
alter table cos_mhelp_placement_private.upload_audit enable row level security;
revoke all on cos_mhelp_placement_private.upload_batches,cos_mhelp_placement_private.upload_control,cos_mhelp_placement_private.upload_audit from public,anon,authenticated,service_role;
insert into cos_mhelp_placement_private.upload_control(singleton) values(true);

-- Full authority-graph digest is deliberately stricter than label matching.
-- Any later inventory/source/archive/history change requires fresh review.
create function cos_mhelp_placement_private.upload_binding_guard(p_tracker uuid,p_native uuid) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
  'tracker',(select to_jsonb(t) from app_private.vision_tracker_locations t where t.id=p_tracker),
  'native',(select to_jsonb(u) from public.equipment_units u where u.id=p_native),
  'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]'::jsonb) from app_private.cos_geocode_sources s where s.tracker_id=p_tracker or s.native_unit_id=p_native),
  'archives',(select coalesce(jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text),'[]'::jsonb) from app_private.cos_archived_representations a where p_tracker in(a.archived_tracker_id,a.canonical_tracker_id) or p_native in(a.archived_native_id,a.canonical_native_id)),
  'nativeHistory',(select coalesce(jsonb_agg(to_jsonb(h) order by to_jsonb(h)::text),'[]'::jsonb) from public.equipment_unit_location_history h where h.equipment_unit_id=p_native),
  'ownerClaims',(select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from app_private.cos_owner_identity_claims c where c.native_unit_id=p_native)
 )::text,'UTF8')),'hex')
$$;

create function cos_mhelp_placement_private.review_upload(p_receipt jsonb,p_records jsonb,p_expected_active_sha256 text,p_apply boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb;b jsonb;seen text[]:='{}';targets text[]:='{}';target text;current_sha text;payload_sha text;sha text:=p_receipt->>'sourceSha256';
 n integer:=0;bound integer:=0;fields integer:=0;shops integer:=0;tracker_seen text[]:='{}';tracker_targets text[]:='{}';existing cos_mhelp_placement_private.upload_batches;
begin
 if current_user not in('postgres','supabase_admin') then raise exception 'Administrator review required' using errcode='42501';end if;
 if p_apply is null or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)<1 or jsonb_array_length(p_records)>10000
  or coalesce(p_receipt->>'contract','')<>'COS_MHELP_UPLOAD_V1' or coalesce(sha,'')!~'^[a-f0-9]{64}$'
  or coalesce(p_receipt->>'authorizationSha256','')!~'^[a-f0-9]{64}$' or coalesce(p_receipt->>'libraryFileId','')!~'^libfile_[a-zA-Z0-9]+$'
  or coalesce(p_receipt->>'receivedAtPrecision','') not in('minute','second') or coalesce(p_receipt->>'receivedAt','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (p_receipt->>'receivedAt')::timestamptz>clock_timestamp() or p_receipt->'exportAsOf' is distinct from 'null'::jsonb
  or jsonb_typeof(p_receipt->'companyCustomerIds') is distinct from 'array' or jsonb_array_length(p_receipt->'companyCustomerIds')<1
  or coalesce(p_receipt->>'receivedMessageId','')='' then raise exception 'Invalid upload receipt';end if;
 select active_sha256 into strict current_sha from cos_mhelp_placement_private.upload_control where singleton for update;
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,
  public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations in share mode nowait;
 payload_sha:=encode(sha256(convert_to(jsonb_build_object('receipt',p_receipt,'records',p_records)::text,'UTF8')),'hex');
 select * into existing from cos_mhelp_placement_private.upload_batches where source_sha256=sha;
 if found then
  if existing.payload_sha256 is distinct from payload_sha then raise exception 'Source hash already has different reviewed content' using errcode='40001';end if;
  if current_sha=sha then return jsonb_build_object('applied',p_apply,'idempotent',true,'sourceSha256',sha,'payloadSha256',payload_sha,'records',jsonb_array_length(p_records));end if;
 end if;
 if current_sha is distinct from p_expected_active_sha256 then raise exception 'Active upload changed since review' using errcode='40001';end if;
 for r in select value from jsonb_array_elements(p_records) loop
  if jsonb_typeof(r) is distinct from 'object' or coalesce(r->>'productId','')!~'^[1-9][0-9]{0,14}$' or r->>'productId'=any(seen)
   or coalesce(r->>'customerId','')!~'^[1-9][0-9]{0,14}$' or coalesce(r->>'unitNumber','')='' or length(r->>'unitNumber')>250
   or coalesce(r->>'customer','')='' or length(r->>'customer')>250 or ((r->>'unitNumber')||(r->>'customer'))~'[[:cntrl:]<>]'
   or coalesce(r->>'placement','') not in('SHOP','FIELD') or coalesce(r->>'lifecycle','') not in('UNFLAGGED','DO_NOT_USE','MISSING')
   or jsonb_typeof(r->'sourceAddress') is distinct from 'object' or (r->>'sourceRow')::integer<2
   or (r->>'placement'='SHOP') is distinct from ((p_receipt->'companyCustomerIds') ? (r->>'customerId')) then raise exception 'Invalid complete upload source record';end if;
  if (r-array['productId','unitNumber','category','customerId','customer','sourceAddress','sourceRow','placement','lifecycle','sourceDates','binding','holdReason','possibleAliasUnitIds','placementHeld','displayUnitNumber','displayAuthorizationSha256'])<>'{}'::jsonb then raise exception 'Unexpected source fields';end if;
  if r->>'displayUnitNumber' is not null and (coalesce(r->>'displayUnitNumber','')='' or length(r->>'displayUnitNumber')>250 or coalesce(r->>'displayAuthorizationSha256','')!~'^[a-f0-9]{64}$') then raise exception 'Approved display alias evidence required';end if;
  seen:=array_append(seen,r->>'productId');n:=n+1;
  if r->>'placement'='FIELD' then fields:=fields+1;else shops:=shops+1;end if;
  b:=r->'binding';
  if b is not null and b<>'null'::jsonb then
   if coalesce(b->>'productId','') is distinct from r->>'productId' or b->>'fullLabel' is distinct from r->>'unitNumber'
    or coalesce(b->>'matchMethod','') not in('reviewed_product_id','exact_family_unit','archived_alias','owner_confirmed_alias')
    or coalesce(b->>'evidenceSha256','')!~'^[a-f0-9]{64}$' or coalesce(b->>'expectedGuard','')!~'^[a-f0-9]{64}$'
    or (b->>'trackerId' is null and b->>'nativeUnitId' is null)
    or jsonb_typeof(b->'representedUnitIds') is distinct from 'array' or jsonb_array_length(b->'representedUnitIds')<1
    or coalesce(b->>'representationEvidenceSha256','')!~'^[a-f0-9]{64}$' then raise exception 'Invalid reviewed upload binding';end if;
   if exists(select 1 from jsonb_array_elements_text(b->'representedUnitIds') v where v not in(coalesce(b->>'trackerId',''),coalesce(b->>'nativeUnitId','')))
    or (select count(*) from jsonb_array_elements_text(b->'representedUnitIds'))<>(select count(distinct v) from jsonb_array_elements_text(b->'representedUnitIds') v) then raise exception 'Invalid represented inventory membership';end if;
   if b->>'expectedGuard' is distinct from cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid) then raise exception 'Upload identity graph changed' using errcode='40001';end if;
   if b->>'trackerId' is not null and not exists(select 1 from app_private.vision_tracker_locations t where t.id=(b->>'trackerId')::uuid and t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and t.unit_number=b->>'trackerLabel') then raise exception 'Upload tracker identity changed';end if;
   if b->>'nativeUnitId' is not null and not exists(select 1 from public.equipment_units u where u.id=(b->>'nativeUnitId')::uuid and u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and u.unit_number=b->>'nativeLabel') then raise exception 'Upload native identity changed';end if;
   if b->>'matchMethod'='reviewed_product_id' and not exists(select 1 from cos_mhelp_placement_private.links l where l.equipment_id=r->>'productId' and l.tracker_id=(b->>'trackerId')::uuid and l.native_unit_id is not distinct from (b->>'nativeUnitId')::uuid and l.full_label=r->>'unitNumber') then raise exception 'Existing ProductId binding unavailable';end if;
   if b->'previousAssignment' is not null and b->'previousAssignment'<>'null'::jsonb and not exists(select 1 from cos_mhelp_placement_private.links l where l.equipment_id=r->>'productId'
    and b->'previousAssignment'->>'productId'=l.equipment_id and l.observation->>'state'='confirmed'
    and l.observation->>'customerId'=b->'previousAssignment'->>'customerId' and l.observation->>'placement'=b->'previousAssignment'->>'placement'
    and l.observation->>'serviceLocationId' is not distinct from b->'previousAssignment'->>'serviceLocationId'
    and l.observed_at=(b->'previousAssignment'->>'observedAt')::timestamptz) then raise exception 'Previous assignment evidence changed' using errcode='40001';end if;
   if b->>'matchMethod'='owner_confirmed_alias' and (b->'reviewEvidence'->>'contract' is distinct from 'COS_OWNER_CONFIRMED_ALIAS_V1' or b->'reviewEvidence'->>'productId' is distinct from r->>'productId' or b->'reviewEvidence'->>'sourceLabel' is distinct from r->>'unitNumber' or coalesce(b->'reviewEvidence'->'approval'->>'messageId','')='' or coalesce(b->'reviewEvidence'->'approval'->>'ownerQuote','')='') then raise exception 'Owner alias approval required';end if;
   if b->>'matchMethod'<>'reviewed_product_id' and (coalesce(b->>'canonicalKey','')='' or jsonb_typeof(b->'reviewEvidence') is distinct from 'object') then raise exception 'Canonical identity evidence required';end if;
   if exists(select 1 from app_private.cos_geocode_sources s where s.active and (s.tracker_id=(b->>'trackerId')::uuid or s.native_unit_id=(b->>'nativeUnitId')::uuid) and s.product_id is distinct from r->>'productId') then raise exception 'Competing ProductId source identity';end if;
   foreach target in array array[b->>'trackerId',b->>'nativeUnitId'] loop
    if target is not null then if target=any(targets) then raise exception 'Multiple source records claim one inventory target';end if;targets:=array_append(targets,target);end if;
   end loop;
   bound:=bound+1;
  end if;
 end loop;
 if n is distinct from (p_receipt->>'recordCount')::integer then raise exception 'Incomplete source file coverage';end if;
 if jsonb_array_length(coalesce(p_receipt->'trackerRecords','[]'::jsonb))>0 then
  if p_receipt->'trackerSource'->>'contract' is distinct from 'COS_CURRENT_TRACKER_CENSUS_V1' or p_receipt->'trackerSource'->>'complete' is distinct from 'true'
   or coalesce(p_receipt->'trackerSource'->>'sourceSha256','')!~'^[a-f0-9]{64}$'
   or (p_receipt->'trackerSource'->>'totalSourceRecords')::integer is distinct from jsonb_array_length(p_receipt->'trackerRecords') then raise exception 'Incomplete current tracker census';end if;
  for r in select value from jsonb_array_elements(p_receipt->'trackerRecords') loop
   b:=r->'binding';
   if coalesce(r->>'recordId','')='' or r->>'recordId'=any(tracker_seen) or coalesce(r->>'unitNumber','')='' or length(r->>'unitNumber')>250
    or coalesce(r->>'placement','') not in('FIELD','SHOP','UNKNOWN') or coalesce(r->>'lifecycle','') not in('ACTIVE','DECOMMISSIONED','RETIRED','MISSING','DO_NOT_USE')
    or coalesce(b->>'state','') not in('linked','held','unlinked') or jsonb_typeof(b->'unitIds') is distinct from 'array'
    or jsonb_typeof(b->'unitLabels') is distinct from 'object' or (r->>'matchedProductId' is not null and not r->>'matchedProductId'=any(seen)) then raise exception 'Invalid tracker source record';end if;
   tracker_seen:=array_append(tracker_seen,r->>'recordId');
   if b->>'state'='linked' then
    if coalesce(b->>'expectedGuard','')!~'^[a-f0-9]{64}$' or b->>'expectedGuard' is distinct from cos_mhelp_placement_private.upload_binding_guard((b->>'trackerId')::uuid,(b->>'nativeUnitId')::uuid)
     or jsonb_typeof(b->'representedUnitIds') is distinct from 'array' or jsonb_array_length(b->'representedUnitIds')<1 then raise exception 'Tracker identity graph changed' using errcode='40001';end if;
    if b->>'trackerId' is not null and not exists(select 1 from app_private.vision_tracker_locations t where t.id=(b->>'trackerId')::uuid and t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and t.unit_number=b->'unitLabels'->>(b->>'trackerId')) then raise exception 'Tracker source label changed';end if;
    if b->>'nativeUnitId' is not null and not exists(select 1 from public.equipment_units u where u.id=(b->>'nativeUnitId')::uuid and u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and u.unit_number=b->'unitLabels'->>(b->>'nativeUnitId')) then raise exception 'Tracker native label changed';end if;
    for target in select jsonb_array_elements_text(b->'unitIds') loop
     if target=any(tracker_targets) or target not in(coalesce(b->>'trackerId',''),coalesce(b->>'nativeUnitId','')) then raise exception 'Conflicting tracker target';end if;
     tracker_targets:=array_append(tracker_targets,target);
    end loop;
    if exists(select 1 from jsonb_array_elements_text(b->'representedUnitIds') v where not (b->'unitIds') ? v) then raise exception 'Invalid tracker visible membership';end if;
   end if;
  end loop;
 end if;

 if p_apply then
  insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values(sha,payload_sha,p_receipt,p_records) on conflict(source_sha256) do nothing;
  update cos_mhelp_placement_private.upload_control set active_sha256=sha where singleton;
  insert into cos_mhelp_placement_private.upload_audit(action,source_sha256,previous_sha256,authorization_sha256) values('activate',sha,current_sha,p_receipt->>'authorizationSha256');
 end if;
 return jsonb_build_object('applied',p_apply,'idempotent',false,'sourceSha256',sha,'payloadSha256',payload_sha,'previousSourceSha256',current_sha,'records',n,'boundRecords',bound,'unboundRecords',n-bound,'recordedField',fields,'recordedShop',shops);
end $$;

create function cos_mhelp_placement_private.rollback_upload(p_expected_active_sha256 text,p_previous_sha256 text,p_authorization_sha256 text) returns jsonb
language plpgsql set search_path='' as $$
declare current_sha text;last_change cos_mhelp_placement_private.upload_audit;
begin
 if current_user not in('postgres','supabase_admin') then raise exception 'Administrator review required' using errcode='42501';end if;
 if coalesce(p_authorization_sha256,'')!~'^[a-f0-9]{64}$' then raise exception 'Rollback authorization required';end if;
 select active_sha256 into strict current_sha from cos_mhelp_placement_private.upload_control where singleton for update;
 select * into last_change from cos_mhelp_placement_private.upload_audit order by id desc limit 1;
 if current_sha is distinct from p_expected_active_sha256 or last_change.action is distinct from 'activate' or last_change.source_sha256 is distinct from p_expected_active_sha256 or last_change.previous_sha256 is distinct from p_previous_sha256 then raise exception 'Rollback head changed' using errcode='40001';end if;
 update cos_mhelp_placement_private.upload_control set active_sha256=p_previous_sha256 where singleton;
 insert into cos_mhelp_placement_private.upload_audit(action,source_sha256,previous_sha256,authorization_sha256) values('rollback',p_previous_sha256,current_sha,p_authorization_sha256);
 return jsonb_build_object('rolledBack',true,'activeSourceSha256',p_previous_sha256,'retainedSourceSha256',current_sha);
end $$;

create function cos_mhelp_placement_private.upload_tracker_snapshot(p_records jsonb) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg((r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object('binding',((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',
  coalesce(r->'binding'->>'state'='linked' and r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid),false))) order by r->>'recordId'),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_records,'[]'::jsonb)) r
$$;

create function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql stable set search_path='' as $$
 select (b.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object('trackerRecords',cos_mhelp_placement_private.upload_tracker_snapshot(b.receipt->'trackerRecords'),'reviewed',true,'payloadSha256',b.payload_sha256,'records',(
  select jsonb_agg((r-'binding')||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
    ((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid)) end) order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(b.records) r))
 from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton
$$;
revoke all on function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid),cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean),cos_mhelp_placement_private.rollback_upload(text,text,text),cos_mhelp_placement_private.upload_snapshot(),cos_mhelp_placement_private.upload_tracker_snapshot(jsonb) from public,anon,authenticated,service_role;

-- CREATE OR REPLACE preserves this existing function's ACL and actor gate.
create or replace function public.cos_mhelp_placement_snapshot(p_actor_user_id uuid,p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('trackerId',tracker_id,'nativeUnitId',native_unit_id,'trackerLabel',tracker_label,'nativeLabel',native_label,
  'guardCurrent',cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard,
  'state',case when observation->>'state'='confirmed' and cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard then 'confirmed' else 'held' end,
  'reason',observation->>'reason','placement',observation->>'placement','customerLabel',observation->>'customerLabel','siteLabel',observation->>'siteLabel','observedAt',observed_at,
  'assignmentChanged',(baseline_customer_id is not null and observation->>'customerId' is not null and observation->>'customerId'<>baseline_customer_id) or (baseline_location_id is not null and observation->>'serviceLocationId' is not null and observation->>'serviceLocationId'<>baseline_location_id),
  'locationReview',observation->>'customerId' is distinct from baseline_customer_id or observation->>'serviceLocationId' is distinct from baseline_location_id) order by tracker_id),'[]') into items from cos_mhelp_placement_private.links;
 return public.cos_mhelp_placement_status()||jsonb_build_object('items',items,'upload',cos_mhelp_placement_private.upload_snapshot());
end $$;
