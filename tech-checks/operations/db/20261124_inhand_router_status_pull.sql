-- Scheduled, read-only InHand router status pull (Cameras On Site project).
--
-- What this writes: on existing camera_unit_routers rows ONLY, and only when the
-- InHand serial matches exactly one row, it sets reported_status,
-- status_observed_at and status_source = 'InHand live pull'.
-- It never inserts or deletes rows and never touches names, unit_key, IPs,
-- ports, current_status (the TCP probe's field) or last_online_at.
-- Held rows ("Held: ...") and MOFI / Cradlepoint rows are skipped.
-- Nothing is ever written back to InHand.

create schema if not exists inhand_private;
revoke all on schema inhand_private from public, anon, authenticated;

-- One row: the cached InHand session for the pull. Service role only.
create table if not exists inhand_private.oauth_state (
  id smallint primary key default 1 check (id = 1),
  access_token text,
  access_expires_at timestamptz,
  refresh_token text,
  updated_at timestamptz not null default now()
);
revoke all on inhand_private.oauth_state from public, anon, authenticated;

-- One row per pull, so a stopped feed is visible instead of silent.
create table if not exists inhand_private.pull_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  ok boolean not null,
  error_code text,
  devices_seen integer,
  updated integer,
  unchanged integer,
  unmatched integer,
  ambiguous integer,
  held_skipped integer,
  brand_skipped integer,
  bad_status integer
);
revoke all on inhand_private.pull_runs from public, anon, authenticated;
create index if not exists pull_runs_started_at on inhand_private.pull_runs (started_at desc);

create or replace function public.cos_inhand_oauth_get()
returns table(access_token text, access_expires_at timestamptz, refresh_token text)
language sql security definer set search_path = '' as $$
  select s.access_token, s.access_expires_at, s.refresh_token from inhand_private.oauth_state s where s.id = 1
$$;

