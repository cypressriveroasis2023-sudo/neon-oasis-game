-- REVIEW-ONLY after publication schema. No grants, no production run.
-- Before-statement hooks cover real native source writes, including admin SQL
-- and apply/rollback wrappers, without editing their workflows. Readback/admission
-- is separate; failed/ambiguous readback never automatically reopens authority.
begin;
set local lock_timeout='2s';
create function cos_avigilon_checks_private.source_write_fence() returns trigger
language plpgsql security definer set search_path='' as $$
declare tenant constant uuid:='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
begin
 perform pg_advisory_xact_lock(hashtextextended('avigilon-run:'||tenant::text,0));
 update cos_avigilon_checks_private.authority set admitted=false,generation=generation+1 where tenant_id=tenant;
 delete from cos_avigilon_checks_private.heads where tenant_id=tenant;
 return null;
end $$;
revoke all on function cos_avigilon_checks_private.source_write_fence() from public,anon,authenticated,service_role;
do $$declare target text;begin
 -- Missing dependencies are a deployment blocker, never silently skipped.
 foreach target in array array[
 'cos_mhelp_placement_private.upload_batches','cos_mhelp_placement_private.upload_control',
 'cos_mhelp_placement_private.scoped_batches','cos_mhelp_placement_private.scoped_control',
 'cos_mhelp_placement_private.links','cos_mhelp_placement_private.locations','cos_mhelp_placement_private.control',
 'cos_sheets_placement_private.bindings','cos_sheets_placement_private.control',
 'public.equipment_units','app_private.vision_tracker_locations',
 'public.equipment_models','public.equipment_assignments','public.jobs','public.sites','public.customers',
 'public.equipment_unit_location_history','app_private.cos_geocode_sources','app_private.cos_archived_representations',
 'public.vision_vigilant_devices','public.vision_vigilant_unit_matches',
 'app_private.cos_owner_identity_claims','app_private.cos_owner_identity_resources',
 'app_private.cos_owner_identity_revocations','app_private.cos_owner_identity_source_events'
 ] loop
  if to_regclass(target) is null then raise exception 'Missing required native authority source: %',target;end if;
  execute format('create trigger avigilon_source_write_fence before insert or update or delete or truncate on %s for each statement execute function cos_avigilon_checks_private.source_write_fence()',target::regclass);
 end loop;
end $$;
commit;
