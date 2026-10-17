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
  'reviewedBinding',binding);
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
   or current_receipt.current_graph_guard is distinct from proof->>'currentGraphGuard' then
   raise exception 'Transition request changed' using errcode='40001';end if;
  return jsonb_build_object('applied',p_apply,'idempotent',true,'productId',p_product);
 end if;
 if p_apply then
  insert into cos_mhelp_placement_private.source_transition_receipts
   (request_id,active_source_sha256,active_payload_sha256,previous_source_sha256,product_id,
    prior_continuity_id,current_row_sha256,previous_row_sha256,current_graph_guard,reviewed_binding,actor_user_id)
  values(p_request_id,p_active,p_payload,p_previous,p_product,(proof->>'priorContinuityId')::bigint,
   p_current_row_sha,proof->>'previousRowSha256',proof->>'currentGraphGuard',proof->'reviewedBinding',p_actor);
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
  select i.product_id,i.reviewed_binding from cos_mhelp_placement_private.source_transition_receipts i
  join cos_mhelp_placement_private.upload_control c on c.singleton and c.active_sha256=i.active_source_sha256
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 and b.payload_sha256=i.active_payload_sha256
  cross join lateral cos_mhelp_placement_private.source_transition_review(i.active_source_sha256,i.active_payload_sha256,i.previous_source_sha256,i.product_id) AS q(proof)
  where q.proof->>'eligible'='true'
    and q.proof->>'currentRowSha256'=i.current_row_sha256
    and q.proof->>'previousRowSha256'=i.previous_row_sha256
    and q.proof->>'currentGraphGuard'=i.current_graph_guard
    and q.proof->'reviewedBinding'=i.reviewed_binding
    and (q.proof->>'priorContinuityId')::bigint=i.prior_continuity_id
 )
 select case when o.j is null then null else o.j||jsonb_build_object('records',(
  select jsonb_agg(case when a.product_id is null or r->'binding' is distinct from 'null'::jsonb then r
   else (r-'binding')||jsonb_build_object('binding',
      ((a.reviewed_binding-'reviewEvidence')||jsonb_build_object('fullLabel',r->>'unitNumber','guardCurrent',true)),
      'holdReason',null,'placementHeld',false,'possibleAliasUnitIds','[]'::jsonb) end
    order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(o.j->'records') r left join accepted a on a.product_id=r->>'productId'
 )) end from original o
$$;
revoke all on function cos_mhelp_placement_private.upload_snapshot() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
