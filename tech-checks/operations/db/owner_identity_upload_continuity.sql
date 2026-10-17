-- Preserve a CURRENT reviewed product binding across exactly one authenticated
-- Owner camera-identity confirmation. Never rewrite the source or weaken its
-- graph guard: an immutable receipt admits only the claim's exact graph delta.
begin;

create table cos_mhelp_placement_private.identity_binding_receipts (
 claim_id uuid primary key references app_private.cos_owner_identity_claims(id),
 source_sha256 text not null references cos_mhelp_placement_private.upload_batches(source_sha256),
 product_id text not null check(product_id ~ '^[1-9][0-9]{0,18}$'),
 native_unit_id uuid not null,
 tracker_id uuid,
 source_row_sha256 text not null check(source_row_sha256 ~ '^[a-f0-9]{64}$'),
 before_guard text not null check(before_guard ~ '^[a-f0-9]{64}$'),
 after_guard text not null check(after_guard ~ '^[a-f0-9]{64}$'),
 actor_user_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(source_sha256, product_id)
);
alter table cos_mhelp_placement_private.identity_binding_receipts enable row level security;
alter table cos_mhelp_placement_private.identity_binding_receipts force row level security;
revoke all on cos_mhelp_placement_private.identity_binding_receipts from public, anon, authenticated, service_role;
create trigger identity_binding_receipts_immutable before update or delete or truncate
 on cos_mhelp_placement_private.identity_binding_receipts for each statement
 execute function app_private.cos_owner_identity_immutable();

-- Same protected graph as upload_binding_guard, excluding ONLY the new claim.
-- Comparing this with the pre-confirmation guard rejects simultaneous GPS,
-- history, registry, archive, source, or other identity changes atomically.
create function cos_mhelp_placement_private.identity_binding_guard_without_claim(p_tracker uuid, p_native uuid, p_claim uuid)
returns text language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
  'tracker',(select to_jsonb(t) from app_private.vision_tracker_locations t where t.id=p_tracker),
  'native',(select to_jsonb(u) from public.equipment_units u where u.id=p_native),
  'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]'::jsonb) from app_private.cos_geocode_sources s where s.tracker_id=p_tracker or s.native_unit_id=p_native),
  'archives',(select coalesce(jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text),'[]'::jsonb) from app_private.cos_archived_representations a where p_tracker in(a.archived_tracker_id,a.canonical_tracker_id) or p_native in(a.archived_native_id,a.canonical_native_id)),
  'nativeHistory',(select coalesce(jsonb_agg(to_jsonb(h) order by to_jsonb(h)::text),'[]'::jsonb) from public.equipment_unit_location_history h where h.equipment_unit_id=p_native),
  'ownerClaims',(select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from app_private.cos_owner_identity_claims c where c.native_unit_id=p_native and c.id is distinct from p_claim)
 )::text,'UTF8')),'hex')
