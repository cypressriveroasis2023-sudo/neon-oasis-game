alter table cos_fleet_board_private.runs add column if not exists staged jsonb;
create or replace function public.cos_fleet_board_stage(p_run uuid,p_sources jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'Backend only';end if;
 if octet_length(p_sources::text)>16000000 then raise exception 'Source bundle too large';end if;
 update cos_fleet_board_private.runs set staged=p_sources where id=p_run and state='running' and started_at>clock_timestamp()-interval '120 seconds' and id=(select active_id from cos_fleet_board_private.control where singleton);
 return found;
end$$;
revoke all on function public.cos_fleet_board_stage(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_fleet_board_stage(uuid,jsonb) to service_role;
