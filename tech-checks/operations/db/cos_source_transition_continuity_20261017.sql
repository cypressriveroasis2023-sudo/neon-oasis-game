-- DRAFT/REVIEW ONLY. Install after repair-owner overlap acknowledgment and PostgreSQL proof.
-- Only three exact approved Solar Spotter candidates; no inventory or GPS writes.
begin;
do $precondition$ begin
 if to_regprocedure('cos_mhelp_placement_private.identity_binding_base_upload_snapshot()') is null
 or to_regprocedure('cos_mhelp_placement_private.continuity_graph(uuid,uuid)') is null
 or to_regprocedure('cos_mhelp_placement_private.upload_snapshot()') is null
 or to_regclass('cos_mhelp_placement_private.source_transition_receipts') is not null then
  raise exception 'Owner continuity prerequisite absent or migration already installed';
 end if;
end $precondition$;
create table cos_mhelp_placement_private.source_transition_receipts (
 request_id uuid primary key,
 active_source_sha256 text not null references cos_mhelp_placement_private.upload_batches(source_sha256),
 active_payload_sha256 text not null check(active_payload_sha256 ~ '^[a-f0-9]{64}$'),
 previous_source_sha256 text not null references cos_mhelp_placement_private.upload_batches(source_sha256),
 product_id text not null check(product_id ~ '^[1-9][0-9]{0,18}$'),
 prior_continuity_id bigint not null references cos_mhelp_placement_private.source_continuity(id),
 current_row_sha256 text not null check(current_row_sha256 ~ '^[a-f0-9]{64}$'),
 previous_row_sha256 text not null check(previous_row_sha256 ~ '^[a-f0-9]{64}$'),
 current_graph_guard text not null check(current_graph_guard ~ '^[a-f0-9]{64}$'),
 reviewed_binding jsonb not null,
 tracker_record_id text not null,
 current_tracker_row_sha256 text not null check(current_tracker_row_sha256 ~ '^[a-f0-9]{64}$'),
 previous_tracker_row_sha256 text not null check(previous_tracker_row_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_tracker_binding jsonb not null,
 actor_user_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(active_source_sha256,product_id)
);
alter table cos_mhelp_placement_private.source_transition_receipts enable row level security;
alter table cos_mhelp_placement_private.source_transition_receipts force row level security;
revoke all on cos_mhelp_placement_private.source_transition_receipts from public,anon,authenticated,service_role;
create trigger source_transition_immutable before update or delete or truncate
 on cos_mhelp_placement_private.source_transition_receipts for each statement
 execute function app_private.cos_owner_identity_immutable();

-- Re-evaluate all source, identity and protected graph evidence for every read.
-- A previous upload alone never authorizes a transition.
create function cos_mhelp_placement_private.source_transition_review(
 p_active text,p_payload text,p_previous text,p_product text)
returns jsonb language plpgsql stable set search_path='' as $$
declare old_row jsonb; new_row jsonb; binding jsonb; receipt cos_mhelp_placement_private.source_continuity;
         old_tracker jsonb; new_tracker jsonb; old_tracker_count integer; new_tracker_count integer;
         source_rows integer; previous_rows integer; source_no text; canonical text; normal_old text; normal_new text;
         active_payload text; new_hash text; old_hash text;
begin
 if p_product not in ('2229349','2258987','2285846') then
  return jsonb_build_object('eligible',false,'reason','separate_identity_review_required');end if;
 select b.payload_sha256 into active_payload from cos_mhelp_placement_private.upload_control c
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  where c.singleton and b.source_sha256=p_active;
 if active_payload is distinct from p_payload or not exists (
  select 1 from cos_mhelp_placement_private.upload_audit a
   where a.action='activate' and a.source_sha256=p_active and a.previous_sha256=p_previous
   and a.id=(select max(id) from cos_mhelp_placement_private.upload_audit)) then
  return jsonb_build_object('eligible',false,'reason','active_source_or_payload_changed');end if;
 select count(*),(jsonb_agg(r)->0) into source_rows,new_row
 from jsonb_array_elements(cos_mhelp_placement_private.scoped_records(p_active)) r
 where r->>'productId'=p_product;
 select count(*),(jsonb_agg(r)->0) into previous_rows,old_row
 from cos_mhelp_placement_private.upload_batches b
 cross join lateral jsonb_array_elements(b.records) r
 where b.source_sha256=p_previous and r->>'productId'=p_product;
 if source_rows<>1 or previous_rows<>1 or new_row->'binding'<>'null'::jsonb
  or new_row->>'placement' is distinct from 'FIELD' or new_row->>'lifecycle' is distinct from 'UNFLAGGED'
  or old_row->>'placement' is distinct from 'FIELD' or old_row->>'lifecycle' is distinct from 'UNFLAGGED'
  or new_row->>'holdReason' is distinct from 'Native identity or location evidence changed; fresh association review required'
  or new_row->>'placementHeld' is distinct from 'true'
  or jsonb_array_length(coalesce(new_row->'possibleAliasUnitIds','[]'::jsonb))<>0
  or old_row->>'placementHeld' is distinct from 'false' or nullif(old_row->>'holdReason','') is not null
  or jsonb_array_length(coalesce(old_row->'possibleAliasUnitIds','[]'::jsonb))<>0 then
  return jsonb_build_object('eligible',false,'reason','review_hold_or_source_identity_mismatch');end if;
 binding:=old_row->'binding';
 if jsonb_typeof(binding) is distinct from 'object' or binding->>'matchMethod' is distinct from 'exact_family_unit'
  or old_row->>'category' is distinct from 'Solar Spotter' or new_row->>'category' is distinct from 'Solar Spotter'
  or old_row->>'customerId' is distinct from new_row->>'customerId'
  or old_row->>'customer' is distinct from new_row->>'customer'
  or old_row->'sourceAddress' is distinct from new_row->'sourceAddress'
  or coalesce(new_row#>>'{sourceAddress,street}','')=''
  or binding->>'productId' is distinct from p_product then
  return jsonb_build_object('eligible',false,'reason','protected_customer_or_service_address_changed');end if;
 normal_old:=upper(btrim(regexp_replace(old_row->>'unitNumber','[[:space:]]+',' ','g')));
 normal_new:=upper(btrim(regexp_replace(new_row->>'unitNumber','[[:space:]]+',' ','g')));
 source_no:=(regexp_match(normal_new,'^SOLAR SPOTTER[[:space:]]+0*([1-9][0-9]*)$'))[1];
 canonical:='SOLAR SPOTTER:'||source_no;
 if normal_old is distinct from normal_new or source_no is null
  or binding->>'canonicalKey' is distinct from canonical
  or upper(btrim(binding->>'nativeLabel')) is distinct from upper(btrim(binding->>'trackerLabel'))
  or upper(btrim(binding->>'nativeLabel')) not like 'SOLAR SPOTTER %HDC2'
  or binding->>'nativeUnitId' is null or binding->>'trackerId' is null
  or jsonb_typeof(binding->'representedUnitIds') is distinct from 'array'
  or jsonb_array_length(binding->'representedUnitIds')<>1
  or (binding->'representedUnitIds'->>0) is distinct from binding->>'nativeUnitId'
  or binding->>'fullLabel' is distinct from old_row->>'unitNumber' then
  return jsonb_build_object('eligible',false,'reason','decimal_variant_or_representation_conflict');end if;
 if not exists(select 1 from public.equipment_units u where u.id=(binding->>'nativeUnitId')::uuid and u.unit_number=binding->>'nativeLabel')
 or not exists(select 1 from app_private.vision_tracker_locations t where t.id=(binding->>'trackerId')::uuid and t.unit_number=binding->>'trackerLabel') then
  return jsonb_build_object('eligible',false,'reason','registry_unit_changed');end if;
 -- Full current-source collision veto, not a family/name-based positive join.
 -- Any other Product ID claiming either physical identity blocks recovery.
 if exists (
  select 1 from jsonb_array_elements(cos_mhelp_placement_private.scoped_records(p_active)) r
  where r->>'productId'<>p_product and
  (r->'binding'->>'nativeUnitId'=binding->>'nativeUnitId'
   or r->'binding'->>'trackerId'=binding->>'trackerId'
   or coalesce(r->'possibleAliasUnitIds','[]'::jsonb) ? (binding->>'nativeUnitId')
   or coalesce(r->'possibleAliasUnitIds','[]'::jsonb) ? (binding->>'trackerId'))
 ) or exists(
  select 1 from cos_mhelp_placement_private.links l where l.equipment_id<>p_product
   and (l.native_unit_id=(binding->>'nativeUnitId')::uuid or l.tracker_id=(binding->>'trackerId')::uuid)
 ) or exists (
  select 1 from app_private.cos_geocode_sources s where s.active and s.product_id is distinct from p_product
   and (s.native_unit_id=(binding->>'nativeUnitId')::uuid or s.tracker_id=(binding->>'trackerId')::uuid)
 ) or exists (
  select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=(binding->>'nativeUnitId')::uuid
 ) then
  return jsonb_build_object('eligible',false,'reason','competing_registry_or_product_identity');end if;
 -- The 2027 tracker is a second independent authority: a recovered Product ID
 -- cannot coexist with the same tracker row still held. Require exact old/new
 -- recordId, family, placement, membership and HDC2 variant continuity.
 select count(*),(jsonb_agg(r)->0) into old_tracker_count,old_tracker
 from cos_mhelp_placement_private.upload_batches b cross join lateral jsonb_array_elements(coalesce(b.receipt->'trackerRecords','[]'::jsonb)) r
 where b.source_sha256=p_previous and r->>'matchedProductId'=p_product;
 select count(*),(jsonb_agg(r)->0) into new_tracker_count,new_tracker
 from cos_mhelp_placement_private.upload_batches b cross join lateral jsonb_array_elements(coalesce(b.receipt->'trackerRecords','[]'::jsonb)) r
 where b.source_sha256=p_active and r->>'matchedProductId'=p_product;
 if old_tracker_count<>1 or new_tracker_count<>1 or new_tracker->>'recordId' is distinct from old_tracker->>'recordId'
  or old_tracker->>'category' is distinct from 'SOLAR SPOTTERS'
  or new_tracker->>'category' is distinct from old_tracker->>'category'
  or old_tracker->>'placement' is distinct from 'FIELD' or new_tracker->>'placement' is distinct from 'FIELD'
  or old_tracker->>'lifecycle' is distinct from 'ACTIVE' or new_tracker->>'lifecycle' is distinct from 'ACTIVE'
  or new_tracker->>'unitNumber' is null
  or upper(btrim(regexp_replace(new_tracker->>'unitNumber','[[:space:]]+',' ','g'))) is distinct from normal_new
  or regexp_replace(upper(btrim(old_tracker->>'unitNumber')),'HDC2$','') is distinct from normal_new
  or new_tracker->>'customer' is distinct from new_row->>'customer'
  or (old_tracker->>'customer'||': '||old_tracker->>'site') is distinct from new_tracker->>'customer'
  or new_tracker->'sourceAddress' is distinct from old_tracker->'sourceAddress'
  or old_tracker->'binding'->>'state' is distinct from 'linked'
  or old_tracker->'binding'->>'matchMethod' is distinct from 'exact_canonical_family_unit'
  or old_tracker->'binding'->>'nativeUnitId' is distinct from binding->>'nativeUnitId'
  or old_tracker->'binding'->>'trackerId' is distinct from binding->>'trackerId'
  or old_tracker->'binding'->>'expectedGuard' is distinct from binding->>'expectedGuard'
  or old_tracker->'binding'->'unitLabels'->>(binding->>'nativeUnitId') is distinct from binding->>'nativeLabel'
  or old_tracker->'binding'->'unitLabels'->>(binding->>'trackerId') is distinct from binding->>'trackerLabel'
  or jsonb_array_length(coalesce(old_tracker->'binding'->'unitIds','[]'::jsonb))<>2
  or not (old_tracker->'binding'->'unitIds' ? (binding->>'nativeUnitId'))
  or not (old_tracker->'binding'->'unitIds' ? (binding->>'trackerId'))
  or old_tracker->'binding'->'representedUnitIds' is distinct from binding->'representedUnitIds'
  or old_tracker->'binding'->>'placementHeld' is distinct from 'false'
  or new_tracker->'binding'->>'state' is distinct from 'held'
  or new_tracker->'binding'->'unitIds' is distinct from '[]'::jsonb
  or new_tracker->'binding'->'unitLabels' is distinct from '{}'::jsonb
  or (new_tracker->'binding'-array['state','unitIds','unitLabels','guardCurrent']) is distinct from '{}'::jsonb then
  return jsonb_build_object('eligible',false,'reason','2027_tracker_membership_or_variant_unproven');end if;
 if exists(select 1 from cos_mhelp_placement_private.upload_batches b
  cross join lateral jsonb_array_elements(coalesce(b.receipt->'trackerRecords','[]'::jsonb)) r
  where b.source_sha256=p_active and r->>'matchedProductId'<>p_product
  and (coalesce(r->'binding'->'unitIds','[]'::jsonb) ? (binding->>'nativeUnitId')
   or coalesce(r->'binding'->'unitIds','[]'::jsonb) ? (binding->>'trackerId')
   or coalesce(r->'binding'->'candidateUnitIds','[]'::jsonb) ? (binding->>'nativeUnitId')
   or coalesce(r->'binding'->'candidateUnitIds','[]'::jsonb) ? (binding->>'trackerId'))) then
  return jsonb_build_object('eligible',false,'reason','competing_2027_tracker_membership');end if;
 select s.* into receipt from cos_mhelp_placement_private.source_continuity s
 where s.source_sha256=p_previous and s.action='admit'
  and s.tracker_id=(binding->>'trackerId')::uuid and s.native_id=(binding->>'nativeUnitId')::uuid
  and s.original_guard=binding->>'expectedGuard' order by s.id desc limit 1;
 if receipt.id is null or receipt.before_guard is distinct from receipt.original_guard
  or receipt.before_graph-'sources' is distinct from receipt.after_graph-'sources'
  or receipt.before_graph->'sources' is distinct from '[]'::jsonb
  or jsonb_array_length(receipt.after_graph->'sources')<>1
  or receipt.after_graph->'sources'->0->>'product_id' is distinct from p_product
  or receipt.after_graph->'sources'->0->>'source_file_sha256' is distinct from p_previous
  or receipt.after_graph is distinct from cos_mhelp_placement_private.continuity_graph(receipt.tracker_id,receipt.native_id)
  or receipt.after_guard is distinct from cos_mhelp_placement_private.upload_binding_guard(receipt.tracker_id,receipt.native_id)
  or exists(select 1 from cos_mhelp_placement_private.source_rollbacks x where x.request_id=receipt.request_id)
  or exists(select 1 from app_private.cos_owner_identity_revocations v join app_private.cos_owner_identity_claims c on c.id=v.claim_id where c.native_unit_id=receipt.native_id) then
  return jsonb_build_object('eligible',false,'reason','source_continuity_or_protected_graph_changed');end if;
 new_hash:=encode(sha256(convert_to(new_row::text,'UTF8')),'hex');
 old_hash:=encode(sha256(convert_to(old_row::text,'UTF8')),'hex');
 return jsonb_build_object('eligible',true,'reason','guarded_source_transition_only',
  'productId',p_product,'priorContinuityId',receipt.id,'currentRowSha256',new_hash,
  'previousRowSha256',old_hash,'currentGraphGuard',receipt.after_guard,
  'reviewedBinding',binding,'trackerRecordId',new_tracker->>'recordId',
  'currentTrackerRowSha256',encode(sha256(convert_to(new_tracker::text,'UTF8')),'hex'),
  'previousTrackerRowSha256',encode(sha256(convert_to(old_tracker::text,'UTF8')),'hex'),
  'reviewedTrackerBinding',old_tracker->'binding');
end$$;
revoke all on function cos_mhelp_placement_private.source_transition_review(text,text,text,text) from public,anon,authenticated,service_role;

-- Owner and existing SQL administrator only; lock the active source plus
-- protected writer tables. Idempotent request IDs cannot rebaseline changed data.
create function cos_mhelp_placement_private.admit_source_transition(
 p_actor uuid,p_org uuid,p_active text,p_payload text,p_previous text,
 p_product text,p_current_row_sha text,p_request_id uuid,p_apply boolean default false)
returns jsonb language plpgsql set search_path='' set lock_timeout='2s' as $$
declare proof jsonb; current_receipt cos_mhelp_placement_private.source_transition_receipts;
begin
 if current_user not in ('postgres','supabase_admin') then
  raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 perform app_private.cos_owner_identity_assert_actor(p_actor,p_org,true);
 if p_request_id is null or p_apply is null or coalesce(p_current_row_sha,'')!~'^[a-f0-9]{64}$' then
  raise exception 'Complete transition approval required' using errcode='22023';end if;
 perform 1 from cos_mhelp_placement_private.upload_control where singleton for update;
 lock table app_private.vision_tracker_locations,public.equipment_units,
  app_private.cos_geocode_sources,app_private.cos_archived_representations,
  public.equipment_unit_location_history,app_private.cos_owner_identity_claims,
  app_private.cos_owner_identity_revocations,cos_mhelp_placement_private.upload_batches,
  cos_mhelp_placement_private.scoped_control,cos_mhelp_placement_private.scoped_batches,
  cos_mhelp_placement_private.links,app_private.cos_archived_representation_revocations
  in share mode nowait;
 proof:=cos_mhelp_placement_private.source_transition_review(p_active,p_payload,p_previous,p_product);
 if proof->>'eligible' is distinct from 'true' or proof->>'currentRowSha256' is distinct from p_current_row_sha then
  raise exception 'Source-transition evidence changed: %',proof->>'reason' using errcode='40001';end if;
 select * into current_receipt from cos_mhelp_placement_private.source_transition_receipts where request_id=p_request_id;
 if found then
  if current_receipt.active_source_sha256 is distinct from p_active
   or current_receipt.active_payload_sha256 is distinct from p_payload
   or current_receipt.previous_source_sha256 is distinct from p_previous
   or current_receipt.product_id is distinct from p_product
   or current_receipt.current_row_sha256 is distinct from p_current_row_sha
   or current_receipt.current_graph_guard is distinct from proof->>'currentGraphGuard'
   or current_receipt.actor_user_id is distinct from p_actor
   or current_receipt.tracker_record_id is distinct from proof->>'trackerRecordId'
   or current_receipt.current_tracker_row_sha256 is distinct from proof->>'currentTrackerRowSha256' then
   raise exception 'Transition request changed' using errcode='40001';end if;
  return jsonb_build_object('applied',p_apply,'idempotent',true,'productId',p_product);
 end if;
 if p_apply then
  insert into cos_mhelp_placement_private.source_transition_receipts
   (request_id,active_source_sha256,active_payload_sha256,previous_source_sha256,product_id,
    prior_continuity_id,current_row_sha256,previous_row_sha256,current_graph_guard,reviewed_binding,
    tracker_record_id,current_tracker_row_sha256,previous_tracker_row_sha256,reviewed_tracker_binding,actor_user_id)
  values(p_request_id,p_active,p_payload,p_previous,p_product,(proof->>'priorContinuityId')::bigint,
   p_current_row_sha,proof->>'previousRowSha256',proof->>'currentGraphGuard',proof->'reviewedBinding',
   proof->>'trackerRecordId',proof->>'currentTrackerRowSha256',proof->>'previousTrackerRowSha256',proof->'reviewedTrackerBinding',p_actor);
 end if;
 return jsonb_build_object('applied',p_apply,'idempotent',false,'productId',p_product,'reason','guarded_source_transition_only');
end$$;
revoke all on function cos_mhelp_placement_private.admit_source_transition(uuid,uuid,text,text,text,text,text,uuid,boolean) from public,anon,authenticated,service_role;

-- Layer over PR200: do not rewrite Owner-confirmation source/reader. A
-- validated receipt clears only the derived guard hold in the read projection,
-- not the immutable upload record; all later graph drift holds it again.
alter function cos_mhelp_placement_private.upload_snapshot() rename to source_transition_base_upload_snapshot;
revoke all on function cos_mhelp_placement_private.source_transition_base_upload_snapshot() from public,anon,authenticated,service_role;
create function cos_mhelp_placement_private.upload_snapshot() returns jsonb
language sql stable set search_path='' as $$
 with original as materialized(select cos_mhelp_placement_private.source_transition_base_upload_snapshot() j),
 accepted as materialized(
  select i.product_id,i.reviewed_binding,i.tracker_record_id,i.reviewed_tracker_binding from cos_mhelp_placement_private.source_transition_receipts i
  join cos_mhelp_placement_private.upload_control c on c.singleton and c.active_sha256=i.active_source_sha256
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 and b.payload_sha256=i.active_payload_sha256
  cross join lateral cos_mhelp_placement_private.source_transition_review(i.active_source_sha256,i.active_payload_sha256,i.previous_source_sha256,i.product_id) AS q(proof)
  where q.proof->>'eligible'='true'
    and q.proof->>'currentRowSha256'=i.current_row_sha256
    and q.proof->>'previousRowSha256'=i.previous_row_sha256
    and q.proof->>'currentGraphGuard'=i.current_graph_guard
    and q.proof->'reviewedBinding'=i.reviewed_binding
    and q.proof->>'trackerRecordId'=i.tracker_record_id
    and q.proof->>'currentTrackerRowSha256'=i.current_tracker_row_sha256
    and q.proof->>'previousTrackerRowSha256'=i.previous_tracker_row_sha256
    and q.proof->'reviewedTrackerBinding'=i.reviewed_tracker_binding
    and (q.proof->>'priorContinuityId')::bigint=i.prior_continuity_id
 )
 select case when o.j is null then null else o.j||jsonb_build_object('records',(
  select jsonb_agg(case when a.product_id is null or r->'binding' is distinct from 'null'::jsonb then r
   else (r-'binding')||jsonb_build_object('binding',
      ((a.reviewed_binding-'reviewEvidence')||jsonb_build_object('fullLabel',r->>'unitNumber','guardCurrent',true)),
      'holdReason',null,'placementHeld',false,'possibleAliasUnitIds','[]'::jsonb) end
    order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(o.j->'records') r left join accepted a on a.product_id=r->>'productId'
 ),'trackerRecords',(
  select coalesce(jsonb_agg(case when a.tracker_record_id is null
     or t->>'matchedProductId' is distinct from a.product_id
     or t->'binding'->>'state' is distinct from 'held'
     or t->'binding'->'unitIds' is distinct from '[]'::jsonb
     or t->'binding'->'unitLabels' is distinct from '{}'::jsonb then t
   else t||jsonb_build_object('binding',
     (a.reviewed_tracker_binding-'reviewEvidence')||jsonb_build_object('state','linked','reason',null,'guardCurrent',true))
   end order by t->>'recordId'),'[]'::jsonb)
  from jsonb_array_elements(coalesce(o.j->'trackerRecords','[]'::jsonb)) t
  left join accepted a on a.tracker_record_id=t->>'recordId'
 )) end from original o
$$;
revoke all on function cos_mhelp_placement_private.upload_snapshot() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
