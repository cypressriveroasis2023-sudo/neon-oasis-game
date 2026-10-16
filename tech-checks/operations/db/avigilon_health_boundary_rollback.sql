-- REVIEW ONLY: disable runtime and quiesce writers first. Retain all evidence.
begin;
revoke all on function public.cos_avigilon_run_commit(uuid,uuid,jsonb),public.cos_avigilon_health_read(uuid,uuid) from public,anon,authenticated,service_role;
-- A closed fence cannot reopen automatically after rollback.
update cos_avigilon_checks_private.authority set admitted=false;
delete from cos_avigilon_checks_private.heads;
commit;
