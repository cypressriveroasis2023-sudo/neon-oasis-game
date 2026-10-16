-- REVIEW-ONLY rollback: disable service transport; retain all run/audit evidence.
begin;
set local lock_timeout='2s';
revoke execute on function public.cos_avigilon_run_claim(uuid,uuid,jsonb),public.cos_avigilon_run_read(uuid,uuid,uuid),public.cos_avigilon_run_save(uuid,uuid,jsonb) from service_role;
commit;
