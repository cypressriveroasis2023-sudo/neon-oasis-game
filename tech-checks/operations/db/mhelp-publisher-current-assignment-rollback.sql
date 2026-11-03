-- Restore only the original publication eligibility predicate. Never alter stored observations.
CREATE OR REPLACE FUNCTION cos_sheets_placement_private.source_current(p_link cos_mhelp_placement_private.links)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT coalesce(p_link.observation->>'state'='confirmed'
 AND p_link.observed_at>clock_timestamp()-interval '20 minutes'
 AND cos_mhelp_placement_private.guard(p_link.tracker_id,p_link.native_unit_id)=p_link.baseline_guard
 AND EXISTS(SELECT 1 FROM cos_mhelp_placement_private.control WHERE singleton AND enabled AND error_code IS NULL AND last_success_at>clock_timestamp()-interval '20 minutes')
 AND NOT EXISTS(SELECT 1 FROM cos_operational_private.current_placements p WHERE p.product_id=p_link.equipment_id),false)
$function$

