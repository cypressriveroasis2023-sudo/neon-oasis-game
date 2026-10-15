-- PRIVATE OFFLINE PROTOTYPE. Revert Edge callers FIRST; approval and drift review required.
begin;
set local lock_timeout='2s';
DO $guard$ BEGIN
 IF to_regprocedure('public.cos_mhelp_placement_snapshot(uuid,uuid,text)') IS NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.cos_mhelp_placement_snapshot(uuid,uuid,text)'::regprocedure AND proowner::regrole::text='postgres' AND proacl::text='{postgres=X/postgres,service_role=X/postgres}' AND prosecdef AND pronargdefaults=0) OR encode(sha256(convert_to(pg_get_functiondef('public.cos_mhelp_placement_snapshot(uuid,uuid,text)'::regprocedure),'UTF8')),'hex') <> 'c14b0f888d51cbeb6f322cd80df3317caafc16357812c4ee676e4111b36660dd' THEN RAISE EXCEPTION 'Camera overload drifted; refuse rollback' USING ERRCODE='55000'; END IF;
 EXECUTE 'DROP FUNCTION public.cos_mhelp_placement_snapshot(uuid,uuid,text)';
END $guard$;
commit;
