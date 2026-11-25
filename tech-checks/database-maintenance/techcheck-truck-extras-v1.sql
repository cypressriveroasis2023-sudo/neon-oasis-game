-- Tech Check: truck standard, extra units, and tech-to-tech moves.
--
-- What James asked for (2026-11-25):
--   * A standard: how many of each unit every Service truck must carry (starts at 1 each).
--   * Extras: IT can hand a tech more of the same unit through the normal handoff, each
--     tracked by its own number.
--   * Tech to tech: one tech gives a unit to another in the app. The giver picks the unit,
--     the other tech and takes a photo. The receiver checks it, takes a photo and signs.
--     Then the unit moves from one truck to the other.
--   * Manager tab: every truck shows "Has X of Y" for each unit type.
--
-- Design. public.service_truck_units stays exactly as it is: one slot per unit type per
-- truck. About 30 functions read it, so it is not changed. Extras live in their own table.
-- A truck "has" a unit type = its slot when assigned + its extras.
--
-- Also fixes: a unit a tech accepted from IT kept its handoff hold forever, so a swap or a
-- return of that unit was refused ("This unit has a signed handoff or intake hold"). The
-- hold of an ACCEPTED handoff to the same tech is now released when that tech swaps,
-- returns, or hands the unit to another tech. An unfinished handoff still blocks.
--
-- Every edit to an existing function is anchored: the anchor text must be found exactly
-- once or nothing changes. Old definitions are saved in
-- app_private.truck_extras_backup_v1. Re-running is a no-op.

-- ---------------------------------------------------------------- tables

create table if not exists app_private.truck_extras_backup_v1(fn text primary key, definition text not null, saved_at timestamptz not null default now());
revoke all on app_private.truck_extras_backup_v1 from public, anon, authenticated;

create table if not exists app_private.truck_standard(
  equipment_type text primary key check (equipment_type in ('Sniper','Ranger','Spotter','Solar Spotter')),
  required integer not null default 1 check (required between 0 and 10),
  updated_at timestamptz not null default now(),
  updated_by_name text not null default 'Setup');
insert into app_private.truck_standard(equipment_type) values ('Sniper'),('Ranger'),('Spotter'),('Solar Spotter') on conflict do nothing;
revoke all on app_private.truck_standard from public, anon, authenticated;

create table if not exists app_private.truck_extra_units(
  id uuid primary key default gen_random_uuid(),
  service_tech_id uuid not null,
  equipment_type text not null check (equipment_type in ('Sniper','Ranger','Spotter','Solar Spotter')),
  unit_tag text not null check (length(btrim(unit_tag)) between 1 and 40),
  came_from text not null check (came_from in ('it_handoff','tech_move','own_slot','owner')),
  came_ref uuid,
  added_at timestamptz not null default now(),
  added_by uuid,
  added_by_name text not null,
  removed_at timestamptz,
  removed_why text check (removed_why in ('given_to_tech','used_in_swap','returned_to_it','moved_to_slot','owner_removed')),
  removed_ref uuid,
  removed_by_name text,
  check ((removed_at is null) = (removed_why is null)));
create unique index if not exists truck_extra_units_one_place on app_private.truck_extra_units(equipment_type, lower(btrim(unit_tag))) where removed_at is null;
create index if not exists truck_extra_units_tech on app_private.truck_extra_units(service_tech_id) where removed_at is null;
revoke all on app_private.truck_extra_units from public, anon, authenticated;

create table if not exists app_private.truck_moves(
  id uuid primary key,                       -- the giver's request id, so a retried send is not doubled
  from_tech uuid not null, from_name text not null,
  to_tech uuid not null, to_name text not null,
  equipment_type text not null, unit_tag text not null,
  from_place text not null check (from_place in ('slot','extra')),
  give_photos text[] not null, give_note text not null default '',
  state text not null default 'waiting' check (state in ('waiting','accepted','refused','cancelled')),
  checks jsonb, take_photos text[], signature jsonb, take_note text,
  to_place text check (to_place in ('slot','extra')),
  created_at timestamptz not null default now(), decided_at timestamptz,
  check (from_tech <> to_tech));
create unique index if not exists truck_moves_one_waiting on app_private.truck_moves(equipment_type, lower(btrim(unit_tag))) where state = 'waiting';
revoke all on app_private.truck_moves from public, anon, authenticated;

-- Photos and drawn signatures for moves: <uid>/<move id>/<sha256>.jpg in their own bucket.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('techcheck-truck-moves','techcheck-truck-moves',false,5242880,array['image/jpeg']) on conflict (id) do nothing;

