DO $guard$ BEGIN IF md5(pg_get_functiondef('public.cos_mhelp_placement_from_inventory()'::regprocedure))<>'275549a5cfb2d7c6efce21277358c697' OR md5(pg_get_functiondef('cos_sheets_placement_private.source_current(cos_mhelp_placement_private.links)'::regprocedure))<>'a49a2d8a46fd192946f51257bd9ebf14' THEN RAISE EXCEPTION 'Placement authority drift';END IF; END $guard$;
-- A real, recorded Shop return must not require reactivating its old Field
-- geocoding source or erasing its placement history.
create or replace function cos_mhelp_placement_private.recorded_shop_return_current(p_product text,p_tracker uuid,p_native uuid)
returns boolean language sql stable set search_path='' as $function$
 select coalesce(exists(
  select 1 from cos_mhelp_placement_private.links l
  join public.equipment_units u on u.id=l.native_unit_id and u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  join app_private.vision_tracker_locations t on t.id=l.tracker_id and t.organization_id=u.organization_id
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=t.id and s.native_unit_id=u.id
   and s.organization_id=u.organization_id and s.entity_kind='equipment_unit' and s.source_system='mhelpdesk_product_import'
  cross join lateral(select m.* from app_private.cos_fleet_shop_moves m where m.unit_id=u.id and m.organization_id=u.organization_id order by m.created_at desc,m.id desc limit 1) m
  where l.equipment_id=p_product and l.tracker_id=p_tracker and l.native_unit_id=p_native
   and l.reviewed_at is not null and l.authorization_sha256~'^[a-f0-9]{64}$'
   and u.unit_number=l.native_label and t.unit_number=l.tracker_label
   and u.current_location_type='shop' and u.status='available' and u.retired_at is null
   and u.installed_site_id is null and u.current_location_ref is null
   and u.gps_latitude is null and u.gps_longitude is null
   and not s.active and s.eligibility='tombstone'
   and m.unit_number=u.unit_number and m.model_id=u.model_id
   and exists(select 1 from jsonb_array_elements(m.source_bindings) b where b->>'productId'=p_product and b->>'sourceUnitNumber'=btrim(l.full_label))
   and exists(select 1 from app_private.cos_geocode_source_events e where e.event_id=s.event_id and e.kind='tombstone' and e.product_id=p_product and e.native_unit_id=u.id and e.source_revision=s.source_revision)
   and not exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=u.id)
   and not exists(select 1 from app_private.cos_archived_representations a where t.id in(a.archived_tracker_id,a.canonical_tracker_id) or u.id in(a.archived_native_id,a.canonical_native_id))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>p_product and (other.tracker_id=t.id or other.native_unit_id=u.id))
 ),false)
$function$;
revoke all on function cos_mhelp_placement_private.recorded_shop_return_current(text,uuid,uuid) from public,anon,authenticated,service_role;

