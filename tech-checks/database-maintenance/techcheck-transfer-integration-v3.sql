-- Completes the named-handoff release. Activation is a separate verified step.
begin;
alter table app_private.techcheck_transfer_outbox
 add column drive_manifest jsonb not null default '{}',
 add column email_state text not null default 'pending' check(email_state in ('pending','sending','sent','review')),
 add column email_id text,
 add column lease_token uuid,
 add column locked_until timestamptz,
 add column attempts integer not null default 0,
 add column next_attempt_at timestamptz not null default now(),
 add column last_error text,
 add column delivered_at timestamptz;
alter table app_private.techcheck_transfer_outbox alter column status set default 'queued';
update app_private.techcheck_transfer_outbox set status='queued' where status='awaiting_delivery_adapter';
create index techcheck_transfer_queue_pending on app_private.techcheck_transfer_outbox(next_attempt_at,created_at)
 where status in ('queued','retry','blocked','processing');
create index techcheck_transfer_event_order on app_private.techcheck_transfer_events(transfer_id,signed_at,id);

-- Exact family and tag; a shared number never joins two equipment families.
create function app_private.techcheck_transfer_custody_hold_v1(p_key text) returns text
language sql stable security definer set search_path='' as $$
 select case
 when e.tracker_state is distinct from 'shop' then 'Not recorded in Shop'
 when exists(select 1 from public.unit_registry u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.lifecycle_status is distinct from 'shop_inventory') then 'Existing equipment custody or maintenance'
 when exists(select 1 from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.equipment_type=e.canonical_family and i.unit_tag=e.unit_tag and not coalesce(t.is_test,false)
   and t.status::text is distinct from 'closed') then 'Existing preparation or handoff'
 when exists(select 1 from public.service_truck_units u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.status is distinct from 'unassigned') then 'Assigned truck equipment'
 when exists(select 1 from public.unit_returns r where r.equipment_type=e.canonical_family and r.unit_tag=e.unit_tag and r.status is distinct from 'completed') then 'Unresolved equipment return'
 end from public.equipment_master e where e.equipment_key=p_key
$$;
revoke all on function app_private.techcheck_transfer_custody_hold_v1(text) from public,anon,authenticated,service_role;

-- Serialize with legacy physical-custody writes. The legacy triggers below
-- protect the other direction after a named-handoff reservation is committed.
create or replace function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_hold text; v_result jsonb;
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 -- Replays must remain valid even when newer placement or custody has changed.
 if p_kind='checkout' and not exists(select 1 from app_private.techcheck_transfer_events where id=p_request_id) then
  for v_item in select value from jsonb_array_elements(app_private.techcheck_transfer_manifest(p_items,false)) loop
   v_hold:=app_private.techcheck_transfer_custody_hold_v1(v_item->>'equipment_key');
   if v_hold is not null then raise exception 'Equipment unavailable: %.',v_hold;end if;
  end loop;
 end if;
 -- Shared technician lock gives the signed daily snapshot a precise ordering
 -- against Service receipts; no receipt can be silently added after sign-off.
 if p_kind='receipt' then perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));end if;
 v_result:=app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
 return v_result||jsonb_build_object('delivery',(select status from app_private.techcheck_transfer_outbox where event_id=p_request_id));
end$$;
revoke all on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

create or replace function public.techcheck_transfer_context_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;v_equipment jsonb;v_transfers jsonb;
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 v_result:=app_private.techcheck_transfer_context_core_v1();
 select coalesce(jsonb_agg(e||jsonb_build_object('reserved',coalesce((e->>'reserved')::boolean,false) or h.reason is not null,'hold_reason',h.reason)),'[]') into v_equipment
 from jsonb_array_elements(v_result->'equipment') e
 cross join lateral(select app_private.techcheck_transfer_custody_hold_v1(e->>'equipment_key') reason) h;
 select coalesce(jsonb_agg(t||jsonb_build_object('events',(
  select coalesce(jsonb_agg(e||jsonb_build_object('delivery',o.status,'report_url',case when coalesce((o.drive_manifest->'summary_pdf_v1'->>'done')::boolean,false) then 'https://drive.google.com/file/d/'||(o.drive_manifest->'summary_pdf_v1'->>'id')||'/view' end)),'[]')
  from jsonb_array_elements(t->'events') e left join app_private.techcheck_transfer_outbox o on o.event_id=(e->>'id')::uuid))),'[]') into v_transfers
 from jsonb_array_elements(v_result->'transfers') t;
 return v_result||jsonb_build_object('equipment',v_equipment,'transfers',v_transfers,'delivery','queued');
