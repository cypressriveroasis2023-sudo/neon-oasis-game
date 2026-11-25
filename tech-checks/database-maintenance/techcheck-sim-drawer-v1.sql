-- Tech Check: SIM drawer — every SIM card on hand, and where each one went.
--
-- The owner keeps spare SIM cards in a drawer. This records them:
--   * app_private.sim_drawer: one row per card (number, carrier, status, where it is)
--   * app_private.sim_drawer_history: every add / hand-out / return / mark, with who and when
--   * public.sim_drawer_v1(): the list, for the owner and IT
--   * public.sim_drawer_add_v1(numbers, carrier, note): owner or IT add cards
--   * public.sim_drawer_mark_v1(number, status, note): owner or IT put a card back in
--     the drawer, or mark it bad / deactivated / removed
-- A card leaves the drawer by itself:
--   * when IT hands a unit over in Tech Check with that SIM (checkout), and comes back
--     if that handoff is cancelled;
--   * when that SIM is put in a Service truck's spare SIM slot.
-- Nothing is blocked yet: a handed-out SIM that is not in the drawer is recorded and
-- shown, so the drawer can be loaded first. app_private.sim_drawer_settings.require_listed
-- turns on refusing unlisted SIMs at checkout later.
--
-- Rollback: see the end of this file.

begin;

create table if not exists app_private.sim_drawer_settings(
  singleton boolean primary key default true check(singleton),
  require_listed boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into app_private.sim_drawer_settings(singleton) values(true) on conflict do nothing;

create table if not exists app_private.sim_drawer(
  sim_number text primary key check(sim_number ~ '^[0-9A-Z]{8,24}$'),
  carrier text check(carrier is null or length(carrier) between 1 and 40),
  status text not null default 'in_drawer' check(status in ('in_drawer','in_unit','on_truck','bad','deactivated','removed')),
  location text,                      -- e.g. "Sniper 332 → Josh Mireles" or "Josh Mireles's truck, slot 2"
  transfer_id uuid,
  note text check(note is null or length(note) <= 300),
  added_by uuid, added_by_name text, added_at timestamptz not null default now(),
  updated_by uuid, updated_by_name text, updated_at timestamptz not null default now()
);
create table if not exists app_private.sim_drawer_history(
  id bigserial primary key,
  sim_number text not null,
  event text not null check(event in ('added','handed_out','returned','to_truck','off_truck','marked','not_in_drawer')),
  status_after text,
  detail text,
  actor_id uuid, actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists sim_drawer_history_sim_idx on app_private.sim_drawer_history(sim_number, created_at desc);
revoke all on app_private.sim_drawer, app_private.sim_drawer_history, app_private.sim_drawer_settings from public, anon, authenticated;

create or replace function app_private.sim_clean_v1(p text) returns text language sql immutable set search_path='' as
$$ select nullif(upper(regexp_replace(coalesce(p,''), '[^0-9A-Za-z]', '', 'g')), '') $$;

create or replace function app_private.sim_actor_v1(out id uuid, out name text, out role text) language sql stable security definer set search_path='' as
$$ select auth.uid(), (select coalesce(nullif(btrim(full_name),''),username) from public.profiles where user_id=auth.uid()),
          (select role::text from public.profiles where user_id=auth.uid() and active) $$;

create or replace function public.sim_drawer_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or public.current_app_role() not in ('owner'::public.app_role,'it'::public.app_role) then
    raise exception 'Not authorized for this action' using errcode='42501';
  end if;
  return jsonb_build_object(
    'require_listed', (select require_listed from app_private.sim_drawer_settings where singleton),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('sim', d.sim_number, 'carrier', d.carrier, 'status', d.status,
        'location', d.location, 'note', d.note, 'added_by', d.added_by_name, 'added_at', d.added_at, 'updated_by', d.updated_by_name, 'updated_at', d.updated_at)
        order by (d.status='in_drawer') desc, d.updated_at desc) from app_private.sim_drawer d), '[]'::jsonb),
    'not_in_drawer', coalesce((select jsonb_agg(jsonb_build_object('sim', h.sim_number, 'detail', h.detail, 'by', h.actor_name, 'at', h.created_at) order by h.created_at desc)
        from (select * from app_private.sim_drawer_history where event='not_in_drawer' and created_at > now() - interval '30 days'
              and not exists(select 1 from app_private.sim_drawer d where d.sim_number=sim_drawer_history.sim_number) limit 100) h), '[]'::jsonb));
