-- REVIEW CANDIDATE ONLY. Apply with both publisher candidates; no user or placement changes.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
alter table public.camera_devices add column if not exists connection_revision bigint not null default 0;

create or replace function public.camera_connection_invalidate_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if row(new.public_ip,new.expected_ports,new.monitoring_profile,new.unit_key,new.monitoring_enabled)
     is distinct from row(old.public_ip,old.expected_ports,old.monitoring_profile,old.unit_key,old.monitoring_enabled) then
    insert into public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
    values(old.id,'unknown','saved_connection_changed',clock_timestamp(),jsonb_build_object(
      'actor',auth.uid(),'previous_ip',host(old.public_ip),'new_ip',host(new.public_ip),
      'previous_ports',old.expected_ports,'new_ports',new.expected_ports,
      'previous_revision',old.connection_revision,'new_revision',old.connection_revision+1,
      'previous_last_success',old.last_probe_online_at));
    new.connection_revision:=old.connection_revision+1;
    new.last_probe_online_at:=null;
    if lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then new.last_health_checked_at:=null; end if;
    update public.camera_health_current set port_status='{}',ip_reachable=null,
      overall_status=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then 'unknown' else overall_status end,
      checked_at=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then null else checked_at end,
      consecutive_failures=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then 0 else consecutive_failures end,
      confirmed_outage=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then false else confirmed_outage end,
      confirmation_reason=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then null else confirmation_reason end,
      detail=case when lower(coalesce(new.monitoring_profile,'')) in ('sniper','camv') then 'Saved connection changed; awaiting a check of the new endpoint.' else detail end
    where camera_device_id=new.id;
  else
    new.connection_revision:=old.connection_revision;
    -- Older publishers cannot refresh a new endpoint's last-success timestamp.
    if new.last_probe_online_at is distinct from old.last_probe_online_at
       and current_setting('cos.connection_publish_device',true) is distinct from new.id::text then
      new.last_probe_online_at:=old.last_probe_online_at;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.camera_connection_invalidate_v1() from public,anon,authenticated;
drop trigger if exists camera_connection_invalidate_v1 on public.camera_devices;
create trigger camera_connection_invalidate_v1 before update on public.camera_devices
for each row execute function public.camera_connection_invalidate_v1();

-- Legacy TCP writers without endpoint attribution fail closed during rollout.
-- Provider-only writes remain intact; provider observations never renew old TCP proof.
create or replace function public.camera_connection_proof_guard_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.camera_devices%rowtype;
begin
 select * into d from public.camera_devices where id=new.camera_device_id;
 if jsonb_typeof(new.port_status)='object' and new.port_status<>'{}'::jsonb then
   if new.port_status->'_connection'->>'revision' is distinct from d.connection_revision::text
      or new.port_status->'_connection'->>'ip' is distinct from host(d.public_ip)
 then
     new.port_status:='{}'; new.ip_reachable:=null;
     if lower(coalesce(d.monitoring_profile,'')) in ('sniper','camv') then
       new.overall_status:='unknown'; new.checked_at:=null;new.confirmed_outage:=false;new.consecutive_failures:=0;
       new.confirmation_reason:=null;new.detail:='Connection check discarded because endpoint evidence was not current.';
     end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function public.camera_connection_proof_guard_v1() from public,anon,authenticated;
drop trigger if exists camera_connection_proof_guard_v1 on public.camera_health_current;
create trigger camera_connection_proof_guard_v1 before insert or update on public.camera_health_current
for each row execute function public.camera_connection_proof_guard_v1();

