-- Private mHelp ticket census for duplicate-job checks and customer names.
-- Dry run: review this file. Do not apply it to production from the pull request.
-- It does not schedule cron, deploy a function, or call mHelp.
--
-- Disposable-database check, then roll back:
--   1. cos_mhelp_placement_private and its links table must already exist.
--   2. Apply this file inside a transaction.
--   3. relrowsecurity is true and pg_policy has no row for census_mhelp_ticket.
--   4. authenticated and anon lack select and insert on that table.
--   5. Roll the transaction back.
--
-- Not installed: a 30-minute schedule at minute 20 and 50 UTC, offset from the
-- inventory reads at minute 05 and 35. Forty-eight runs at 24 vendor reads
-- stay inside the existing 4,600 data admission. See the rollback file.
begin;

create table cos_mhelp_placement_private.census_mhelp_ticket (
  ticket_id text primary key check (ticket_id ~ '^[1-9][0-9]{0,14}$'),
  ticket_number text not null check (ticket_number ~ '^[1-9][0-9]{0,14}$'),
  customer_name text check (customer_name is null or (char_length(customer_name) between 1 and 250 and customer_name !~ '[[:cntrl:]<>]')),
  status_label text check (status_label is null or (char_length(status_label) between 1 and 250 and status_label !~ '[[:cntrl:]<>]')),
  type_label text check (type_label is null or (char_length(type_label) between 1 and 250 and type_label !~ '[[:cntrl:]<>]')),
  created_at timestamptz not null,
  scheduled_at timestamptz,
  equipment_id text check (equipment_id is null or equipment_id ~ '^[1-9][0-9]{0,14}$'),
  fetched_at timestamptz not null default clock_timestamp()
);
create index census_mhelp_ticket_equipment_idx
  on cos_mhelp_placement_private.census_mhelp_ticket (equipment_id)
  where equipment_id is not null;
