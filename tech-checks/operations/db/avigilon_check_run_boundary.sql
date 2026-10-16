-- REVIEW-ONLY CANDIDATE. No service EXECUTE grants; separate permission approval required.
-- Install after avigilon_check_runs.sql. Existing platform service credential only.
begin;
set local lock_timeout='2s';
do $$begin
 if current_user<>'postgres' or to_regprocedure('cos_avigilon_checks_private.assert_actor(uuid,uuid)') is null
  or to_regprocedure('public.cos_avigilon_run_claim(uuid,uuid,jsonb)') is not null
  or to_regprocedure('public.cos_avigilon_run_read(uuid,uuid,uuid)') is not null
  or to_regprocedure('public.cos_avigilon_run_save(uuid,uuid,jsonb)') is not null
 then raise exception 'Reviewed boundary installation prerequisite changed';end if;
end$$;
create function public.cos_avigilon_run_claim(p_actor_user_id uuid,p_organization_id uuid,p_run jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service transport required' using errcode='42501';end if;
 return cos_avigilon_checks_private.claim(p_actor_user_id,p_organization_id,p_run);
end $$;
create function public.cos_avigilon_run_read(p_actor_user_id uuid,p_organization_id uuid,p_run_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service transport required' using errcode='42501';end if;
 return cos_avigilon_checks_private.read_run(p_actor_user_id,p_organization_id,p_run_id);
end $$;
create function public.cos_avigilon_run_save(p_actor_user_id uuid,p_organization_id uuid,p_run jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service transport required' using errcode='42501';end if;
 return cos_avigilon_checks_private.save(p_actor_user_id,p_organization_id,p_run);
end $$;
revoke all on function public.cos_avigilon_run_claim(uuid,uuid,jsonb),public.cos_avigilon_run_read(uuid,uuid,uuid),public.cos_avigilon_run_save(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
commit;
