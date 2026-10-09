-- COS Victron registry only. No equipment/camera/map identity, roles, or existing records are modified.
create schema if not exists cos_vrm_private;
revoke all on schema cos_vrm_private from public, anon, authenticated;
create table cos_vrm_private.installations (
  installation_id bigint primary key check (installation_id between 1 and 9007199254740991),
  name text not null check (length(name) between 1 and 200 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  last_seen_at timestamptz,
  available boolean not null default true
);
create table cos_vrm_private.sync_state (
  singleton boolean primary key default true check (singleton),
  source_user_id bigint check (source_user_id between 1 and 9007199254740991),
  last_attempt_at timestamptz, last_success_at timestamptz,
  lease_id uuid, lease_until timestamptz, retry_after_at timestamptz,
  error_code text check (error_code in ('access','rate_limit','provider','invalid_response','account_changed','storage'))
);
alter table cos_vrm_private.installations enable row level security;
alter table cos_vrm_private.sync_state enable row level security;
revoke all on all tables in schema cos_vrm_private from public, anon, authenticated, service_role;
insert into cos_vrm_private.sync_state(singleton) values (true);


-- The only public RPC callers are existing server-side service_role credentials.
-- No end-user grant or new user authorization is added; the Edge bridge keeps its Owner gate.
create function public.cos_vrm_fleet_snapshot() returns jsonb language plpgsql security definer set search_path = '' as $$
declare s cos_vrm_private.sync_state%rowtype; scheduled boolean := false; rows jsonb;
begin
  select * into strict s from cos_vrm_private.sync_state where singleton;
  if pg_catalog.to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname = $1 and active and schedule = $2)'
      into scheduled using 'cos-vrm-fleet-discovery','*/15 * * * *';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('installationId',installation_id,'name',name,'lastSeenAt',last_seen_at,'available',available) order by name,installation_id),'[]') into rows from cos_vrm_private.installations;
  return jsonb_build_object('items',rows,'lastAttemptAt',s.last_attempt_at,'lastSuccessAt',s.last_success_at,
    'errorCode',s.error_code,'retryAfterAt',s.retry_after_at,'syncing',coalesce(s.lease_until > now(),false),'scheduleActive',scheduled);
end $$;
create function public.cos_vrm_fleet_begin() returns jsonb language plpgsql security definer set search_path = '' as $$
declare s cos_vrm_private.sync_state%rowtype; token uuid;
begin
  select * into strict s from cos_vrm_private.sync_state where singleton for update;
  if s.lease_until > now() or s.retry_after_at > now() or s.last_attempt_at > now() - interval '30 seconds' then
    return jsonb_build_object('leaseId',null);
  end if;
  token := gen_random_uuid();
  update cos_vrm_private.sync_state set lease_id = token, lease_until = now() + interval '60 seconds', last_attempt_at = now() where singleton;
  return jsonb_build_object('leaseId',token);
end $$;
create function public.cos_vrm_fleet_finish(p_lease_id uuid,p_user_id bigint,p_items jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s cos_vrm_private.sync_state%rowtype; row jsonb; ids bigint[] := '{}'; n bigint;
begin
  select * into strict s from cos_vrm_private.sync_state where singleton for update;
  if s.lease_id is distinct from p_lease_id or p_lease_id is null or s.lease_until <= now() then return 'false'::jsonb; end if;
  if p_user_id is null or p_user_id not between 1 and 9007199254740991 then raise exception 'Invalid account ID'; end if;
  if s.source_user_id is not null and s.source_user_id <> p_user_id then return '"account_changed"'::jsonb; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 5000 then raise exception 'Invalid fleet'; end if;
  for row in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(row->'installationId') is distinct from 'number'
      or (row->>'installationId') !~ '^[1-9][0-9]*$' or jsonb_typeof(row->'name') is distinct from 'string'
      or length(row->>'name') not between 1 and 200 or row->>'name' <> btrim(row->>'name') or row->>'name' ~ '[[:cntrl:]]'
      or (select count(*) from jsonb_object_keys(row)) <> 2 then raise exception 'Invalid installation'; end if;
    n := (row->>'installationId')::bigint;
    if n > 9007199254740991 or n = any(ids) then raise exception 'Invalid or duplicate installation'; end if;
    ids := array_append(ids,n);
  end loop;
  if (select count(*) from cos_vrm_private.installations where installation_id <> all(ids)) + cardinality(ids) > 5000 then raise exception 'Registry limit exceeded'; end if;
  update cos_vrm_private.installations set available = false where installation_id <> all(ids);
  insert into cos_vrm_private.installations(installation_id,name,last_seen_at,available)
    select (value->>'installationId')::bigint,value->>'name',now(),true from jsonb_array_elements(p_items)
    on conflict (installation_id) do update set name = excluded.name,last_seen_at = excluded.last_seen_at,available = true;
  update cos_vrm_private.sync_state set source_user_id = p_user_id,last_success_at = now(),error_code = null,
    lease_id = null,lease_until = null,retry_after_at = null where singleton;
  return 'true'::jsonb;
end $$;
create function public.cos_vrm_fleet_fail(p_lease_id uuid,p_error_code text,p_retry_seconds integer) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_error_code is null or p_error_code not in ('access','rate_limit','provider','invalid_response','account_changed','storage') or p_retry_seconds is null or p_retry_seconds not between 30 and 86400 then raise exception 'Invalid failure status'; end if;
  update cos_vrm_private.sync_state set error_code = p_error_code,lease_id = null,lease_until = null,
    retry_after_at = now() + make_interval(secs => p_retry_seconds)
    where singleton and lease_id = p_lease_id and lease_until > now();
  return found;
end $$;
-- Validate the scheduler credential inside Vault; never return its value to the caller.
create function public.cos_vrm_scheduler_authorized(p_secret text) returns boolean language plpgsql security definer set search_path = '' as $$
declare valid boolean := false;
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' then return false; end if;
  select coalesce(bool_or(sha256(convert_to(decrypted_secret,'UTF8')) = sha256(convert_to(p_secret,'UTF8'))),false)
    into valid from vault.decrypted_secrets where name = 'cos_vrm_sync_secret';
  return valid;
end $$;
revoke all on function public.cos_vrm_fleet_snapshot(),public.cos_vrm_fleet_begin(),public.cos_vrm_fleet_finish(uuid,bigint,jsonb),public.cos_vrm_fleet_fail(uuid,text,integer),public.cos_vrm_scheduler_authorized(text) from public,anon,authenticated;
grant execute on function public.cos_vrm_fleet_snapshot(),public.cos_vrm_fleet_begin(),public.cos_vrm_fleet_finish(uuid,bigint,jsonb),public.cos_vrm_fleet_fail(uuid,text,integer),public.cos_vrm_scheduler_authorized(text) to service_role;
