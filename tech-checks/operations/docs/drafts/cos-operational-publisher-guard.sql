-- PR #226, release companion (NOT INSTALLED).
-- Install only after cos-operational-transfer-v1.sql and after verifying the
-- exact deployed cos_sheets_placement_private.source_current function body.
-- Source-driven mHelpDesk publishing must never reverse a newer Owner decision.
-- Keep every other part of source freshness, baseline guard and ACL unchanged.
create or replace function cos_sheets_placement_private.source_current(
 p_link cos_mhelp_placement_private.links
) returns boolean language sql stable set search_path='' as $fn$
 select coalesce(
  p_link.observation->>'state'='confirmed'
   and p_link.observed_at>clock_timestamp()-interval '20 minutes'
   and cos_mhelp_placement_private.guard(p_link.tracker_id,p_link.native_unit_id)=p_link.baseline_guard
   and exists(select 1 from cos_mhelp_placement_private.control
     where singleton and enabled and error_code is null
       and last_success_at>clock_timestamp()-interval '20 minutes')
   and not exists(select 1 from cos_operational_private.current_placements p
     where p.product_id=p_link.equipment_id),
  false
 )
$fn$;
revoke all on function cos_sheets_placement_private.source_current(cos_mhelp_placement_private.links)
 from public,anon,authenticated,service_role;
-- The private function is evaluated only inside the existing definer RPC.
