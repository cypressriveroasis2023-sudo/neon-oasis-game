-- Durable Fleet board reliability, 2026-11-09. Apply after
-- fleet-durable-board-install.sql and fleet-board-staging.sql.
--
-- 1. Polling no longer has to rebuild the whole completed board: a small
--    status record and the immutable completed payload are read separately.
-- 2. Each run records bounded, non-sensitive step diagnostics (step names,
--    durations, HTTP status, attempt counts). No source rows, addresses,
--    IPs, tokens or identities are stored in diagnostics.
-- 3. The batch lease is 180 seconds. The measured successful batch needed
--    109 of the previous 120 seconds, so ordinary variance expired it.
-- Existing callers that pass only the original arguments keep working.
alter table cos_fleet_board_private.runs add column if not exists diagnostics jsonb;

create or replace function public.cos_fleet_board_begin(p_force boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c cos_fleet_board_private.control%rowtype;r uuid;
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 select * into c from cos_fleet_board_private.control where singleton for update;
 if c.active_id is not null and exists(select 1 from cos_fleet_board_private.runs where id=c.active_id and started_at>clock_timestamp()-interval '180 seconds' and state='running') then if p_force then update cos_fleet_board_private.control set queued=true where singleton;end if;return null;end if;
 if clock_timestamp()<c.next_at and ((not p_force and c.latest_id is not null) or exists(select 1 from cos_fleet_board_private.runs where started_at>clock_timestamp()-interval '60 seconds')) then if p_force then update cos_fleet_board_private.control set queued=true,next_at=least(next_at,(select max(started_at)+interval '60 seconds' from cos_fleet_board_private.runs)) where singleton;end if;return null;end if;
 update cos_fleet_board_private.runs set state='failed',error_code='worker_interrupted',finished_at=clock_timestamp() where id=c.active_id and state='running';
 update cos_fleet_board_private.runs set staged=null where staged is not null and started_at<clock_timestamp()-interval '1 hour';
 insert into cos_fleet_board_private.runs(state) values('running') returning id into r;
 update cos_fleet_board_private.control set active_id=r,queued=false,next_at=clock_timestamp()+interval '10 minutes' where singleton;
 return jsonb_build_object('id',r);
end$$;

create or replace function public.cos_fleet_board_stage(p_run uuid,p_sources jsonb) returns boolean language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 if octet_length(p_sources::text)>16000000 then raise exception 'Source bundle too large';end if;
 update cos_fleet_board_private.runs set staged=p_sources where id=p_run and state='running' and started_at>clock_timestamp()-interval '180 seconds' and id=(select active_id from cos_fleet_board_private.control where singleton);
 return found;
end$$;

-- Bounded progress marker. An interrupted run keeps the last step it reached.
create or replace function public.cos_fleet_board_progress(p_run uuid,p_diagnostics jsonb) returns boolean language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 if jsonb_typeof(p_diagnostics) is distinct from 'object' or octet_length(p_diagnostics::text)>20000 then return false;end if;
 update cos_fleet_board_private.runs set diagnostics=p_diagnostics where id=p_run and state='running' and id=(select active_id from cos_fleet_board_private.control where singleton);
 return found;
end$$;

drop function if exists public.cos_fleet_board_finish(uuid,jsonb);
create or replace function public.cos_fleet_board_finish(p_run uuid,p_payload jsonb,p_diagnostics jsonb default null) returns boolean language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare c cos_fleet_board_private.control%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 select * into c from cos_fleet_board_private.control where singleton for update;
 if c.active_id is distinct from p_run then return false;end if;
 if not exists(select 1 from cos_fleet_board_private.runs where id=p_run and state='running' and started_at>clock_timestamp()-interval '180 seconds') then return false;end if;
 if p_payload->>'contract' is distinct from 'COS_SAVED_FLEET_BOARD_V1' or jsonb_typeof(p_payload->'fleet') is distinct from 'object' or (p_payload#>'{fleet,fieldMap,sharedFleetView}') is distinct from 'true'::jsonb or octet_length(p_payload::text)>12000000 then raise exception 'Invalid completed board';end if;
 update cos_fleet_board_private.runs set state='completed',finished_at=clock_timestamp(),payload=p_payload,staged=null,counts=p_payload->'counts',inventory=p_payload->'inventory',units=p_payload->'units',
  diagnostics=case when jsonb_typeof(p_diagnostics)='object' and octet_length(p_diagnostics::text)<=20000 then p_diagnostics else diagnostics end where id=p_run and state='running';
 update cos_fleet_board_private.control set latest_id=p_run,active_id=null,next_at=case when queued then greatest(clock_timestamp(),(select started_at+interval '60 seconds' from cos_fleet_board_private.runs where id=p_run)) else next_at end where singleton;
 update cos_fleet_board_private.runs set payload=null where id<>p_run and payload is not null;
 return true;
end$$;

drop function if exists public.cos_fleet_board_fail(uuid,text,jsonb);
create or replace function public.cos_fleet_board_fail(p_run uuid,p_code text,p_products jsonb default '[]',p_diagnostics jsonb default null) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 update cos_fleet_board_private.runs set state='failed',finished_at=clock_timestamp(),error_code=case when p_code in ('checks_incomplete','connection_source_incomplete','inventory_source_incomplete') then p_code else 'source_read_failed' end,products=p_products,
  diagnostics=case when jsonb_typeof(p_diagnostics)='object' and octet_length(p_diagnostics::text)<=20000 then p_diagnostics else diagnostics end where id=p_run and state='running';
 update cos_fleet_board_private.control set active_id=null,next_at=case when queued then greatest(clock_timestamp(),(select started_at+interval '60 seconds' from cos_fleet_board_private.runs where id=p_run)) else next_at end where singleton and active_id=p_run;
 return true;
end$$;

create or replace function public.cos_fleet_board_read() returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 return jsonb_build_object('contract','COS_DURABLE_FLEET_RESPONSE_V1','latest',(select jsonb_build_object('id',r.id,'completedAt',r.finished_at,'payload',r.payload) from cos_fleet_board_private.control c join cos_fleet_board_private.runs r on r.id=c.latest_id where c.singleton),'refresh',(select jsonb_build_object('id',id,'state',case when (select queued and active_id is null from cos_fleet_board_private.control where singleton) then 'queued' when state='running' and started_at<clock_timestamp()-interval '180 seconds' then 'failed' else state end,'error',case when state='running' and started_at<clock_timestamp()-interval '180 seconds' then 'worker_interrupted' else error_code end,'products',products,'startedAt',started_at,'finishedAt',finished_at) from cos_fleet_board_private.runs order by started_at desc limit 1),'history',coalesce((select jsonb_agg(x) from(select id,started_at,finished_at,state,error_code,counts,inventory from cos_fleet_board_private.runs order by started_at desc limit 30)x),'[]'));
end$$;

-- Same record as cos_fleet_board_read without the completed payload.
create or replace function public.cos_fleet_board_status() returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 return jsonb_build_object('contract','COS_DURABLE_FLEET_RESPONSE_V1','latest',(select jsonb_build_object('id',r.id,'completedAt',r.finished_at) from cos_fleet_board_private.control c join cos_fleet_board_private.runs r on r.id=c.latest_id where c.singleton),'refresh',(select jsonb_build_object('id',id,'state',case when (select queued and active_id is null from cos_fleet_board_private.control where singleton) then 'queued' when state='running' and started_at<clock_timestamp()-interval '180 seconds' then 'failed' else state end,'error',case when state='running' and started_at<clock_timestamp()-interval '180 seconds' then 'worker_interrupted' else error_code end,'products',products,'startedAt',started_at,'finishedAt',finished_at,'diagnostics',diagnostics) from cos_fleet_board_private.runs order by started_at desc limit 1),'history',coalesce((select jsonb_agg(x) from(select id,started_at,finished_at,state,error_code,counts,inventory,diagnostics from cos_fleet_board_private.runs order by started_at desc limit 30)x),'[]'));
end$$;

-- The completed payload of the current board only. It never changes for a
-- given run, so the backend may keep it for as long as that run is current.
create or replace function public.cos_fleet_board_payload(p_run uuid) returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 return (select r.payload from cos_fleet_board_private.control c join cos_fleet_board_private.runs r on r.id=c.latest_id where c.singleton and r.id=p_run and r.state='completed');
end$$;

revoke all on function public.cos_fleet_board_begin(boolean),public.cos_fleet_board_stage(uuid,jsonb),public.cos_fleet_board_progress(uuid,jsonb),public.cos_fleet_board_finish(uuid,jsonb,jsonb),public.cos_fleet_board_fail(uuid,text,jsonb,jsonb),public.cos_fleet_board_read(),public.cos_fleet_board_status(),public.cos_fleet_board_payload(uuid) from public,anon,authenticated;
grant execute on function public.cos_fleet_board_begin(boolean),public.cos_fleet_board_stage(uuid,jsonb),public.cos_fleet_board_progress(uuid,jsonb),public.cos_fleet_board_finish(uuid,jsonb,jsonb),public.cos_fleet_board_fail(uuid,text,jsonb,jsonb),public.cos_fleet_board_read(),public.cos_fleet_board_status(),public.cos_fleet_board_payload(uuid) to service_role;
