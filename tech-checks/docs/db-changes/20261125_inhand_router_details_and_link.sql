-- Applied to Tech Check (goqrnolcvqnirjmzaeyk) on 2026-11-25. Approved by James Martin 11:27 AM CT
-- ("proceed with your recommendation": router details on the unit card, :8080 router link, Link router).
--
-- 1. camera_unit_routers gains InHand detail columns. Only the InHand pull writes them; nothing else reads
--    or writes them except public.cos_router_details_v1 below. No existing column changes meaning.
--    inhand_public_ip is InHand's live router address, kept apart from router_public_ip (COS's record),
--    which this change never writes.
-- 2. inhand_private.unmatched_routers: InHand routers with no COS router row, replaced on every pull.
--    Holds name, serial, online and last check-in only. No SIM numbers (ICCID/IMSI/IMEI) are stored.
-- 3. cos_inhand_router_status_apply also writes the details and the unmatched list.
-- 4. cos_router_details_v1(): service_role read for the cos-router-details function.
-- 5. cos_router_link_v1(): service_role write, called by cos-router-details only after it has checked
--    the caller is an active Owner or IT profile. Writes one camera_inventory_audit row with the EXISTING
--    action 'ADD_ROUTER_LINK' (already in cos_tracker_endpoint_claims_v1's allow-list since 2026-11-24)
--    and an after_state with no 'id' and no 'public_ip' key, the same shape as the 2026-11-24 rows,
--    so the camera sweep's endpoint claims are unaffected. Check cos_sweep_watchdog_recent_v1 after use.
--
-- Rollback:
--   select pg_get_functiondef('public.cos_inhand_router_status_apply(jsonb,timestamptz)'::regprocedure);  -- restore the
--     2026-11-24 body from tech-checks/operations/db/20261124_inhand_router_status_pull.sql
--   drop function public.cos_router_details_v1(); drop function public.cos_router_link_v1(text,text,uuid,text,text);
--   drop table inhand_private.unmatched_routers;
--   alter table public.camera_unit_routers drop column inhand_public_ip, drop column inhand_signal,
--     drop column inhand_carrier, drop column inhand_firmware, drop column inhand_gps, drop column inhand_details_at;

alter table public.camera_unit_routers
  add column if not exists inhand_public_ip text,
  add column if not exists inhand_signal jsonb,
  add column if not exists inhand_carrier text,
  add column if not exists inhand_firmware text,
  add column if not exists inhand_gps jsonb,
  add column if not exists inhand_details_at timestamptz;

create table if not exists inhand_private.unmatched_routers (
  serial text primary key,
  name text,
  model text,
  online boolean,
  last_seen timestamptz,
  observed_at timestamptz not null
);
revoke all on inhand_private.unmatched_routers from public, anon, authenticated;

-- Readings: [{"serial","online", optional "d": {name, model, pub, sig:{level,radio,band,rsrp,rsrq,sinr,ts}, carrier, fw, gps:{lat,lng,t}, seen}}]
create or replace function public.cos_inhand_router_status_apply(p_readings jsonb, p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; d jsonb;
  v_serial text; v_online text; v_status text; v_count integer; v_row record;
  v_pub text; v_sig jsonb; v_gps jsonb; v_carrier text; v_fw text; v_seen timestamptz;
  c_updated integer := 0; c_unchanged integer := 0; c_unmatched integer := 0; c_ambiguous integer := 0;
  c_held integer := 0; c_brand integer := 0; c_bad integer := 0; c_seen integer := 0;
begin
  if jsonb_typeof(p_readings) is distinct from 'array' then raise exception 'readings must be an array'; end if;
  if jsonb_array_length(p_readings) > 5000 then raise exception 'too many readings'; end if;
  if p_observed_at is null or p_observed_at > now() + interval '1 minute' or p_observed_at < now() - interval '15 minutes' then
    raise exception 'observed_at out of range';
  end if;
  delete from inhand_private.unmatched_routers;

  for r in select value from jsonb_array_elements(p_readings) loop
    c_seen := c_seen + 1;
    v_serial := upper(btrim(coalesce(r->>'serial', '')));
    v_online := r->>'online';
    v_status := case v_online when '1' then 'online' when '0' then 'offline' else null end;
    if v_serial !~ '^[A-Z0-9-]{6,40}$' or v_status is null then c_bad := c_bad + 1; continue; end if;
    d := case when jsonb_typeof(r->'d') = 'object' then r->'d' else '{}'::jsonb end;
    v_pub := case when coalesce(d->>'pub', '') ~ '^\d{1,3}(\.\d{1,3}){3}$' then d->>'pub' else null end;
    v_sig := case when jsonb_typeof(d->'sig') = 'object' then jsonb_strip_nulls(jsonb_build_object(
               'level', case when (d->'sig'->>'level') ~ '^[0-5]$' then (d->'sig'->>'level')::int end,
               'radio', left(nullif(d->'sig'->>'radio', ''), 8), 'band', left(nullif(d->'sig'->>'band', ''), 8),
               'rsrp', case when (d->'sig'->>'rsrp') ~ '^-?\d{1,3}(\.\d+)?$' then (d->'sig'->>'rsrp')::numeric end,
               'rsrq', case when (d->'sig'->>'rsrq') ~ '^-?\d{1,3}(\.\d+)?$' then (d->'sig'->>'rsrq')::numeric end,
               'sinr', case when (d->'sig'->>'sinr') ~ '^-?\d{1,3}(\.\d+)?$' then (d->'sig'->>'sinr')::numeric end,
               'ts', case when (d->'sig'->>'ts') ~ '^\d{4}-\d\d-\d\dT' then d->'sig'->>'ts' end)) end;
    v_gps := case when (d->'gps'->>'lat') ~ '^-?\d{1,3}(\.\d+)?$' and (d->'gps'->>'lng') ~ '^-?\d{1,3}(\.\d+)?$'
               and abs((d->'gps'->>'lat')::numeric) <= 90 and abs((d->'gps'->>'lng')::numeric) <= 180
             then jsonb_build_object('lat', (d->'gps'->>'lat')::numeric, 'lng', (d->'gps'->>'lng')::numeric,
               't', case when (d->'gps'->>'t') ~ '^\d{4}-\d\d-\d\dT' then d->'gps'->>'t' end) end;
    v_carrier := left(nullif(btrim(coalesce(d->>'carrier', '')), ''), 24);
    v_fw := left(nullif(btrim(coalesce(d->>'fw', '')), ''), 24);
    v_seen := case when (d->>'seen') ~ '^\d{4}-\d\d-\d\dT' then (d->>'seen')::timestamptz end;

    select count(*) into v_count from public.camera_unit_routers where upper(btrim(inhand_serial)) = v_serial;
    if v_count = 0 then
      c_unmatched := c_unmatched + 1;
      insert into inhand_private.unmatched_routers (serial, name, model, online, last_seen, observed_at)
      values (v_serial, left(nullif(btrim(coalesce(d->>'name', '')), ''), 80), left(nullif(btrim(coalesce(d->>'model', '')), ''), 24),
              v_status = 'online', v_seen, p_observed_at)
      on conflict (serial) do nothing;
      continue;
    end if;
    if v_count > 1 then c_ambiguous := c_ambiguous + 1; continue; end if;

    select id, status_source, status_observed_at, router_type, router_model into v_row
      from public.camera_unit_routers where upper(btrim(inhand_serial)) = v_serial for update;
    if coalesce(v_row.status_source, '') like 'Held:%' then c_held := c_held + 1; continue; end if;
    if lower(coalesce(v_row.router_type, '')) in ('mofi', 'cradlepoint')
       or coalesce(v_row.router_model, '') ~* '(mofi|cradlepoint)' then c_brand := c_brand + 1; continue; end if;
    if v_row.status_observed_at is not null and v_row.status_observed_at >= p_observed_at then c_unchanged := c_unchanged + 1; continue; end if;

    update public.camera_unit_routers
       set reported_status = v_status,
           status_observed_at = p_observed_at,
           status_source = 'InHand live pull',
           inhand_public_ip = v_pub,
           inhand_signal = v_sig,
           inhand_carrier = v_carrier,
           inhand_firmware = v_fw,
           inhand_gps = v_gps,
           inhand_details_at = p_observed_at,
           updated_at = now()
     where id = v_row.id;
    c_updated := c_updated + 1;
  end loop;

  insert into inhand_private.pull_runs (ok, devices_seen, updated, unchanged, unmatched, ambiguous, held_skipped, brand_skipped, bad_status)
  values (true, c_seen, c_updated, c_unchanged, c_unmatched, c_ambiguous, c_held, c_brand, c_bad);
  return jsonb_build_object('devices_seen', c_seen, 'updated', c_updated, 'unchanged', c_unchanged, 'unmatched', c_unmatched,
    'ambiguous', c_ambiguous, 'held_skipped', c_held, 'brand_skipped', c_brand, 'bad_status', c_bad);
end $$;

-- Everything the unit card and the Link router list need, in one read. Router admin port is 8080 for the whole
-- fleet (James, 2026-11-25). The link address is InHand's live address when InHand has one, else COS's record.
create or replace function public.cos_router_details_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'routers', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'unit', r.unit_key,
        'serial', r.inhand_serial,
        'model', nullif(r.router_model, ''),
        'status', case when r.status_source = 'InHand live pull' then r.reported_status end,
        'at', case when r.status_source = 'InHand live pull' then r.status_observed_at end,
        'ip', coalesce(r.inhand_public_ip, host(r.router_public_ip)),
        'ipFrom', case when r.inhand_public_ip is not null then 'inhand' when r.router_public_ip is not null then 'cos' end,
        'cosDiffers', r.inhand_public_ip is not null and r.router_public_ip is not null and r.inhand_public_ip <> host(r.router_public_ip),
        'port', 8080,
        'sig', r.inhand_signal, 'carrier', r.inhand_carrier, 'fw', r.inhand_firmware, 'gps', r.inhand_gps,
        'detailsAt', r.inhand_details_at)) order by r.unit_key)
      from public.camera_unit_routers r where nullif(btrim(r.inhand_serial), '') is not null), '[]'::jsonb),
    'unmatched', coalesce((select jsonb_agg(jsonb_build_object('serial', u.serial, 'name', u.name, 'model', u.model,
        'online', u.online, 'lastSeen', u.last_seen, 'at', u.observed_at) order by u.online desc, u.name)
      from inhand_private.unmatched_routers u), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(k order by k) from (
        select distinct d.unit_key k from public.camera_devices d
         where nullif(btrim(d.unit_key), '') is not null
           and not exists (select 1 from public.camera_unit_routers r where r.unit_key = d.unit_key and nullif(btrim(r.inhand_serial), '') is not null)) x), '[]'::jsonb));
