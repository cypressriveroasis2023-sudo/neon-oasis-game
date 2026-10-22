CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.upload_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select b.value||jsonb_build_object('shopAddressBaseline',cos_mhelp_placement_private.shop_address_baseline(b.value->>'sourceSha256'),'apiSync',jsonb_build_object('enabled',c.enabled,'lastAttemptAt',c.last_attempt_at,'lastSuccessAt',c.last_success_at,'errorCode',c.error_code),
  'apiMissingRecords',(select coalesce(jsonb_agg(r||jsonb_build_object('binding',case when r->'binding' is null or r->'binding'='null'::jsonb then 'null'::jsonb else
   (r->'binding')||jsonb_build_object('guardCurrent',r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid)) end)),'[]'::jsonb)
   from jsonb_array_elements(coalesce(b.value->'apiMissingRecords','[]'::jsonb)) r))
 from (select cos_mhelp_placement_private.api_base_upload_snapshot() value) b
 cross join cos_mhelp_placement_private.live_inventory_control c where c.singleton
$function$
