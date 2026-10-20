-- Exact current adapter only. No inventory, source, telemetry, credentials, cron or ACL changes.
do $health_read_guard$
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('cos_mhelp_placement_private.upload_snapshot()')
  and p.proowner::regrole::text='postgres' and p.proacl::text='{postgres=X/postgres}' and not p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=""']::text[] and p.prorettype='jsonb'::regtype
  and encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6747b96cae9779432df07c3ac1ec6d0b7d6e4a8b758a7c92de33b38cf1fa846b') then
  raise exception 'Saved-read adapter changed; stop and review the current definition and security catalog' using errcode='55000';
 end if;
end $health_read_guard$;
-- Saved-read optimization only. Preserve the complete API/scoped/identity guard stack.
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.upload_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with base as materialized (select cos_mhelp_placement_private.api_base_upload_snapshot() value)
 select b.value||jsonb_build_object('apiSync',jsonb_build_object('enabled',c.enabled,'lastAttemptAt',c.last_attempt_at,'lastSuccessAt',c.last_success_at,'errorCode',c.error_code),
  'apiMissingRecords',(select coalesce(jsonb_agg(r||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
   (r->'binding')||jsonb_build_object('guardCurrent',r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid)) end)),'[]'::jsonb)
   from jsonb_array_elements(coalesce(b.value->'apiMissingRecords','[]'::jsonb)) r))
 from base b
 cross join cos_mhelp_placement_private.live_inventory_control c where c.singleton
$function$
;
do $health_read_security$
begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('cos_mhelp_placement_private.upload_snapshot()')
  and p.proowner::regrole::text='postgres' and p.proacl::text='{postgres=X/postgres}' and not p.prosecdef and p.provolatile='s'
  and p.proconfig=array['search_path=""']::text[] and p.prorettype='jsonb'::regtype) then
  raise exception 'Saved-read adapter security changed' using errcode='55000';
 end if;
end $health_read_security$;
