-- Reviewed native project: tughscoxralhofrckvxy, 2026-10-14.
-- A stale reconnect revision is an application conflict, not a serialization
-- failure. PostgREST 14 can loop on deliberate SQLSTATE 40001 exceptions.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- Apply after cos-mhelp-shared-read-backoff.sql. No state or Vault reads/writes.
-- This maintenance patch is separate from any Edge deployment.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $migration$
declare
 v_target oid=to_regprocedure('public.cos_mhelp_token_session(text,uuid,text,text,timestamptz,text,bigint,uuid)');
 v_definition text;
 v_catalog jsonb;
 v_old text='raise exception ''mHelp reconnect configuration changed'' using errcode=''40001'';';
 v_new text='raise exception ''mHelp reconnect configuration changed'' using errcode=''PT409'';';
begin
 if v_target is null then
  raise exception 'mHelp token control is missing; refresh the reviewed migration.' using errcode='P0001';
 end if;
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
 into v_definition,v_catalog from pg_proc p where p.oid=v_target;
 if v_definition is null or md5(v_definition) not in ('e45d53dfe5e50e91a687fd44b03d4050','201eaf0fe35e26bd21f249682ff328c8') then
  raise exception 'mHelp token control changed; refresh the reviewed migration.' using errcode='P0001';
 end if;
 if not exists(select 1 from pg_proc p where p.oid=v_target
  and pg_get_userbyid(p.proowner)='postgres'
  and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
  and p.prosecdef and p.proconfig=array['search_path=pg_catalog, public, vault']::text[]
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and has_function_privilege('service_role',p.oid,'EXECUTE')) then
  raise exception 'mHelp token control security changed; refresh the reviewed migration.' using errcode='P0001';
 end if;
 if md5(v_definition)='e45d53dfe5e50e91a687fd44b03d4050' then
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
   raise exception 'mHelp reconnect conflict marker changed; refresh the reviewed migration.' using errcode='P0001';
  end if;
  execute replace(v_definition,v_old,v_new);
 end if;
 if md5(pg_get_functiondef(v_target)) is distinct from '201eaf0fe35e26bd21f249682ff328c8'
 or (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_target) is distinct from v_catalog then
  raise exception 'mHelp conflict repair changed an unexpected function attribute.' using errcode='P0001';
 end if;
end $migration$;
commit;
