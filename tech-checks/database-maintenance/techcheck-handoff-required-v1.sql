-- Tech Check: a unit goes on a Service truck only through a signed IT handoff.
--
-- Before this change a Service tech could type any unit number into a truck
-- slot (service_save_my_truck_inventory_v3, also used by the daily report),
-- and nothing asked for an IT checkout, photos or signatures. Since 26 Oct 2026
-- about 15 units went on trucks that way and no handoff was recorded.
--
-- After this change:
--   * Putting a NEW unit number into a Service truck slot needs an accepted
--     IT -> Service handoff of that exact unit, to that same tech, and that
--     unit must not have gone onto any other truck since the handoff.
--   * Units already on trucks are left where they are. Saving the same unit
--     again, emptying a slot, or a daily check with no change still works.
--   * The owner can still load a unit without a handoff, but only through
--     public.owner_load_truck_unit_without_handoff_v1 with a written reason,
--     and every such load is recorded with who, when and why. A plain owner
--     truck edit with no reason is recorded too, as "no reason given".
--   * IT and Service cannot get around it.
--   * public.techcheck_handoff_gaps_v1 lists, for the morning report and the
--     5:15 check: units on trucks with no handoff, loads without a handoff,
--     and handoffs that IT started but Service has not finished within 4 hours.
--
-- Switch: app_private.techcheck_handoff_enforcement.mode
--   'enforce' (default) blocks; 'log' allows and records instead.
-- Rollback: see the end of this file.

begin;

create table if not exists app_private.techcheck_handoff_enforcement(
  singleton boolean primary key default true check(singleton),
  mode text not null default 'enforce' check(mode in ('enforce','log')),
  awaiting_service_hours integer not null default 4 check(awaiting_service_hours between 1 and 72),
  updated_at timestamptz not null default now()
);
insert into app_private.techcheck_handoff_enforcement(singleton) values(true) on conflict do nothing;

create table if not exists app_private.techcheck_handoff_exceptions(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  service_tech_id uuid not null,
  service_tech_name text,
  equipment_type text not null,
  unit_tag text not null,
  actor_id uuid,
  actor_name text not null,
  actor_role text not null,
  reason text not null,
  kind text not null check(kind in ('owner_override','owner_edit_no_reason','system','log_mode'))
);
create index if not exists techcheck_handoff_exceptions_created_idx on app_private.techcheck_handoff_exceptions(created_at desc);
revoke all on app_private.techcheck_handoff_enforcement, app_private.techcheck_handoff_exceptions from public, anon, authenticated;

-- The accepted handoff that covers this unit on this tech's truck, or null.
create or replace function app_private.techcheck_handoff_covering_v1(p_service_tech_id uuid, p_equipment_type text, p_unit_tag text)
returns uuid language sql stable security definer set search_path='' as $$
  with keys as (
    select e.equipment_key from public.equipment_master e
    where e.canonical_family = p_equipment_type
      and lower(btrim(e.unit_tag)) = lower(btrim(p_unit_tag))
  ), latest as (
    select t.id, t.service_actor, t.updated_at
    from app_private.techcheck_transfers t
    where t.state = 'accepted'
      and exists(select 1 from keys k, jsonb_array_elements(t.manifest) m where m->>'equipment_key' = k.equipment_key)
    order by t.updated_at desc
    limit 1
  )
  select l.id from latest l
  where l.service_actor = p_service_tech_id
    -- one handoff covers the unit until it goes onto a different truck
    and not exists(
      select 1 from public.service_truck_inventory_audit a
      where a.item_kind = 'unit' and a.item_slot = p_equipment_type
        and lower(btrim(a.after_value)) = lower(btrim(p_unit_tag))
        and a.service_tech_id is distinct from p_service_tech_id
        and a.created_at > l.updated_at)
$$;
revoke all on function app_private.techcheck_handoff_covering_v1(uuid,text,text) from public, anon, authenticated;

-- The message a Service tech sees when a unit is refused. It always ends with
-- the one next step for them, using the button names on their screens.
create or replace function app_private.techcheck_handoff_next_step_v1(p_service_tech_id uuid, p_equipment_type text, p_unit_tag text)
returns text language plpgsql stable security definer set search_path='' as $$
declare
  v_unit text := p_equipment_type || ' ' || btrim(p_unit_tag);
  v_t app_private.techcheck_transfers%rowtype;
