-- Generic read-adapter candidate. One existing function body only; no new exposure or grants.
-- Fast path is statement-local. Dependency/key drift lazily invokes the original baseline query.
-- Production use requires exact-head proof and a freshly fingerprinted guarded install transaction.
create or replace function cos_mhelp_placement_private.upload_snapshot()
returns jsonb language sql stable set search_path='' as $upload$
select case when
(select count(*)=2 and bool_and(p.oid is not null and p.proowner::regrole::text='postgres' and p.proacl::text='{postgres=X/postgres}' and pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE') and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')=v.definition_sha256)
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
  and pg_catalog.pg_get_constraintdef(c.oid)='CHECK (singleton)')
 then (
 with active as materialized (
  select b.receipt,b.records,b.payload_sha256,b.source_sha256
  from cos_mhelp_placement_private.upload_control c
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  where c.singleton
 ), source_rows as materialized (
  select r,
   r->'binding' is not null and r->'binding'<>'null'::jsonb eligible,
   case when r->'binding' is not null and r->'binding'<>'null'::jsonb then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(a.records) r
 ), tracker_rows as materialized (
  select r,r->'binding'->>'state'='linked' eligible,
   case when (r->'binding'->>'state'='linked') is not false then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(coalesce(a.receipt->'trackerRecords','[]'::jsonb)) r
 ), bindings as materialized (
  select binding_key from source_rows where eligible
  union
  select binding_key from tracker_rows where eligible is not false
 ), binding_ids as materialized (
  select binding_key,(binding_key->>0)::uuid tracker_id,(binding_key->>1)::uuid native_id,binding_key->>2 original_guard
  from bindings
 ), tracker_ids as materialized (select distinct tracker_id id from binding_ids where tracker_id is not null),
 native_ids as materialized (select distinct native_id id from binding_ids where native_id is not null),
 graph_trackers as materialized (
  select x.id,to_jsonb(x) row_json from app_private.vision_tracker_locations x where x.id in(select id from tracker_ids)
 ), graph_natives as materialized (
  select x.id,to_jsonb(x) row_json from public.equipment_units x where x.id in(select id from native_ids)
 ), graph_sources as materialized (
  select x.native_unit_id id,x.tracker_id,to_jsonb(x) row_json
  from app_private.cos_geocode_sources x
  where x.tracker_id in(select id from tracker_ids) or x.native_unit_id in(select id from native_ids)
 ), source_members as materialized (
  select b.binding_key,x.id from binding_ids b join graph_sources x on x.tracker_id=b.tracker_id
  union
  select b.binding_key,x.id from binding_ids b join graph_sources x on x.id=b.native_id
 ), source_arrays as materialized (
  select m.binding_key,jsonb_agg(x.row_json order by x.row_json::text) rows_json
  from source_members m join graph_sources x on x.id=m.id group by m.binding_key
 ), graph_archives as materialized (
  select x.id,x.archived_tracker_id,x.canonical_tracker_id,x.archived_native_id,x.canonical_native_id,to_jsonb(x) row_json
  from app_private.cos_archived_representations x
  where x.archived_tracker_id in(select id from tracker_ids) or x.canonical_tracker_id in(select id from tracker_ids)
   or x.archived_native_id in(select id from native_ids) or x.canonical_native_id in(select id from native_ids)
 ), archive_members as materialized (
  select b.binding_key,x.id from binding_ids b join graph_archives x on x.archived_tracker_id=b.tracker_id
  union
  select b.binding_key,x.id from binding_ids b join graph_archives x on x.canonical_tracker_id=b.tracker_id
  union
  select b.binding_key,x.id from binding_ids b join graph_archives x on x.archived_native_id=b.native_id
  union
  select b.binding_key,x.id from binding_ids b join graph_archives x on x.canonical_native_id=b.native_id
 ), archive_arrays as materialized (
  select m.binding_key,jsonb_agg(x.row_json order by x.row_json::text) rows_json
  from archive_members m join graph_archives x on x.id=m.id group by m.binding_key
 ), history_arrays as materialized (
  select x.equipment_unit_id id,jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) rows_json
  from public.equipment_unit_location_history x where x.equipment_unit_id in(select id from native_ids)
  group by x.equipment_unit_id
 ), owner_arrays as materialized (
  select x.native_unit_id id,jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) rows_json
  from app_private.cos_owner_identity_claims x where x.native_unit_id in(select id from native_ids)
  group by x.native_unit_id
 ), continuity_heads as materialized (
  select distinct on (b.binding_key) b.binding_key,x.after_guard
  from binding_ids b join cos_mhelp_placement_private.source_continuity x
   on x.tracker_id is not distinct from b.tracker_id and x.native_id is not distinct from b.native_id
    and x.original_guard=b.original_guard
  join active a on x.source_sha256=a.source_sha256 and x.payload_sha256=a.payload_sha256
  order by b.binding_key,x.id desc
 ), current_guards as materialized (
  select b.binding_key,coalesce(c.after_guard,b.original_guard)=encode(sha256(convert_to(jsonb_build_object(
   'tracker',t.row_json,'native',n.row_json,
   'sources',coalesce(s.rows_json,'[]'::jsonb),'archives',coalesce(a.rows_json,'[]'::jsonb),
   'nativeHistory',coalesce(h.rows_json,'[]'::jsonb),'ownerClaims',coalesce(o.rows_json,'[]'::jsonb)
  )::text,'UTF8')),'hex') guard_current
  from binding_ids b
  left join graph_trackers t on t.id=b.tracker_id
  left join graph_natives n on n.id=b.native_id
  left join source_arrays s on s.binding_key=b.binding_key
  left join archive_arrays a on a.binding_key=b.binding_key
  left join history_arrays h on h.id=b.native_id
  left join owner_arrays o on o.id=b.native_id
  left join continuity_heads c on c.binding_key=b.binding_key
 )
 select (a.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object(
  'trackerRecords',(
   select coalesce(jsonb_agg((s.r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object(
    'binding',((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',coalesce(s.eligible and g.guard_current,false)))
    order by s.r->>'recordId'),'[]'::jsonb)
   from tracker_rows s left join current_guards g
    on g.binding_key=s.binding_key
  ),'reviewed',true,'payloadSha256',a.payload_sha256,'records',(
   select jsonb_agg((s.r-'binding')||jsonb_build_object('binding',case when not s.eligible then 'null'::jsonb else
    ((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',g.guard_current) end)
    order by (s.r->>'sourceRow')::integer)
   from source_rows s left join current_guards g
    on g.binding_key=s.binding_key
  )) from active a
 ) else (
 with active as materialized (
  select b.receipt,b.records,b.payload_sha256
  from cos_mhelp_placement_private.upload_control c
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  where c.singleton
 ), source_rows as materialized (
  select r,
   r->'binding' is not null and r->'binding'<>'null'::jsonb eligible,
   case when r->'binding' is not null and r->'binding'<>'null'::jsonb then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(a.records) r
 ), tracker_rows as materialized (
  select r,r->'binding'->>'state'='linked' eligible,
   case when (r->'binding'->>'state'='linked') is not false then
    jsonb_build_array((r->'binding'->>'trackerId')::uuid,(r->'binding'->>'nativeUnitId')::uuid,r->'binding'->>'expectedGuard') end binding_key
  from active a cross join lateral jsonb_array_elements(coalesce(a.receipt->'trackerRecords','[]'::jsonb)) r
 ), bindings as materialized (
  select binding_key from source_rows where eligible
  union
  select binding_key from tracker_rows where eligible is not false
 ), current_guards as materialized (
  select b.*,cos_mhelp_placement_private.continuity_current((binding_key->>0)::uuid,(binding_key->>1)::uuid,binding_key->>2) guard_current
  from bindings b
 )
 select (a.receipt-array['receivedMessageId','authorizationSha256'])||jsonb_build_object(
  'trackerRecords',(
   select coalesce(jsonb_agg((s.r-array['binding','displayApproval','approval','ownerQuote','reviewEvidence'])||jsonb_build_object(
    'binding',((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',coalesce(s.eligible and g.guard_current,false)))
    order by s.r->>'recordId'),'[]'::jsonb)
   from tracker_rows s left join current_guards g
    on g.binding_key=s.binding_key
  ),'reviewed',true,'payloadSha256',a.payload_sha256,'records',(
   select jsonb_agg((s.r-'binding')||jsonb_build_object('binding',case when not s.eligible then 'null'::jsonb else
    ((s.r->'binding')-'reviewEvidence')||jsonb_build_object('guardCurrent',g.guard_current) end)
    order by (s.r->>'sourceRow')::integer)
   from source_rows s left join current_guards g
    on g.binding_key=s.binding_key
  )) from active a
 limit 1
 ) end
$upload$;
