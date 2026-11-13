-- Exact two-function performance repair. No data, grants, cron, timeout increase or provider changes.
-- Run only after current release authorization and validation. Drift aborts atomically.
begin;
set local lock_timeout='1s';
set local statement_timeout='8s';
set local search_path=pg_catalog,pg_temp;
do $guard$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('COS_INVENTORY_GUARD_REUSE_20261113',0)) then raise exception 'Concurrent repair';end if;
 if exists(select 1 from (values
 ('cos_mhelp_placement_private.authoritative_product_records(jsonb,boolean)','a57e04c0439b5fde0f4b9c24de3302469b8eb4eb30dc281059bd78e9e0222c68','{postgres=X/postgres}',false,'["search_path=\"\""]'::jsonb),
 ('public.cos_mhelp_inventory_baseline()','055a6f469eaca61d42540687bbf389b7408aefebe9f461cda7736d2db90433ed','{postgres=X/postgres,service_role=X/postgres}',true,'["search_path=\"\"", "work_mem=64MB"]'::jsonb)
 ) expected(signature,sha,acl,security_definer,settings)
 left join pg_proc p on p.oid=to_regprocedure(expected.signature)
 where p.oid is null or p.proowner::regrole::text<>'postgres'
 or p.proacl::text is distinct from expected.acl
 or p.prosecdef is distinct from expected.security_definer
 or to_jsonb(p.proconfig) is distinct from expected.settings
 or encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') is distinct from expected.sha)
 then raise exception 'Function drift or permission mismatch; no repair applied';end if;
end $guard$;
CREATE OR REPLACE FUNCTION cos_mhelp_placement_private.authoritative_product_records(p_records jsonb, p_projection boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000
  or (select count(distinct r->>'productId') from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records)
 then raise exception 'Unique current Product IDs required';end if;
 with binding_membership as materialized (
  select distinct x.r->>'productId' product_id, ids.kind, ids.binding_id
  from jsonb_array_elements(p_records) x(r)
  cross join lateral (values
   ('tracker',x.r->'binding'->>'trackerId'),('native',x.r->'binding'->>'nativeUnitId')
  ) ids(kind,binding_id)
  where ids.binding_id is not null
 ), wanted as materialized (
  select r,ord from jsonb_array_elements(p_records) with ordinality x(r,ord)
  where (r->'binding' is null or r->'binding'='null'::jsonb)
   and coalesce(r->>'holdReason','') in ('','api_equipment_label_changed',
    'Product ID identity label changed; confirm before linking',
    'Prior reviewed scoped identity or assignment requires Owner installation review',
    'Source assignment or protection changed; Owner installation review required')
   and r->>'lifecycle'='UNFLAGGED' and r->'apiAssignment'->'active' is distinct from 'false'::jsonb
   and r->'apiAssignment'->'placementProof'->>'version'='1'
   and r->>'unitNumber'=btrim(r->'apiAssignment'->>'fullLabel')
   and r->>'customerId'=r->'apiAssignment'->>'customerId'
   and r->'apiAssignment'->'placementProof'->'parentIsServiceLocation'='false'::jsonb
   and r->'apiAssignment'->'placementProof'->'parentActive' is distinct from 'false'::jsonb
   and ((r->>'placement'='SHOP' and lower(btrim(r->'apiAssignment'->'placementProof'->>'parentLabel')) in ('cameras onsite','cameras onsite llc'))
     or (r->>'placement'='FIELD' and r->'apiAssignment'->'placementProof'->'serviceVerified'='true'::jsonb
       and r->'apiAssignment'->'placementProof'->'serviceActive' is distinct from 'false'::jsonb
       and nullif(r->'apiAssignment'->'placementProof'->>'siteLabel','') is not null
       and coalesce(r->'apiAssignment'->>'serviceLocationId','')~'^[1-9][0-9]{0,14}$'))
 ), candidate_links as materialized (
  select l.*,cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) current_guard,
   case when exists(select 1 from wanted w where w.r->>'productId'=l.equipment_id and w.r->>'placement'='SHOP')
    then cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id) else false end current_shop_return
  from cos_mhelp_placement_private.links l
  where exists(select 1 from wanted w where w.r->>'productId'=l.equipment_id)
 ), original_batches as materialized (
  select b.* from cos_mhelp_placement_private.upload_batches b
  where b.receipt->>'contract'='COS_MHELP_UPLOAD_V1'
   and b.receipt->>'sourceSha256'=b.source_sha256
   and b.payload_sha256=encode(sha256(convert_to(jsonb_build_object('receipt',b.receipt,'records',b.records)::text,'UTF8')),'hex')
 ), history as materialized (
  select h,w.r,l.tracker_id,l.native_unit_id,l.baseline_guard,l.source_revision,
   row_number() over(partition by h->>'productId' order by b.admitted_at desc,b.source_sha256) priority
  from original_batches b cross join lateral jsonb_array_elements(b.records) h
  join wanted w on w.r->>'productId'=h->>'productId'
  join candidate_links l on l.equipment_id=h->>'productId'
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=l.tracker_id
   and ((l.native_unit_id is null and s.entity_kind='tracker') or (s.entity_kind='equipment_unit' and s.native_unit_id=l.native_unit_id))
   and s.source_system='mhelpdesk_product_import'
   and ((s.active and s.source_revision=l.source_revision) or (w.r->>'placement'='SHOP' and l.current_shop_return))
  where h->'binding'->>'matchMethod'='reviewed_product_id'
   and h->'binding'->'reviewEvidence'->>'review_state' in ('confirmed','held')
   and l.reviewed_at is not null and l.authorization_sha256~'^[a-f0-9]{64}$'
   and h->'binding'->'reviewEvidence'->>'reviewed_product_id'=l.equipment_id
   and h->'binding'->>'productId'=l.equipment_id
   and h->'binding'->>'trackerId'=l.tracker_id::text
   and h->'binding'->>'nativeUnitId' is not distinct from l.native_unit_id::text
   and h->'binding'->>'trackerLabel'=l.tracker_label
   and h->'binding'->>'nativeLabel' is not distinct from l.native_label
   and lower(regexp_replace(h->>'category','[[:space:]]','','g'))=lower(regexp_replace(w.r->>'category','[[:space:]]','','g'))
   and w.r->'apiAssignment'->'placementProof'->'model'=coalesce(to_jsonb(l.model),'null'::jsonb)
   and (l.baseline_guard=l.current_guard or (w.r->>'placement'='SHOP' and l.current_shop_return))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>l.equipment_id
      and (other.tracker_id=l.tracker_id or other.native_unit_id=l.native_unit_id))
   and not exists(select 1 from binding_membership other where other.product_id<>l.equipment_id
      and ((other.kind='tracker' and other.binding_id=l.tracker_id::text)
        or (other.kind='native' and other.binding_id=l.native_unit_id::text)))
   and not exists(select 1 from jsonb_array_elements_text(coalesce(w.r->'possibleAliasUnitIds','[]'::jsonb)) alias
      where alias is distinct from l.tracker_id::text and alias is distinct from l.native_unit_id::text)
 ), repaired as materialized (
  select r->>'productId' product_id,(r-array['binding','holdReason','placementHeld','displayUnitNumber','displayAuthorizationSha256'])
   ||jsonb_build_object('holdReason',null,'possibleAliasUnitIds','[]'::jsonb,'binding',
    ((h->'binding')-'guardCurrent')||jsonb_build_object('fullLabel',r->>'unitNumber','expectedGuard',
      cos_mhelp_placement_private.upload_binding_guard(tracker_id,native_unit_id))
      ||case when p_projection then jsonb_build_object('guardCurrent',true) else '{}'::jsonb end) row
  from history where priority=1
 )
 select coalesce(jsonb_agg(coalesce(f.row,x.r) order by x.ord),'[]'::jsonb) into result
 from jsonb_array_elements(p_records) with ordinality x(r,ord) left join repaired f on f.product_id=x.r->>'productId';
 -- Restoring two lost bindings must not attach both Products to one resource.
 if exists(select 1 from jsonb_array_elements(result) r cross join lateral
    (values(r->'binding'->>'trackerId'),(r->'binding'->>'nativeUnitId')) ids(id)
    where id is not null group by id having count(distinct r->>'productId')>1)
 then raise exception 'Competing exact Product ID bindings';end if;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.cos_mhelp_inventory_baseline()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET work_mem TO '64MB'
