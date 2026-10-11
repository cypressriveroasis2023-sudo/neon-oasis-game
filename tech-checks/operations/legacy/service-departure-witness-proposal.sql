-- LOCAL REVIEW ONLY. No public grant, activation, backfill or production apply.
-- Requires reviewed canonical shared membership helpers. These witnesses are
-- captured prospectively in the same transaction as the real own Start/claim.
begin;
do $$begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.service_departure_readiness_v1(uuid)')) is distinct from 'a36f7b17dd7bb4f7c98d5784174eadf5' then raise exception 'Reviewed service_departure_readiness_v1 contract changed';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.ensure_service_truck_baseline_v1(uuid)')) is distinct from 'de14074246025e57ede23177cdfd6e8e' then raise exception 'Reviewed ensure_service_truck_baseline_v1 contract changed';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.refresh_service_truck_restock_requests_v1()')) is distinct from '3b2df8abd8ee4067877d35dcf175f5bc' then raise exception 'Reviewed refresh_service_truck_restock_requests_v1 contract changed';end if;
end$$;
do $$begin
 if not exists(select 1 from pg_namespace where nspname='cos_service_field') then
  create schema cos_service_field;revoke all on schema cos_service_field from public,anon,authenticated,service_role;
 elsif exists(select 1 from pg_namespace where nspname='cos_service_field' and nspowner<>(select oid from pg_roles where rolname=current_user)) then
  raise exception 'Reviewed private Service schema owner required';
 end if;
end$$;
create table cos_service_field.departure_starts (
 id uuid primary key default gen_random_uuid(),
 work_order_id uuid not null references cos_mhelp_intake.work_orders(id),
 membership_id uuid not null references cos_mhelp_intake.participants(id),
 assignment_id uuid not null unique references public.job_assignments(id),
 actor_id uuid not null references public.profiles(user_id),prep_ticket_id uuid,
 started_at timestamptz not null,inspection_id uuid not null,inventory_check_id uuid not null,
 readiness_snapshot jsonb not null,inspection_snapshot jsonb not null,inventory_snapshot jsonb not null,
 units_snapshot jsonb not null,sims_snapshot jsonb not null,stock_snapshot jsonb not null,
 created_at timestamptz not null default now(),unique(membership_id,assignment_id,actor_id)
);
alter table cos_service_field.departure_starts enable row level security;
revoke all on cos_service_field.departure_starts from public,anon,authenticated,service_role;
create function cos_service_field.immutable_departure_v1() returns trigger language plpgsql set search_path='' as $$begin
 raise exception 'Prospective departure history is immutable';
end$$;
create trigger immutable_departure before update or delete on cos_service_field.departure_starts for each row execute function cos_service_field.immutable_departure_v1();

create function cos_service_field.require_departure_start_v1(p_assignment uuid,p_prep uuid)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare m jsonb;a public.job_assignments%rowtype;g cos_service_field.departure_starts%rowtype;
begin
 m:=cos_mhelp_intake.lock_participant_v1(p_assignment,auth.uid(),p_prep,false);
 if m->>'department' is distinct from 'service' then raise exception 'Own Service departure required';end if;
 select * into strict a from public.job_assignments where id=p_assignment;
 select * into g from cos_service_field.departure_starts where assignment_id=p_assignment;
 if not found or g.work_order_id::text is distinct from m->>'work_order_id' or g.membership_id::text is distinct from m->>'membership_id'
  or g.actor_id is distinct from auth.uid() or g.prep_ticket_id is distinct from p_prep
  or a.assignee_user_id is distinct from g.actor_id or a.started_at is distinct from g.started_at or a.status not in ('started','completed')
  or a.cancelled_at is not null then raise exception 'Prospective own Service departure witness unavailable';end if;
 return jsonb_build_object('id',g.id,'started_at',g.started_at,'work_order_id',g.work_order_id,'membership_id',g.membership_id,'actor_id',g.actor_id,'assignment_id',g.assignment_id,'prep_id',g.prep_ticket_id);
end$$;

create function cos_service_field.capture_departure_witness_v1(p_assignment uuid,p_prep uuid,p_claimed boolean)
returns jsonb language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare m jsonb;a public.job_assignments%rowtype;g cos_service_field.departure_starts%rowtype;
 ready jsonb;mc public.morning_checks%rowtype;ic public.service_truck_inventory_checks%rowtype;
 units jsonb;sims jsonb;stock jsonb;today date:=timezone('America/Chicago',now())::date;shared_done boolean;
