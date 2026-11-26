-- Victron MPPT (solar charger) readings for Helios units: panel volts, charge state, yield today, charger error.
--
-- Additive only. The Victron fleet sync (cos-vrm-fleet-sync, cos_vrm_fleet_finish) is not changed and does not
-- read or write any of this. A separate small function (cos-vrm-mppt-sync) collects these readings and saves
-- them here through cos_vrm_mppt_save. Numbers only: a Victron path name, a value and Victron's timestamp.

create table if not exists cos_vrm_private.mppt_latest (
  installation_id bigint not null,
  instance integer not null,
  path text not null,
  value numeric not null,
  observed_at timestamptz not null,
  checked_at timestamptz not null default now(),
  primary key (installation_id, instance, path)
);
create table if not exists cos_vrm_private.mppt_history (
  installation_id bigint not null,
  instance integer not null,
  path text not null,
  observed_at timestamptz not null,
  value numeric not null,
  primary key (installation_id, instance, path, observed_at)
);
-- Names only (no values): which readings the chargers publish, so new ones can be added on evidence.
create table if not exists cos_vrm_private.mppt_paths_seen (
  path text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table cos_vrm_private.mppt_latest enable row level security;
alter table cos_vrm_private.mppt_history enable row level security;
alter table cos_vrm_private.mppt_paths_seen enable row level security;
revoke all on cos_vrm_private.mppt_latest, cos_vrm_private.mppt_history, cos_vrm_private.mppt_paths_seen from public, anon, authenticated;

-- Which installations to read, and whether to read at all right now. The fleet sync always comes first:
-- not ready while it is running, failing, rate limited, or has not succeeded in the last 45 minutes.
-- Only Helios units that reported power in the last 24 hours are read, so unplugged units cost no requests.
create or replace function public.cos_vrm_mppt_targets()
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object(
    'ready', coalesce((select s.error_code is null and coalesce(s.lease_until, '-infinity'::timestamptz) <= now()
        and coalesce(s.retry_after_at, '-infinity'::timestamptz) <= now() and s.last_success_at > now() - interval '45 minutes'
      from cos_vrm_private.sync_state s where s.singleton), false),
    'ids', coalesce((select jsonb_agg(i.installation_id order by i.name, i.installation_id)
      from cos_vrm_private.installations i
      where i.available and i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$'
        and exists(select 1 from cos_vrm_private.power_history h where h.installation_id = i.installation_id and h.observed_at > now() - interval '24 hours')
    ), '[]'::jsonb));
$function$;
revoke all on function public.cos_vrm_mppt_targets() from public, anon, authenticated;
grant execute on function public.cos_vrm_mppt_targets() to service_role;

-- Save one batch. A row that is not exactly a known reading for a known Helios is skipped, never guessed.
-- Returns how many readings were kept. History holds 10 days and stores a value only when Victron's timestamp is new.
create or replace function public.cos_vrm_mppt_save(p_rows jsonb, p_paths jsonb)
returns integer language plpgsql security definer set search_path to '' as $function$
declare
  r jsonb; p jsonb; kept integer := 0; v_id bigint; v_instance integer; v_value numeric; v_at timestamptz;
  known constant text[] := array['/Pv/V','/Pv/I','/Pv/0/V','/Pv/1/V','/Dc/0/Voltage','/Dc/0/Current','/State','/ErrorCode','/MppOperationMode',
    '/History/Daily/0/Yield','/History/Daily/0/MaxPower','/History/Daily/1/Yield','/History/Daily/1/MaxPower','/Yield/User'];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000
    or jsonb_typeof(p_paths) is distinct from 'array' or jsonb_array_length(p_paths) > 150 then
    raise exception 'Invalid MPPT batch';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    begin
      if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r)) <> 5
        or not (r ?& array['installationId','instance','path','value','observedAt'])
        or jsonb_typeof(r->'installationId') is distinct from 'number' or r->>'installationId' !~ '^[1-9][0-9]{0,15}$'
        or jsonb_typeof(r->'instance') is distinct from 'number' or r->>'instance' !~ '^[0-9]{1,4}$'
        or jsonb_typeof(r->'path') is distinct from 'string' or not (r->>'path' = any(known))
        or jsonb_typeof(r->'value') is distinct from 'number'
        or jsonb_typeof(r->'observedAt') is distinct from 'string' or length(r->>'observedAt') > 40 then
        continue;
      end if;
      v_id := (r->>'installationId')::bigint; v_instance := (r->>'instance')::integer;
      v_value := (r->>'value')::numeric; v_at := (r->>'observedAt')::timestamptz;
      if v_instance > 1000 or abs(v_value) > 10000000 or v_at < '2000-01-01'::timestamptz or v_at > now() + interval '5 minutes'
        or not exists(select 1 from cos_vrm_private.installations i where i.installation_id = v_id and i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$') then
        continue;
      end if;
      insert into cos_vrm_private.mppt_latest as l(installation_id, instance, path, value, observed_at, checked_at)
        values (v_id, v_instance, r->>'path', v_value, v_at, now())
        on conflict (installation_id, instance, path) do update
          set value = case when excluded.observed_at >= l.observed_at then excluded.value else l.value end,
              observed_at = greatest(l.observed_at, excluded.observed_at), checked_at = now();
      if v_at > now() - interval '10 days' then
        insert into cos_vrm_private.mppt_history(installation_id, instance, path, observed_at, value)
          values (v_id, v_instance, r->>'path', v_at, v_value)
          on conflict (installation_id, instance, path, observed_at) do nothing;
      end if;
      kept := kept + 1;
    exception when others then
      -- One unreadable row never loses the rest of the batch.
      null;
    end;
  end loop;
  for p in select value from jsonb_array_elements(p_paths) loop
    if jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^/[A-Za-z0-9/]{1,60}$' then
      insert into cos_vrm_private.mppt_paths_seen as s(path) values (p #>> '{}')
        on conflict (path) do update set last_seen_at = now();
    end if;
  end loop;
  delete from cos_vrm_private.mppt_history where observed_at < now() - interval '10 days';
  return kept;
end $function$;
revoke all on function public.cos_vrm_mppt_save(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cos_vrm_mppt_save(jsonb, jsonb) to service_role;

-- The scheduled call. It reuses the fleet sync's scheduler credential, read inside the database only.
create or replace function cos_vrm_private.enqueue_mppt_sync()
returns bigint language plpgsql security definer set search_path to '' as $function$
declare request_id bigint;
begin
  if exists(select 1 from cos_vrm_private.sync_state where singleton and (lease_until > now() or retry_after_at > now())) then return null; end if;
  select net.http_post(
    url := 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-mppt-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cos-vrm-sync',(select decrypted_secret from vault.decrypted_secrets where name = 'cos_vrm_sync_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end $function$;
revoke all on function cos_vrm_private.enqueue_mppt_sync() from public, anon, authenticated;