AS $function$
with original(value) as materialized (
with baseline(value) as materialized (
select cos_mhelp_placement_private.upload_snapshot()||jsonb_build_object('publisherRefreshEquipmentIds',(
 select coalesce(jsonb_agg(equipment_id),'[]'::jsonb) from (
 with eligible as materialized (
 select q.equipment_id,l.tracker_id,l.native_unit_id,l.baseline_guard,l.observed_at
 from cos_sheets_placement_private.refresh_requests q
 join cos_sheets_placement_private.bindings b using(equipment_id)
 join cos_mhelp_placement_private.links l using(equipment_id)
 where q.requested_at>clock_timestamp()-interval '2 hours' and b.pending_cells is null
 and l.observation->>'state'='confirmed'
 and not exists(select 1 from cos_operational_private.current_placements p where p.product_id=l.equipment_id)
 )
 select equipment_id from eligible
 where cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard
 order by observed_at nulls first,equipment_id limit 6
 ) selected))
), tracker_membership as materialized (
 select x->'binding'->>'trackerId' tracker_id, count(distinct x->>'productId') product_count
 from baseline b cross join lateral jsonb_array_elements(
   coalesce(b.value->'records','[]'::jsonb)||coalesce(b.value->'apiMissingRecords','[]'::jsonb)) x
 where x->'binding'->>'trackerId' is not null
 group by x->'binding'->>'trackerId'
)
select b.value || jsonb_build_object('trackerEndpointMembership',jsonb_build_object(
 'contract','COS_TRACKER_ENDPOINT_MEMBERSHIP_V1',
 'sourceSha256',b.value->>'sourceSha256',
 'records',(select coalesce(jsonb_agg(jsonb_build_object(
  'productId',r->>'productId','trackerId',r->'binding'->>'trackerId',
  'bindingGuard',r->'binding'->>'expectedGuard',
  'readOnlyTracker',coalesce(
   r->'binding'->'nativeUnitId'='null'::jsonb and r->'binding'->'guardCurrent'='true'::jsonb
   and t.id is not null and t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
   and not exists(select 1 from public.equipment_units u where u.id=t.id)
   and t.unit_number=r->'binding'->>'trackerLabel'
   and coalesce(r->'binding'->'representedUnitIds',jsonb_build_array(t.id::text))=jsonb_build_array(t.id::text)
   and not exists(select 1 from app_private.cos_geocode_sources s join public.equipment_units u on u.id=s.native_unit_id where s.tracker_id=t.id)
   and not exists(select 1 from app_private.cos_archived_representations a where t.id in(a.archived_tracker_id,a.canonical_tracker_id))
   and (select m.product_count from tracker_membership m where m.tracker_id=t.id::text)=1,false)
 ) order by r->>'productId'),'[]'::jsonb)
 from jsonb_array_elements(b.value->'records')r
 left join app_private.vision_tracker_locations t on t.id=(r->'binding'->>'trackerId')::uuid)
)) from baseline b
)
select original.value || jsonb_build_object('cameraSnapshotSources',jsonb_build_object(
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'organization_id',u.organization_id,'unit_number',u.unit_number,'status',u.status) order by u.id),'[]'::jsonb) from public.equipment_units u where u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'organization_id',m.organization_id,'equipment_unit_id',m.equipment_unit_id,'vigilant_device_id',m.vigilant_device_id,'camera_key',m.camera_key,'match_method',m.match_method,'confidence',m.confidence) order by m.id),'[]'::jsonb) from public.vision_vigilant_unit_matches m where m.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 'providers',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'organization_id',d.organization_id,'external_device_id',d.external_device_id,'device_name',d.device_name,'device_type',d.device_type,'source',d.source) order by d.id),'[]'::jsonb) from public.vision_vigilant_devices d where d.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 'ownerCrosswalk',app_private.cos_owner_identity_snapshot_value('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid),
 'trackerUnits',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'unitNumber',t.unit_number,'modelName',t.family,'readOnly',true,'recordSource',t.source_name,'snapshotImportedAt',t.imported_at,'sourceVerifiedAt',t.source_verified_at) order by t.id),'[]'::jsonb) from app_private.vision_tracker_locations t where t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5')
)) from original;
$function$
;
do $guard$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('COS_INVENTORY_GUARD_REUSE_20261113',0)) then raise exception 'Concurrent repair';end if;
 if exists(select 1 from (values
 ('cos_mhelp_placement_private.authoritative_product_records(jsonb,boolean)','9b53cb6ec820b518e24559ec0395641dc040f5b6aeb79a5e36c3a443b3a61ace','{postgres=X/postgres}',false,'["search_path=\"\""]'::jsonb),
 ('public.cos_mhelp_inventory_baseline()','5063173bb68524cae3f5225b8e8521796af4b4f7fc55e3fa697ed835c878f6c2','{postgres=X/postgres,service_role=X/postgres}',true,'["search_path=\"\"", "work_mem=64MB"]'::jsonb)
 ) expected(signature,sha,acl,security_definer,settings)
 left join pg_proc p on p.oid=to_regprocedure(expected.signature)
 where p.oid is null or p.proowner::regrole::text<>'postgres'
 or p.proacl::text is distinct from expected.acl
 or p.prosecdef is distinct from expected.security_definer
 or to_jsonb(p.proconfig) is distinct from expected.settings
 or encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') is distinct from expected.sha)
 then raise exception 'Function drift or permission mismatch; no repair applied';end if;
end $guard$;
commit;
