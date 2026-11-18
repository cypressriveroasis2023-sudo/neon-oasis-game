-- PREPARED ONLY. This pull request does not apply the migration and does not
-- connect to a live project.
--
-- Watchful failing-device readings. Each load is one run. Replaying a run
-- updates that run in place. A later run is appended. Nothing in this file
-- deletes a row.
--
-- Rollback keeps the rows. Turn the loader off by unsetting
-- COS_WATCHFUL_DEVICE_HEALTH_ENABLED. To retire the functions without deleting
-- history, drop the functions and policies and revoke select. Do not drop
-- public.watchful_device_health or public.watchful_device_health_runs.

create schema if not exists cos_watchful_private;
revoke all on schema cos_watchful_private from public, anon, authenticated;
grant usage on schema cos_watchful_private to service_role;

create table public.watchful_device_health_runs (
  run_id uuid primary key,
  run_at timestamptz not null,
  source_sha256 text not null,
  loaded_at timestamptz not null default pg_catalog.clock_timestamp(),
  loaded_by uuid not null,
  row_count integer not null,
  constraint watchful_device_health_runs_sha check (source_sha256 ~ '^[a-f0-9]{64}$'),
  constraint watchful_device_health_runs_count check (row_count >= 0 and row_count <= 5000)
);

create table public.watchful_device_health (
  run_id uuid not null references public.watchful_device_health_runs (run_id),
  row_key text not null,
  device_name text not null,
  site_name text not null,
  device_type text not null,
  reported_status text not null,
  last_seen_at timestamptz,
  loaded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (run_id, row_key),
  constraint watchful_device_health_type check (device_type in ('nvr', 'camera', 'vms', 'bridge')),
  constraint watchful_device_health_name check (char_length(device_name) between 1 and 160),
  constraint watchful_device_health_site check (char_length(site_name) between 1 and 160),
  constraint watchful_device_health_status check (char_length(reported_status) <= 40),
  constraint watchful_device_health_key check (char_length(row_key) between 1 and 400)
);

create index watchful_device_health_runs_latest_idx
  on public.watchful_device_health_runs (run_at desc, loaded_at desc, run_id desc);

alter table public.watchful_device_health_runs enable row level security;
alter table public.watchful_device_health_runs force row level security;
alter table public.watchful_device_health enable row level security;
alter table public.watchful_device_health force row level security;

revoke all on table public.watchful_device_health_runs from public, anon, authenticated;
revoke all on table public.watchful_device_health from public, anon, authenticated;
grant select on table public.watchful_device_health_runs to authenticated;
grant select on table public.watchful_device_health to authenticated;

-- Owner, or one of the three verified IT accounts, and only while that
-- profile is still active. Same accounts the power-alarm migration already
-- treats as verified IT. A department change removes the match.
create policy watchful_device_health_runs_owner_it_read
on public.watchful_device_health_runs
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
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
  )
);

create policy watchful_device_health_owner_it_read
on public.watchful_device_health
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid())
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
  )
);

create or replace function cos_watchful_private.assert_owner_or_it(p_actor uuid)
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

revoke all on function cos_watchful_private.assert_owner_or_it(uuid) from public, anon, authenticated, service_role;

