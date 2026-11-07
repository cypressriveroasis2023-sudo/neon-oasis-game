-- Guarded source-only address receipt compatibility. Does not publish points.
-- Keep existing private receipt/identity/source/coordinate admission unchanged.
BEGIN;
DO $check$ BEGIN
 IF to_regprocedure('cos_mhelp_placement_private.source_estimate_record_current(jsonb)') IS NULL
 OR to_regprocedure('cos_mhelp_placement_private.review_source_equipment_estimates(text,text,text,jsonb,text)') IS NULL
 THEN RAISE EXCEPTION 'Guarded source-estimate system missing'; END IF;
END $check$;
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.source_estimate_record_current(r jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(
  jsonb_typeof(r)='object' AND r->>'placement'='FIELD' AND r->>'lifecycle'='UNFLAGGED'
  AND r->'binding'='null'::jsonb
  AND (NOT (r ? 'placementHeld') OR r->'placementHeld'='false'::jsonb)
  AND (NOT (r ? 'possibleAliasUnitIds') OR r->'possibleAliasUnitIds'='[]'::jsonb)
  AND (NOT (r ? 'holdReason') OR r->'holdReason'='null'::jsonb)
  AND NOT (r ? 'supersedesProductId')
  AND r->>'productId'~'^[1-9][0-9]{0,14}$'
  AND r->>'customerId'~'^[1-9][0-9]{0,14}$'
  AND length(r->>'customer') BETWEEN 1 AND 512
  AND jsonb_typeof(r->'sourceAddress')='object'
  AND length(btrim(r#>>'{sourceAddress,street}')) BETWEEN 1 AND 300
  AND length(btrim(r#>>'{sourceAddress,city}')) BETWEEN 1 AND 100
  AND r#>>'{sourceAddress,state}'~*'^[a-z]{2}$'
  AND r#>>'{sourceAddress,zip}'~'^[0-9]{5}(-[0-9]{4})?$',false)
$$;
REVOKE ALL ON FUNCTION cos_mhelp_placement_private.source_estimate_record_current(jsonb)
 FROM public,anon,authenticated,service_role;
COMMIT;