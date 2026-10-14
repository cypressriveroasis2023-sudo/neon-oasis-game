-- A stale TV revision is an application conflict, not a retryable serialization
-- failure. PostgREST 14 may endlessly retry a custom SQLSTATE 40001.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- Change only the reviewed v2 function's conflict code; keep its CAS, row lock,
-- validation, atomic history write, owner, grants and security attributes intact.
-- Already-running retry loops require separate, explicitly authorized handling.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $migration$
declare
 v_target oid=to_regprocedure('public.cos_tv_board_settings_save_v2(uuid,uuid,text[],integer,integer)');
 v_definition text;
 v_catalog jsonb;
begin
 if v_target is null then
  raise exception 'TV save v2 is missing; refresh the reviewed migration.' using errcode='P0001';
 end if;
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
 into v_definition,v_catalog from pg_proc p where p.oid=v_target;

 -- First hash: live definition verified on 2026-10-14. Second: exactly the
 -- same definition with the sole business-conflict SQLSTATE changed to PT409.
 if v_definition is null or md5(v_definition) not in ('8521ac1766ee9c51014eee8a568575a5','db521dff6bea454d662c0a22b09a217a') then
  raise exception 'TV save v2 changed; refresh the reviewed migration.' using errcode='P0001';
 end if;
 if md5(v_definition)='8521ac1766ee9c51014eee8a568575a5' then
  execute replace(v_definition,'errcode=''40001''','errcode=''PT409''');
 end if;

 if md5(pg_get_functiondef(v_target)) is distinct from 'db521dff6bea454d662c0a22b09a217a'
 or (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_target) is distinct from v_catalog then
  raise exception 'TV conflict repair changed an unexpected function attribute.' using errcode='P0001';
 end if;
end $migration$;
commit;
