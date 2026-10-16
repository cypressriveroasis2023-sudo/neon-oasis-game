-- Reviewed deployment candidate. Install after mhelp_upload_overlay.sql and
-- owner_identity_crosswalk.sql. No operational table, grant or base receipt changes.
create table cos_mhelp_placement_private.scoped_batches(
 id uuid primary key, base_sha256 text not null references cos_mhelp_placement_private.upload_batches,
 previous_id uuid references cos_mhelp_placement_private.scoped_batches,
 organization_id uuid not null, actor_id uuid not null, request jsonb not null,
 records jsonb not null, admitted_at timestamptz not null default clock_timestamp()
);
create table cos_mhelp_placement_private.scoped_control(
 base_sha256 text primary key references cos_mhelp_placement_private.upload_batches,
 revision bigint not null default 0, active_id uuid references cos_mhelp_placement_private.scoped_batches
);
create table cos_mhelp_placement_private.scoped_audit(
 id bigint generated always as identity primary key, base_sha256 text not null,
 revision bigint not null, action text not null check(action in ('apply','rollback')),
 previous_id uuid, active_id uuid, actor_id uuid not null, organization_id uuid not null,
 authorization_sha256 text not null, at timestamptz not null default clock_timestamp()
);
alter table cos_mhelp_placement_private.scoped_batches enable row level security;
alter table cos_mhelp_placement_private.scoped_control enable row level security;
alter table cos_mhelp_placement_private.scoped_audit enable row level security;
revoke all on cos_mhelp_placement_private.scoped_batches,cos_mhelp_placement_private.scoped_control,cos_mhelp_placement_private.scoped_audit from public,anon,authenticated,service_role;
create function cos_mhelp_placement_private.scoped_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Scoped evidence is append-only'; end $$;
create trigger scoped_batches_immutable before update or delete or truncate on cos_mhelp_placement_private.scoped_batches for each statement execute function cos_mhelp_placement_private.scoped_immutable();
create trigger scoped_audit_immutable before update or delete or truncate on cos_mhelp_placement_private.scoped_audit for each statement execute function cos_mhelp_placement_private.scoped_immutable();

create function cos_mhelp_placement_private.scoped_records(p_base text) returns jsonb language sql stable set search_path='' as $$
 select coalesce(s.records,b.records) from cos_mhelp_placement_private.upload_batches b
 left join cos_mhelp_placement_private.scoped_control c on c.base_sha256=b.source_sha256
 left join cos_mhelp_placement_private.scoped_batches s on s.id=c.active_id and s.base_sha256=b.source_sha256
 where b.source_sha256=p_base
$$;

