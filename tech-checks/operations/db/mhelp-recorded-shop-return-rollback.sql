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
 select jsonb_object_agg(x->>'productId',x) into rows_by_id from jsonb_array_elements(b.records)x;
 start_receipt:=public.cos_mhelp_placement_begin();
 lease:=(start_receipt->>'leaseId')::uuid;
 if lease is null then return jsonb_build_object('handled',true,'state','busy_or_disabled','vendorReads',0,'inventoryWrites',0);end if;
 for l in select * from cos_mhelp_placement_private.links order by equipment_id loop
  r:=rows_by_id->l.equipment_id;p:=r->'apiAssignment'->'placementProof';reason:=null;
  if r is null then reason:='equipment_missing';
  elsif r->'apiAssignment'->>'fullLabel' is distinct from l.full_label
   or p->'model' is distinct from coalesce(to_jsonb(l.model),'null'::jsonb)
   or r->>'lifecycle' is distinct from 'UNFLAGGED' or r->'apiAssignment'->'active'='false'::jsonb
   or cos_mhelp_placement_private.guard(l.tracker_id,l.native_unit_id) is distinct from l.baseline_guard then reason:='identity_or_lifecycle_changed';
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

;