create or replace function public.cos_inhand_oauth_put(p_access_token text, p_expires_in_seconds integer, p_refresh_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into inhand_private.oauth_state (id, access_token, access_expires_at, refresh_token, updated_at)
  values (1, p_access_token,
          case when p_access_token is null then null
               else now() + make_interval(secs => greatest(60, least(coalesce(p_expires_in_seconds, 3600), 86400)) - 60) end,
          p_refresh_token, now())
  on conflict (id) do update set
    access_token = excluded.access_token,
    access_expires_at = excluded.access_expires_at,
    -- A token response without a refresh token keeps the previous one.
    refresh_token = coalesce(excluded.refresh_token, inhand_private.oauth_state.refresh_token),
    updated_at = now();
end $$;

create or replace function public.cos_inhand_oauth_clear()
returns void language sql security definer set search_path = '' as $$
  update inhand_private.oauth_state set access_token = null, access_expires_at = null, refresh_token = null, updated_at = now() where id = 1
$$;

create or replace function public.cos_inhand_pull_failed(p_error_code text)
returns void language sql security definer set search_path = '' as $$
  insert into inhand_private.pull_runs (ok, error_code) values (false, left(p_error_code, 120))
$$;

-- p_readings: [{"serial": "RF3...", "online": 0|1}, ...] exactly as InHand reported them.
-- p_observed_at: when this pull read InHand (the live reading's time).
create or replace function public.cos_inhand_router_status_apply(p_readings jsonb, p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_serial text;
  v_online text;
  v_status text;
  v_count integer;
  v_row record;
  c_updated integer := 0; c_unchanged integer := 0; c_unmatched integer := 0; c_ambiguous integer := 0;
  c_held integer := 0; c_brand integer := 0; c_bad integer := 0; c_seen integer := 0;
  v_result jsonb;
begin
  if jsonb_typeof(p_readings) is distinct from 'array' then raise exception 'readings must be an array'; end if;
  if jsonb_array_length(p_readings) > 5000 then raise exception 'too many readings'; end if;
  if p_observed_at is null or p_observed_at > now() + interval '1 minute' or p_observed_at < now() - interval '15 minutes' then
    raise exception 'observed_at out of range';
  end if;

  for r in select value from jsonb_array_elements(p_readings) loop
    c_seen := c_seen + 1;
    v_serial := upper(btrim(coalesce(r->>'serial', '')));
    v_online := r->>'online';
    v_status := case v_online when '1' then 'online' when '0' then 'offline' else null end;
    if v_serial !~ '^[A-Z0-9-]{6,40}$' or v_status is null then c_bad := c_bad + 1; continue; end if;

    select count(*) into v_count from public.camera_unit_routers where upper(btrim(inhand_serial)) = v_serial;
    if v_count = 0 then c_unmatched := c_unmatched + 1; continue; end if;
    if v_count > 1 then c_ambiguous := c_ambiguous + 1; continue; end if;

    select id, status_source, status_observed_at, reported_status, router_type, router_model into v_row
      from public.camera_unit_routers where upper(btrim(inhand_serial)) = v_serial for update;
    if coalesce(v_row.status_source, '') like 'Held:%' then c_held := c_held + 1; continue; end if;
    if lower(coalesce(v_row.router_type, '')) in ('mofi', 'cradlepoint')
       or coalesce(v_row.router_model, '') ~* '(mofi|cradlepoint)' then c_brand := c_brand + 1; continue; end if;
    -- An older or equal reading never replaces a newer one.
    if v_row.status_observed_at is not null and v_row.status_observed_at >= p_observed_at then c_unchanged := c_unchanged + 1; continue; end if;

    update public.camera_unit_routers
       set reported_status = v_status,
           status_observed_at = p_observed_at,
           status_source = 'InHand live pull',
           updated_at = now()
     where id = v_row.id;
    c_updated := c_updated + 1;
  end loop;

  insert into inhand_private.pull_runs (ok, devices_seen, updated, unchanged, unmatched, ambiguous, held_skipped, brand_skipped, bad_status)
  values (true, c_seen, c_updated, c_unchanged, c_unmatched, c_ambiguous, c_held, c_brand, c_bad);

  v_result := jsonb_build_object('devices_seen', c_seen, 'updated', c_updated, 'unchanged', c_unchanged, 'unmatched', c_unmatched,
    'ambiguous', c_ambiguous, 'held_skipped', c_held, 'brand_skipped', c_brand, 'bad_status', c_bad);
  return v_result;
end $$;

-- Readable by the Owner app later; status counts only, no tokens.
-- One-time connect links. A state is issued by the owner (SQL), lasts 30 minutes, works once.
create table if not exists inhand_private.connect_states (
  state text primary key check (state ~ '^[A-Za-z0-9_-]{20,100}$'),
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz
);
revoke all on inhand_private.connect_states from public, anon, authenticated;

create or replace function public.cos_inhand_connect_take(p_state text)
returns boolean language sql security definer set search_path = '' as $$
  with taken as (
    update inhand_private.connect_states set used_at = now()
     where state = p_state and used_at is null and expires_at > now()
    returning 1)
  select exists (select 1 from taken)
$$;

create or replace function public.cos_inhand_pull_recent(p_limit integer default 20)
returns setof inhand_private.pull_runs language sql security definer set search_path = '' as $$
  select * from inhand_private.pull_runs order by started_at desc limit greatest(1, least(p_limit, 200))
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.cos_inhand_oauth_get()',
    'public.cos_inhand_oauth_put(text, integer, text)',
    'public.cos_inhand_oauth_clear()',
    'public.cos_inhand_pull_failed(text)',
    'public.cos_inhand_router_status_apply(jsonb, timestamptz)',
    'public.cos_inhand_pull_recent(integer)',
    'public.cos_inhand_connect_take(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Keep the run log small: 30 days.
create or replace function inhand_private.prune_pull_runs() returns void language sql set search_path = '' as $$
  delete from inhand_private.pull_runs where started_at < now() - interval '30 days'
$$;

-- Schedule (applied separately, after the function is deployed and one manual run is checked):
-- select cron.schedule('inhand-router-status-pull', '2,12,22,32,42,52 * * * *', $cron$
--   select net.http_post(url:='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/inhand-router-status-pull',
--     headers:=jsonb_build_object('Content-Type','application/json','x-camera-cron-secret',
--       (select decrypted_secret from vault.decrypted_secrets where name='camera_health_cron_secret' limit 1)),
--     body:='{}'::jsonb, timeout_milliseconds:=60000);
--   select inhand_private.prune_pull_runs();
-- $cron$);
--
-- Rollback: select cron.unschedule('inhand-router-status-pull');
-- then drop the seven public.cos_inhand_* functions and schema inhand_private cascade.
-- Router rows keep their last written status, which simply ages into Unknown.
