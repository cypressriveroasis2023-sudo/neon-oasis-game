-- REVIEW CANDIDATE. Install after partial returns v4 and daily receipt links v5.
-- All rollout settings remain held. Apply the exact writer lock-order companion
-- in the same reviewed installation before attesting custody_ready.
begin;
create function app_private.techcheck_custody_gate_v6() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 if tg_op='TRUNCATE' and exists(select 1 from app_private.techcheck_transfer_reservations) then raise exception 'Resolve named equipment custody before clearing inventory.';end if;
 return null;
end$$;
revoke all on function app_private.techcheck_custody_gate_v6() from public,anon,authenticated,service_role;

-- Exact identity grants access; a legacy bare-tag collision only vetoes it.
create function app_private.techcheck_custody_available_v6(p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare e public.equipment_master%rowtype;tag text;
begin
 select * into e from public.equipment_master where equipment_key=p_key;
 if not found or e.tracker_state is distinct from 'shop' or nullif(btrim(e.unit_tag),'') is null then raise exception 'Current Shop equipment identity required.';end if;
 if (select count(*) from public.equipment_master x where x.canonical_family=e.canonical_family and x.unit_tag=e.unit_tag)<>1 then raise exception 'The exact equipment identity is duplicated. Resolve it before checkout.';end if;
 tag:=lower(btrim(e.unit_tag));
 if exists(select 1 from public.unit_registry r where (r.unit_key in (e.equipment_key,tag) or lower(btrim(r.unit_tag))=tag) and
  (r.equipment_type is distinct from e.canonical_family or btrim(r.unit_tag) is distinct from e.unit_tag or r.lifecycle_status is distinct from 'shop_inventory' or r.current_holder_id is not null or nullif(btrim(r.current_site),'') is not null)) then raise exception 'Equipment has conflicting legacy custody or field placement.';end if;
 if exists(select 1 from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id where lower(btrim(i.unit_tag))=tag and t.status::text in ('draft','released')) then raise exception 'Equipment is reserved by an active legacy preparation.';end if;
 if exists(select 1 from public.unit_returns r where lower(btrim(r.unit_tag))=tag and (r.status is distinct from 'completed' or r.mhelp_inventory_confirmed is distinct from true)) then raise exception 'Equipment has an unresolved legacy return or inventory review.';end if;
 if exists(select 1 from public.asset_inventory a where (a.unit_key in (e.equipment_key,tag) or lower(btrim(a.unit_tag))=tag) and
  (a.asset_type is distinct from e.canonical_family or btrim(a.unit_tag) is distinct from e.unit_tag or a.availability_status is distinct from 'shop' or a.assigned_to is not null)) then raise exception 'Equipment is assigned or held in legacy inventory.';end if;
 if exists(select 1 from public.service_truck_units u where lower(btrim(u.unit_tag))=tag) then raise exception 'Equipment is already recorded in permanent truck stock.';end if;
 if exists(select 1 from public.service_truck_restock_requests r where lower(btrim(r.replacement_unit_tag))=tag and r.status not in ('cancelled','accepted')) then raise exception 'Equipment is reserved by a truck restock request.';end if;
end$$;
revoke all on function app_private.techcheck_custody_available_v6(text) from public,anon,authenticated,service_role;

create function app_private.techcheck_reservation_guard_v6() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 if exists(select 1 from app_private.techcheck_transfer_reservations r join public.equipment_master held on held.equipment_key=r.equipment_key join public.equipment_master candidate on candidate.equipment_key=new.equipment_key where r.equipment_key<>new.equipment_key and lower(btrim(held.unit_tag))=lower(btrim(candidate.unit_tag))) then raise exception 'A legacy bare-tag collision is already held by another handoff. Resolve the exact inventory identity first.';end if;
 perform app_private.techcheck_custody_available_v6(new.equipment_key);
 return new;
end$$;
revoke all on function app_private.techcheck_reservation_guard_v6() from public,anon,authenticated,service_role;
create trigger techcheck_reservation_guard_v6 before insert or update on app_private.techcheck_transfer_reservations for each row execute function app_private.techcheck_reservation_guard_v6();

-- Only the reviewed Owner reconciliation function can create a transaction-local
-- permit. A caller-set GUC, a role claim or a matching tag is never a permit.
create table app_private.techcheck_inventory_permits_v6(transaction_id bigint not null,equipment_key text not null,actor uuid not null,primary key(transaction_id,equipment_key));
create table app_private.techcheck_inventory_releases_v6(id uuid primary key,transfer_id uuid not null,equipment_key text not null,return_event_id uuid not null references app_private.techcheck_transfer_events(id),owner_id uuid not null,owner_name text not null,notes text not null,request jsonb not null,released_at timestamptz not null default now(),unique(transfer_id,equipment_key));
alter table app_private.techcheck_inventory_permits_v6 enable row level security;
alter table app_private.techcheck_inventory_releases_v6 enable row level security;
revoke all on app_private.techcheck_inventory_permits_v6,app_private.techcheck_inventory_releases_v6 from public,anon,authenticated,service_role;

create function app_private.techcheck_legacy_custody_guard_v6() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb;r record;tag text;unitkey text;
begin
 -- The statement gate runs before row locks. The writer-lock companion also
 -- gates existing RPCs before their SELECT FOR UPDATE operations.
 if tg_table_name='equipment_master' and tg_op='UPDATE' and
  (to_jsonb(new)-array['updated_at','imported_at','source_file','source_page','health_provider','tracker_public_ip'])=(to_jsonb(old)-array['updated_at','imported_at','source_file','source_page','health_provider','tracker_public_ip']) then return new;end if;
 for row_data in select value from jsonb_array_elements(case tg_op when 'INSERT' then jsonb_build_array(to_jsonb(new)) when 'DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end) loop
  tag:=lower(btrim(coalesce(row_data->>'unit_tag',row_data->>'replacement_unit_tag','')));
  unitkey:=coalesce(row_data->>'equipment_key',row_data->>'unit_key','');
  for r in select q.equipment_key,q.transfer_id from app_private.techcheck_transfer_reservations q join public.equipment_master e using(equipment_key)
   where (tag<>'' and lower(btrim(e.unit_tag))=tag) or (unitkey<>'' and unitkey in (e.equipment_key,lower(btrim(e.unit_tag))))
    or (tg_table_name='prep_tickets' and exists(select 1 from public.prep_items i where i.prep_ticket_id=(row_data->>'id')::uuid and lower(btrim(i.unit_tag))=lower(btrim(e.unit_tag)))) loop
   if tg_table_name in ('asset_inventory','unit_registry') and tg_op<>'DELETE' and exists(select 1 from app_private.techcheck_inventory_permits_v6 p where p.transaction_id=txid_current() and p.equipment_key=r.equipment_key and p.actor=auth.uid()) then continue;end if;
   raise exception 'Equipment has an unresolved named handoff or return. Complete its inventory review first.' using errcode='23514';
  end loop;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function app_private.techcheck_legacy_custody_guard_v6() from public,anon,authenticated,service_role;
do $$declare table_name text;begin
 foreach table_name in array array['equipment_master','unit_registry','prep_items','prep_tickets','unit_returns','asset_inventory','service_truck_units','service_truck_restock_requests'] loop
  execute format('create trigger aaa_techcheck_custody_gate_v6 before insert or update or delete or truncate on public.%I for each statement execute function app_private.techcheck_custody_gate_v6()',table_name);
  execute format('create trigger aaa_techcheck_custody_row_v6 before insert or update or delete on public.%I for each row execute function app_private.techcheck_legacy_custody_guard_v6()',table_name);
 end loop;
end$$;

create or replace function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 return app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
end$$;

-- This explicit Owner action reuses BOTH legacy inventory routines and all their
-- existing active-workflow/damage checks. It does not create a fictional job,
-- Service return, placement observation, or automatic inventory event.
create function public.owner_release_techcheck_return_v6(p_request_id uuid,p_transfer_id uuid,p_equipment_key text,p_return_event_id uuid,p_inventory_confirmed boolean,p_notes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();owner_name text;item app_private.techcheck_transfer_item_returns%rowtype;e public.equipment_master%rowtype;previous app_private.techcheck_inventory_releases_v6%rowtype;asset_key text;
 request jsonb:=jsonb_build_object('transfer_id',p_transfer_id,'equipment_key',p_equipment_key,'return_event_id',p_return_event_id,'inventory_confirmed',p_inventory_confirmed,'notes',p_notes);
begin
 select coalesce(nullif(btrim(full_name),''),username) into owner_name from public.profiles where user_id=actor and role::text='owner' and active and archived_at is null;
 if not found then raise exception 'Active Owner account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 if p_request_id is null then raise exception 'Review request identity required.';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 select * into previous from app_private.techcheck_inventory_releases_v6 where id=p_request_id;
 if found then
  if previous.owner_id<>actor or previous.request is distinct from request then raise exception 'Review request already used with different details.';end if;
  return jsonb_build_object('id',previous.id,'equipment_key',previous.equipment_key,'released',true,'replayed',true);
 end if;
 if p_inventory_confirmed is distinct from true or length(btrim(coalesce(p_notes,''))) not between 10 and 2000 then raise exception 'Confirm the completed MHelpDesk inventory review and record its evidence or reference.';end if;
 perform 1 from app_private.techcheck_transfers where id=p_transfer_id for update;
 select * into item from app_private.techcheck_transfer_item_returns where transfer_id=p_transfer_id and equipment_key=p_equipment_key;
 if not found or item.event_id is distinct from p_return_event_id or not item.passed then raise exception 'A current passing IT intake is required. Failed equipment must be repaired and rechecked first.';end if;
 if not exists(select 1 from app_private.techcheck_transfer_reservations where transfer_id=p_transfer_id and equipment_key=p_equipment_key) then raise exception 'This equipment reservation changed. Reload the review.';end if;
 perform app_private.techcheck_custody_available_v6(p_equipment_key);
 select * into e from public.equipment_master where equipment_key=p_equipment_key;
 asset_key:=public.normalize_unit_key(e.unit_tag);
 if exists(select 1 from public.asset_inventory where unit_key=asset_key and (unit_tag is distinct from e.unit_tag or asset_type is distinct from e.canonical_family)) then raise exception 'Legacy inventory identity is ambiguous. Resolve it before release.';end if;
 insert into app_private.techcheck_inventory_permits_v6 values(txid_current(),p_equipment_key,actor);
 if not exists(select 1 from public.asset_inventory where unit_key=asset_key) then
  perform public.owner_add_inventory_asset(e.unit_tag,e.canonical_family,'device',p_notes);
 end if;
 perform public.owner_set_inventory_asset_status(asset_key,'shop',p_notes);
 if not exists(select 1 from public.asset_inventory where unit_key=asset_key and unit_tag=e.unit_tag and asset_type=e.canonical_family and availability_status='shop' and assigned_to is null)
 or not exists(select 1 from public.unit_registry where unit_key=asset_key and unit_tag=e.unit_tag and equipment_type=e.canonical_family and lifecycle_status='shop_inventory' and current_holder_id is null and nullif(btrim(current_site),'') is null) then raise exception 'Legacy inventory release did not reconcile the exact unit.';end if;
 insert into app_private.techcheck_inventory_releases_v6(id,transfer_id,equipment_key,return_event_id,owner_id,owner_name,notes,request) values(p_request_id,p_transfer_id,p_equipment_key,p_return_event_id,actor,owner_name,p_notes,request);
 delete from app_private.techcheck_transfer_reservations where transfer_id=p_transfer_id and equipment_key=p_equipment_key;
 delete from app_private.techcheck_inventory_permits_v6 where transaction_id=txid_current() and equipment_key=p_equipment_key;
 return jsonb_build_object('id',p_request_id,'equipment_key',p_equipment_key,'released',true,'replayed',false);
end$$;
revoke all on function public.owner_release_techcheck_return_v6(uuid,uuid,text,uuid,boolean,text) from public,anon,service_role;
grant execute on function public.owner_release_techcheck_return_v6(uuid,uuid,text,uuid,boolean,text) to authenticated;

create function public.owner_techcheck_return_reviews_v6() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and role::text='owner' and active and archived_at is null) then raise exception 'Active Owner account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 return jsonb_build_object('version',6,'actor_id',auth.uid(),'items',coalesce((select jsonb_agg(jsonb_build_object('transfer_id',q.transfer_id,'equipment_key',q.equipment_key,'return_event_id',r.event_id,'passed',r.passed,'returned_at',r.returned_at,'family',e.canonical_family,'unit_tag',e.unit_tag,'snapshot',v.snapshot,'photos',v.photos) order by r.returned_at) from app_private.techcheck_transfer_reservations q join app_private.techcheck_transfer_item_returns r using(transfer_id,equipment_key) join public.equipment_master e using(equipment_key) join app_private.techcheck_transfer_events v on v.id=r.event_id),'[]'::jsonb));
end$$;
revoke all on function public.owner_techcheck_return_reviews_v6() from public,anon,service_role;
grant execute on function public.owner_techcheck_return_reviews_v6() to authenticated;

create function app_private.techcheck_release_immutable_v6() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Signed inventory review history is immutable.';end$$;
revoke all on function app_private.techcheck_release_immutable_v6() from public,anon,authenticated,service_role;
create trigger techcheck_release_immutable_v6 before update or delete on app_private.techcheck_inventory_releases_v6 for each row execute function app_private.techcheck_release_immutable_v6();

-- Keep signed return states immutable while displaying the later, separately
-- audited Owner release accurately in the current technician view.
alter function public.techcheck_transfer_context_v1() set schema app_private;
alter function app_private.techcheck_transfer_context_v1() rename to techcheck_transfer_context_returns_v4;
revoke all on function app_private.techcheck_transfer_context_returns_v4() from public,anon,authenticated,service_role;
create function public.techcheck_transfer_context_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;transfers jsonb;
begin
 result:=app_private.techcheck_transfer_context_returns_v4();
 select coalesce(jsonb_agg(t||jsonb_build_object(
  'returned_items',coalesce((select jsonb_agg(item||jsonb_build_object('inventory_released',r.id is not null,'inventory_released_at',r.released_at)) from jsonb_array_elements(t->'returned_items') item left join app_private.techcheck_inventory_releases_v6 r on r.transfer_id=(t->>'id')::uuid and r.equipment_key=item->>'equipment_key' and r.return_event_id=(item->>'event_id')::uuid),'[]'::jsonb),
  'inventory_review_complete',t->>'state'='returned_review' and not exists(select 1 from jsonb_array_elements(t->'manifest') item where not exists(select 1 from app_private.techcheck_inventory_releases_v6 r where r.transfer_id=(t->>'id')::uuid and r.equipment_key=item->>'equipment_key'))
 )),'[]'::jsonb) into transfers from jsonb_array_elements(result->'transfers') t;
 return result||jsonb_build_object('transfers',transfers);
end$$;
revoke all on function public.techcheck_transfer_context_v1() from public,anon,service_role;
grant execute on function public.techcheck_transfer_context_v1() to authenticated;
commit;
