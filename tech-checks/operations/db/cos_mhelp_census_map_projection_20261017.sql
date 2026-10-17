-- Read-only authorized MHelpDesk *address reference* layer for Fleet.
-- Does NOT link Product IDs to COS native equipment, move Shop inventory,
-- replace verified GPS, infer camera health or write a coordinate.
begin;
create or replace function public.cos_mhelp_census_map_snapshot(
 p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb; source_count integer; field_count integer; shop_count integer;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
   or app_private.has_permission(p_organization_id,'equipment.view') is not true
 then raise exception 'Equipment view permission required' using errcode='42501'; end if;
 with active as materialized (
  select b.source_sha256,b.payload_sha256,b.records
  from cos_mhelp_placement_private.upload_control c
  join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256
  where c.singleton
 ), source_rows as materialized (
  select r,ordinality as ord,active.source_sha256,active.payload_sha256
  from active cross join lateral jsonb_array_elements(active.records) with ordinality x(r,ordinality)
 ), products as materialized (
  select sr.r,sr.source_sha256,sr.payload_sha256,p.product_id,
   coalesce(f.status,a.status) status,coalesce(f.reason,a.reason) reason,a.census_benchmark,
   coalesce(f.matched_address,a.matched_address) matched_address,
   coalesce(f.latitude,a.latitude) latitude,coalesce(f.longitude,a.longitude) longitude,
   coalesce(f.geocoded_at,a.completed_at) completed_at,
   coalesce(f.provider,'us_census_address_range') provider,f.lookup_address,
   a.status original_status
  from source_rows sr
  join cos_mhelp_placement_private.census_mhelp_product p
    on p.source_sha256=sr.source_sha256 and p.payload_sha256=sr.payload_sha256
   and p.product_id=sr.r->>'productId'
   and p.source_row_sha256=encode(sha256(convert_to(sr.r::text,'UTF8')),'hex')
   and p.placement=sr.r->>'placement'
  join cos_mhelp_placement_private.census_mhelp_address a
   on a.source_sha256=p.source_sha256 and a.address_sha256=p.address_sha256
  left join lateral (
   select f.* from cos_mhelp_placement_private.mhelp_address_resolution f
   where f.source_sha256=p.source_sha256 and f.payload_sha256=p.payload_sha256
    and f.address_sha256=p.address_sha256 and f.status in ('matched','address_review')
    and a.status in ('no_match','invalid_address')
   order by f.id desc limit 1
  ) f on true
  where sr.r->>'placement'='FIELD'
 ), counts as materialized (
  select count(*) total,
   count(*) filter(where r->>'placement'='FIELD') field,
   count(*) filter(where r->>'placement'='SHOP') shop
  from source_rows
 )
 select jsonb_build_object(
  'contract','COS_MHELP_CENSUS_ADDRESS_MAP_V1',
  'sourceSha256',a.source_sha256,'payloadSha256',a.payload_sha256,
  'verifiedGps',false,'liveGps',false,
  'confidence','mhelpdesk_customer_address_reference_only',
  'totalProducts',c.total,'fieldProducts',c.field,'shopProducts',c.shop,
  'items',coalesce((
   select jsonb_agg(jsonb_build_object(
    'productId',p.product_id,
    'sourceRowSha256',encode(sha256(convert_to(p.r::text,'UTF8')),'hex'),
    'unitNumber',p.r->>'unitNumber',
    'customer',p.r->>'customer',
    'category',p.r->>'category',
    'sourceAddress',p.r->'sourceAddress',
    'placement','FIELD',
    'lifecycle',p.r->>'lifecycle',
    'placementHeld',coalesce(p.r->>'placementHeld','false')='true',
    'status',p.status,
    'reason',p.reason,
    'matchedAddress',p.matched_address,
    'latitude',case when p.status in ('matched','address_review') and (p.provider<>'us_census_address_range' or p.census_benchmark='Public_AR_Current' or p.lookup_address is not null) then p.latitude else null end,
    'longitude',case when p.status in ('matched','address_review') and (p.provider<>'us_census_address_range' or p.census_benchmark='Public_AR_Current' or p.lookup_address is not null) then p.longitude else null end,
    'geocodedAt',p.completed_at,
    'geocodeSource',p.provider,
    'lookupAddress',p.lookup_address,
    'originalStatus',p.original_status,
    'verified',false,
    'liveGps',false,
    'confidence','mhelpdesk_address_census_range_unverified')
    order by p.product_id)
   from products p
  ),'[]'::jsonb)
 ) into response from active a cross join counts c;
 if response is null or (response->>'totalProducts')::integer<>1001
 or (response->>'fieldProducts')::integer<>287
 or (response->>'shopProducts')::integer<>714
 or jsonb_array_length(response->'items')<>287
 or (select count(distinct x->>'productId') from jsonb_array_elements(response->'items') x)<>287
 then raise exception 'Full current mHelpDesk source/address audit unavailable' using errcode='40001';end if;
 return response;
end$$;
revoke all on function public.cos_mhelp_census_map_snapshot(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.cos_mhelp_census_map_snapshot(uuid,uuid) to service_role;
commit;