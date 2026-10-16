-- REVIEW ONLY. Apply only after action-time approval of these exact function permissions.
-- Project: Tech Check tughscoxralhofrckvxy.
-- DDL installation intentionally leaves every wrapper executable by postgres only.
-- This one atomic statement changes no table/schema access or role memberships.
do $permissions$
declare target text; expected text; actual record;
begin
 if current_user<>'postgres' then raise exception 'Reviewed permission installer required';end if;
 for target,expected in select * from (values
  ('public.cos_avigilon_run_claim(uuid,uuid,jsonb)','ad2fcea5b3188fef8974a9838cc33938'),
  ('public.cos_avigilon_run_read(uuid,uuid,uuid)','13c1933a0230597915af98d3bd690dd8'),
  ('public.cos_avigilon_run_save(uuid,uuid,jsonb)','5e8b68d4b4184ad5048825778d0b5a24'),
  ('public.cos_avigilon_run_commit(uuid,uuid,jsonb)','0d4772d2faaad35ea30ec803ba9d31f6'),
  ('public.cos_avigilon_health_read(uuid,uuid)','d15465c393f056d0778b0baf28437b6a'),
  ('public.cos_avigilon_source_control(uuid,uuid,text,jsonb)','a369b4c095928787876bc2c897a34f82')
 ) as reviewed(signature,source_md5) loop
  select p.proowner::regrole::text owner,p.proacl::text acl,p.prosecdef,p.proconfig,p.pronargdefaults,md5(p.prosrc) source_md5 into actual from pg_proc p where p.oid=to_regprocedure(target);
  if not found or actual.owner<>'postgres' or actual.acl is distinct from '{postgres=X/postgres}'
   or not actual.prosecdef or actual.proconfig is distinct from array['search_path=""']
   or actual.pronargdefaults<>0 or actual.source_md5 is distinct from expected
  then raise exception 'Reviewed boundary changed or permissions already differ: %',target using errcode='55000';end if;
 end loop;
 grant execute on function public.cos_avigilon_run_claim(uuid,uuid,jsonb),
 public.cos_avigilon_run_read(uuid,uuid,uuid),
 public.cos_avigilon_run_save(uuid,uuid,jsonb),
 public.cos_avigilon_run_commit(uuid,uuid,jsonb),
 public.cos_avigilon_health_read(uuid,uuid),
 public.cos_avigilon_source_control(uuid,uuid,text,jsonb) to service_role;
 for target in select signature from (values
  ('public.cos_avigilon_run_claim(uuid,uuid,jsonb)','ad2fcea5b3188fef8974a9838cc33938'),
  ('public.cos_avigilon_run_read(uuid,uuid,uuid)','13c1933a0230597915af98d3bd690dd8'),
  ('public.cos_avigilon_run_save(uuid,uuid,jsonb)','5e8b68d4b4184ad5048825778d0b5a24'),
  ('public.cos_avigilon_run_commit(uuid,uuid,jsonb)','0d4772d2faaad35ea30ec803ba9d31f6'),
  ('public.cos_avigilon_health_read(uuid,uuid)','d15465c393f056d0778b0baf28437b6a'),
  ('public.cos_avigilon_source_control(uuid,uuid,text,jsonb)','a369b4c095928787876bc2c897a34f82')
 ) as reviewed(signature,source_md5) loop
  if (select p.proacl::text from pg_proc p where p.oid=to_regprocedure(target)) is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  then raise exception 'Boundary permission postcondition failed: %',target using errcode='55000';end if;
 end loop;
end $permissions$;