begin
  if not exists(select 1 from public.equipment_master e where e.canonical_family = p_equipment_type
                and lower(btrim(e.unit_tag)) = lower(btrim(p_unit_tag))) then
    return format('%s was not added to your truck. It is not in the COS equipment list, so it can''t be handed over yet. NEXT STEP: Check the unit number. If it is right, tell James so he can add it. Then IT will hand it to you.', v_unit);
  end if;

  select t.* into v_t from app_private.techcheck_transfers t
  where exists(select 1 from public.equipment_master e, jsonb_array_elements(t.manifest) m
               where e.canonical_family = p_equipment_type and lower(btrim(e.unit_tag)) = lower(btrim(p_unit_tag))
                 and m->>'equipment_key' = e.equipment_key)
  order by t.updated_at desc limit 1;

  if not found or v_t.state in ('cancelled','returned_review','returned_repair') then
    return format('%s was not added to your truck. IT has not handed it to you in the app. NEXT STEP: Ask IT (Teddy or Victor) to tap "Check Out / Hand Off" in Tech Check for %s and pick your name. Then open "Equipment received from IT", tap "Verify equipment received", take the photos and sign.', v_unit, v_unit);
  elsif v_t.service_actor is distinct from p_service_tech_id then
    return format('%s was not added to your truck. IT handed it to %s, not to you. NEXT STEP: Ask IT to hand %s to you in Tech Check. If %s gave it to you, tell James.', v_unit, coalesce(v_t.service_name,'another tech'), v_unit, coalesce(v_t.service_name,'that tech'));
  elsif v_t.state = 'awaiting_service' then
    return format('%s was not added to your truck. IT already handed it to you. It is waiting for YOUR signature. NEXT STEP: Open "Equipment received from IT" in Tech Check, tap "Verify equipment received" on %s, take the photos and sign.', v_unit, v_unit);
  elsif v_t.state = 'discrepancy' then
    return format('%s was not added to your truck. Your receipt did not match what IT sent, so IT or James has to review it first. NEXT STEP: Call IT or James and tell them %s is waiting for review. You don''t need to sign again.', v_unit, v_unit);
  else
    return format('%s was not added to your truck. Its handoff was already used for another truck. NEXT STEP: Ask IT to hand %s to you again in Tech Check, then sign for it under "Equipment received from IT".', v_unit, v_unit);
  end if;
end
$$;
revoke all on function app_private.techcheck_handoff_next_step_v1(uuid,text,text) from public, anon, authenticated;

create or replace function app_private.techcheck_handoff_required_guard_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_tag text := nullif(btrim(coalesce(new.unit_tag,'')),'');
  v_mode text;
  v_role text;
  v_actor text;
  v_tech text;
  v_reason text := nullif(btrim(coalesce(current_setting('cos.handoff_override_reason', true),'')),'');
  v_kind text;
begin
  if v_tag is null or new.status is distinct from 'assigned' then return new; end if;
  if tg_op = 'UPDATE' and lower(btrim(coalesce(old.unit_tag,''))) = lower(v_tag)
     and old.service_tech_id is not distinct from new.service_tech_id then
    return new;  -- same unit, same truck: nothing new is being handed over
  end if;
  if app_private.techcheck_handoff_covering_v1(new.service_tech_id, new.equipment_type, v_tag) is not null then
    return new;
  end if;

  select coalesce(mode,'enforce') into v_mode from app_private.techcheck_handoff_enforcement where singleton;
  v_mode := coalesce(v_mode,'enforce');
  select p.role::text, coalesce(p.full_name,p.username) into v_role, v_actor
    from public.profiles p where p.user_id = auth.uid() and p.active;
  select coalesce(p.full_name,p.username,'Service Tech') into v_tech
    from public.profiles p where p.user_id = new.service_tech_id;

  if auth.uid() is null then
    v_kind := 'system'; v_role := 'system'; v_actor := 'System'; v_reason := coalesce(v_reason,'System change with no signed-in person');
  elsif v_role = 'owner' then
    v_kind := case when v_reason is null then 'owner_edit_no_reason' else 'owner_override' end;
    v_reason := coalesce(v_reason,'No reason given');
  elsif v_mode = 'log' then
    v_kind := 'log_mode'; v_reason := 'Loaded without a handoff while enforcement was set to log';
  else
    raise exception using
      errcode = 'P0001',
      message = app_private.techcheck_handoff_next_step_v1(new.service_tech_id, new.equipment_type, v_tag),
      hint = 'handoff_required';
  end if;

  insert into app_private.techcheck_handoff_exceptions(service_tech_id, service_tech_name, equipment_type, unit_tag, actor_id, actor_name, actor_role, reason, kind)
  values(new.service_tech_id, v_tech, new.equipment_type, v_tag, auth.uid(), coalesce(v_actor,'Unknown'), coalesce(v_role,'unknown'), v_reason, v_kind);
  return new;
end
$$;
revoke all on function app_private.techcheck_handoff_required_guard_v1() from public, anon, authenticated;

drop trigger if exists techcheck_handoff_required_guard_v1 on public.service_truck_units;
create trigger techcheck_handoff_required_guard_v1
  before insert or update on public.service_truck_units
  for each row execute function app_private.techcheck_handoff_required_guard_v1();