-- Admin transport plus existing Owner actor/tenant authorization. No new RPC grant.
create function cos_mhelp_placement_private.review_scoped_inventory(p_actor uuid,p_org uuid,p_base text,p_revision bigint,p_request_id uuid,p_evidence jsonb,p_operations jsonb,p_apply boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare current_base text; head uuid; rev bigint; request jsonb; prior cos_mhelp_placement_private.scoped_batches;
 records jsonb; op jsonb; old jsonb; target jsonb; next_row jsonb; binding jsonb; seen text[]:='{}';
 old_id text; new_id text; observed timestamptz; base_receipt jsonb; n integer:=0;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Administrator review required' using errcode='42501'; end if;
 perform app_private.cos_owner_identity_assert_actor(p_actor,p_org,true);
 if p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or p_actor is null then raise exception 'Invalid tenant or actor' using errcode='42501'; end if;
 if p_request_id is null or p_apply is null or p_revision is null or p_revision<0
  or coalesce(p_base,'')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_operations) is distinct from 'array' or jsonb_array_length(p_operations) not between 1 and 1000
  or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence->>'kind' is distinct from 'derived_mapping'
  or coalesce(p_evidence->>'libraryFileId','')!~'^libfile_[a-zA-Z0-9]+$' or coalesce(p_evidence->>'sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_evidence->>'authorizationSha256','')!~'^[a-f0-9]{64}$' or coalesce(p_evidence->>'receivedAt','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$'
  or p_evidence-array['kind','libraryFileId','sha256','authorizationSha256','receivedAt']<>'{}'::jsonb then raise exception 'Invalid scoped review'; end if;
 observed:=(p_evidence->>'receivedAt')::timestamptz;
 if observed>clock_timestamp() then raise exception 'Future source evidence'; end if;
 select active_sha256 into strict current_base from cos_mhelp_placement_private.upload_control where singleton for update;
 if current_base is distinct from p_base then raise exception 'Base upload changed' using errcode='40001'; end if;
 select receipt into strict base_receipt from cos_mhelp_placement_private.upload_batches where source_sha256=p_base;
 if observed<(base_receipt->>'receivedAt')::timestamptz then raise exception 'Older source evidence'; end if;
 select active_id,revision into head,rev from cos_mhelp_placement_private.scoped_control where base_sha256=p_base for update;
 rev:=coalesce(rev,0);
 request:=jsonb_build_object('actor',p_actor,'organization',p_org,'base',p_base,'revision',p_revision,'evidence',p_evidence,'operations',p_operations);
 select * into prior from cos_mhelp_placement_private.scoped_batches where id=p_request_id;
 if found then
  if prior.request is distinct from request or head is distinct from p_request_id then raise exception 'Request identity reused or head changed' using errcode='40001'; end if;
  return jsonb_build_object('applied',p_apply,'idempotent',true,'revision',rev,'activeId',head);
 end if;
 if rev<>p_revision then raise exception 'Scoped revision changed' using errcode='40001'; end if;
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,
  public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations,cos_mhelp_placement_private.links in share mode nowait;
 records:=cos_mhelp_placement_private.scoped_records(p_base);
 for op in select value from jsonb_array_elements(p_operations) loop
  if jsonb_typeof(op) is distinct from 'object' or op-array['expectedRecord','after','mode','inventoryOnlyReason']<>'{}'::jsonb
   or coalesce(op->>'mode','') not in ('assignment','replace_source_hold') then raise exception 'Invalid operation'; end if;
  if op ? 'inventoryOnlyReason' and (op->>'inventoryOnlyReason' is distinct from 'no_sim' or op->>'mode'<>'replace_source_hold' or op->'after'->>'placement' is distinct from 'SHOP') then raise exception 'Invalid inventory-only restriction'; end if;
  old_id:=op->'expectedRecord'->>'productId'; target:=op->'after'; new_id:=target->>'productId';
  select value into old from jsonb_array_elements(records) where value->>'productId'=old_id;
  if old is null or old is distinct from op->'expectedRecord' or old_id=any(seen) then raise exception 'Source record changed or duplicated' using errcode='40001'; end if;
  seen:=array_append(seen,old_id);
  if old->>'category' not in ('Sniper','Sniper ES','Sniper 2','Sniper 2 SA','Sniper 4','Radar - Sniper','Thermal - Sniper','CAM-V')
   or jsonb_typeof(target) is distinct from 'object' or target-array['productId','unitNumber','category','customerId','customer','placement','lifecycle']<>'{}'::jsonb
   or exists(select 1 from unnest(array['productId','unitNumber','category','customerId','customer','placement','lifecycle']) k where jsonb_typeof(target->k) is distinct from 'string')
   or target->>'unitNumber' is distinct from old->>'unitNumber' or target->>'category' is distinct from old->>'category'
   or target->>'lifecycle' is distinct from old->>'lifecycle' or coalesce(new_id,'')!~'^[1-9][0-9]{0,14}$'
   or coalesce(target->>'customerId','')!~'^[1-9][0-9]{0,14}$' or length(coalesce(target->>'customer','')) not between 1 and 250
   or target->>'customer'~'[[:cntrl:]<>]' or coalesce(target->>'placement','') not in ('FIELD','SHOP')
   or (target->>'placement'='SHOP') is distinct from ((base_receipt->'companyCustomerIds') ? (target->>'customerId')) then raise exception 'Invalid scoped assignment or restriction change'; end if;
  if old->'scopedAuthority' is not null and observed<(old->'scopedAuthority'->>'receivedAt')::timestamptz then raise exception 'Older scoped evidence'; end if;
  if old->>'inventoryOnlyReason'='no_sim' and target->>'placement'<>'SHOP' then raise exception 'Inventory-only connection restriction cannot be relaxed'; end if;
  binding:=old->'binding';
  if binding is not null and binding<>'null'::jsonb then
   if binding->>'expectedGuard' is distinct from cos_mhelp_placement_private.upload_binding_guard((binding->>'trackerId')::uuid,(binding->>'nativeUnitId')::uuid) then raise exception 'Identity graph changed' using errcode='40001'; end if;
   if binding->>'trackerId' is not null and not exists(select 1 from app_private.vision_tracker_locations t where t.id=(binding->>'trackerId')::uuid and t.organization_id=p_org and t.unit_number=binding->>'trackerLabel') then raise exception 'Tracker tenant or label changed'; end if;
   if binding->>'nativeUnitId' is not null and not exists(select 1 from public.equipment_units u where u.id=(binding->>'nativeUnitId')::uuid and u.organization_id=p_org and u.unit_number=binding->>'nativeLabel' and u.status not in ('deleted','retired')) then raise exception 'Native tenant, label or activation restriction changed'; end if;
   if exists(select 1 from app_private.cos_geocode_sources s where s.active and (s.tracker_id=(binding->>'trackerId')::uuid or s.native_unit_id=(binding->>'nativeUnitId')::uuid) and s.product_id is distinct from old_id) then raise exception 'Competing ProductId'; end if;
  end if;
  next_row:=old||target||jsonb_build_object('scopedAuthority',jsonb_build_object('contract','COS_SCOPED_INVENTORY_AUTHORITY_V1','revisionId',p_request_id,'receivedAt',p_evidence->>'receivedAt','evidenceSha256',p_evidence->>'sha256','evidenceKind','derived_mapping'));
  -- The old customer address is no longer evidence for this assignment. Never
  -- copy a customer postal address into the installation/GPS tables.
  if target->>'customerId' is distinct from old->>'customerId' or target->>'customer' is distinct from old->>'customer' then next_row:=next_row||jsonb_build_object('sourceAddress','{}'::jsonb); end if;
  if op->>'mode'='assignment' then
   if new_id<>old_id then raise exception 'Assignment cannot change ProductId'; end if;
  else
   if old ? 'supersedesProductId' then raise exception 'Previously replaced source requires separate identity review'; end if;
   if new_id=old_id or new_id=any(seen) or exists(select 1 from jsonb_array_elements(records) r where r->>'productId'=new_id)
    or exists(select 1 from cos_mhelp_placement_private.links where equipment_id=new_id)
    or exists(select 1 from app_private.cos_geocode_sources where active and product_id=new_id) then raise exception 'Replacement ProductId collision'; end if;
   seen:=array_append(seen,new_id);
   next_row:=next_row||jsonb_build_object('binding',null,'placementHeld',true,'holdReason','source_product_replaced_identity_unverified','supersedesProductId',old_id,
    'possibleAliasUnitIds',(select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(coalesce(old->'possibleAliasUnitIds','[]'::jsonb)||coalesce(binding->'representedUnitIds','[]'::jsonb)) x));
   if op->>'inventoryOnlyReason'='no_sim' then next_row:=next_row||jsonb_build_object('inventoryOnlyReason','no_sim','holdReason','inventory_only_no_sim_no_current_ip'); end if;
  end if;
  select jsonb_agg(case when value->>'productId'=old_id then next_row else value end order by ordinality) into records from jsonb_array_elements(records) with ordinality;
  n:=n+1;
 end loop;
 if p_apply then
  insert into cos_mhelp_placement_private.scoped_batches values(p_request_id,p_base,head,p_org,p_actor,request,records,clock_timestamp());
  insert into cos_mhelp_placement_private.scoped_control values(p_base,rev+1,p_request_id) on conflict(base_sha256) do update set revision=excluded.revision,active_id=excluded.active_id;
  insert into cos_mhelp_placement_private.scoped_audit(base_sha256,revision,action,previous_id,active_id,actor_id,organization_id,authorization_sha256) values(p_base,rev+1,'apply',head,p_request_id,p_actor,p_org,p_evidence->>'authorizationSha256');
 end if;
 return jsonb_build_object('applied',p_apply,'idempotent',false,'operations',n,'revision',case when p_apply then rev+1 else rev end,'activeId',case when p_apply then p_request_id else head end);
end $$;

create function cos_mhelp_placement_private.rollback_scoped_inventory(p_actor uuid,p_org uuid,p_base text,p_revision bigint,p_expected_id uuid,p_authorization text) returns jsonb
language plpgsql set search_path='' as $$
declare current_base text; c cos_mhelp_placement_private.scoped_control; b cos_mhelp_placement_private.scoped_batches;
begin
 if current_user not in ('postgres','supabase_admin') then raise exception 'Administrator review required' using errcode='42501'; end if;
 perform app_private.cos_owner_identity_assert_actor(p_actor,p_org,true);
 if p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or p_actor is null or coalesce(p_authorization,'')!~'^[a-f0-9]{64}$' or p_expected_id is null then raise exception 'Invalid rollback authorization'; end if;
 select active_sha256 into strict current_base from cos_mhelp_placement_private.upload_control where singleton for update;
 select * into c from cos_mhelp_placement_private.scoped_control where base_sha256=p_base for update;
 if current_base is distinct from p_base or c.revision is distinct from p_revision or c.active_id is distinct from p_expected_id then raise exception 'Scoped rollback head changed' using errcode='40001'; end if;
 select * into strict b from cos_mhelp_placement_private.scoped_batches where id=c.active_id and organization_id=p_org;
 update cos_mhelp_placement_private.scoped_control set active_id=b.previous_id,revision=c.revision+1 where base_sha256=p_base;
 insert into cos_mhelp_placement_private.scoped_audit(base_sha256,revision,action,previous_id,active_id,actor_id,organization_id,authorization_sha256) values(p_base,c.revision+1,'rollback',c.active_id,b.previous_id,p_actor,p_org,p_authorization);
 return jsonb_build_object('rolledBack',true,'revision',c.revision+1,'activeId',b.previous_id);
end $$;

-- Existing authorized RPC still owns actor/tenant checks. No exposed function
-- or ACL changes. Retain the global receipt and recheck bindings on every read.
create or replace function cos_mhelp_placement_private.upload_snapshot() returns jsonb language sql stable set search_path='' as $$
 with active as materialized (
  select b.*,cos_mhelp_placement_private.scoped_records(b.source_sha256) scoped_records,coalesce(c.revision,0) scoped_revision
  from cos_mhelp_placement_private.upload_control u join cos_mhelp_placement_private.upload_batches b on b.source_sha256=u.active_sha256
  left join cos_mhelp_placement_private.scoped_control c on c.base_sha256=b.source_sha256 where u.singleton
 )
 select (b.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object(
 'trackerRecords',cos_mhelp_placement_private.upload_tracker_snapshot((select coalesce(jsonb_agg(case when replacement is null then t else t||jsonb_build_object('matchedProductId',replacement->>'productId','binding',(t->'binding')||jsonb_build_object('state','held','placementHeld',true)) end),'[]'::jsonb)
  from jsonb_array_elements(coalesce(b.receipt->'trackerRecords','[]'::jsonb)) t left join lateral (select r replacement from jsonb_array_elements(b.scoped_records) r where r->>'supersedesProductId'=t->>'matchedProductId') x on true)),
 'reviewed',true,'payloadSha256',b.payload_sha256,'scopedRevision',b.scoped_revision,'records',(
 select jsonb_agg((r-'binding')||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
 ((r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid)) end) order by (r->>'sourceRow')::integer)
 from jsonb_array_elements(b.scoped_records) r)) from active b
$$;
revoke all on function cos_mhelp_placement_private.scoped_immutable(),cos_mhelp_placement_private.scoped_records(text),cos_mhelp_placement_private.review_scoped_inventory(uuid,uuid,text,bigint,uuid,jsonb,jsonb,boolean),cos_mhelp_placement_private.rollback_scoped_inventory(uuid,uuid,text,bigint,uuid,text) from public,anon,authenticated,service_role;
