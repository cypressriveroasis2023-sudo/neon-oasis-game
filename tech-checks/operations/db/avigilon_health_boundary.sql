-- REVIEW ONLY. Install after avigilon_health_publication.sql. No grants included.
begin;
create function public.cos_avigilon_run_commit(p_actor_user_id uuid,p_organization_id uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service transport required' using errcode='42501';end if;
 return cos_avigilon_checks_private.commit_result(p_actor_user_id,p_organization_id,p_result);
end $$;
create function public.cos_avigilon_health_read(p_actor_user_id uuid,p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Service transport required' using errcode='42501';end if;
 return cos_avigilon_checks_private.read_health(p_actor_user_id,p_organization_id);
end $$;
revoke all on function public.cos_avigilon_run_commit(uuid,uuid,jsonb),public.cos_avigilon_health_read(uuid,uuid) from public,anon,authenticated,service_role;
commit;