-- Owner direction: mHelp supplies current labels and assignments. An already
-- reviewed exact Product ID survives label/assignment changes; names are not keys.
-- Restore only original reviewed links whose protected native graph is unchanged.
create or replace function cos_mhelp_placement_private.authoritative_product_records(p_records jsonb,p_projection boolean default false)
returns jsonb language plpgsql stable set search_path='' as $function$
declare result jsonb;
begin
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000
  or (select count(distinct r->>'productId') from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records)
 then raise exception 'Unique current Product IDs required';end if;
 with wanted as materialized (
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
  join cos_mhelp_placement_private.links l on l.equipment_id=h->>'productId'
  join app_private.cos_geocode_sources s on s.product_id=l.equipment_id and s.tracker_id=l.tracker_id
   and ((l.native_unit_id is null and s.entity_kind='tracker') or (s.entity_kind='equipment_unit' and s.native_unit_id=l.native_unit_id))
   and s.source_system='mhelpdesk_product_import'
   and ((s.active and s.source_revision=l.source_revision) or (w.r->>'placement'='SHOP' and cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id)))
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
   and (l.baseline_guard=cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) or (w.r->>'placement'='SHOP' and cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id)))
   and not exists(select 1 from app_private.cos_geocode_sources other where other.active and other.product_id<>l.equipment_id
      and (other.tracker_id=l.tracker_id or other.native_unit_id=l.native_unit_id))
   and not exists(select 1 from jsonb_array_elements(p_records) other where other->>'productId'<>l.equipment_id
      and (other->'binding'->>'trackerId'=l.tracker_id::text or other->'binding'->>'nativeUnitId'=l.native_unit_id::text))
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
end $function$;
revoke all on function cos_mhelp_placement_private.authoritative_product_records(jsonb,boolean) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cos_mhelp_placement_from_inventory()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '25s'
AS $function$
declare ctl cos_mhelp_placement_private.live_inventory_control;b cos_mhelp_placement_private.upload_batches;
 l cos_mhelp_placement_private.links;r jsonb;p jsonb;rows_by_id jsonb;observations jsonb:='[]'::jsonb;
 start_receipt jsonb;result jsonb;reason text;retry_at timestamptz;lease uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 -- Match admission's lock order and keep source/time from the same snapshot.
 select * into strict ctl from cos_mhelp_placement_private.live_inventory_control where singleton for share;
 if not ctl.enabled then return jsonb_build_object('handled',true,'state','paused','reason','inventory_paused','vendorReads',0,'inventoryWrites',0);end if;
 select ub.* into b from cos_mhelp_placement_private.upload_control c
 join cos_mhelp_placement_private.upload_batches ub on ub.source_sha256=c.active_sha256 where c.singleton for share of c;
 select greatest(blocked_until,probe_until) into retry_at from cos_mhelp_placement_private.read_backoff where singleton;
 reason:=case
  when ctl.last_success_at is null or ctl.last_success_at<clock_timestamp()-interval '30 minutes' then 'inventory_source_stale'
  when b.source_sha256 is distinct from ctl.active_source_sha256 or b.receipt->>'contract' is distinct from 'COS_MHELP_API_V1'
   or b.receipt->>'origin' is distinct from 'mhelpdesk_api' or b.receipt->'complete' is distinct from 'true'::jsonb then 'awaiting_complete_inventory'
  when jsonb_typeof(b.records) is distinct from 'array' then 'awaiting_complete_inventory'
  when exists(select 1 from jsonb_array_elements(b.records) x where x->'apiAssignment'->'placementProof'->>'version' is distinct from '1') then 'awaiting_inventory_placement_proof'
  when exists(select 1 from jsonb_array_elements(b.records) x
   cross join lateral (values ('apiCustomerObservedAt'),('apiCategoryObservedAt'),('apiAddressObservedAt')) keys(k)
   where x->'sourceDates' ? keys.k and x->'sourceDates'->keys.k<>'null'::jsonb
    and (cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k) is null
     or cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k)<clock_timestamp()-interval '3 hours'
     or cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k)>clock_timestamp()+interval '30 seconds')) then 'inventory_resource_stale'
  else null end;
 if reason is not null then return jsonb_build_object('handled',true,'state','deferred','reason',reason,
  'sourceReadAt',ctl.last_success_at,'retryAt',case when retry_at>clock_timestamp() then retry_at else null end,'vendorReads',0,'inventoryWrites',0);end if;
 if jsonb_array_length(b.records) not between 1 and 10000
  or (select count(distinct x->>'productId') from jsonb_array_elements(b.records)x)<>jsonb_array_length(b.records)
  then raise exception 'Incomplete inventory proof';end if;
 select jsonb_object_agg(x->>'productId',x) into rows_by_id from jsonb_array_elements(cos_mhelp_placement_private.authoritative_product_records(b.records))x;
 start_receipt:=public.cos_mhelp_placement_begin();
 lease:=(start_receipt->>'leaseId')::uuid;
 if lease is null then return jsonb_build_object('handled',true,'state','busy_or_disabled','vendorReads',0,'inventoryWrites',0);end if;
 for l in select * from cos_mhelp_placement_private.links order by equipment_id loop
  r:=rows_by_id->l.equipment_id;p:=r->'apiAssignment'->'placementProof';reason:=null;
  if r is null then reason:='equipment_missing';
  elsif (r->'apiAssignment'->>'fullLabel' is distinct from l.full_label and not coalesce((r->'binding'->>'productId'=l.equipment_id and r->'binding'->>'trackerId'=l.tracker_id::text and r->'binding'->>'nativeUnitId' is not distinct from l.native_unit_id::text and r->'binding'->>'fullLabel'=r->>'unitNumber' and r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard(l.tracker_id,l.native_unit_id)),false))
   or p->'model' is distinct from coalesce(to_jsonb(l.model),'null'::jsonb)
   or r->>'lifecycle' is distinct from 'UNFLAGGED' or r->'apiAssignment'->'active'='false'::jsonb
   or (cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) is distinct from l.baseline_guard and not (r->>'placement'='SHOP' and cos_mhelp_placement_private.recorded_shop_return_current(l.equipment_id,l.tracker_id,l.native_unit_id))) then reason:='identity_or_lifecycle_changed';
  elsif p->'parentIsServiceLocation' is distinct from 'false'::jsonb or p->'parentActive'='false'::jsonb
   or nullif(p->>'parentLabel','') is null or length(p->>'parentLabel')>250
   or (p->>'parentLabel')~'[[:cntrl:]<>]'
   or (r->>'placement'='SHOP') is distinct from (lower(btrim(p->>'parentLabel')) in ('cameras onsite','cameras onsite llc')) then reason:='customer_unverified';
  elsif r->>'placement'='FIELD' and (p->'serviceVerified' is distinct from 'true'::jsonb or p->'serviceActive'='false'::jsonb
   or nullif(p->>'siteLabel','') is null or length(p->>'siteLabel')>250 or (p->>'siteLabel')~'[[:cntrl:]<>]'
   or coalesce(r->'apiAssignment'->>'serviceLocationId','')!~'^[1-9][0-9]{0,14}$') then reason:='service_location_unverified';end if;
  observations:=observations||jsonb_build_array(case when reason is not null then jsonb_build_object('equipmentId',l.equipment_id,'state','held','reason',reason)
   else jsonb_build_object('equipmentId',l.equipment_id,'state','confirmed','customerId',r->>'customerId',
    'serviceLocationId',r->'apiAssignment'->>'serviceLocationId','placement',r->>'placement','customerLabel',p->>'parentLabel',
    'siteLabel',case when r->>'placement'='SHOP' then 'SHOP' else p->>'siteLabel' end) end);
 end loop;
 result:=public.cos_mhelp_placement_finish(lease,observations);
 if result->'committed' is distinct from 'true'::jsonb then raise exception 'Placement lease changed' using errcode='40001';end if;
 -- Preserve the observation's real API time, never claim a newer vendor read.
 update cos_mhelp_placement_private.links cached_link set observed_at=least(ctl.last_success_at,
   cos_mhelp_placement_private.resource_observed_at(rows_by_id->cached_link.equipment_id->'sourceDates'->'apiCustomerObservedAt'),
   cos_mhelp_placement_private.resource_observed_at(rows_by_id->cached_link.equipment_id->'sourceDates'->'apiAddressObservedAt'))
  where equipment_id in(select x->>'equipmentId' from jsonb_array_elements(observations)x);
 update cos_mhelp_placement_private.control set last_success_at=ctl.last_success_at where singleton;
 return result||jsonb_build_object('handled',true,'state','current','source','mhelpdesk_api','sourceSha256',b.source_sha256,
  'sourceReadAt',ctl.last_success_at,'resourceObservedAt',(select min(cos_mhelp_placement_private.resource_observed_at(x->'sourceDates'->keys.k))
   from jsonb_array_elements(b.records) x cross join lateral(values('apiCustomerObservedAt'),('apiAddressObservedAt'),('apiCategoryObservedAt')) keys(k)),
  'locationSource','mhelp_product_address_worker','vendorReads',0,'inventoryWrites',0);
