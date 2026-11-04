-- Apply to the camera-health sweep database.
set local lock_timeout = '1s';
set local statement_timeout = '8s';

-- Restrict the guarded claim scan to history rows that recorded a probed address.
create index if not exists camera_health_history_public_ip_claim_idx
on public.camera_health_history (camera_device_id, (detail->>'public_ip_used'))
where detail->>'public_ip_used' is not null;

set local lock_timeout = '1s';

-- Prefer the partial history index. The planner otherwise overestimates rows with an IP.
-- Deduplicate the stored strings before parsing each address as inet.
CREATE OR REPLACE FUNCTION public.cos_tracker_endpoint_claims_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET enable_seqscan TO 'off'
AS $function$
declare result jsonb;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 -- One query snapshot for current, inactive, deleted-resource and historical claims.
 with audit as materialized (
  select action,before_state,after_state from public.camera_inventory_audit
 ), snapshots as (
  select action,v,'before'::text as side from audit cross join lateral jsonb_array_elements(
   case when jsonb_typeof(before_state)='array' then before_state
    when jsonb_typeof(before_state)='object' then jsonb_build_array(before_state) else '[]'::jsonb end) v
  union all select action,after_state,'after' from audit where jsonb_typeof(after_state)='object'
 ), current_devices as materialized (
  select id::text as id,host(public_ip) as public_ip,connection_revision::text as connection_revision,
   expected_ports,monitoring_enabled,activation_state,device_name,unit_key,organization,mhelp_product_id as product_id from public.camera_devices
 ), probe_addresses as materialized (
  select distinct camera_device_id, detail->>'public_ip_used' as address
  from public.camera_health_history where detail->>'public_ip_used' is not null
 ), historical as (
  select v->>'id' as resource_id,host((v->>'public_ip')::inet) as ip,v->>'unit_key' as unit_key
   from snapshots where v ? 'public_ip' and v->>'public_ip' is not null and v->>'id' is not null
  union select camera_device_id::text,host(address::inet),null
   from probe_addresses
 ), retained as (
  select distinct resource_id,ip from historical h where not exists (
   select 1 from current_devices d where d.id=h.resource_id and d.public_ip=h.ip
    and (h.unit_key is null or h.unit_key is not distinct from d.unit_key))
 ), invalid as (
  select 1 from audit where jsonb_typeof(after_state) is distinct from 'object' or action is null or action not in('MOVE_TO_ROOT','MOVE_TO_FIELD','CORRECT_CAMERA_IDENTITY','RESOURCE_TYPE_CORRECTION')
   or (action in('MOVE_TO_ROOT','MOVE_TO_FIELD') and (jsonb_typeof(before_state) is distinct from 'array' or before_state='[]'::jsonb))
   or (action='CORRECT_CAMERA_IDENTITY' and (before_state->>'id' is null or before_state->>'public_ip' is null))
  union all select 1 from snapshots where side='before' and action in('MOVE_TO_ROOT','MOVE_TO_FIELD','CORRECT_CAMERA_IDENTITY') and (jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'id','')!~'^[1-9][0-9]*$' or not(v ? 'public_ip') or not(v ? 'unit_key'))
  union all select 1 from historical where resource_id is null or resource_id!~'^[1-9][0-9]*$' or ip is null
 )
 select jsonb_build_object('complete',not exists(select 1 from invalid),
  'observedAt',floor(extract(epoch from statement_timestamp())*1000),
  'devices',coalesce((select jsonb_agg(d order by id) from current_devices d),'[]'::jsonb),
  'claims',coalesce((select jsonb_agg(jsonb_build_object('resourceId',resource_id,'ip',ip) order by resource_id,ip) from retained),'[]'::jsonb)) into result;
 if octet_length(result::text)>8000000 then raise exception 'Endpoint claims exceed bounded read';end if;
 return result;
end$function$
;
