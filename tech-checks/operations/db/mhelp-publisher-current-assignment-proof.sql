-- Fresh complete equipment assignment, with separately dated cached metadata. No clocks or ACLs are changed.
DO $guard$ BEGIN IF md5(pg_get_functiondef('cos_sheets_placement_private.source_current(cos_mhelp_placement_private.links)'::regprocedure))<> '6b4ff318335d29dd68b3f252a9c22587' THEN RAISE EXCEPTION 'Publisher source predicate drift'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION cos_sheets_placement_private.source_current(p_link cos_mhelp_placement_private.links)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(p_link.observation->>'state'='confirmed'
 AND (p_link.observed_at>clock_timestamp()-interval '20 minutes'
 OR EXISTS(
  SELECT 1
  FROM cos_mhelp_placement_private.live_inventory_control live
  JOIN cos_mhelp_placement_private.upload_control active ON active.singleton AND active.active_sha256=live.active_source_sha256
  JOIN cos_mhelp_placement_private.upload_batches batch ON batch.source_sha256=active.active_sha256
  CROSS JOIN LATERAL jsonb_array_elements(batch.records) r
  WHERE live.singleton AND live.enabled AND live.error_code IS NULL
   AND live.last_success_at>clock_timestamp()-interval '20 minutes'
   AND batch.receipt->>'contract'='COS_MHELP_API_V1' AND batch.receipt->>'origin'='mhelpdesk_api'
   AND batch.receipt->'complete'='true'::jsonb
   AND r->>'productId'=p_link.equipment_id
   AND (SELECT count(*) FROM jsonb_array_elements(batch.records) other WHERE other->>'productId'=p_link.equipment_id)=1
   AND coalesce(r->>'holdReason','')='' AND r->>'lifecycle'='UNFLAGGED'
   AND r->'apiAssignment'->'active' IS DISTINCT FROM 'false'::jsonb
   AND r->'apiAssignment'->>'fullLabel'=p_link.full_label
   AND r->'apiAssignment'->'placementProof'->>'version'='1'
   AND r->'apiAssignment'->'placementProof'->'model'=coalesce(to_jsonb(p_link.model),'null'::jsonb)
   AND r->'apiAssignment'->'placementProof'->'parentIsServiceLocation'='false'::jsonb
   AND r->'apiAssignment'->'placementProof'->'parentActive' IS DISTINCT FROM 'false'::jsonb
   AND r->>'customerId'=p_link.observation->>'customerId'
   AND r->'apiAssignment'->'serviceLocationId' IS NOT DISTINCT FROM p_link.observation->'serviceLocationId'
   AND r->>'placement'=p_link.observation->>'placement'
   AND r->'apiAssignment'->'placementProof'->>'parentLabel'=p_link.observation->>'customerLabel'
   AND ((r->>'placement'='SHOP' AND p_link.observation->>'siteLabel'='SHOP'
         AND lower(btrim(p_link.observation->>'customerLabel')) IN('cameras onsite','cameras onsite llc'))
     OR (r->>'placement'='FIELD' AND r->'apiAssignment'->'placementProof'->'serviceVerified'='true'::jsonb
         AND r->'apiAssignment'->'placementProof'->'serviceActive' IS DISTINCT FROM 'false'::jsonb
         AND r->'apiAssignment'->'placementProof'->>'siteLabel'=p_link.observation->>'siteLabel'))
   AND cos_mhelp_placement_private.resource_observed_at(r->'sourceDates'->'apiCustomerObservedAt')
       BETWEEN clock_timestamp()-interval '3 hours' AND clock_timestamp()+interval '30 seconds'
   AND NOT EXISTS(
    SELECT 1 FROM (VALUES('apiCustomerObservedAt'),('apiCategoryObservedAt'),('apiAddressObservedAt')) d(k)
    WHERE r->'sourceDates' ? d.k AND r->'sourceDates'->d.k<>'null'::jsonb
     AND (cos_mhelp_placement_private.resource_observed_at(r->'sourceDates'->d.k) IS NULL
       OR cos_mhelp_placement_private.resource_observed_at(r->'sourceDates'->d.k)<clock_timestamp()-interval '3 hours'
       OR cos_mhelp_placement_private.resource_observed_at(r->'sourceDates'->d.k)>clock_timestamp()+interval '30 seconds'))
 ))
 AND cos_mhelp_placement_private.guard(p_link.tracker_id,p_link.native_unit_id)=p_link.baseline_guard
 AND EXISTS(SELECT 1 FROM cos_mhelp_placement_private.control WHERE singleton AND enabled AND error_code IS NULL AND last_success_at>clock_timestamp()-interval '20 minutes')
 AND NOT EXISTS(SELECT 1 FROM cos_operational_private.current_placements p WHERE p.product_id=p_link.equipment_id),false)
$function$