end$function$

;
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
  CROSS JOIN LATERAL jsonb_array_elements(cos_mhelp_placement_private.authoritative_product_records(batch.records)) r
  WHERE live.singleton AND live.enabled AND live.error_code IS NULL
   AND live.last_success_at>clock_timestamp()-interval '20 minutes'
   AND batch.receipt->>'contract'='COS_MHELP_API_V1' AND batch.receipt->>'origin'='mhelpdesk_api'
   AND batch.receipt->'complete'='true'::jsonb
   AND r->>'productId'=p_link.equipment_id
   AND (SELECT count(*) FROM jsonb_array_elements(batch.records) other WHERE other->>'productId'=p_link.equipment_id)=1
   AND coalesce(r->>'holdReason','')='' AND r->>'lifecycle'='UNFLAGGED'
   AND r->'apiAssignment'->'active' IS DISTINCT FROM 'false'::jsonb
   AND (r->'apiAssignment'->>'fullLabel'=p_link.full_label OR coalesce((r->'binding'->>'productId'=p_link.equipment_id and r->'binding'->>'trackerId'=p_link.tracker_id::text and r->'binding'->>'nativeUnitId' is not distinct from p_link.native_unit_id::text and r->'binding'->>'fullLabel'=r->>'unitNumber' and r->'binding'->>'expectedGuard'=cos_mhelp_placement_private.upload_binding_guard(p_link.tracker_id,p_link.native_unit_id)),false))
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
 AND (cos_mhelp_placement_private.guard(p_link.tracker_id,p_link.native_unit_id)=p_link.baseline_guard OR (p_link.observation->>'placement'='SHOP' AND cos_mhelp_placement_private.recorded_shop_return_current(p_link.equipment_id,p_link.tracker_id,p_link.native_unit_id)))
 AND EXISTS(SELECT 1 FROM cos_mhelp_placement_private.control WHERE singleton AND enabled AND error_code IS NULL AND last_success_at>clock_timestamp()-interval '20 minutes')
 AND NOT EXISTS(SELECT 1 FROM cos_operational_private.current_placements p WHERE p.product_id=p_link.equipment_id),false)
$function$

;