end$$;

create function app_private.techcheck_transfer_legacy_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_transfer app_private.techcheck_transfers%rowtype;v_key text;v_row jsonb:=to_jsonb(new);
begin
 if tg_op='UPDATE' and to_jsonb(old) is not distinct from v_row then return new;end if;
 for v_key in select e.equipment_key from public.equipment_master e
  where e.canonical_family=v_row->>'equipment_type' and e.unit_tag=v_row->>'unit_tag' order by e.equipment_key loop
  perform pg_advisory_xact_lock(hashtextextended(v_key,2));
  select t.* into v_transfer from app_private.techcheck_transfer_reservations r join app_private.techcheck_transfers t on t.id=r.transfer_id where r.equipment_key=v_key;
  if found and not coalesce(v_transfer.state='accepted' and (
   tg_table_name='service_truck_units' and v_transfer.service_actor::text=v_row->>'service_tech_id'
   or tg_table_name='unit_registry' and v_transfer.service_actor::text=v_row->>'current_holder_id' and v_row->>'lifecycle_status'='assigned_to_tech'),false) then
   raise exception 'Equipment has an unresolved named handoff or intake review.';
  end if;
 end loop;
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_legacy_guard_v1() from public,anon,authenticated,service_role;
create trigger techcheck_named_handoff_prep_guard before insert or update on public.prep_items for each row execute function app_private.techcheck_transfer_legacy_guard_v1();
create trigger techcheck_named_handoff_truck_guard before insert or update on public.service_truck_units for each row execute function app_private.techcheck_transfer_legacy_guard_v1();
create trigger techcheck_named_handoff_return_guard before insert or update on public.unit_returns for each row execute function app_private.techcheck_transfer_legacy_guard_v1();
create trigger techcheck_named_handoff_registry_guard before insert or update on public.unit_registry for each row execute function app_private.techcheck_transfer_legacy_guard_v1();

create function app_private.techcheck_transfer_legacy_ticket_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status::text is distinct from 'closed' and not coalesce(new.is_test,false) and exists(
  select 1 from public.prep_items i join public.equipment_master e on e.canonical_family=i.equipment_type and e.unit_tag=i.unit_tag
   join app_private.techcheck_transfer_reservations r on r.equipment_key=e.equipment_key where i.prep_ticket_id=new.id)
 then raise exception 'Equipment has an unresolved named handoff or intake review.';end if;
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_legacy_ticket_guard_v1() from public,anon,authenticated,service_role;
create trigger techcheck_named_handoff_ticket_guard before update on public.prep_tickets for each row execute function app_private.techcheck_transfer_legacy_ticket_guard_v1();

-- New signed daily reports reference exactly the receipts present at sign-off.
-- Existing reports and their immutable evidence are never rewritten.
create function app_private.techcheck_transfer_daily_link_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_receipts jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.service_tech_id::text,0));
 select coalesce(jsonb_agg(jsonb_build_object('transfer_id',e.transfer_id,'event_id',e.id,'revision',e.snapshot->'revision','state',e.snapshot->>'state',
  'signed_at',e.signed_at,'it_name',e.snapshot->>'it_name','service_name',e.actor_name,'actual',e.snapshot->'actual','differences',e.snapshot->'differences','snapshot',e.snapshot) order by e.signed_at,e.id),'[]') into v_receipts
 from app_private.techcheck_transfer_events e
 where e.actor_id=new.service_tech_id and e.kind='receipt' and timezone('America/Chicago',e.signed_at)::date=new.check_date
  and e.signed_at<=new.submitted_at;
 new.snapshot:=new.snapshot||jsonb_build_object('transfer_receipts',v_receipts);
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_daily_link_v1() from public,anon,authenticated,service_role;
create trigger techcheck_named_handoff_daily_link before insert on app_private.service_daily_reports for each row execute function app_private.techcheck_transfer_daily_link_v1();