create or replace function app_private.truck_move_file_v1(p_path text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where user_id = auth.uid() and active and role::text in ('service','it','owner');
  if not found then return false; end if;
  if p_path ~ ('^' || p.user_id::text || '/[a-f0-9-]{36}/[a-f0-9]{64}[.]jpg$') then return true; end if;
  if p_write then return false; end if;
  return exists(select 1 from app_private.truck_moves m
    where (p.role::text in ('it','owner') or p.user_id in (m.from_tech, m.to_tech))
      and (p_path = any(m.give_photos) or p_path = any(coalesce(m.take_photos,'{}')) or p_path = m.signature->>'path'));
end $$;
revoke all on function app_private.truck_move_file_v1(text,boolean) from public, anon, service_role;
grant execute on function app_private.truck_move_file_v1(text,boolean) to authenticated;
drop policy if exists truck_moves_insert_v1 on storage.objects;
create policy truck_moves_insert_v1 on storage.objects for insert to authenticated
  with check (bucket_id = 'techcheck-truck-moves' and app_private.truck_move_file_v1(name, true));
drop policy if exists truck_moves_read_v1 on storage.objects;
create policy truck_moves_read_v1 on storage.objects for select to authenticated
  using (bucket_id = 'techcheck-truck-moves' and app_private.truck_move_file_v1(name, false));

-- Each saved photo must be this tech's own upload for this move.
create or replace function app_private.truck_move_photos_ok_v1(p_move uuid, p_paths text[], p_min integer) returns void
language plpgsql security definer set search_path='' as $$
declare path text;
begin
  if p_paths is null or cardinality(p_paths) < p_min then raise exception 'Take at least % photo of the unit.', p_min; end if;
  if cardinality(p_paths) > 8 then raise exception 'Use no more than eight photos.'; end if;
  foreach path in array p_paths loop
    if path is null or path !~ ('^' || auth.uid()::text || '/' || p_move::text || '/[a-f0-9]{64}[.]jpg$')
       or not exists(select 1 from storage.objects where bucket_id = 'techcheck-truck-moves' and name = path
                     and metadata->>'mimetype' = 'image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880) then
      raise exception 'A photo did not finish saving. Tap Send again.';
    end if;
  end loop;
end $$;
revoke all on function app_private.truck_move_photos_ok_v1(uuid,text[],integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- where is a unit?

-- Every place a unit can sit on a truck right now: its slot (assigned) or an extra.
create or replace function app_private.truck_unit_places_v1(p_type text, p_tag text)
returns table(service_tech_id uuid, place text, extra_id uuid)
language sql stable security definer set search_path='' as $$
  select u.service_tech_id, 'slot', null::uuid from public.service_truck_units u
   where u.equipment_type = p_type and u.status = 'assigned' and lower(btrim(coalesce(u.unit_tag,''))) = lower(btrim(p_tag))
  union all
  select x.service_tech_id, 'extra', x.id from app_private.truck_extra_units x
   where x.removed_at is null and x.equipment_type = p_type and lower(btrim(x.unit_tag)) = lower(btrim(p_tag))
$$;
revoke all on function app_private.truck_unit_places_v1(text,text) from public, anon, authenticated;

-- One truck, type by type: the standard, what it has, and every unit by number.
create or replace function app_private.truck_kinds_v1(p_tech uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'type', s.equipment_type, 'required', s.required,
    'have', (case when u.status = 'assigned' and nullif(btrim(u.unit_tag),'') is not null then 1 else 0 end)
            + (select count(*) from app_private.truck_extra_units x where x.service_tech_id = p_tech and x.removed_at is null and x.equipment_type = s.equipment_type),
    'slot', case when u.status = 'assigned' and nullif(btrim(u.unit_tag),'') is not null then jsonb_build_object('tag', u.unit_tag) end,
    'slot_used', u.status = 'used_restock_due',
    'extras', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tag', x.unit_tag, 'came_from', x.came_from, 'added_at', x.added_at) order by x.added_at)
                        from app_private.truck_extra_units x where x.service_tech_id = p_tech and x.removed_at is null and x.equipment_type = s.equipment_type), '[]'::jsonb)
  ) order by array_position(array['Sniper','Ranger','Spotter','Solar Spotter'], s.equipment_type)), '[]'::jsonb)
  from app_private.truck_standard s
  left join public.service_truck_units u on u.service_tech_id = p_tech and u.equipment_type = s.equipment_type
$$;
revoke all on function app_private.truck_kinds_v1(uuid) from public, anon, authenticated;

-- The signed-in Service tech.
create or replace function app_private.truck_me_v1() returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where user_id = auth.uid() and active and archived_at is null;
  if not found or p.role::text <> 'service' then raise exception 'Sign in as a Service technician.' using errcode = '42501'; end if;
  return p;
end $$;
revoke all on function app_private.truck_me_v1() from public, anon, authenticated;

-- ---------------------------------------------------------------- what a Service tech sees

