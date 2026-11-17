CREATE OR REPLACE FUNCTION public.cos_fleet_board_begin(p_force boolean DEFAULT false, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c cos_fleet_board_private.control%rowtype;r uuid;
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 select * into c from cos_fleet_board_private.control where singleton for update;
 -- Same request token: return the lease that request was already granted.
 if p_request is not null then select id into r from cos_fleet_board_private.runs where request=p_request;if found then return jsonb_build_object('id',r,'replayed',true);end if;end if;
 if c.active_id is not null and exists(select 1 from cos_fleet_board_private.runs where id=c.active_id and started_at>clock_timestamp()-interval '180 seconds' and state='running' and (request is null or producer is not null or started_at>clock_timestamp()-interval '60 seconds')) then if p_force then update cos_fleet_board_private.control set queued=true where singleton;end if;return null;end if;
 if clock_timestamp()<c.next_at and ((not p_force and c.latest_id is not null) or exists(select 1 from cos_fleet_board_private.runs where started_at>clock_timestamp()-interval '60 seconds')) then if p_force then update cos_fleet_board_private.control set queued=true,next_at=least(next_at,(select max(started_at)+interval '60 seconds' from cos_fleet_board_private.runs)) where singleton;end if;return null;end if;
 update cos_fleet_board_private.runs set state='failed',error_code='worker_interrupted',finished_at=clock_timestamp() where id=c.active_id and state='running';
 update cos_fleet_board_private.runs set staged=null where staged is not null and started_at<clock_timestamp()-interval '1 hour';
 insert into cos_fleet_board_private.runs(state,request) values('running',p_request) returning id into r;
 update cos_fleet_board_private.control set active_id=r,queued=false,next_at=clock_timestamp()+interval '10 minutes' where singleton;
 return jsonb_build_object('id',r);
end$function$
