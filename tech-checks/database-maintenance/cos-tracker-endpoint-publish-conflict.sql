-- A stale expected generation is an application conflict, not a retryable
-- serialization failure. PostgREST 14 may endlessly retry a custom SQLSTATE
-- 40001, and each looping request keeps one API pool connection.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- On 2026-11-11 every PostgREST connection on the camera project was held by
-- such loops in cos_tracker_endpoint_publish_v1, so all API reads timed out.
-- Change only the conflict code; keep the generation check, row lock,
-- validation, writes, owner, grants and security attributes intact.
-- Already-running retry loops require separate, explicitly authorized handling.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $migration$
declare
 v_target oid=to_regprocedure('public.cos_tracker_endpoint_publish_v1(bigint,jsonb)');
 v_definition text;
 v_catalog jsonb;
begin
 if v_target is null then
  raise exception 'Tracker endpoint publish v1 is missing; refresh the reviewed migration.' using errcode='P0001';
 end if;
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
 into v_definition,v_catalog from pg_proc p where p.oid=v_target;

 -- First hash: live definition read on 2026-11-11. Second: exactly the same
 -- definition with the sole conflict SQLSTATE changed to PT409.
 if v_definition is null or md5(v_definition) not in ('fe7ae8f8cc646b7cd44655d7f12b15f1','591574ec716088bdcc06f6f7fc76838b') then
  raise exception 'Tracker endpoint publish v1 changed; refresh the reviewed migration.' using errcode='P0001';
 end if;
 if md5(v_definition)='fe7ae8f8cc646b7cd44655d7f12b15f1' then
  execute replace(v_definition,'errcode=''40001''','errcode=''PT409''');
 end if;

 if md5(pg_get_functiondef(v_target)) is distinct from '591574ec716088bdcc06f6f7fc76838b'
 or (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_target) is distinct from v_catalog then
  raise exception 'Publish conflict repair changed an unexpected function attribute.' using errcode='P0001';
 end if;
end $migration$;
commit;
