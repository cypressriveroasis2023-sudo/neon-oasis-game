-- One complete vendor reader; placement consumes its explicit verified proof.
-- No tokens, native equipment, GPS, SIMs, source files or history are written.
begin;
create table cos_mhelp_placement_private.inventory_read_lease(
 singleton boolean primary key default true check(singleton),
 lease_id uuid,lease_until timestamptz
);
insert into cos_mhelp_placement_private.inventory_read_lease(singleton) values(true);
alter table cos_mhelp_placement_private.inventory_read_lease enable row level security;
revoke all on cos_mhelp_placement_private.inventory_read_lease from public,anon,authenticated,service_role;

create function public.cos_mhelp_inventory_read_lease(p_action text,p_lease uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $$
declare s cos_mhelp_placement_private.inventory_read_lease;retry_at timestamptz;v uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 if p_action='release' and p_lease is not null then
  update cos_mhelp_placement_private.inventory_read_lease set lease_id=null,lease_until=null where singleton and lease_id=p_lease;
  return jsonb_build_object('released',true);
 end if;
 if p_action is distinct from 'acquire' or p_lease is not null then raise exception 'Invalid read lease operation';end if;
 -- Respect the durable vendor cooldown. Never clear, shorten or probe it here.
 select greatest(blocked_until,probe_until) into retry_at from cos_mhelp_placement_private.read_backoff where singleton;
 if retry_at>clock_timestamp() then return jsonb_build_object('allowed',false,'reason','source_rate_limited','retryAt',retry_at);end if;
 select * into strict s from cos_mhelp_placement_private.inventory_read_lease where singleton for update;
 if s.lease_until>clock_timestamp() then return jsonb_build_object('allowed',false,'reason','inventory_read_in_progress','retryAt',s.lease_until);end if;
 v:=gen_random_uuid();
 update cos_mhelp_placement_private.inventory_read_lease set lease_id=v,lease_until=clock_timestamp()+interval '5 minutes' where singleton;
 return jsonb_build_object('allowed',true,'leaseId',v);
end$$;
revoke all on function public.cos_mhelp_inventory_read_lease(text,uuid) from public,anon,authenticated;
grant execute on function public.cos_mhelp_inventory_read_lease(text,uuid) to service_role;

create function public.cos_mhelp_placement_from_inventory()
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='25s' as $$
declare ctl cos_mhelp_placement_private.live_inventory_control;b cos_mhelp_placement_private.upload_batches;
 l cos_mhelp_placement_private.links;r jsonb;p jsonb;rows_by_id jsonb;observations jsonb:='[]'::jsonb;
 start_receipt jsonb;result jsonb;reason text;retry_at timestamptz;lease uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 -- Match admission's lock order and keep source/time from the same snapshot.
 select * into strict ctl from cos_mhelp_placement_private.live_inventory_control where singleton for share;
 if not ctl.enabled then return jsonb_build_object('handled',false);end if;
 select ub.* into b from cos_mhelp_placement_private.upload_control c
 join cos_mhelp_placement_private.upload_batches ub on ub.source_sha256=c.active_sha256 where c.singleton for share of c;
 select greatest(blocked_until,probe_until) into retry_at from cos_mhelp_placement_private.read_backoff where singleton;
 reason:=case
  when ctl.last_success_at is null or ctl.last_success_at<clock_timestamp()-interval '30 minutes' then 'inventory_source_stale'
  when b.source_sha256 is distinct from ctl.active_source_sha256 or b.receipt->>'contract' is distinct from 'COS_MHELP_API_V1'
   or b.receipt->>'origin' is distinct from 'mhelpdesk_api' or b.receipt->'complete' is distinct from 'true'::jsonb then 'awaiting_complete_inventory'
  when jsonb_typeof(b.records) is distinct from 'array' then 'awaiting_complete_inventory'
  when exists(select 1 from jsonb_array_elements(b.records) x where x->'apiAssignment'->'placementProof'->>'version' is distinct from '1') then 'awaiting_inventory_placement_proof'
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
 update cos_mhelp_placement_private.links set observed_at=ctl.last_success_at
  where equipment_id in(select x->>'equipmentId' from jsonb_array_elements(observations)x);
 update cos_mhelp_placement_private.control set last_success_at=ctl.last_success_at where singleton;
 return result||jsonb_build_object('handled',true,'state','current','source','mhelpdesk_api','sourceSha256',b.source_sha256,
  'sourceReadAt',ctl.last_success_at,'locationSource','mhelp_product_address_worker','vendorReads',0,'inventoryWrites',0);
end$$;
revoke all on function public.cos_mhelp_placement_from_inventory() from public,anon,authenticated;
grant execute on function public.cos_mhelp_placement_from_inventory() to service_role;
commit;