-- Owner only: load a unit without a handoff, with a written reason that is kept.
create or replace function public.owner_load_truck_unit_without_handoff_v1(p_service_tech_id uuid, p_equipment_type text, p_unit_tag text, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reason text := btrim(coalesce(p_reason,'')); v_tag text := nullif(btrim(coalesce(p_unit_tag,'')),''); v_n integer;
begin
  perform public.require_role(array['owner'::public.app_role]);
  if v_tag is null then raise exception 'Enter the unit number.'; end if;
  if length(v_reason) < 10 then raise exception 'Write why this unit is going on the truck without a handoff (at least 10 characters).'; end if;
  if exists(select 1 from public.service_truck_units u where u.service_tech_id <> p_service_tech_id and u.status = 'assigned'
            and lower(btrim(coalesce(u.unit_tag,''))) = lower(v_tag)) then
    raise exception 'Unit % is already assigned to another Service truck.', v_tag;
  end if;
  perform set_config('cos.handoff_override_reason', v_reason, true);
  update public.service_truck_units
     set unit_tag = v_tag, status = 'assigned', assigned_by = auth.uid(),
         assigned_by_name = (select coalesce(full_name,username) from public.profiles where user_id = auth.uid()),
         assigned_at = now(), updated_at = now()
   where service_tech_id = p_service_tech_id and equipment_type = p_equipment_type;
  get diagnostics v_n = row_count;
  perform set_config('cos.handoff_override_reason', '', true);
  if v_n = 0 then raise exception 'That truck has no % slot.', p_equipment_type; end if;
  update public.service_truck_inventory_checks set ready = false, updated_at = now()
   where service_tech_id = p_service_tech_id and check_date = timezone('America/Chicago', now())::date;
  return jsonb_build_object('ok', true, 'equipment_type', p_equipment_type, 'unit_tag', v_tag);
end
$$;
revoke all on function public.owner_load_truck_unit_without_handoff_v1(uuid,text,text,text) from public, anon;
grant execute on function public.owner_load_truck_unit_without_handoff_v1(uuid,text,text,text) to authenticated;

-- Read-only list for the morning report and the 5:15 check. Owner, or a
-- server-side run with no signed-in person (the report runs).
create or replace function public.techcheck_handoff_gaps_v1(p_since timestamptz default now() - interval '24 hours')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_hours integer;
begin
  if auth.uid() is not null and public.current_app_role() is distinct from 'owner'::public.app_role then
    raise exception 'Not authorized for this action';
  end if;
  select awaiting_service_hours into v_hours from app_private.techcheck_handoff_enforcement where singleton;
  v_hours := coalesce(v_hours, 4);
  return jsonb_build_object(
    'checked_at', now(),
    'since', p_since,
    'mode', (select mode from app_private.techcheck_handoff_enforcement where singleton),
    'on_truck_without_handoff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'service_tech', coalesce(p.full_name,p.username,'Service Tech'),
               'equipment_type', u.equipment_type, 'unit_tag', u.unit_tag,
               'loaded_by', u.assigned_by_name, 'loaded_at', u.assigned_at,
               'in_equipment_list', exists(select 1 from public.equipment_master e where e.canonical_family=u.equipment_type and lower(btrim(e.unit_tag))=lower(btrim(u.unit_tag))))
             order by coalesce(p.full_name,p.username), u.equipment_type)
      from public.service_truck_units u
      left join public.profiles p on p.user_id = u.service_tech_id
      where u.status is distinct from 'unassigned' and nullif(btrim(coalesce(u.unit_tag,'')),'') is not null
        and coalesce(p.full_name,p.username,'') not ilike 'test %'
        and app_private.techcheck_handoff_covering_v1(u.service_tech_id, u.equipment_type, u.unit_tag) is null), '[]'::jsonb),
    'loaded_without_handoff', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.created_at, 'service_tech', x.service_tech_name, 'equipment_type', x.equipment_type,
               'unit_tag', x.unit_tag, 'by', x.actor_name, 'role', x.actor_role, 'reason', x.reason, 'kind', x.kind) order by x.created_at desc)
      from app_private.techcheck_handoff_exceptions x where x.created_at >= p_since), '[]'::jsonb),
    'handoffs_not_finished', coalesce((
      select jsonb_agg(jsonb_build_object('transfer_id', t.id, 'state', t.state, 'from', t.it_name, 'to', t.service_name,
               'started_at', t.created_at, 'last_step_at', t.updated_at,
               'hours_waiting', round(extract(epoch from now() - t.updated_at)/3600.0, 1),
               'units', (select jsonb_agg(coalesce(m->>'family','')||' '||coalesce(m->>'unit_tag','')) from jsonb_array_elements(t.manifest) m))
             order by t.updated_at)
      from app_private.techcheck_transfers t
      where t.state <> 'accepted' and t.state not ilike '%cancel%'
        and t.updated_at < now() - make_interval(hours => v_hours)), '[]'::jsonb)
  );
end
$$;
revoke all on function public.techcheck_handoff_gaps_v1(timestamptz) from public, anon;
grant execute on function public.techcheck_handoff_gaps_v1(timestamptz) to authenticated, service_role;

commit;

-- Rollback (leaves the recorded exceptions in place):
--   drop trigger if exists techcheck_handoff_required_guard_v1 on public.service_truck_units;
--   drop function if exists public.owner_load_truck_unit_without_handoff_v1(uuid,text,text,text);
--   drop function if exists public.techcheck_handoff_gaps_v1(timestamptz);
--   drop function if exists app_private.techcheck_handoff_required_guard_v1();
--   drop function if exists app_private.techcheck_handoff_covering_v1(uuid,text,text);
-- Softer: update app_private.techcheck_handoff_enforcement set mode='log';