create table cos_mhelp_placement_private.census_mhelp_ticket_cursor (
  singleton boolean primary key default true check (singleton),
  cursor jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table cos_mhelp_placement_private.census_mhelp_ticket enable row level security;
alter table cos_mhelp_placement_private.census_mhelp_ticket_cursor enable row level security;
revoke all on cos_mhelp_placement_private.census_mhelp_ticket, cos_mhelp_placement_private.census_mhelp_ticket_cursor from public, anon, authenticated, service_role;

create function cos_mhelp_placement_private.census_ticket_cursor_ok(p_cursor jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_cursor) = 'object'
    and (select array_agg(item order by item) from jsonb_object_keys(p_cursor) as item) = array['budgetDay','equipmentBase','equipmentBoundaryChecked','equipmentLastTicketId','equipmentOrdinal','equipmentSeen','equipmentSweepCount','equipmentTruncated','readsToday','recentBase','recentBoundaryChecked','recentLastTicketId','recentSeen','runsToday','statusBase','statusBoundaryChecked','statusLastTicketId','statusOrdinal','statusSeen']::text[]
    and (p_cursor->'budgetDay' = 'null'::jsonb or (p_cursor->>'budgetDay') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    and (p_cursor->>'statusOrdinal') ~ '^(0|[1-9][0-9]{0,4})$'
    and (p_cursor->>'statusSeen') ~ '^(0|[1-9][0-9]{0,5})$'
    and (p_cursor->>'recentSeen') ~ '^(0|[1-9][0-9]{0,5})$'
    and (p_cursor->>'equipmentOrdinal') ~ '^(0|[1-9][0-9]{0,5})$'
    and (p_cursor->>'equipmentSeen') ~ '^(0|[1-9][0-9]{0,5})$'
    and (p_cursor->>'equipmentSweepCount') ~ '^(0|[1-9][0-9]{0,5})$'
    and (p_cursor->>'readsToday') ~ '^(0|[1-9][0-9]{0,4})$'
    and (p_cursor->>'readsToday')::integer between 0 and 1152
    and (p_cursor->>'runsToday') ~ '^(0|[1-9][0-9]{0,2})$'
    and (p_cursor->>'runsToday')::integer between 0 and 48
    and (p_cursor->>'statusBase') in ('0', '1')
    and (p_cursor->>'recentBase') in ('0', '1')
    and (p_cursor->>'equipmentBase') in ('0', '1')
    and (p_cursor->>'statusBoundaryChecked') in ('true', 'false')
    and (p_cursor->>'recentBoundaryChecked') in ('true', 'false')
    and (p_cursor->>'equipmentBoundaryChecked') in ('true', 'false')
    and (p_cursor->>'equipmentTruncated') in ('true', 'false')
    and (p_cursor->'statusLastTicketId' = 'null'::jsonb or (p_cursor->>'statusLastTicketId') ~ '^[1-9][0-9]{0,14}$')
    and (p_cursor->'recentLastTicketId' = 'null'::jsonb or (p_cursor->>'recentLastTicketId') ~ '^[1-9][0-9]{0,14}$')
    and (p_cursor->'equipmentLastTicketId' = 'null'::jsonb or (p_cursor->>'equipmentLastTicketId') ~ '^[1-9][0-9]{0,14}$')
$$;
revoke all on function cos_mhelp_placement_private.census_ticket_cursor_ok(jsonb) from public, anon, authenticated, service_role;

insert into cos_mhelp_placement_private.census_mhelp_ticket_cursor(singleton, cursor)
values (true, '{"budgetDay":null,"equipmentBase":0,"equipmentBoundaryChecked":false,"equipmentLastTicketId":null,"equipmentOrdinal":0,"equipmentSeen":0,"equipmentSweepCount":0,"equipmentTruncated":false,"readsToday":0,"recentBase":0,"recentBoundaryChecked":false,"recentLastTicketId":null,"recentSeen":0,"runsToday":0,"statusBase":0,"statusBoundaryChecked":false,"statusLastTicketId":null,"statusOrdinal":0,"statusSeen":0}'::jsonb);

create function public.cos_mhelp_census_ticket_upsert(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare
  item jsonb;
  stored integer := 0;
  v_ticket_id text;
  v_ticket_number text;
  v_customer_name text;
  v_status_label text;
  v_type_label text;
  v_equipment_id text;
  v_created_at timestamptz;
  v_scheduled_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'Invalid census rows' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(item) as item_key where item_key not in ('ticketId', 'ticketNumber', 'customerName', 'status', 'type', 'createdAt', 'scheduledAt', 'equipmentId')) <> 0
      or (select count(*) from jsonb_object_keys(item)) <> 8 then
      raise exception 'Invalid census rows' using errcode = '22023';
    end if;
    v_ticket_id := item->>'ticketId';
    v_ticket_number := item->>'ticketNumber';
    v_customer_name := item->>'customerName';
    v_status_label := item->>'status';
    v_type_label := item->>'type';
    v_equipment_id := item->>'equipmentId';
    if v_ticket_id !~ '^[1-9][0-9]{0,14}$' or v_ticket_number !~ '^[1-9][0-9]{0,14}$' then raise exception 'Invalid census rows' using errcode = '22023'; end if;
    if v_customer_name is not null and (char_length(v_customer_name) < 1 or char_length(v_customer_name) > 250 or v_customer_name ~ '[[:cntrl:]<>]') then raise exception 'Invalid census rows' using errcode = '22023'; end if;
    if v_status_label is not null and (char_length(v_status_label) < 1 or char_length(v_status_label) > 250 or v_status_label ~ '[[:cntrl:]<>]') then raise exception 'Invalid census rows' using errcode = '22023'; end if;
    if v_type_label is not null and (char_length(v_type_label) < 1 or char_length(v_type_label) > 250 or v_type_label ~ '[[:cntrl:]<>]') then raise exception 'Invalid census rows' using errcode = '22023'; end if;
    if v_equipment_id is not null and v_equipment_id !~ '^[1-9][0-9]{0,14}$' then raise exception 'Invalid census rows' using errcode = '22023'; end if;
    begin
      v_created_at := (item->>'createdAt')::timestamptz;
      v_scheduled_at := case when item->'scheduledAt' = 'null'::jsonb or item->>'scheduledAt' is null then null else (item->>'scheduledAt')::timestamptz end;
    exception when others then raise exception 'Invalid census rows' using errcode = '22023';
    end;
    if v_created_at is null then raise exception 'Invalid census rows' using errcode = '22023'; end if;
    insert into cos_mhelp_placement_private.census_mhelp_ticket as census
      (ticket_id, ticket_number, customer_name, status_label, type_label, created_at, scheduled_at, equipment_id, fetched_at)
    values (v_ticket_id, v_ticket_number, v_customer_name, v_status_label, v_type_label, v_created_at, v_scheduled_at, v_equipment_id, clock_timestamp())
    on conflict (ticket_id) do update set
      ticket_number = excluded.ticket_number,
      customer_name = coalesce(excluded.customer_name, census.customer_name),
      status_label = excluded.status_label,
      type_label = excluded.type_label,
      created_at = excluded.created_at,
      scheduled_at = excluded.scheduled_at,
      equipment_id = coalesce(excluded.equipment_id, census.equipment_id),
      fetched_at = clock_timestamp();
    stored := stored + 1;
  end loop;
  return jsonb_build_object('stored', stored);
end $$;

create function public.cos_mhelp_census_ticket_duplicates(p_equipment_id text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare
  v_equipment text;
  v_rows jsonb;
  v_total integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_equipment_id is null or p_equipment_id !~ '^[1-9][0-9]{0,14}$' then raise exception 'Invalid equipment id' using errcode = '22023'; end if;
  v_equipment := p_equipment_id;
  select count(*) into v_total from cos_mhelp_placement_private.census_mhelp_ticket where equipment_id = v_equipment;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ticketId', matched.ticket_id,
    'ticketNumber', matched.ticket_number,
    'customerName', matched.customer_name,
    'status', matched.status_label,
    'type', matched.type_label,
    'createdAt', matched.created_at,
    'scheduledAt', matched.scheduled_at,
    'equipmentId', matched.equipment_id,
    'fetchedAt', matched.fetched_at
  ) order by matched.created_at, matched.ticket_id), '[]'::jsonb) into v_rows
  from (
    select ticket_id, ticket_number, customer_name, status_label, type_label, created_at, scheduled_at, equipment_id, fetched_at
    from cos_mhelp_placement_private.census_mhelp_ticket
    where equipment_id = v_equipment
    order by created_at, ticket_id
    limit 50
  ) matched;
  return jsonb_build_object('equipmentId', v_equipment, 'rows', v_rows, 'truncated', v_total > 50);