$$;
revoke all on function cos_mhelp_placement_private.identity_binding_guard_without_claim(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Keep the installed, reviewed admission kernel byte-for-byte, private, and
-- inaccessible to the API roles. The public signature and actor gate are fixed.
alter function public.cos_owner_identity_confirm(uuid,uuid,text,uuid,jsonb) set schema app_private;
alter function app_private.cos_owner_identity_confirm(uuid,uuid,text,uuid,jsonb) rename to cos_owner_identity_confirm_base;
revoke all on function app_private.cos_owner_identity_confirm_base(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.cos_owner_identity_confirm(p_actor_user_id uuid,p_organization_id uuid,p_expected_revision text,p_request_id uuid,p_claim jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare base text; rows jsonb; source_row jsonb; safe_row jsonb; row_count integer;
 tracker uuid; native uuid; before_guard text; after_guard text; unchanged_guard text;
 row_hash text; result jsonb; claim uuid; after_row jsonb;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 -- Exact retries delegate to the original idempotency gate. Never refresh a
 -- receipt after a later source, GPS or identity change.
 if exists(select 1 from app_private.cos_owner_identity_claims where request_id=p_request_id) then
  return app_private.cos_owner_identity_confirm_base(p_actor_user_id,p_organization_id,p_expected_revision,p_request_id,p_claim);
 end if;
 native:=(p_claim->>'unitId')::uuid;
 -- Matches the import's control-before-native lock order, preventing activation
 -- or rollback of a different complete file during identity admission.
 select active_sha256 into base from cos_mhelp_placement_private.upload_control where singleton for share;
 if base is not null then
  -- One MVCC statement brackets source-row eligibility and the complete graph.
  select cos_mhelp_placement_private.scoped_records(base),cos_mhelp_placement_private.upload_snapshot()
   into rows,safe_row;
  select count(*),(jsonb_agg(r)->0) into row_count,source_row
   from jsonb_array_elements(rows) r where r->'binding'->>'nativeUnitId'=native::text;
  if row_count>1 then raise exception 'Multiple reviewed products claim this equipment.' using errcode='40001'; end if;
  if row_count=1 then
   tracker:=(source_row->'binding'->>'trackerId')::uuid;
   select r into safe_row from jsonb_array_elements(safe_row->'records') r
    where r->>'productId'=source_row->>'productId';
   if safe_row->'binding'->>'guardCurrent' is distinct from 'true'
    or source_row->>'lifecycle' is distinct from 'UNFLAGGED'
    or source_row->'binding'->>'nativeLabel' is distinct from p_claim->>'unitNumber'
    or source_row->'binding'->>'fullLabel' is distinct from source_row->>'unitNumber'
    or nullif(source_row->>'holdReason','') is not null
    or coalesce(source_row->>'placementHeld','false')<>'false'
    or jsonb_array_length(coalesce(source_row->'possibleAliasUnitIds','[]'::jsonb))>0 then
    raise exception 'Current reviewed inventory binding needs identity review; no confirmation was saved.' using errcode='40001';
   end if;
   before_guard:=cos_mhelp_placement_private.upload_binding_guard(tracker,native);
   -- Recheck eligibility with this guard's statement snapshot. A source read
   -- completed before a concurrently committed edit cannot bless that edit.
   if not exists(select 1 from jsonb_array_elements(cos_mhelp_placement_private.upload_snapshot()->'records') r
     where r->>'productId'=source_row->>'productId' and r->'binding'->>'guardCurrent'='true') then
    raise exception 'Inventory graph changed during identity review.' using errcode='40001';
   end if;
   row_hash:=encode(sha256(convert_to(source_row::text,'UTF8')),'hex');
  end if;
 end if;
 result:=app_private.cos_owner_identity_confirm_base(p_actor_user_id,p_organization_id,p_expected_revision,p_request_id,p_claim);
 if result->>'replayed'='true' or row_count is distinct from 1 then return result; end if;
 claim:=(result->>'claimId')::uuid;
 select cos_mhelp_placement_private.upload_binding_guard(tracker,native),
        cos_mhelp_placement_private.identity_binding_guard_without_claim(tracker,native,claim),
        (select r from jsonb_array_elements(cos_mhelp_placement_private.scoped_records(base)) r where r->>'productId'=source_row->>'productId')
 into after_guard,unchanged_guard,after_row;
 if unchanged_guard is distinct from before_guard or after_row is distinct from source_row then
  raise exception 'Inventory or protected evidence changed during confirmation; no identity or binding was saved.' using errcode='40001';
 end if;
 insert into cos_mhelp_placement_private.identity_binding_receipts(claim_id,source_sha256,product_id,native_unit_id,tracker_id,source_row_sha256,before_guard,after_guard,actor_user_id)
 values(claim,base,source_row->>'productId',native,tracker,row_hash,before_guard,after_guard,p_actor_user_id);
 return result;
end $$;
revoke all on function public.cos_owner_identity_confirm(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_owner_identity_confirm(uuid,uuid,text,uuid,jsonb) to service_role;

-- Preserve the installed continuity and scoped-upload reader exactly. Only an
-- immutable receipt for the same unchanged source row can carry its guard over
-- the new claim. New/revoked claims and every later graph edit still fail closed.
alter function cos_mhelp_placement_private.upload_snapshot() rename to identity_binding_base_upload_snapshot;
revoke all on function cos_mhelp_placement_private.identity_binding_base_upload_snapshot() from public,anon,authenticated,service_role;
create function cos_mhelp_placement_private.upload_snapshot() returns jsonb
language sql stable set search_path='' as $$
 with original as materialized(select cos_mhelp_placement_private.identity_binding_base_upload_snapshot() snapshot),
 current_rows as materialized(
  select b.source_sha256,r from cos_mhelp_placement_private.upload_control u
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=u.active_sha256
  cross join lateral jsonb_array_elements(cos_mhelp_placement_private.scoped_records(b.source_sha256)) r
  where u.singleton and exists(select 1 from cos_mhelp_placement_private.identity_binding_receipts i where i.source_sha256=b.source_sha256)
 ), accepted as materialized(
  select i.product_id from cos_mhelp_placement_private.identity_binding_receipts i
  join current_rows r on r.source_sha256=i.source_sha256 and r.r->>'productId'=i.product_id
  join app_private.cos_owner_identity_claims c on c.id=i.claim_id and c.native_unit_id=i.native_unit_id
  where encode(sha256(convert_to(r.r::text,'UTF8')),'hex')=i.source_row_sha256
   and r.r->'binding'->>'nativeUnitId'=i.native_unit_id::text
   and c.confirmed_by=i.actor_user_id
   and not exists(select 1 from app_private.cos_owner_identity_revocations v where v.claim_id=c.id)
   and c.source_epoch=app_private.cos_owner_identity_source_epoch(c.native_unit_id,
    coalesce((select jsonb_agg(jsonb_build_object('source',x.source,'externalId',x.external_device_id)) from app_private.cos_owner_identity_resources x where x.claim_id=c.id),'[]'::jsonb))
   and cos_mhelp_placement_private.upload_binding_guard(i.tracker_id,i.native_unit_id)=i.after_guard
 )
 select case when o.snapshot is null then null else o.snapshot||jsonb_build_object('records',(
  select jsonb_agg(case when a.product_id is null then r else jsonb_set(r,'{binding,guardCurrent}','true'::jsonb) end order by (r->>'sourceRow')::integer)
  from jsonb_array_elements(o.snapshot->'records') r left join accepted a on a.product_id=r->>'productId'
 )) end from original o
$$;
revoke all on function cos_mhelp_placement_private.upload_snapshot() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
