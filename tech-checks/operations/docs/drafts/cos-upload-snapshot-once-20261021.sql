begin;
set local lock_timeout='5s';
do $cos_snapshot_guard$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='cos_mhelp_placement_private.upload_snapshot()'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')<>'08b47f4133cbe9de810cfdfadd5e813897b4db5d2e82d70b971ead67ba57d0f9' then
  raise exception 'Installed upload snapshot changed; fresh review required';
 end if;
 if pg_get_userbyid(p.proowner)<>'postgres' or p.proacl::text is distinct from '{postgres=X/postgres}'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] then
  raise exception 'Installed upload snapshot permissions or configuration changed';
 end if;
end $cos_snapshot_guard$;
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.upload_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with snapshot as materialized (select cos_mhelp_placement_private.api_base_upload_snapshot() value)
 select b.value||jsonb_build_object('shopAddressBaseline',cos_mhelp_placement_private.shop_address_baseline(b.value->>'sourceSha256'),'apiSync',jsonb_build_object('enabled',c.enabled,'lastAttemptAt',c.last_attempt_at,'lastSuccessAt',c.last_success_at,'errorCode',c.error_code),
  'apiMissingRecords',(select coalesce(jsonb_agg(r||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
   (r->'binding')||jsonb_build_object('guardCurrent',r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid)) end)),'[]'::jsonb)
   from jsonb_array_elements(coalesce(b.value->'apiMissingRecords','[]'::jsonb)) r))
 from snapshot b
 cross join cos_mhelp_placement_private.live_inventory_control c where c.singleton
$function$;
commit;