end $$;

create or replace function public.sim_drawer_add_v1(p_numbers text[], p_carrier text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; n text; v text; added text[] := '{}'; already text[] := '{}'; bad text[] := '{}';
  v_carrier text := nullif(btrim(coalesce(p_carrier,'')),''); v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  perform public.require_role(array['owner'::public.app_role,'it'::public.app_role]);
  select * into a from app_private.sim_actor_v1();
  if coalesce(array_length(p_numbers,1),0) = 0 or array_length(p_numbers,1) > 500 then raise exception 'Add between 1 and 500 SIM numbers.'; end if;
  if length(v_carrier) > 40 or length(v_note) > 300 then raise exception 'Carrier or note is too long.'; end if;
  foreach n in array p_numbers loop
    v := app_private.sim_clean_v1(n);
    if v is null then continue; end if;
    if v !~ '^[0-9A-Z]{8,24}$' then bad := bad || v; continue; end if;
    if exists(select 1 from app_private.sim_drawer where sim_number=v) then already := already || v; continue; end if;
    insert into app_private.sim_drawer(sim_number, carrier, note, added_by, added_by_name, updated_by, updated_by_name)
      values(v, v_carrier, v_note, a.id, a.name, a.id, a.name);
    insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
      values(v, 'added', 'in_drawer', concat_ws(' · ', v_carrier, v_note), a.id, a.name);
    added := added || v;
  end loop;
  return jsonb_build_object('added', to_jsonb(added), 'already_listed', to_jsonb(already), 'not_a_sim_number', to_jsonb(bad));
end $$;

create or replace function public.sim_drawer_mark_v1(p_number text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; v text := app_private.sim_clean_v1(p_number); d app_private.sim_drawer%rowtype; v_note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  perform public.require_role(array['owner'::public.app_role,'it'::public.app_role]);
  select * into a from app_private.sim_actor_v1();
  if p_status not in ('in_drawer','bad','deactivated','removed') then raise exception 'Choose In drawer, Bad, Deactivated or Removed.'; end if;
  if p_status <> 'in_drawer' and v_note is null then raise exception 'Write why this SIM is %.', replace(p_status,'_',' '); end if;
  if length(v_note) > 300 then raise exception 'Note is too long.'; end if;
  select * into d from app_private.sim_drawer where sim_number=v for update;
  if not found then raise exception 'SIM % is not on the drawer list.', coalesce(v, p_number); end if;
  update app_private.sim_drawer set status=p_status, location=case when p_status='in_drawer' then null else location end,
    transfer_id=case when p_status='in_drawer' then null else transfer_id end, note=coalesce(v_note, note),
    updated_by=a.id, updated_by_name=a.name, updated_at=now() where sim_number=v;
  insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
    values(v, 'marked', p_status, v_note, a.id, a.name);
  return jsonb_build_object('sim', v, 'status', p_status);
end $$;

-- Handoffs: a SIM IT hands over leaves the drawer; a cancelled handoff puts it back.
create or replace function app_private.sim_drawer_follow_transfer_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb; s text; v text; t app_private.techcheck_transfers%rowtype;
begin
  select * into t from app_private.techcheck_transfers where id=new.transfer_id;
  if new.kind = 'checkout' then
    for item in select value from jsonb_array_elements(coalesce(new.snapshot->'actual', '[]'::jsonb)) loop
      for s in select jsonb_array_elements_text(coalesce(item->'sims','[]'::jsonb)) loop
        v := app_private.sim_clean_v1(s);
        if v is null or v in ('NA','NONE','N') then continue; end if;
        if exists(select 1 from app_private.sim_drawer where sim_number=v) then
          update app_private.sim_drawer set status='in_unit', transfer_id=new.transfer_id,
            location=concat(item->>'family',' ',item->>'unit_tag',' → ',coalesce(t.service_name,'Service')),
            updated_by=new.actor_id, updated_by_name=new.actor_name, updated_at=now() where sim_number=v;
          insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
            values(v, 'handed_out', 'in_unit', concat(item->>'family',' ',item->>'unit_tag',' handed to ',coalesce(t.service_name,'Service')), new.actor_id, new.actor_name);
        else
          insert into app_private.sim_drawer_history(sim_number, event, detail, actor_id, actor_name)
            values(v, 'not_in_drawer', concat('Handed over in ',item->>'family',' ',item->>'unit_tag',' to ',coalesce(t.service_name,'Service')), new.actor_id, new.actor_name);
        end if;
      end loop;
    end loop;
  elsif new.kind = 'cancel' then
    for v in select sim_number from app_private.sim_drawer where transfer_id=new.transfer_id and status='in_unit' loop
      update app_private.sim_drawer set status='in_drawer', transfer_id=null, location=null, updated_by=new.actor_id, updated_by_name=new.actor_name, updated_at=now() where sim_number=v;
      insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
        values(v, 'returned', 'in_drawer', 'Handoff cancelled', new.actor_id, new.actor_name);
    end loop;
  end if;
  return null;
exception when others then
  -- The drawer must never stop a handoff from saving.
  raise warning 'sim drawer: %', sqlerrm;
  return null;
end $$;
drop trigger if exists sim_drawer_follow_transfer_v1 on app_private.techcheck_transfer_events;
create trigger sim_drawer_follow_transfer_v1 after insert on app_private.techcheck_transfer_events
  for each row execute function app_private.sim_drawer_follow_transfer_v1();

-- Service truck spare SIM slots: a drawer SIM put in a slot is on that truck.
create or replace function app_private.sim_drawer_follow_truck_v1() returns trigger language plpgsql security definer set search_path='' as $$
declare v_new text := app_private.sim_clean_v1(new.sim_number); v_old text := app_private.sim_clean_v1(old.sim_number); a record; tech text;
begin
  if v_new is not distinct from v_old then return null; end if;
  select * into a from app_private.sim_actor_v1();
  select coalesce(nullif(btrim(full_name),''),username,'Service') into tech from public.profiles where user_id=new.service_tech_id;
  if v_old is not null and exists(select 1 from app_private.sim_drawer where sim_number=v_old and status='on_truck') then
    update app_private.sim_drawer set status='in_unit', location='Used from '||tech||'''s truck', updated_by=a.id, updated_by_name=a.name, updated_at=now() where sim_number=v_old;
    insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
      values(v_old, 'off_truck', 'in_unit', 'Taken off '||tech||'''s truck, slot '||new.slot_no, a.id, coalesce(a.name,'System'));
  end if;
  if v_new is not null and exists(select 1 from app_private.sim_drawer where sim_number=v_new) then
    update app_private.sim_drawer set status='on_truck', transfer_id=null, location=tech||'''s truck, slot '||new.slot_no, updated_by=a.id, updated_by_name=a.name, updated_at=now() where sim_number=v_new;
    insert into app_private.sim_drawer_history(sim_number, event, status_after, detail, actor_id, actor_name)
      values(v_new, 'to_truck', 'on_truck', tech||'''s truck, slot '||new.slot_no, a.id, coalesce(a.name,'System'));
  end if;
  return null;
exception when others then
  raise warning 'sim drawer: %', sqlerrm;
  return null;
end $$;
drop trigger if exists sim_drawer_follow_truck_v1 on public.service_truck_sims;
create trigger sim_drawer_follow_truck_v1 after update on public.service_truck_sims
  for each row execute function app_private.sim_drawer_follow_truck_v1();

revoke all on function app_private.sim_drawer_follow_transfer_v1(), app_private.sim_drawer_follow_truck_v1(), app_private.sim_actor_v1() from public, anon, authenticated;
revoke all on function public.sim_drawer_v1(), public.sim_drawer_add_v1(text[],text,text), public.sim_drawer_mark_v1(text,text,text) from public, anon;
grant execute on function public.sim_drawer_v1(), public.sim_drawer_add_v1(text[],text,text), public.sim_drawer_mark_v1(text,text,text) to authenticated;

commit;

-- Rollback (keeps the drawer tables and their history):
--   drop trigger if exists sim_drawer_follow_transfer_v1 on app_private.techcheck_transfer_events;
--   drop trigger if exists sim_drawer_follow_truck_v1 on public.service_truck_sims;
--   drop function if exists public.sim_drawer_v1(), public.sim_drawer_add_v1(text[],text,text), public.sim_drawer_mark_v1(text,text,text);