create or replace function cos_watchful_private.load_device_health(
  p_actor uuid,
  p_run_id uuid,
  p_run_at timestamptz,
  p_source_sha256 text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_at timestamptz;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_written integer := 0;
  v_expected text[] := array['deviceName', 'deviceType', 'lastSeenAt', 'reportedStatus', 'rowKey', 'site'];
begin
  perform cos_watchful_private.assert_owner_or_it(p_actor);
  if p_run_id is null or p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'A run id and source checksum are required.' using errcode = '22023';
  end if;
  if p_run_at is not null and p_run_at > pg_catalog.clock_timestamp() + interval '60 seconds' then
    raise exception 'The run timestamp is not valid.' using errcode = '22023';
  end if;
  v_run_at := coalesce(p_run_at, pg_catalog.clock_timestamp());
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' or pg_catalog.jsonb_array_length(p_rows) > 5000 then
    raise exception 'Device rows are required.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) element, pg_catalog.jsonb_object_keys(element) key
    where pg_catalog.lower(key) in ('imsi', 'iccid', 'imei', 'sim')
  ) then
    raise exception 'SIM identifiers are not accepted.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) element
    where (
      select pg_catalog.array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(element) key
    ) is distinct from v_expected
  ) then
    raise exception 'A device row has an unexpected field.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_rows) as row("rowKey" text, "deviceName" text, site text, "deviceType" text, "reportedStatus" text, "lastSeenAt" text)
    where pg_catalog.btrim(row."deviceName") is null
      or pg_catalog.char_length(pg_catalog.btrim(row."deviceName")) not between 1 and 160
      or pg_catalog.btrim(row.site) is null
      or pg_catalog.char_length(pg_catalog.btrim(row.site)) not between 1 and 160
      or row."deviceType" not in ('nvr', 'camera', 'vms', 'bridge')
      or row."rowKey" is null
      or pg_catalog.char_length(row."rowKey") not between 1 and 400
      or coalesce(pg_catalog.char_length(row."reportedStatus"), 0) > 40
      or coalesce(row."reportedStatus", '') ~ '[[:cntrl:]]'
  ) then
    raise exception 'A device row is missing a name, site, or supported type.' using errcode = '22023';
  end if;
  if (
    select count(*) from pg_catalog.jsonb_array_elements(p_rows)
  ) is distinct from (
    select count(distinct element ->> 'rowKey') from pg_catalog.jsonb_array_elements(p_rows) element
  ) then
    raise exception 'This run repeats a device.' using errcode = '22023';
  end if;

  insert into public.watchful_device_health_runs (run_id, run_at, source_sha256, loaded_by, row_count)
  values (p_run_id, v_run_at, p_source_sha256, p_actor, 0)
  on conflict (run_id) do nothing;

  with incoming as (
    select
      row."rowKey" as row_key,
      pg_catalog.btrim(row."deviceName") as device_name,
      pg_catalog.btrim(row.site) as site_name,
      row."deviceType" as device_type,
      coalesce(row."reportedStatus", '') as reported_status,
      case
        when row."lastSeenAt" ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' then row."lastSeenAt"::timestamptz
        else null
      end as last_seen_at
    from pg_catalog.jsonb_to_recordset(p_rows) as row("rowKey" text, "deviceName" text, site text, "deviceType" text, "reportedStatus" text, "lastSeenAt" text)
  ),
  classified as (
    select incoming.*, existing.row_key is null as is_new,
      existing.row_key is not null and (
        existing.device_name is distinct from incoming.device_name
        or existing.site_name is distinct from incoming.site_name
        or existing.device_type is distinct from incoming.device_type
        or existing.reported_status is distinct from incoming.reported_status
        or existing.last_seen_at is distinct from incoming.last_seen_at
      ) as is_changed
    from incoming
    left join public.watchful_device_health existing
      on existing.run_id = p_run_id and existing.row_key = incoming.row_key
  ),
  written as (
    insert into public.watchful_device_health (
      run_id, row_key, device_name, site_name, device_type, reported_status, last_seen_at
    )
    select p_run_id, row_key, device_name, site_name, device_type, reported_status, last_seen_at
    from classified
    where is_new or is_changed
    on conflict (run_id, row_key) do update
      set device_name = excluded.device_name,
          site_name = excluded.site_name,
          device_type = excluded.device_type,
          reported_status = excluded.reported_status,
          last_seen_at = excluded.last_seen_at,
          loaded_at = pg_catalog.clock_timestamp()
      where public.watchful_device_health.device_name is distinct from excluded.device_name
         or public.watchful_device_health.site_name is distinct from excluded.site_name
         or public.watchful_device_health.device_type is distinct from excluded.device_type
         or public.watchful_device_health.reported_status is distinct from excluded.reported_status
         or public.watchful_device_health.last_seen_at is distinct from excluded.last_seen_at
    returning row_key
  )
  select
    (select count(*)::integer from classified where is_new),
    (select count(*)::integer from classified where is_changed),
    (select count(*)::integer from classified where not is_new and not is_changed),
    (select count(*)::integer from written)
  into v_inserted, v_updated, v_unchanged, v_written;
  if v_written is distinct from v_inserted + v_updated then
    raise exception 'The run could not be saved.' using errcode = '40001';
  end if;

  update public.watchful_device_health_runs as runs
  set run_at = v_run_at,
      source_sha256 = p_source_sha256,
      loaded_by = p_actor,
      loaded_at = pg_catalog.clock_timestamp(),
      row_count = (select count(*) from public.watchful_device_health devices where devices.run_id = p_run_id)
  where runs.run_id = p_run_id
    and (
      v_inserted > 0
      or v_updated > 0
      or runs.run_at is distinct from v_run_at
      or runs.source_sha256 is distinct from p_source_sha256
    );

  return pg_catalog.jsonb_build_object(
    'runId', p_run_id,
    'runAt', (select runs.run_at from public.watchful_device_health_runs runs where runs.run_id = p_run_id),
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'deleted', 0
  );
end;
$$;

revoke all on function cos_watchful_private.load_device_health(uuid, uuid, timestamptz, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function cos_watchful_private.load_device_health(uuid, uuid, timestamptz, text, jsonb) to service_role;

create or replace function cos_watchful_private.read_device_health(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.watchful_device_health_runs;
  v_rows jsonb;
begin
  perform cos_watchful_private.assert_owner_or_it(p_actor);
  select * into v_run
  from public.watchful_device_health_runs
  order by run_at desc, loaded_at desc, run_id desc
  limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('runId', null, 'runAt', null, 'rows', pg_catalog.jsonb_build_array());
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'rowKey', devices.row_key,
    'deviceName', devices.device_name,
    'site', devices.site_name,
    'deviceType', devices.device_type,
    'reportedStatus', devices.reported_status,
    'lastSeenAt', devices.last_seen_at
  ) order by devices.row_key), pg_catalog.jsonb_build_array())
  into v_rows
  from public.watchful_device_health devices
  where devices.run_id = v_run.run_id;
  return pg_catalog.jsonb_build_object(
    'runId', v_run.run_id,
    'runAt', v_run.run_at,
    'sourceSha256', v_run.source_sha256,
    'rows', v_rows
  );
end;
$$;

revoke all on function cos_watchful_private.read_device_health(uuid) from public, anon, authenticated, service_role;
grant execute on function cos_watchful_private.read_device_health(uuid) to service_role;

-- PostgREST only exposes public. These wrappers add no check of their own.
create or replace function public.cos_watchful_device_health_load(
  p_actor uuid,
  p_run_id uuid,
  p_run_at timestamptz,
  p_source_sha256 text,
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cos_watchful_private.load_device_health(p_actor, p_run_id, p_run_at, p_source_sha256, p_rows);
$$;

create or replace function public.cos_watchful_device_health_read(p_actor uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select cos_watchful_private.read_device_health(p_actor);
$$;

revoke all on function public.cos_watchful_device_health_load(uuid, uuid, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function public.cos_watchful_device_health_read(uuid) from public, anon, authenticated;
grant execute on function public.cos_watchful_device_health_load(uuid, uuid, timestamptz, text, jsonb) to service_role;
grant execute on function public.cos_watchful_device_health_read(uuid) to service_role;
