-- PREPARED ONLY. This pull request does not apply the migration and does not
-- connect to a live project.
--
-- The router serial columns belong to a separate pending migration. This
-- function refuses to run until inhand_serial and inhand_device_id both exist.
-- It updates an existing row only when the CSV serial is exactly that column.
-- It does not insert a router, delete a router, or rename one.
--
-- Rollback keeps every inventory row. Turn the loader off by unsetting
-- COS_INHAND_ROUTER_STATUS_ENABLED. To retire the function, drop
-- public.cos_inhand_router_status_load and cos_inhand_private.apply_router_status.
-- Do not drop public.camera_unit_routers and do not drop the serial columns.

create schema if not exists cos_inhand_private;
revoke all on schema cos_inhand_private from public, anon, authenticated;
grant usage on schema cos_inhand_private to service_role;

create or replace function cos_inhand_private.assert_owner_or_it(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.user_profiles p
    where p.user_id = p_actor
      and p.active is true
      and (
        p.department = 'owner'
        or (
          p.department = 'it'
          and p.user_id in (
            'd0757b64-9623-4adc-afff-21cc7853e88a'::uuid,
            '3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid,
            'c9a7c3e9-953c-4ad6-a080-5eacbcd1d1c7'::uuid
          )
        )
      )
  ) then
    raise exception 'An active COS Owner or verified IT account is required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function cos_inhand_private.assert_owner_or_it(uuid) from public, anon, authenticated, service_role;

create or replace function cos_inhand_private.apply_router_status(p_actor uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text[] := array['deviceId', 'ip', 'lastSeenAt', 'name', 'serial', 'status'];
  v_row record;
  v_count integer;
  v_id bigint;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_wrote integer;
  v_unmatched jsonb := pg_catalog.jsonb_build_array();
  v_matched jsonb := pg_catalog.jsonb_build_array();
  v_ip inet;
begin
  perform cos_inhand_private.assert_owner_or_it(p_actor);
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'camera_unit_routers'
      and column_name in ('inhand_serial', 'inhand_device_id')
  ) <> 2 then
    raise exception 'Router serial columns are not installed. The loader is refused.' using errcode = '55000';
  end if;
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' or pg_catalog.jsonb_array_length(p_rows) > 2000 then
    raise exception 'Router rows are required.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) element, pg_catalog.jsonb_object_keys(element) key
    where pg_catalog.lower(key) in ('imsi', 'iccid', 'imei', 'sim')
  ) then
    raise exception 'A SIM identifier was refused.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) element
    where (
      select pg_catalog.array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(element) key
    ) is distinct from v_expected
  ) then
    raise exception 'A router row has an unexpected field.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_rows) as row(serial text, "deviceId" text)
    where coalesce(row.serial, '') ~ '^[0-9]{14,22}$'
       or coalesce(row."deviceId", '') ~ '^[0-9]{14,22}$'
  ) then
    raise exception 'A SIM identifier was refused.' using errcode = '22023';
  end if;

  create temporary table inhand_router_status_rows (
    name text, serial text, status text, last_seen timestamptz, ip text, device_id text
  ) on commit drop;
  insert into pg_temp.inhand_router_status_rows (name, serial, status, last_seen, ip, device_id)
  select
    pg_catalog.btrim(row.name),
    pg_catalog.btrim(row.serial),
    pg_catalog.lower(pg_catalog.btrim(row.status)),
    case
      when row."lastSeenAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then row."lastSeenAt"::timestamptz
      else null
    end,
    nullif(pg_catalog.btrim(row.ip), ''),
    nullif(pg_catalog.btrim(row."deviceId"), '')
  from pg_catalog.jsonb_to_recordset(p_rows) as row(
    name text, serial text, status text, "lastSeenAt" text, ip text, "deviceId" text
  );
  if exists (
    select 1 from pg_temp.inhand_router_status_rows
    where name is null or pg_catalog.char_length(name) not between 1 and 160
       or serial is null or pg_catalog.char_length(serial) not between 1 and 80
       or status not in ('online', 'offline')
       or last_seen is null
       or (ip is not null and (
         ip !~ '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$'
         or exists (
           select 1 from pg_catalog.regexp_split_to_table(ip, '\.') part
           where part !~ '^[0-9]{1,3}$' or (part ~ '^[0-9]{1,3}$' and part::integer > 255)
         )
       ))
  ) then
    raise exception 'A router row is missing a serial, status, or last-seen time.' using errcode = '22023';
  end if;
  if (select count(*) from pg_temp.inhand_router_status_rows) is distinct from (select count(distinct serial) from pg_temp.inhand_router_status_rows) then
    raise exception 'This file repeats a serial.' using errcode = '22023';
  end if;

  for v_row in select * from pg_temp.inhand_router_status_rows loop
    execute 'select count(*)::integer from public.camera_unit_routers where inhand_serial = $1'
      into v_count using v_row.serial;
    if v_count is distinct from 1 then
      v_unmatched := v_unmatched || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'serial', v_row.serial, 'name', v_row.name, 'reason', case when v_count = 0 then 'none' else 'ambiguous' end
      ));
      continue;
    end if;
    execute 'select id from public.camera_unit_routers where inhand_serial = $1' into v_id using v_row.serial;
    v_ip := case when v_row.ip is null then null else v_row.ip::inet end;
    execute $sql$
      update public.camera_unit_routers
      set current_status = $1,
          last_checked_at = $2,
          updated_at = pg_catalog.clock_timestamp(),
          last_online_at = case
            when $1 = 'online' and (current_status is distinct from 'online' or last_online_at is null) then $2
            else last_online_at
          end,
          router_public_ip = case when $3::inet is null then router_public_ip else $3::inet end,
          inhand_serial = $4,
          inhand_device_id = case when $5::text is null then inhand_device_id else $5::text end
      where id = $6
        and inhand_serial = $4
        and (
          current_status is distinct from $1
          or last_checked_at is distinct from $2
          or ($3::inet is not null and router_public_ip is distinct from $3::inet)
          or ($5::text is not null and inhand_device_id is distinct from $5::text)
        )
    $sql$ using v_row.status, v_row.last_seen, v_ip, v_row.serial, v_row.device_id, v_id;
    get diagnostics v_wrote = row_count;
    if v_wrote = 1 then v_updated := v_updated + 1; else v_unchanged := v_unchanged + 1; end if;
    v_matched := v_matched || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_id, 'serial', v_row.serial, 'name', v_row.name, 'status', v_row.status,
      'ip', v_row.ip, 'deviceId', v_row.device_id, 'changed', v_wrote = 1
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'columnsReady', true,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'unmatched', v_unmatched,
    'matched', v_matched,
    'created', 0,
    'deleted', 0
  );
end;
$$;

revoke all on function cos_inhand_private.apply_router_status(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function cos_inhand_private.apply_router_status(uuid, jsonb) to service_role;

create or replace function public.cos_inhand_router_status_load(p_actor uuid, p_rows jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cos_inhand_private.apply_router_status(p_actor, p_rows);
$$;

revoke all on function public.cos_inhand_router_status_load(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cos_inhand_router_status_load(uuid, jsonb) to service_role;
