select (select count(*)=2 and bool_and(p.oid is not null and p.proowner::regrole::text='postgres' and p.proacl::text='{postgres=X/postgres}' and pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE') and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')=v.definition_sha256)
 from (values
 ('cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)','6c6163ee414b04a046e4e4aca49eae9a3b4d609d46dab2de6ebfeb814ec096b7'),
 ('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)','c6f4af6579a1dccee3c33c5b66ec04fc7db02555d2d1391298f5bf9234431ad1')
 ) v(signature,definition_sha256)
 left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(v.signature))
 and (select count(*)=2 and bool_and(p.oid in (
 pg_catalog.to_regprocedure('cos_mhelp_placement_private.upload_binding_guard(uuid,uuid)'),
 pg_catalog.to_regprocedure('cos_mhelp_placement_private.continuity_current(uuid,uuid,text)')))
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='cos_mhelp_placement_private' and p.proname in ('upload_binding_guard','continuity_current'))
 and not exists (
 select 1 from (values
 ('app_private.vision_tracker_locations','id','uuid'),
 ('public.equipment_units','id','uuid'),
 ('app_private.cos_geocode_sources','native_unit_id','uuid'),
 ('app_private.cos_archived_representations','id','uuid'),
 ('cos_mhelp_placement_private.upload_control','singleton','boolean'),
 ('cos_mhelp_placement_private.upload_batches','source_sha256','text'),
 ('cos_mhelp_placement_private.source_continuity','id','bigint')
 ) v(relation,column_name,type_name)
 left join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass(v.relation)
  and a.attname=v.column_name and a.attnum>0 and not a.attisdropped
 where a.attnum is null or not a.attnotnull or a.atttypid<>pg_catalog.to_regtype(v.type_name)
  or exists(select 1 from pg_catalog.pg_inherits h where h.inhparent=a.attrelid)
  or not exists(select 1 from pg_catalog.pg_index i where i.indrelid=a.attrelid and i.indisprimary and i.indisunique
   and i.indisvalid and i.indisready and i.indislive and i.indimmediate
   and i.indnkeyatts=1 and i.indnatts=1 and i.indkey[0]=a.attnum and i.indexprs is null and i.indpred is null)
 )
 and not exists (
 select 1 from (values ('original_guard'),('after_guard')) v(column_name)
 left join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass('cos_mhelp_placement_private.source_continuity')
  and a.attname=v.column_name and a.attnum>0 and not a.attisdropped
 where a.attnum is null or not a.attnotnull or a.atttypid<>pg_catalog.to_regtype('text')
 )
 and exists(select 1 from pg_catalog.pg_constraint c
 where c.conrelid=pg_catalog.to_regclass('cos_mhelp_placement_private.upload_control')
  and c.contype='c' and c.convalidated and not c.condeferrable and not c.condeferred
  and pg_catalog.pg_get_constraintdef(c.oid)='CHECK (singleton)') as fast_path_allowed;
