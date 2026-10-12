-- Extend the existing private registry and service-only RPCs. No access grants change.
alter table cos_vrm_private.installations
  add column power_observations jsonb,
  add column power_last_attempt_at timestamptz,
  add column power_error_code text;

create or replace function public.cos_vrm_fleet_finish(p_lease_id uuid,p_user_id bigint,p_items jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare s cos_vrm_private.sync_state%rowtype; row jsonb; ids bigint[] := '{}'; n bigint; power jsonb; obs jsonb; metric text; measured_value numeric; attempted timestamptz;
begin
  select * into strict s from cos_vrm_private.sync_state where singleton for update;
  if s.lease_id is distinct from p_lease_id or p_lease_id is null or s.lease_until <= now() then return 'false'::jsonb; end if;
  if p_user_id is null or p_user_id not between 1 and 9007199254740991 then raise exception 'Invalid account ID'; end if;
  if s.source_user_id is not null and s.source_user_id <> p_user_id then return '"account_changed"'::jsonb; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>5000 then raise exception 'Invalid fleet'; end if;
  for row in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(row) is distinct from 'object' or jsonb_typeof(row->'installationId') is distinct from 'number'
      or (row->>'installationId') !~ '^[1-9][0-9]*$' or jsonb_typeof(row->'name') is distinct from 'string'
      or length(row->>'name') not between 1 and 200 or row->>'name'<>btrim(row->>'name') or row->>'name' ~ '[[:cntrl:]]'
      or exists(select 1 from jsonb_object_keys(row) k where k not in ('installationId','name','power'))
      or (select count(*) from jsonb_object_keys(row)) not between 2 and 3 then raise exception 'Invalid installation'; end if;
    n := (row->>'installationId')::bigint;
    if n>9007199254740991 or n=any(ids) then raise exception 'Invalid or duplicate installation'; end if;
    ids := array_append(ids,n);
    if row ? 'power' then
      power := row->'power';
      if row->>'name' !~* '^HELIOS[[:space:]]+[0-9]{1,3}$' or jsonb_typeof(power) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(power))<>3 or not(power ?& array['checkedAt','observations','errorCode'])
        or jsonb_typeof(power->'checkedAt') is distinct from 'string' or length(power->>'checkedAt')>40
        or jsonb_typeof(power->'observations') is distinct from 'array' or jsonb_array_length(power->'observations')>40
        or jsonb_typeof(power->'errorCode') not in ('string','null')
        or coalesce(power->>'errorCode','') not in ('','access','provider','rate_limit','invalid_response','no_data') then raise exception 'Invalid power snapshot'; end if;
      attempted := (power->>'checkedAt')::timestamptz;
      if attempted<now()-interval '30 minutes' or attempted>now()+interval '5 minutes' then raise exception 'Invalid power attempt time'; end if;
      for obs in select value from jsonb_array_elements(power->'observations') loop
        if jsonb_typeof(obs) is distinct from 'object' or (select count(*) from jsonb_object_keys(obs))<>6
          or not(obs ?& array['metric','value','unit','observedAt','instance','source'])
          or jsonb_typeof(obs->'metric') is distinct from 'string' or jsonb_typeof(obs->'value') is distinct from 'number'
          or jsonb_typeof(obs->'unit') is distinct from 'string' or jsonb_typeof(obs->'observedAt') is distinct from 'string'
          or length(obs->>'observedAt')>40 or jsonb_typeof(obs->'instance') is distinct from 'number'
          or obs->>'instance' !~ '^[0-9]+$' or (obs->>'instance')::numeric>1000
          or jsonb_typeof(obs->'source') is distinct from 'string' or obs->>'source' not in ('system','battery','solarcharger') then raise exception 'Invalid power measurement'; end if;
        metric := obs->>'metric'; measured_value := (obs->>'value')::numeric;
        if metric not in ('battery_soc','battery_voltage','battery_current','battery_power','solar_power','load_power','low_voltage_alarm','low_soc_alarm','high_voltage_alarm')
          or obs->>'unit' is distinct from (case metric when 'battery_soc' then '%' when 'battery_voltage' then 'V' when 'battery_current' then 'A' when 'battery_power' then 'W' when 'solar_power' then 'W' when 'load_power' then 'W' else 'state' end)
          or abs(measured_value)>1000000 or metric='battery_soc' and measured_value not between 0 and 100
          or metric='battery_voltage' and measured_value not between 0 and 200 or metric='battery_current' and abs(measured_value)>10000
          or metric='solar_power' and measured_value<0 or metric like '%_alarm' and measured_value not between 0 and 2
          or (obs->>'observedAt')::timestamptz<'2000-01-01'::timestamptz
          or (obs->>'observedAt')::timestamptz>attempted+interval '5 minutes' then raise exception 'Invalid power measurement range'; end if;
      end loop;
    end if;
  end loop;
  if (select count(*) from cos_vrm_private.installations where installation_id<>all(ids))+cardinality(ids)>5000 then raise exception 'Registry limit exceeded'; end if;
  update cos_vrm_private.installations set available=false where installation_id<>all(ids);
  insert into cos_vrm_private.installations as registry(installation_id,name,last_seen_at,available,power_observations,power_last_attempt_at,power_error_code)
    select (value->>'installationId')::bigint,value->>'name',now(),true,
      case when jsonb_array_length(value->'power'->'observations')>0 then value->'power'->'observations' else null end,
      (value->'power'->>'checkedAt')::timestamptz,value->'power'->>'errorCode' from jsonb_array_elements(p_items)
    on conflict(installation_id) do update set name=excluded.name,last_seen_at=excluded.last_seen_at,available=true,
      power_observations=case when excluded.power_last_attempt_at>=coalesce(registry.power_last_attempt_at,'-infinity'::timestamptz) then coalesce(excluded.power_observations,registry.power_observations) else registry.power_observations end,
      power_error_code=case when excluded.power_last_attempt_at>=coalesce(registry.power_last_attempt_at,'-infinity'::timestamptz) then excluded.power_error_code else registry.power_error_code end,
      power_last_attempt_at=greatest(registry.power_last_attempt_at,excluded.power_last_attempt_at);
  update cos_vrm_private.sync_state set source_user_id=p_user_id,last_success_at=now(),error_code=null,lease_id=null,lease_until=null,retry_after_at=null where singleton;
  return 'true'::jsonb;
end $function$;

create or replace function public.cos_vrm_fleet_snapshot()
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare s cos_vrm_private.sync_state%rowtype; scheduled boolean:=false; rows jsonb; power jsonb;
begin
  select * into strict s from cos_vrm_private.sync_state where singleton;
  if pg_catalog.to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=$1 and active and schedule=$2)' into scheduled using 'cos-vrm-fleet-discovery','*/15 * * * *';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('installationId',installation_id,'name',name,'lastSeenAt',last_seen_at,'available',available) order by name,installation_id),'[]') into rows from cos_vrm_private.installations;
  select coalesce(jsonb_agg(jsonb_build_object('installationId',installation_id,'name',name,'measurements',coalesce(power_observations,'[]'::jsonb),'lastAttemptAt',power_last_attempt_at,'errorCode',power_error_code) order by name,installation_id),'[]') into power from cos_vrm_private.installations where name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$';
  return jsonb_build_object('items',rows,'power',power,'lastAttemptAt',s.last_attempt_at,'lastSuccessAt',s.last_success_at,'errorCode',s.error_code,'retryAfterAt',s.retry_after_at,'syncing',coalesce(s.lease_until>now(),false),'scheduleActive',scheduled);
end $function$;