-- Units IT handed this tech (accepted, for the truck, since handoffs became required) that
-- have not been put on any truck yet.
create or replace function app_private.truck_from_it_v1(p_tech uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', e.canonical_family, 'tag', e.unit_tag, 'handoff_id', t.id,
           'from', t.it_name, 'accepted_at', t.updated_at) order by t.updated_at, e.canonical_family, e.unit_tag), '[]'::jsonb)
  from app_private.techcheck_transfers t
  cross join lateral jsonb_array_elements(t.manifest) m
  join public.equipment_master e on e.equipment_key = m->>'equipment_key'
  where t.state = 'accepted' and t.service_actor = p_tech and t.purpose = 'truck_replenishment'
    and t.updated_at >= timestamptz '2026-11-25 00:00:00-06'
    and e.canonical_family in ('Sniper','Ranger','Spotter','Solar Spotter')
    and app_private.techcheck_handoff_covering_v1(p_tech, e.canonical_family, e.unit_tag) = t.id
    and not exists(select 1 from app_private.truck_unit_places_v1(e.canonical_family, e.unit_tag))
    -- never placed since it was accepted: no truck slot change and no extra for it
    and not exists(select 1 from public.service_truck_inventory_audit a where a.item_kind = 'unit' and a.item_slot = e.canonical_family
                   and lower(btrim(a.after_value)) = lower(btrim(e.unit_tag)) and a.created_at > t.updated_at)
    and not exists(select 1 from app_private.truck_extra_units x where x.equipment_type = e.canonical_family
                   and lower(btrim(x.unit_tag)) = lower(btrim(e.unit_tag)) and x.added_at > t.updated_at)
$$;
revoke all on function app_private.truck_from_it_v1(uuid) from public, anon, authenticated;

create or replace function app_private.truck_move_json_v1(m app_private.truck_moves) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id', m.id, 'from_id', m.from_tech, 'from', m.from_name, 'to_id', m.to_tech, 'to', m.to_name,
    'type', m.equipment_type, 'tag', m.unit_tag, 'state', m.state, 'note', m.give_note, 'photos', to_jsonb(m.give_photos),
    'take_note', m.take_note, 'take_photos', to_jsonb(m.take_photos), 'checks', m.checks, 'to_place', m.to_place,
    'sent_at', m.created_at, 'decided_at', m.decided_at)
$$;
revoke all on function app_private.truck_move_json_v1(app_private.truck_moves) from public, anon, authenticated;

create or replace function public.truck_my_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
  p := app_private.truck_me_v1();
  return jsonb_build_object(
    'me', jsonb_build_object('id', p.user_id, 'name', coalesce(nullif(p.full_name,''), p.username)),
    'kinds', app_private.truck_kinds_v1(p.user_id),
    'coming', coalesce((select jsonb_agg(app_private.truck_move_json_v1(m) order by m.created_at) from app_private.truck_moves m where m.to_tech = p.user_id and m.state = 'waiting'), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(app_private.truck_move_json_v1(m) order by m.created_at) from app_private.truck_moves m where m.from_tech = p.user_id and m.state = 'waiting'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(app_private.truck_move_json_v1(x) order by x.decided_at desc) from (
        select * from app_private.truck_moves m where p.user_id in (m.from_tech, m.to_tech) and m.state <> 'waiting'
        and m.decided_at > now() - interval '3 days' order by m.decided_at desc limit 10) x), '[]'::jsonb),
    'from_it', app_private.truck_from_it_v1(p.user_id),
    'techs', coalesce((select jsonb_agg(jsonb_build_object('id', o.user_id, 'name', coalesce(nullif(o.full_name,''), o.username)) order by coalesce(nullif(o.full_name,''), o.username))
        from public.profiles o where o.active and o.role::text = 'service' and o.user_id <> p.user_id
          and coalesce(nullif(o.full_name,''), o.username) !~* '^test'), '[]'::jsonb));
end $$;
revoke all on function public.truck_my_v1() from public, anon;
grant execute on function public.truck_my_v1() to authenticated;

-- ---------------------------------------------------------------- IT unit onto my truck