begin
 m:=cos_mhelp_intake.lock_participant_v1(p_assignment,auth.uid(),p_prep,false);
 if m->>'department' is distinct from 'service' then raise exception 'Own Service departure required';end if;
 select * into strict a from public.job_assignments where id=p_assignment;
 -- Replay never rechecks an overwritten daily inventory row or creates a new
 -- timestamp. It is valid only for the exact actual Start already witnessed.
 if exists(select 1 from cos_service_field.departure_starts where assignment_id=p_assignment) then
  return cos_service_field.require_departure_start_v1(p_assignment,p_prep);
 end if;
 if a.work_type in ('delivery','swap') and (p_prep is null or not exists(select 1 from public.prep_tickets p where p.id=p_prep and p.status::text in ('released','closed') and not p.is_test)) then
  raise exception 'Released canonical handoff required before Service Start';end if;
 if p_claimed then
  if a.status is distinct from 'started' or a.started_at is distinct from transaction_timestamp() or a.claimed_at is distinct from transaction_timestamp()
   or a.completed_at is not null then raise exception 'Exact same-transaction genuine claim required';end if;
 else
  if a.status is distinct from 'assigned' or a.started_at is not null or a.completed_at is not null or a.claimed_at is not null then
   raise exception 'Prospective own Start required; historical Start cannot be adopted';end if;
 end if;
 -- Completion supplies this private seal checker; until it is installed, no
 -- activation wrapper may call this helper. There is no permissive fallback.
 if to_regprocedure('cos_service_field.shared_submission_recorded_v1(uuid)') is null then raise exception 'Shared completion seal unavailable';end if;
 execute 'select cos_service_field.shared_submission_recorded_v1($1)' into shared_done using (m->>'work_order_id')::uuid;
 if shared_done is distinct from false then raise exception 'Shared job already submitted; new Start requires Operations correction';end if;
 -- The genuine readiness routine can initialize baseline rows and refresh
 -- restock state. SRE excludes other writers without unsafe SHARE lock upgrades.
 lock table public.morning_checks,public.service_truck_inventory_checks,public.service_truck_units,
  public.service_truck_sims,public.service_truck_stock,public.service_truck_restock_requests in share row exclusive mode nowait;
 ready:=public.service_departure_readiness_v1(auth.uid());
 if ready->>'service_tech_id' is distinct from auth.uid()::text or ready->>'check_date' is distinct from today::text
  or ready->'inspection_ready' is distinct from 'true'::jsonb or ready->'inventory_ready' is distinct from 'true'::jsonb
  or ready->'departure_ready' is distinct from 'true'::jsonb then raise exception 'Genuine own departure checks required';end if;
 select * into mc from public.morning_checks c where c.service_tech_id=auth.uid()
  and timezone('America/Chicago',c.submitted_at)::date=today and not c.is_test
  and jsonb_typeof(c.truck_checks)='object' and (select count(*) from jsonb_each(c.truck_checks))=8
  and not exists(select 1 from jsonb_each(c.truck_checks) x where x.value<>'true'::jsonb)
  and (not c.taking_trailer or (jsonb_typeof(c.trailer_checks)='object' and (select count(*) from jsonb_each(c.trailer_checks))=7
    and not exists(select 1 from jsonb_each(c.trailer_checks) x where x.value<>'true'::jsonb)))
  order by c.submitted_at desc,c.id limit 1 for share nowait;
 if not found then raise exception 'Genuine current own inspection row required';end if;
 select * into ic from public.service_truck_inventory_checks c where c.service_tech_id=auth.uid() and c.check_date=today for share nowait;
 if not found or ic.ready is distinct from true or ready->'today_check'->>'id' is distinct from ic.id::text then raise exception 'Genuine current own inventory row required';end if;
 select jsonb_agg(to_jsonb(u) order by u.equipment_type) into units from public.service_truck_units u where u.service_tech_id=auth.uid();
 select jsonb_agg(to_jsonb(s) order by s.slot_no) into sims from public.service_truck_sims s where s.service_tech_id=auth.uid();
 select to_jsonb(s) into strict stock from public.service_truck_stock s where s.service_tech_id=auth.uid();
 insert into cos_service_field.departure_starts(work_order_id,membership_id,assignment_id,actor_id,prep_ticket_id,started_at,
  inspection_id,inventory_check_id,readiness_snapshot,inspection_snapshot,inventory_snapshot,units_snapshot,sims_snapshot,stock_snapshot)
 values((m->>'work_order_id')::uuid,(m->>'membership_id')::uuid,a.id,auth.uid(),p_prep,transaction_timestamp(),mc.id,ic.id,ready,to_jsonb(mc),to_jsonb(ic),units,sims,stock)
 returning * into g;
 return jsonb_build_object('id',g.id,'started_at',g.started_at,'work_order_id',g.work_order_id,'membership_id',g.membership_id,'actor_id',g.actor_id,'assignment_id',g.assignment_id,'prep_id',g.prep_ticket_id);
end$$;
create function cos_service_field.capture_departure_start_v1(p_assignment uuid,p_prep uuid) returns jsonb language sql security invoker set search_path='' as $$select cos_service_field.capture_departure_witness_v1(p_assignment,p_prep,false)$$;
create function cos_service_field.capture_claimed_departure_start_v1(p_assignment uuid,p_prep uuid) returns jsonb language sql security invoker set search_path='' as $$select cos_service_field.capture_departure_witness_v1(p_assignment,p_prep,true)$$;
revoke all on function cos_service_field.immutable_departure_v1(),cos_service_field.require_departure_start_v1(uuid,uuid),cos_service_field.capture_departure_witness_v1(uuid,uuid,boolean),cos_service_field.capture_departure_start_v1(uuid,uuid),cos_service_field.capture_claimed_departure_start_v1(uuid,uuid) from public,anon,authenticated,service_role;
commit;