-- Separate queue using the existing Google account and archive conventions.
grant usage on schema app_private to service_role;
create function app_private.techcheck_transfer_delivery_v1(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_queue app_private.techcheck_transfer_outbox%rowtype;v_event app_private.techcheck_transfer_events%rowtype;v_token uuid:=gen_random_uuid();v_photos jsonb;
begin
 if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server access required.' using errcode='42501';end if;
 if p_action='claim' then
  select o.* into v_queue from app_private.techcheck_transfer_outbox o join app_private.techcheck_transfer_events e on e.id=o.event_id join app_private.techcheck_transfers t on t.id=o.transfer_id
  where (p_id is null or o.event_id=p_id) and (p_actor is null or (exists(select 1 from public.profiles p where p.user_id=p_actor and p.active and p.archived_at is null)
    and (app_private.cos_verified_fleet_actor(p_actor) or t.service_actor=p_actor)))
   and o.status in ('queued','retry','blocked','processing') and o.next_attempt_at<=now() and (o.locked_until is null or o.locked_until<now())
  order by o.created_at,o.event_id limit 1 for update of o skip locked;
  if not found then return null;end if;
  update app_private.techcheck_transfer_outbox set status='processing',lease_token=v_token,locked_until=now()+interval '10 minutes',attempts=attempts+1 where event_id=v_queue.event_id returning * into v_queue;
  select * into strict v_event from app_private.techcheck_transfer_events where id=v_queue.event_id;
  select coalesce(jsonb_agg(p||jsonb_build_object('category',case when p->>'kind'='signature' then 'Technician signature' else p->>'equipment_key' end,'view',p->>'kind')),'[]') into v_photos from jsonb_array_elements(v_event.photos) p;
  return (to_jsonb(v_queue)-'event_id')||jsonb_build_object('id',v_queue.event_id,'actor_name',v_event.actor_name,'check_date',timezone('America/Chicago',v_event.signed_at)::date,
   'submitted_at',v_event.signed_at,'kind',v_event.kind,'snapshot',v_event.snapshot,'photos',v_photos);
 end if;
 select * into v_queue from app_private.techcheck_transfer_outbox where event_id=p_id and lease_token=p_lease and locked_until>now() for update;
 if not found then raise exception 'Delivery lease expired.';end if;
 if p_action='checkpoint' then
  if p_data ? 'email_state' and p_data->>'email_state' not in ('pending','sending','sent','review') then raise exception 'Invalid email state.';end if;
  update app_private.techcheck_transfer_outbox set drive_manifest=coalesce(p_data->'drive_manifest',drive_manifest),email_state=coalesce(p_data->>'email_state',email_state),email_id=coalesce(p_data->>'email_id',email_id) where event_id=p_id;
 elsif p_action='finish' then
  if p_data->>'status' not in ('sent','retry','blocked','review') then raise exception 'Invalid delivery result.';end if;
  if p_data->>'status'='sent' and (v_queue.email_state<>'sent' or v_queue.email_id is null or not coalesce((v_queue.drive_manifest->>'complete')::boolean,false)) then raise exception 'Archive and email confirmation required.';end if;
  update app_private.techcheck_transfer_outbox set status=p_data->>'status',last_error=left(p_data->>'error',240),locked_until=null,lease_token=null,
   next_attempt_at=now()+interval '5 minutes',delivered_at=case when p_data->>'status'='sent' then now() else null end where event_id=p_id;
 else raise exception 'Invalid queue action.';end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function app_private.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
create function public.techcheck_transfer_delivery_v1(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select app_private.techcheck_transfer_delivery_v1(p_action,p_id,p_actor,p_lease,p_data)$$;
revoke all on function public.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
commit;