create or replace function public.truck_put_from_it_v1(p_type text, p_tag text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; v_item jsonb; s public.service_truck_units%rowtype; v_name text;
begin
  p := app_private.truck_me_v1();
  v_name := coalesce(nullif(p.full_name,''), p.username);
  perform pg_advisory_xact_lock(hashtextextended('truck:' || lower(coalesce(p_type,'')) || ':' || lower(btrim(coalesce(p_tag,''))), 7));
  select x into v_item from jsonb_array_elements(app_private.truck_from_it_v1(p.user_id)) x
   where x->>'type' = p_type and lower(x->>'tag') = lower(btrim(coalesce(p_tag,''))) limit 1;
  if v_item is null then
    if exists(select 1 from app_private.truck_unit_places_v1(p_type, btrim(coalesce(p_tag,''))) w where w.service_tech_id = p.user_id) then
      return public.truck_my_v1();  -- already on my truck: a retried tap
    end if;
    raise exception '% % is not waiting to go on your truck. NEXT STEP: Pull down to refresh. If it is still missing, ask IT to check the handoff.', p_type, btrim(coalesce(p_tag,''));
  end if;
  select * into s from public.service_truck_units where service_tech_id = p.user_id and equipment_type = p_type for update;
  if found and (s.status <> 'assigned' or nullif(btrim(s.unit_tag),'') is null) then
    update public.service_truck_units set unit_tag = v_item->>'tag', status = 'assigned', last_used_ticket_no = null, last_used_at = null,
           old_unit_tag = null, assigned_by = p.user_id, assigned_by_name = v_name, assigned_at = now(), updated_at = now()
     where service_tech_id = p.user_id and equipment_type = p_type;
  else
    insert into app_private.truck_extra_units(service_tech_id, equipment_type, unit_tag, came_from, came_ref, added_by, added_by_name)
    values (p.user_id, p_type, v_item->>'tag', 'it_handoff', (v_item->>'handoff_id')::uuid, p.user_id, v_name);
  end if;
  return public.truck_my_v1();
end $$;
revoke all on function public.truck_put_from_it_v1(text,text) from public, anon;
grant execute on function public.truck_put_from_it_v1(text,text) to authenticated;

-- ---------------------------------------------------------------- tech to tech

create or replace function public.truck_give_v1(p_move uuid, p_to uuid, p_type text, p_tag text, p_photos text[], p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; o public.profiles%rowtype; m app_private.truck_moves%rowtype;
  v_tag text := btrim(coalesce(p_tag,'')); v_place text; v_name text; v_to text;
begin
  p := app_private.truck_me_v1();
  if p_move is null then raise exception 'Tap Send again.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_move::text, 7));
  select * into m from app_private.truck_moves where id = p_move;
  if found then
    if m.from_tech = p.user_id and m.to_tech = p_to and m.equipment_type = p_type and lower(m.unit_tag) = lower(v_tag) then return public.truck_my_v1(); end if;
    raise exception 'This send was already used for something else. Start again.';
  end if;
  select * into o from public.profiles where user_id = p_to and active and role::text = 'service';
  if not found or p_to = p.user_id then raise exception 'Pick the Service tech you are giving it to.'; end if;
  if p_type not in ('Sniper','Ranger','Spotter','Solar Spotter') or v_tag = '' then raise exception 'Pick the unit you are giving.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('truck:' || lower(p_type) || ':' || lower(v_tag), 7));
  if exists(select 1 from app_private.truck_moves w where w.state = 'waiting' and w.equipment_type = p_type and lower(w.unit_tag) = lower(v_tag)) then
    raise exception '% % is already on its way to someone. NEXT STEP: Open "Sent, waiting" and cancel that one first.', p_type, v_tag;
  end if;
  select w.place into v_place from app_private.truck_unit_places_v1(p_type, v_tag) w where w.service_tech_id = p.user_id;
  if v_place is null then
    raise exception '% % is not on your truck in the app. NEXT STEP: Check the unit number. If it really is on your truck, tell James.', p_type, v_tag;
  end if;
  if not exists(select 1 from public.equipment_master e where e.canonical_family = p_type and lower(btrim(e.unit_tag)) = lower(v_tag)) then
    raise exception '% % is not in the COS equipment list, so it cannot be moved in the app yet. NEXT STEP: Tell James the unit number.', p_type, v_tag;
  end if;
  if exists(select 1 from app_private.techcheck_ticketfree_returns_v1 r where r.state in ('waiting_it','identity_review')
            and ((r.family = p_type and lower(r.unit_tag) = lower(v_tag)) or (r.used_family = p_type and lower(r.used_tag) = lower(v_tag)))) then
    raise exception '% % is part of a return waiting for IT. NEXT STEP: Ask IT to finish that check-in first.', p_type, v_tag;
  end if;
  if length(coalesce(p_note,'')) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  perform app_private.truck_move_photos_ok_v1(p_move, p_photos, 1);
  v_name := coalesce(nullif(p.full_name,''), p.username);
  v_to := coalesce(nullif(o.full_name,''), o.username);
  insert into app_private.truck_moves(id, from_tech, from_name, to_tech, to_name, equipment_type, unit_tag, from_place, give_photos, give_note)
  values (p_move, p.user_id, v_name, p_to, v_to, p_type, v_tag, v_place, p_photos, btrim(coalesce(p_note,'')));
  insert into public.app_notifications(recipient_user_id, kind, title, body, unit_tag)
  values (p_to, 'equipment_ready_service', v_name || ' is giving you ' || p_type || ' ' || v_tag,
          'Open Tech Check, tap My truck, then Check it and sign. It goes on your truck when you sign.', v_tag);
  return public.truck_my_v1();
end $$;
revoke all on function public.truck_give_v1(uuid,uuid,text,text,text[],text) from public, anon;
grant execute on function public.truck_give_v1(uuid,uuid,text,text,text[],text) to authenticated;

create or replace function public.truck_cancel_give_v1(p_move uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; m app_private.truck_moves%rowtype;
begin
  p := app_private.truck_me_v1();
  select * into m from app_private.truck_moves where id = p_move for update;
  if not found or m.from_tech <> p.user_id then raise exception 'That send was not found. Pull down to refresh.'; end if;
  if m.state = 'cancelled' then return public.truck_my_v1(); end if;
  if m.state <> 'waiting' then raise exception '% already answered it, so it cannot be cancelled.', m.to_name; end if;
  update app_private.truck_moves set state = 'cancelled', decided_at = now() where id = p_move;
  return public.truck_my_v1();
end $$;
revoke all on function public.truck_cancel_give_v1(uuid) from public, anon;
grant execute on function public.truck_cancel_give_v1(uuid) to authenticated;

-- The receiver answers. Taking it needs: the number matches, every check answered, at
-- least one photo, and a signature (drawn picture, or typed full name).
create or replace function public.truck_take_v1(p_move uuid, p_accept boolean, p_checks jsonb, p_photos text[], p_signature jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; m app_private.truck_moves%rowtype; s public.service_truck_units%rowtype;
  v_name text; v_note text := btrim(coalesce(p_note,'')); v_problem boolean := false; c text; v_to_place text; v_sig jsonb;
begin
  p := app_private.truck_me_v1();
  v_name := coalesce(nullif(p.full_name,''), p.username);
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_move::text,''), 7));
  select * into m from app_private.truck_moves where id = p_move for update;
  if not found or m.to_tech <> p.user_id then raise exception 'That unit was not found. Pull down to refresh.'; end if;
  if m.state <> 'waiting' then
    if (m.state = 'accepted' and p_accept) or (m.state = 'refused' and not p_accept) then return public.truck_my_v1(); end if;
    raise exception 'This was already answered (%). Pull down to refresh.', m.state;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('truck:' || lower(m.equipment_type) || ':' || lower(m.unit_tag), 7));
  if length(v_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  if not coalesce(p_accept, false) then
    if length(v_note) < 5 then raise exception 'Write why you are not taking it.'; end if;
    update app_private.truck_moves set state = 'refused', take_note = v_note, decided_at = now() where id = m.id;
    insert into public.app_notifications(recipient_user_id, kind, title, body, unit_tag)
    values (m.from_tech, 'equipment_ready_service', v_name || ' did not take ' || m.equipment_type || ' ' || m.unit_tag,
            'It is still on your truck in the app. Reason: ' || v_note, m.unit_tag);
    return public.truck_my_v1();
  end if;

  -- checks
  if p_checks is null or jsonb_typeof(p_checks) <> 'object' then raise exception 'Answer every check.'; end if;
  foreach c in array array['number_matches','no_damage','all_parts'] loop
    if coalesce(p_checks->>c,'') not in ('pass','problem') then raise exception 'Answer every check.'; end if;
    v_problem := v_problem or p_checks->>c = 'problem';
  end loop;
  if p_checks->>'number_matches' = 'problem' then
    raise exception 'The unit number does not match, so do not take it. NEXT STEP: Tap "Don''t take it" and write the number you see.';
  end if;
  if v_problem and length(v_note) < 5 then raise exception 'You marked a Problem. Write what is wrong.'; end if;
  perform app_private.truck_move_photos_ok_v1(m.id, p_photos, 1);
  -- signature
  if p_signature is null or p_signature->>'method' not in ('drawn','typed') then raise exception 'Sign to take the unit.'; end if;
  if p_signature->>'method' = 'drawn' then
    perform app_private.truck_move_photos_ok_v1(m.id, array[p_signature->>'path'], 1);
    v_sig := jsonb_build_object('method','drawn','path',p_signature->>'path','name',v_name,'at',now());
  else
    if lower(regexp_replace(btrim(coalesce(p_signature->>'name','')),'\s+',' ','g')) <> lower(regexp_replace(btrim(v_name),'\s+',' ','g')) then
      raise exception 'Type your full name exactly as it shows: %', v_name;
    end if;
    v_sig := jsonb_build_object('method','typed','name',v_name,'at',now());
  end if;

  -- the giver must still have it where it was
  if not exists(select 1 from app_private.truck_unit_places_v1(m.equipment_type, m.unit_tag) w where w.service_tech_id = m.from_tech and w.place = m.from_place) then
    raise exception '% no longer has % % on the truck in the app. NEXT STEP: Ask % to check, then send it again.', m.from_name, m.equipment_type, m.unit_tag, m.from_name;
  end if;
  -- release the hold of a finished IT handoff to the giver; an unfinished one still blocks
  delete from app_private.techcheck_transfer_reservations h using app_private.techcheck_transfers t, public.equipment_master e
   where e.canonical_family = m.equipment_type and lower(btrim(e.unit_tag)) = lower(m.unit_tag) and h.equipment_key = e.equipment_key
     and t.id = h.transfer_id and t.state = 'accepted' and t.service_actor = m.from_tech;
  if exists(select 1 from app_private.techcheck_transfer_reservations h join public.equipment_master e on e.equipment_key = h.equipment_key
            where e.canonical_family = m.equipment_type and lower(btrim(e.unit_tag)) = lower(m.unit_tag)) then
    raise exception '% % has an unfinished IT handoff. NEXT STEP: Ask IT to finish it first.', m.equipment_type, m.unit_tag;
  end if;

  -- record the decision first: the truck guard reads it as this tech's handoff
  update app_private.truck_moves set state = 'accepted', checks = p_checks, take_photos = p_photos, signature = v_sig,
         take_note = v_note, decided_at = clock_timestamp() where id = m.id;
  -- off the giver's truck
  if m.from_place = 'slot' then
    update public.service_truck_units set unit_tag = null, status = 'unassigned', old_unit_tag = m.unit_tag, updated_at = now()
     where service_tech_id = m.from_tech and equipment_type = m.equipment_type and status = 'assigned' and lower(btrim(unit_tag)) = lower(m.unit_tag);
  else
    update app_private.truck_extra_units set removed_at = now(), removed_why = 'given_to_tech', removed_ref = m.id, removed_by_name = v_name
     where service_tech_id = m.from_tech and removed_at is null and equipment_type = m.equipment_type and lower(btrim(unit_tag)) = lower(m.unit_tag);
  end if;
  -- onto mine: the empty slot first, otherwise an extra
  select * into s from public.service_truck_units where service_tech_id = p.user_id and equipment_type = m.equipment_type for update;
  if found and (s.status <> 'assigned' or nullif(btrim(s.unit_tag),'') is null) then
    update public.service_truck_units set unit_tag = m.unit_tag, status = 'assigned', last_used_ticket_no = null, last_used_at = null,
           old_unit_tag = null, assigned_by = p.user_id, assigned_by_name = v_name, assigned_at = now(), updated_at = now()
     where service_tech_id = p.user_id and equipment_type = m.equipment_type;
    v_to_place := 'slot';
  else
    insert into app_private.truck_extra_units(service_tech_id, equipment_type, unit_tag, came_from, came_ref, added_by, added_by_name)
    values (p.user_id, m.equipment_type, m.unit_tag, 'tech_move', m.id, p.user_id, v_name);
    v_to_place := 'extra';
  end if;
  update app_private.truck_moves set to_place = v_to_place where id = m.id;
  insert into public.service_truck_unit_history(service_tech_id, equipment_type, unit_tag, event, old_unit_tag, actor_id, actor_name)
  values (m.from_tech, m.equipment_type, m.unit_tag, 'GIVEN TO ' || upper(v_name), null, p.user_id, v_name),
         (p.user_id, m.equipment_type, m.unit_tag, 'TAKEN FROM ' || upper(m.from_name), null, p.user_id, v_name);
  insert into public.app_notifications(recipient_user_id, kind, title, body, unit_tag)
  values (m.from_tech, 'equipment_ready_service', v_name || ' signed for ' || m.equipment_type || ' ' || m.unit_tag,
          'It is off your truck in the app and on ' || v_name || '''s truck.', m.unit_tag);
  return public.truck_my_v1();
end $$;
revoke all on function public.truck_take_v1(uuid,boolean,jsonb,text[],jsonb,text) from public, anon;
grant execute on function public.truck_take_v1(uuid,boolean,jsonb,text[],jsonb,text) to authenticated;

-- ---------------------------------------------------------------- owner (Manager tab)

create or replace function public.owner_truck_board_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is not null then perform public.require_role(array['owner'::public.app_role]); end if;
  return jsonb_build_object(
    'standard', (select jsonb_agg(jsonb_build_object('type', equipment_type, 'required', required)
                  order by array_position(array['Sniper','Ranger','Spotter','Solar Spotter'], equipment_type)) from app_private.truck_standard),
    'trucks', coalesce((select jsonb_agg(jsonb_build_object('id', o.user_id, 'name', coalesce(nullif(o.full_name,''), o.username),
                  'kinds', app_private.truck_kinds_v1(o.user_id),
                  'waiting', coalesce((select jsonb_agg(app_private.truck_move_json_v1(m) order by m.created_at) from app_private.truck_moves m
                                       where m.state = 'waiting' and o.user_id in (m.from_tech, m.to_tech)), '[]'::jsonb))
                  order by coalesce(nullif(o.full_name,''), o.username))
               from public.profiles o where o.active and o.role::text = 'service' and coalesce(nullif(o.full_name,''), o.username) !~* '^test'), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(app_private.truck_move_json_v1(x) order by x.created_at desc) from (
               select * from app_private.truck_moves order by created_at desc limit 30) x), '[]'::jsonb),
    'checked_at', now());
end $$;
revoke all on function public.owner_truck_board_v1() from public, anon;
grant execute on function public.owner_truck_board_v1() to authenticated;

create or replace function public.owner_truck_standard_set_v1(p_type text, p_required integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_role(array['owner'::public.app_role]);
  if p_required is null or p_required < 0 or p_required > 10 then raise exception 'Pick a number from 0 to 10.'; end if;
  update app_private.truck_standard set required = p_required, updated_at = now(),
         updated_by_name = (select coalesce(nullif(full_name,''), username) from public.profiles where user_id = auth.uid())
   where equipment_type = p_type;
  if not found then raise exception 'Unknown unit type.'; end if;
  return public.owner_truck_board_v1();
end $$;
revoke all on function public.owner_truck_standard_set_v1(text,integer) from public, anon;
grant execute on function public.owner_truck_standard_set_v1(text,integer) to authenticated;

create or replace function public.owner_truck_extra_remove_v1(p_extra uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_role(array['owner'::public.app_role]);
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'Write why this extra is coming off the truck (at least 10 characters).'; end if;
  if exists(select 1 from app_private.truck_extra_units x join app_private.truck_moves m on m.state = 'waiting' and m.equipment_type = x.equipment_type
            and lower(m.unit_tag) = lower(btrim(x.unit_tag)) where x.id = p_extra) then
    raise exception 'This unit is on its way to another tech. Cancel that first.';
  end if;
  update app_private.truck_extra_units set removed_at = now(), removed_why = 'owner_removed',
         removed_by_name = (select coalesce(nullif(full_name,''), username) from public.profiles where user_id = auth.uid()) || ': ' || btrim(p_reason)
   where id = p_extra and removed_at is null;
  if not found then raise exception 'That extra is no longer on the truck. Refresh.'; end if;
  return public.owner_truck_board_v1();
end $$;
revoke all on function public.owner_truck_extra_remove_v1(uuid,text) from public, anon;
grant execute on function public.owner_truck_extra_remove_v1(uuid,text) to authenticated;

-- ---------------------------------------------------------------- edits to existing functions

do $edits$
declare
  f record; d text; n integer;
  edits constant jsonb := jsonb_build_array(
    -- 1. A signed tech-to-tech move is a handoff to the receiver.
    jsonb_build_object('fn','app_private.techcheck_handoff_covering_v1(uuid,text,text)', 'mark','truck_moves',
      'old', $o$  latest as (select * from (select * from handoff union all select * from baseline) x order by at desc limit 1)$o$,
      'new', $n$  moved as (select m.id, m.to_tech as service_actor, m.decided_at as at from app_private.truck_moves m where m.state = 'accepted'
      and m.equipment_type = p_equipment_type and lower(btrim(m.unit_tag)) = lower(btrim(p_unit_tag))),
  latest as (select * from (select * from handoff union all select * from baseline union all select * from moved) x order by at desc limit 1)$n$),
    -- 2. IT cannot hand out a unit that is an extra on a truck.
    jsonb_build_object('fn','app_private.techcheck_transfer_custody_hold_v1(text)', 'mark','truck_extra_units',
      'old', $o$ when exists(select 1 from public.service_truck_units u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.status is distinct from 'unassigned') then 'Assigned truck equipment'$o$,
      'new', $n$ when exists(select 1 from public.service_truck_units u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.status is distinct from 'unassigned') then 'Assigned truck equipment'
 when exists(select 1 from app_private.truck_extra_units x where x.removed_at is null and x.equipment_type=e.canonical_family and lower(btrim(x.unit_tag))=lower(btrim(e.unit_tag))) then 'Assigned truck equipment'$n$),
    -- 3. Swaps and returns list the extras on my truck too.
    jsonb_build_object('fn','app_private.techcheck_ticketfree_context_v1()', 'mark','truck_extra_units',
      'old', $o$ )m where u.service_tech_id=p.user_id;$o$,
      'new', $n$ )m where u.service_tech_id=p.user_id;
 t:=t||coalesce((select jsonb_agg(jsonb_build_object('family',x.equipment_type,'unit_tag',x.unit_tag,'status','assigned','place','extra',
   'equipment_key',(select case when count(*)=1 then min(equipment_key) end from public.equipment_master
     where unit_tag=x.unit_tag and (canonical_family=x.equipment_type or workflow_type=x.equipment_type))) order by x.equipment_type,x.added_at)
  from app_private.truck_extra_units x where x.service_tech_id=p.user_id and x.removed_at is null),'[]'::jsonb);$n$),
    -- 4a. A swap or return may use an extra.
    jsonb_build_object('fn','app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[])', 'mark','xtra app_private.truck_extra_units',
      'old', $o$ restock uuid; k text; n integer; original jsonb;$o$,
      'new', $n$ restock uuid; k text; n integer; original jsonb; xtra app_private.truck_extra_units%rowtype;$n$),
    -- 4b. A finished IT handoff to this tech no longer blocks its swap or return.
    jsonb_build_object('fn','app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[])', 'mark','t.service_actor=p.user_id;',
      'old', $o$  if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=k) then raise exception 'This unit has a signed handoff or intake hold.$o$,
      'new', $n$  delete from app_private.techcheck_transfer_reservations h using app_private.techcheck_transfers t where h.equipment_key=k and t.id=h.transfer_id and t.state='accepted' and t.service_actor=p.user_id;
  if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=k) then raise exception 'This unit has a signed handoff or intake hold.$n$),
    -- 4c. An extra of another tech counts as "on another truck".
    jsonb_build_object('fn','app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[])', 'mark','x.service_tech_id<>p.user_id',
      'old', $o$ if exists(select 1 from public.service_truck_units where unit_tag=e.unit_tag and equipment_type in (e.canonical_family,e.workflow_type) and status='assigned' and service_tech_id<>p.user_id)$o$,
      'new', $n$ if exists(select 1 from app_private.truck_extra_units x where x.removed_at is null and x.service_tech_id<>p.user_id and x.equipment_type in (e.canonical_family,e.workflow_type) and lower(btrim(x.unit_tag))=lower(btrim(e.unit_tag))) or exists(select 1 from public.service_truck_units where unit_tag=e.unit_tag and equipment_type in (e.canonical_family,e.workflow_type) and status='assigned' and service_tech_id<>p.user_id)$n$),
    -- 4d. Installed unit: an extra first, otherwise the truck slot as before.
    jsonb_build_object('fn','app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[])', 'mark','select * into xtra from app_private.truck_extra_units x where x.service_tech_id=p.user_id and x.removed_at is null and x.equipment_type in (used.',
      'old', $o$  select count(*) into n from public.service_truck_units where service_tech_id=p.user_id and unit_tag=used.unit_tag and equipment_type in (used.canonical_family,used.workflow_type) and status='assigned';$o$,
      'new', $n$  select * into xtra from app_private.truck_extra_units x where x.service_tech_id=p.user_id and x.removed_at is null and x.equipment_type in (used.canonical_family,used.workflow_type) and lower(btrim(x.unit_tag))=lower(btrim(used.unit_tag)) for update;
  if found then n:=1; else
  select count(*) into n from public.service_truck_units where service_tech_id=p.user_id and unit_tag=used.unit_tag and equipment_type in (used.canonical_family,used.workflow_type) and status='assigned';
  end if;$n$),
    -- 4e. An unused extra can be returned.
    jsonb_build_object('fn','app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[])', 'mark','x.equipment_type in (e.canonical_family,e.workflow_type) and lower(btrim(x.unit_tag))=lower(btrim(e.unit_tag)) for update',
      'old', $o$  if found then mode:='truck_return';end if;$o$,
      'new', $n$  if found then mode:='truck_return';
  else select * into xtra from app_private.truck_extra_units x where x.service_tech_id=p.user_id and x.removed_at is null and x.equipment_type in (e.canonical_family,e.workflow_type) and lower(btrim(x.unit_tag))=lower(btrim(e.unit_tag)) for update;
   if found then mode:='truck_return';end if;
  end if;$n$),
    -- 4f. Using or returning an extra takes it off the truck; the slot and restock are untouched.
    jsonb_build_object('fn','app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[])', 'mark','EXTRA USED IN SWAP',
      'old', $o$ if mode in ('swap','truck_return') then
  stock_family:=truck.equipment_type;$o$,
      'new', $n$ if xtra.id is not null then
  update app_private.truck_extra_units set removed_at=now(),removed_why=case when mode='swap' then 'used_in_swap' else 'returned_to_it' end,removed_ref=p_request_id,removed_by_name=coalesce(nullif(p.full_name,''),p.username,'Service') where id=xtra.id;
  insert into public.service_truck_unit_history(service_tech_id,equipment_type,unit_tag,event,old_unit_tag,actor_id,actor_name)
   values(p.user_id,xtra.equipment_type,xtra.unit_tag,case when mode='swap' then 'EXTRA USED IN SWAP - TICKET-FREE' else 'EXTRA RETURNED UNUSED - WAITING IT' end,e.unit_tag,p.user_id,coalesce(nullif(p.full_name,''),p.username,'Service'));
 elsif mode in ('swap','truck_return') then
  stock_family:=truck.equipment_type;$n$)
  );
  e jsonb; v_fn regprocedure; v_old text; v_new text;
begin
  for e in select * from jsonb_array_elements(edits) loop
    v_fn := (e->>'fn')::regprocedure; v_old := e->>'old'; v_new := e->>'new';
    d := pg_get_functiondef(v_fn);
    if position(e->>'mark' in d) > 0 then continue; end if;          -- already applied
    n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
    if n <> 1 then raise exception 'Anchor for % found % times. Nothing changed.', e->>'fn', n; end if;
    insert into app_private.truck_extras_backup_v1(fn, definition) values (e->>'fn', d) on conflict do nothing;
    execute replace(d, v_old, v_new);
  end loop;
end
$edits$;

-- ---------------------------------------------------------------- one place per unit

-- A unit is never both a truck slot and an extra. Typing my own extra into my truck screen
-- moves it into the slot; a unit that is an extra on another truck is refused.
create or replace function app_private.truck_slot_extra_sync_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare x app_private.truck_extra_units%rowtype; v_owner text;
begin
  if new.status is distinct from 'assigned' or nullif(btrim(coalesce(new.unit_tag,'')),'') is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'assigned' and lower(btrim(coalesce(old.unit_tag,''))) = lower(btrim(new.unit_tag)) then return new; end if;
  select * into x from app_private.truck_extra_units e where e.removed_at is null and e.equipment_type = new.equipment_type
     and lower(btrim(e.unit_tag)) = lower(btrim(new.unit_tag)) for update;
  if not found then return new; end if;
  if x.service_tech_id <> new.service_tech_id then
    select coalesce(nullif(full_name,''), username, 'another tech') into v_owner from public.profiles where user_id = x.service_tech_id;
    raise exception '% % is an extra on %''s truck. NEXT STEP: Ask % to give it to you in Tech Check (My truck, Give a unit).', new.equipment_type, btrim(new.unit_tag), v_owner, v_owner;
  end if;
  update app_private.truck_extra_units set removed_at = now(), removed_why = 'moved_to_slot',
         removed_by_name = coalesce((select coalesce(nullif(full_name,''), username) from public.profiles where user_id = auth.uid()), 'System')
   where id = x.id;
  return new;
end $$;
revoke all on function app_private.truck_slot_extra_sync_v1() from public, anon, authenticated;
-- Named to run before techcheck_handoff_required_guard_v1 (triggers fire in name order),
-- so a tech typing another tech's extra gets this message, not "IT has not handed it".
drop trigger if exists techcheck_extra_place_guard_v1 on public.service_truck_units;
create trigger techcheck_extra_place_guard_v1 before insert or update on public.service_truck_units
  for each row execute function app_private.truck_slot_extra_sync_v1();