$$;

-- Link an unmatched InHand router to a COS unit. The caller (cos-router-details) has already checked the person.
create or replace function public.cos_router_link_v1(p_unit_key text, p_serial text, p_actor_id uuid, p_actor_name text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_serial text := upper(btrim(coalesce(p_serial, '')));
  v_unit text := btrim(coalesce(p_unit_key, ''));
  v_row record; v_id bigint; v_model text;
begin
  if v_serial !~ '^[A-Z0-9-]{6,40}$' then return jsonb_build_object('ok', false, 'message', 'That router serial is not valid.'); end if;
  if v_unit = '' or not exists (select 1 from public.camera_devices where unit_key = v_unit) then
    return jsonb_build_object('ok', false, 'message', 'COS has no unit named ' || coalesce(nullif(v_unit, ''), '(blank)') || '.'); end if;
  if exists (select 1 from public.camera_unit_routers where upper(btrim(inhand_serial)) = v_serial) then
    return jsonb_build_object('ok', false, 'message', 'That router is already linked to a unit.'); end if;
  select model into v_model from inhand_private.unmatched_routers where serial = v_serial;
  if not found then return jsonb_build_object('ok', false, 'message', 'InHand did not list that router in the latest pull. Wait for the next pull and try again.'); end if;
  select id, inhand_serial into v_row from public.camera_unit_routers where unit_key = v_unit order by id limit 1 for update;
  if found and nullif(btrim(v_row.inhand_serial), '') is not null then
    return jsonb_build_object('ok', false, 'message', v_unit || ' already has a router linked. Fix that one first.'); end if;
  if found then
    update public.camera_unit_routers set inhand_serial = v_serial, updated_at = now() where id = v_row.id returning id into v_id;
  else
    insert into public.camera_unit_routers (unit_key, router_name, router_model, inhand_serial, created_at, updated_at)
    values (v_unit, 'InHand Router', 'InHand ' || coalesce(nullif(v_model, ''), 'router'), v_serial, now(), now()) returning id into v_id;
  end if;
  delete from inhand_private.unmatched_routers where serial = v_serial;
  insert into public.camera_inventory_audit (actor_id, actor_name, action, unit_key, device_ids, before_state, after_state, reason, created_at)
  values (p_actor_id, left(coalesce(nullif(btrim(p_actor_name), ''), 'COS user'), 120), 'ADD_ROUTER_LINK', v_unit, array[]::bigint[], 'null'::jsonb,
          jsonb_build_object('camera_unit_routers_id', v_id, 'inhand_serial', v_serial, 'router_model', 'InHand ' || coalesce(nullif(v_model, ''), 'router')),
          left(coalesce(nullif(btrim(p_reason), ''), 'Linked with the Link router button in COS.'), 500), now());
  return jsonb_build_object('ok', true, 'message', 'Linked. Its status shows after the next InHand pull, within 30 minutes.', 'unit', v_unit, 'serial', v_serial);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.cos_router_details_v1()', 'public.cos_router_link_v1(text, text, uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