end $$;

create function public.cos_mhelp_census_ticket_cursor(p_action text, p_cursor jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare
  stored jsonb;
  rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_action = 'read' then
    if p_cursor is not null then raise exception 'Invalid census cursor' using errcode = '22023'; end if;
  elsif p_action = 'save' then
    if not cos_mhelp_placement_private.census_ticket_cursor_ok(p_cursor) then raise exception 'Invalid census cursor' using errcode = '22023'; end if;
    update cos_mhelp_placement_private.census_mhelp_ticket_cursor
      set cursor = p_cursor, updated_at = clock_timestamp()
      where singleton;
  else
    raise exception 'Invalid census cursor' using errcode = '22023';
  end if;
  select cursor into stored from cos_mhelp_placement_private.census_mhelp_ticket_cursor where singleton;
  select count(*) into rows from cos_mhelp_placement_private.census_mhelp_ticket;
  return jsonb_build_object('cursor', stored, 'censusRows', rows);
end $$;

create function public.cos_mhelp_census_ticket_equipment(p_offset integer)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare ids jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'Invalid equipment page' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(equipment_id order by equipment_id), '[]'::jsonb) into ids
  from (
    select equipment_id from cos_mhelp_placement_private.links
    where equipment_id ~ '^[1-9][0-9]{0,14}$'
    order by equipment_id
    offset p_offset
    limit 2
  ) page;
  return jsonb_build_object('equipmentIds', ids);
end $$;

create function public.cos_mhelp_census_ticket_refresh(p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare ids jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 4 then raise exception 'Invalid refresh page' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(ticket_id order by fetched_at, ticket_id), '[]'::jsonb) into ids
  from (
    select ticket_id, fetched_at from cos_mhelp_placement_private.census_mhelp_ticket
    where created_at < clock_timestamp() - interval '48 hours'
      and status_label is not null
      and status_label !~* '(^|[^[:alpha:]])(closed|complete|completed|cancelled|canceled|invoiced|void|voided)([^[:alpha:]]|$)'
    order by fetched_at, ticket_id
    limit p_limit
  ) due;
  return jsonb_build_object('ticketIds', ids);
end $$;

create function public.cos_mhelp_census_ticket_touch(p_ticket_id text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '2s' as $$
declare touched integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if p_ticket_id is null or p_ticket_id !~ '^[1-9][0-9]{0,14}$' then raise exception 'Invalid census rows' using errcode = '22023'; end if;
  update cos_mhelp_placement_private.census_mhelp_ticket set fetched_at = clock_timestamp() where ticket_id = p_ticket_id;
  get diagnostics touched = row_count;
  return jsonb_build_object('touched', touched);
end $$;

revoke all on function public.cos_mhelp_census_ticket_upsert(jsonb), public.cos_mhelp_census_ticket_duplicates(text), public.cos_mhelp_census_ticket_cursor(text, jsonb), public.cos_mhelp_census_ticket_equipment(integer), public.cos_mhelp_census_ticket_refresh(integer), public.cos_mhelp_census_ticket_touch(text) from public, anon, authenticated;
grant execute on function public.cos_mhelp_census_ticket_upsert(jsonb), public.cos_mhelp_census_ticket_duplicates(text), public.cos_mhelp_census_ticket_cursor(text, jsonb), public.cos_mhelp_census_ticket_equipment(integer), public.cos_mhelp_census_ticket_refresh(integer), public.cos_mhelp_census_ticket_touch(text) to service_role;
notify pgrst, 'reload schema';
commit;