CREATE OR REPLACE FUNCTION public.publish_camera_connection_v1(p_device_id bigint, p_revision bigint, p_public_ip inet, p_expected_ports integer[], p_monitoring_profile text, p_health jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare d public.camera_devices%rowtype; h public.camera_health_current%rowtype; at_time timestamptz; ports jsonb; status_value text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
 select * into d from public.camera_devices where id=p_device_id for update;
 if not found or d.connection_revision is distinct from p_revision or d.public_ip is distinct from p_public_ip
   or d.expected_ports is distinct from p_expected_ports or d.monitoring_profile is distinct from p_monitoring_profile
   or not d.monitoring_enabled then return jsonb_build_object('ok',false,'reason','connection_changed');end if;
 if p_source not in ('manual_tcp_check','automatic_tcp_sweep') then raise exception 'Invalid check source';end if;
 at_time:=(p_health->>'checked_at')::timestamptz;
 if at_time is null or at_time>clock_timestamp()+interval '30 seconds' or at_time<clock_timestamp()-interval '5 minutes' then raise exception 'Invalid observation time';end if;
 ports:=p_health->'port_status';status_value:=p_health->>'overall_status';
 if jsonb_typeof(ports)<>'object' or ports='{}'::jsonb or status_value not in ('online','offline','unknown','verifying') then raise exception 'Invalid connection observation';end if;
 if exists(select 1 from jsonb_each(ports) e where e.key!~'^[0-9]{1,5}$' or (case when e.key~'^[0-9]{1,5}$' then e.key::int not between 1 and 65535 else true end) or jsonb_typeof(e.value->'online') is distinct from 'boolean') then raise exception 'Invalid port results';end if;
 select * into h from public.camera_health_current where camera_device_id=d.id for update;
 if (h.port_status->'_connection'->>'checkedAt')::timestamptz>at_time then return jsonb_build_object('ok',false,'reason','newer_observation');end if;
 ports:=ports||jsonb_build_object('_connection',jsonb_build_object('revision',d.connection_revision::text,'checkedAt',to_jsonb(at_time),'ip',host(d.public_ip),'status',status_value,'reachable',(p_health->>'ip_reachable')::boolean,'confirmedOutage',coalesce((p_health->>'confirmed_outage')::boolean,false),'consecutiveFailures',least(3,greatest(0,coalesce((p_health->>'consecutive_failures')::int,0)))));
 insert into public.camera_health_current(camera_device_id,overall_status,ip_reachable,port_status,checked_at,consecutive_failures,detail,confirmed_outage,confirmation_reason,first_failed_at,last_recovered_at,acknowledged_at,acknowledged_by)
 values(d.id,case when lower(d.monitoring_profile) in ('sniper','camv') then status_value else coalesce(d.source_status,'unknown') end,
 (p_health->>'ip_reachable')::boolean,ports,case when lower(d.monitoring_profile) in ('sniper','camv') then at_time else d.source_last_seen_at end,
 case when lower(d.monitoring_profile) in ('sniper','camv') then least(3,greatest(0,coalesce((p_health->>'consecutive_failures')::int,0))) else 0 end,case when lower(d.monitoring_profile) in ('sniper','camv') then left(p_health->>'detail',300) else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then coalesce((p_health->>'confirmed_outage')::boolean,false) else false end,case when lower(d.monitoring_profile) in ('sniper','camv') then left(p_health->>'confirmation_reason',200) else null end,
 case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'first_failed_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'last_recovered_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'acknowledged_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'acknowledged_by')::uuid else null end)
 on conflict(camera_device_id) do update set
 overall_status=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.overall_status else camera_health_current.overall_status end,
 ip_reachable=excluded.ip_reachable,port_status=excluded.port_status,
 checked_at=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.checked_at else camera_health_current.checked_at end,
 consecutive_failures=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.consecutive_failures else camera_health_current.consecutive_failures end,
 detail=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.detail else camera_health_current.detail end,
 confirmed_outage=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.confirmed_outage else camera_health_current.confirmed_outage end,
 confirmation_reason=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.confirmation_reason else camera_health_current.confirmation_reason end,
 first_failed_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'first_failed_at' then excluded.first_failed_at else camera_health_current.first_failed_at end,
 last_recovered_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'last_recovered_at' then excluded.last_recovered_at else camera_health_current.last_recovered_at end,
 acknowledged_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'acknowledged_at' then excluded.acknowledged_at else camera_health_current.acknowledged_at end,
 acknowledged_by=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'acknowledged_by' then excluded.acknowledged_by else camera_health_current.acknowledged_by end;
 perform set_config('cos.connection_publish_device',d.id::text,true);
 update public.camera_devices set last_health_checked_at=case when lower(d.monitoring_profile) in ('sniper','camv') then at_time else last_health_checked_at end,last_probe_online_at=case when (p_health->>'ip_reachable')::boolean then at_time else last_probe_online_at end where id=d.id;
 perform set_config('cos.connection_publish_device','',true);
 if lower(d.monitoring_profile) in ('sniper','camv') and h.overall_status is distinct from status_value then
 insert into public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
 values(d.id,status_value,p_source,at_time,jsonb_build_object('previous_status',h.overall_status,'ports',ports,'public_ip_used',host(d.public_ip),'connection_revision',d.connection_revision));end if;
 return jsonb_build_object('ok',true,'checked_at',at_time,'revision',d.connection_revision);
end $function$;
revoke all on function public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text) from public,anon,authenticated;
grant execute on function public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text) to service_role;
commit;