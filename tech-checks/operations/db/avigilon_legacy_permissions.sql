-- REVIEW ONLY. Apply only after action-time approval of these exact function permissions.
-- Project: Camera Health goqrnolcvqnirjmzaeyk.
-- DDL installation intentionally leaves every wrapper executable by postgres only.
-- This one atomic statement changes no table/schema access or role memberships.
do $permissions$
declare target text; expected text; actual record;
begin
 if current_user<>'postgres' then raise exception 'Reviewed permission installer required';end if;
 for target,expected in select * from (values
  ('public.cos_avigilon_source_apply(jsonb)','d9183dc3c31213a9cadcf0d63bd6b402'),
  ('public.cos_avigilon_source_seal()','3a287ec56a91176f28cdb0b1b9e86a41'),
  ('public.cos_avigilon_source_cancel(jsonb)','9ae59c54c2d1d4b1fb208d990b385fb7')
 ) as reviewed(signature,source_md5) loop
  select p.proowner::regrole::text owner,p.proacl::text acl,p.prosecdef,p.proconfig,p.pronargdefaults,md5(p.prosrc) source_md5 into actual from pg_proc p where p.oid=to_regprocedure(target);
  if not found or actual.owner<>'postgres' or actual.acl is distinct from '{postgres=X/postgres}'
   or not actual.prosecdef or actual.proconfig is distinct from array['search_path=""']
   or actual.pronargdefaults<>0 or actual.source_md5 is distinct from expected
  then raise exception 'Reviewed boundary changed or permissions already differ: %',target using errcode='55000';end if;
 end loop;
 grant execute on function public.cos_avigilon_source_apply(jsonb),
 public.cos_avigilon_source_seal(),
 public.cos_avigilon_source_cancel(jsonb) to service_role;
 for target in select signature from (values
  ('public.cos_avigilon_source_apply(jsonb)','d9183dc3c31213a9cadcf0d63bd6b402'),
  ('public.cos_avigilon_source_seal()','3a287ec56a91176f28cdb0b1b9e86a41'),
  ('public.cos_avigilon_source_cancel(jsonb)','9ae59c54c2d1d4b1fb208d990b385fb7')
 ) as reviewed(signature,source_md5) loop
  if (select p.proacl::text from pg_proc p where p.oid=to_regprocedure(target)) is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  then raise exception 'Boundary permission postcondition failed: %',target using errcode='55000';end if;
 end loop;
end $permissions$;
