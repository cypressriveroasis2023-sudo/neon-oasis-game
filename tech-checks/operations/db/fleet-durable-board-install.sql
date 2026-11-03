create schema if not exists cos_fleet_board_private;
revoke all on schema cos_fleet_board_private from public,anon,authenticated;
grant usage on schema cos_fleet_board_private to service_role;
create table cos_fleet_board_private.runs(id uuid primary key default gen_random_uuid(),started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,state text not null check(state in ('running','completed','failed')),error_code text,products jsonb not null default '[]',payload jsonb,counts jsonb,inventory jsonb,units jsonb);
create index fleet_board_runs_started on cos_fleet_board_private.runs(started_at desc);
create table cos_fleet_board_private.control(singleton boolean primary key default true check(singleton),latest_id uuid references cos_fleet_board_private.runs(id),active_id uuid references cos_fleet_board_private.runs(id),next_at timestamptz not null default '-infinity');
insert into cos_fleet_board_private.control(singleton) values(true);
alter table cos_fleet_board_private.runs enable row level security;
alter table cos_fleet_board_private.control enable row level security;
grant select,insert,update on all tables in schema cos_fleet_board_private to service_role;
create function public.cos_fleet_board_begin(p_force boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c cos_fleet_board_private.control%rowtype;r uuid;
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 select * into c from cos_fleet_board_private.control where singleton for update;
 if c.active_id is not null and exists(select 1 from cos_fleet_board_private.runs where id=c.active_id and started_at>clock_timestamp()-interval '120 seconds' and state='running') then return null;end if;
 if clock_timestamp()<c.next_at and ((not p_force and c.latest_id is not null) or exists(select 1 from cos_fleet_board_private.runs where started_at>clock_timestamp()-interval '60 seconds')) then return null;end if;
 update cos_fleet_board_private.runs set state='failed',error_code='worker_interrupted',finished_at=clock_timestamp() where id=c.active_id and state='running';
 insert into cos_fleet_board_private.runs(state) values('running') returning id into r;
 update cos_fleet_board_private.control set active_id=r,next_at=clock_timestamp()+interval '10 minutes' where singleton;
 return jsonb_build_object('id',r);
end$$;
create function public.cos_fleet_board_read() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 return jsonb_build_object('contract','COS_DURABLE_FLEET_RESPONSE_V1','latest',(select jsonb_build_object('id',r.id,'completedAt',r.finished_at,'payload',r.payload) from cos_fleet_board_private.control c join cos_fleet_board_private.runs r on r.id=c.latest_id where c.singleton),'refresh',(select jsonb_build_object('id',id,'state',case when state='running' and started_at<clock_timestamp()-interval '120 seconds' then 'failed' else state end,'error',case when state='running' and started_at<clock_timestamp()-interval '120 seconds' then 'worker_interrupted' else error_code end,'products',products,'startedAt',started_at,'finishedAt',finished_at) from cos_fleet_board_private.runs order by started_at desc limit 1),'history',coalesce((select jsonb_agg(x) from(select id,started_at,finished_at,state,error_code,counts,inventory from cos_fleet_board_private.runs order by started_at desc limit 30)x),'[]'));
end$$;
create function public.cos_fleet_board_finish(p_run uuid,p_payload jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare c cos_fleet_board_private.control%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 select * into c from cos_fleet_board_private.control where singleton for update;
 if c.active_id is distinct from p_run then return false;end if;
 if not exists(select 1 from cos_fleet_board_private.runs where id=p_run and state='running' and started_at>clock_timestamp()-interval '120 seconds') then return false;end if;
 if p_payload->>'contract' is distinct from 'COS_SAVED_FLEET_BOARD_V1' or jsonb_typeof(p_payload->'fleet') is distinct from 'object' or octet_length(p_payload::text)>12000000 then raise exception 'Invalid completed board';end if;
 update cos_fleet_board_private.runs set state='completed',finished_at=clock_timestamp(),payload=p_payload,counts=p_payload->'counts',inventory=p_payload->'inventory',units=p_payload->'units' where id=p_run and state='running';
 update cos_fleet_board_private.control set latest_id=p_run,active_id=null where singleton;
 update cos_fleet_board_private.runs set payload=null where id<>p_run and payload is not null;
 return true;
end$$;
create function public.cos_fleet_board_fail(p_run uuid,p_code text,p_products jsonb default '[]') returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 update cos_fleet_board_private.runs set state='failed',finished_at=clock_timestamp(),error_code=case when p_code in ('checks_incomplete','connection_source_incomplete','inventory_source_incomplete') then p_code else 'source_read_failed' end,products=p_products where id=p_run and state='running';
 update cos_fleet_board_private.control set active_id=null where singleton and active_id=p_run;
 return true;
end$$;
revoke all on function public.cos_fleet_board_begin(boolean),public.cos_fleet_board_read(),public.cos_fleet_board_finish(uuid,jsonb),public.cos_fleet_board_fail(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cos_fleet_board_begin(boolean),public.cos_fleet_board_read(),public.cos_fleet_board_finish(uuid,jsonb),public.cos_fleet_board_fail(uuid,text,jsonb) to service_role;

create function public.cos_fleet_board_history(p_run uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 return (select jsonb_build_object('id',id,'completedAt',finished_at,'counts',counts,'units',units) from cos_fleet_board_private.runs where id=p_run and state='completed');
end$$;
revoke all on function public.cos_fleet_board_history(uuid) from public,anon,authenticated;
grant execute on function public.cos_fleet_board_history(uuid) to service_role;
