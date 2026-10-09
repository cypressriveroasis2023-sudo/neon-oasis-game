-- Read-only schema/privilege evidence before installing or applying admission.
-- No row contents, addresses, credentials or provider calls.
select jsonb_build_object(
 'capturedAt',clock_timestamp(),
 'actor',current_user,
 'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,
   'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by n.nspname,c.relname,a.attnum)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where n.nspname in ('public','app_private') and c.relname in
   ('equipment_units','equipment_models','equipment_unit_location_history','vision_tracker_locations',
    'vision_cameras','vision_vigilant_devices','vision_vigilant_unit_matches','audit_events',
    'cos_geocode_sources','cos_geocode_source_events','cos_owner_identity_claims',
    'vision_source_inventory_v1','mhelpdesk_equipment_catalog')),
 'targetConstraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint
  where conrelid='app_private.vision_tracker_locations'::regclass),
 'targetTriggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger
  where tgrelid='app_private.vision_tracker_locations'::regclass and not tgisinternal),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
  'securityDefiner',p.prosecdef,'config',p.proconfig,'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname)
  from pg_proc p where p.oid in ('app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb)'::regprocedure,
   'app_private.cos_geocode_sources_admin_revoke_reviewed(uuid,jsonb)'::regprocedure,
   'app_private.cos_source_native_guard(text,uuid,uuid,text,text)'::regprocedure,
   'app_private.guard_reviewed_tracker_estimate_epoch()'::regprocedure)),
 'servicePrivateSchemaUsage',has_schema_privilege('service_role','app_private','USAGE')
) as support_admission_preflight;
