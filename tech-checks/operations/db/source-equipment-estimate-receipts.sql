-- NATIVE project, reviewed candidate only. This stores bounded, reviewed cache
-- evidence; it never creates a native unit, source job, identity link or provider call.
begin;
create table cos_mhelp_placement_private.source_equipment_estimates(
 receipt_id uuid primary key,source_sha256 text not null,payload_sha256 text not null,product_id text not null,
 upload_record_sha256 text not null,upload_record jsonb not null,linkage_graph_sha256 text not null,cache_evidence_sha256 text not null,cache_evidence jsonb not null,
 authorization_sha256 text not null,admitted_at timestamptz not null default clock_timestamp(),
 unique(source_sha256,payload_sha256,product_id,upload_record_sha256),
 check(source_sha256~'^[a-f0-9]{64}$' and payload_sha256~'^[a-f0-9]{64}$' and upload_record_sha256~'^[a-f0-9]{64}$' and cache_evidence_sha256~'^[a-f0-9]{64}$' and authorization_sha256~'^[a-f0-9]{64}$' and linkage_graph_sha256~'^[a-f0-9]{64}$'),
 check(product_id~'^[1-9][0-9]{0,14}$')
);
create table cos_mhelp_placement_private.source_equipment_estimate_revocations(
 receipt_id uuid primary key references cos_mhelp_placement_private.source_equipment_estimates,
 authorization_sha256 text not null check(authorization_sha256~'^[a-f0-9]{64}$'),revoked_at timestamptz not null default clock_timestamp()
);
alter table cos_mhelp_placement_private.source_equipment_estimates enable row level security;
alter table cos_mhelp_placement_private.source_equipment_estimate_revocations enable row level security;
revoke all on cos_mhelp_placement_private.source_equipment_estimates,cos_mhelp_placement_private.source_equipment_estimate_revocations from public,anon,authenticated,service_role;
create function cos_mhelp_placement_private.source_estimate_append_only() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Estimate review receipts are append-only';end$$;
create trigger source_estimates_immutable before update or delete or truncate on cos_mhelp_placement_private.source_equipment_estimates for each statement execute function cos_mhelp_placement_private.source_estimate_append_only();
create trigger source_estimate_revocations_immutable before update or delete or truncate on cos_mhelp_placement_private.source_equipment_estimate_revocations for each statement execute function cos_mhelp_placement_private.source_estimate_append_only();
create function cos_mhelp_placement_private.source_estimate_record_current(r jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(r)='object' and r->>'placement'='FIELD' and r->>'lifecycle'='UNFLAGGED'
  and r->'binding'='null'::jsonb and r->'placementHeld'='false'::jsonb and r->'possibleAliasUnitIds'='[]'::jsonb
  and r->>'productId'~'^[1-9][0-9]{0,14}$' and r->>'customerId'~'^[1-9][0-9]{0,14}$'
  and length(r->>'customer') between 1 and 512 and jsonb_typeof(r->'sourceAddress')='object'
  and length(r#>>'{sourceAddress,street}') between 1 and 300 and length(r#>>'{sourceAddress,city}') between 1 and 100
  and r#>>'{sourceAddress,state}'~*'^[a-z]{2}$' and r#>>'{sourceAddress,zip}'~'^[0-9]{5}(-[0-9]{4})?$',false)
$$;
-- Full, exact graph evidence is denial-only. It never creates a positive native
-- identity from an old ProductId source association. Historical rows remain part
-- of the receipt; any later graph/authority change suppresses the estimate.
create function cos_mhelp_placement_private.source_estimate_linkage_graph(p_product text) returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
 with recursive seed_pairs as (
  select s.tracker_id,s.native_unit_id from app_private.cos_geocode_sources s where s.product_id=p_product
  union select l.tracker_id,l.native_unit_id from cos_mhelp_placement_private.links l where l.equipment_id=p_product
  union select null::uuid,c.native_unit_id from app_private.cos_owner_identity_claims c where c.product_association->>'productId'=p_product
  union select c.tracker_id,c.native_unit_id from app_private.cos_source_recorded_coordinates c where c.payload->>'productId'=p_product
 ), all_pairs as (
  select tracker_id,native_unit_id from app_private.cos_geocode_sources
  union select tracker_id,native_unit_id from cos_mhelp_placement_private.links
  union select tracker_id,native_unit_id from app_private.cos_source_recorded_coordinates
  union select archived_tracker_id,archived_native_id from app_private.cos_archived_representations
  union select canonical_tracker_id,canonical_native_id from app_private.cos_archived_representations
 ), edge_groups as (
  select array[tracker_id,native_unit_id] ids from all_pairs
  union select array[archived_tracker_id,archived_native_id,canonical_tracker_id,canonical_native_id] from app_private.cos_archived_representations
 ), edges as (
  select distinct a.id a,b.id b from edge_groups g cross join lateral unnest(g.ids) a(id) cross join lateral unnest(g.ids) b(id) where a.id is not null and b.id is not null and a.id<>b.id
 ), nodes(id) as (
  select id from seed_pairs p cross join lateral unnest(array[p.tracker_id,p.native_unit_id]) x(id) where id is not null
  union select e.b from nodes n join edges e on e.a=n.id
 ), pairs as (
  select * from seed_pairs
  union select * from all_pairs where tracker_id in(select id from nodes) or native_unit_id in(select id from nodes)
 ), claims as (
  select c.* from app_private.cos_owner_identity_claims c where c.product_association->>'productId'=p_product or c.native_unit_id in(select id from nodes)
 ), archives as (
  select a.* from app_private.cos_archived_representations a where exists(select 1 from nodes n where n.id in(a.archived_tracker_id,a.canonical_tracker_id,a.archived_native_id,a.canonical_native_id))
 ) select jsonb_build_object(
  'productId',p_product,
  'sources',(select coalesce(jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text),'[]'::jsonb) from app_private.cos_geocode_sources s where s.product_id=p_product or s.native_unit_id in(select native_unit_id from pairs) or s.tracker_id in(select tracker_id from pairs)),
  'links',(select coalesce(jsonb_agg(to_jsonb(l) order by to_jsonb(l)::text),'[]'::jsonb) from cos_mhelp_placement_private.links l where l.equipment_id=p_product or l.native_unit_id in(select native_unit_id from pairs) or l.tracker_id in(select tracker_id from pairs)),
  'pairGuards',(select coalesce(jsonb_agg(jsonb_build_object('trackerId',p.tracker_id,'nativeUnitId',p.native_unit_id,'guard',cos_mhelp_placement_private.upload_binding_guard(p.tracker_id,p.native_unit_id)) order by p.tracker_id,p.native_unit_id),'[]'::jsonb) from pairs p),
  'ownerClaims',(select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from claims c),
  'ownerResources',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from app_private.cos_owner_identity_resources r where r.claim_id in(select id from claims)),
  'ownerRevocations',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from app_private.cos_owner_identity_revocations r where r.claim_id in(select id from claims)),
  'archives',(select coalesce(jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text),'[]'::jsonb) from archives a),
  'archiveRevocations',(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from app_private.cos_archived_representation_revocations r where r.representation_id in(select id from archives)),
  'recordedCoordinates',(select coalesce(jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text),'[]'::jsonb) from app_private.cos_source_recorded_coordinates c where c.payload->>'productId'=p_product or c.native_unit_id in(select native_unit_id from pairs) or c.tracker_id in(select tracker_id from pairs))
 )
$$;
create function cos_mhelp_placement_private.source_estimate_linkage_guard(p_product text) returns text language sql stable set search_path='' set timezone='UTC' as $$
 select encode(sha256(convert_to(cos_mhelp_placement_private.source_estimate_linkage_graph(p_product)::text,'UTF8')),'hex')
$$;
create function cos_mhelp_placement_private.review_source_equipment_estimates(p_source_sha256 text,p_payload_sha256 text,p_input_sha256 text,p_receipts jsonb,p_authorization_sha256 text) returns jsonb
language plpgsql set search_path='' as $$
declare b cos_mhelp_placement_private.upload_batches; x jsonb; u jsonb; c jsonb; addr text; existing cos_mhelp_placement_private.source_equipment_estimates; seen text[]:='{}';counted integer:=0;
begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed transaction required';end if;
 if p_authorization_sha256 is null or p_authorization_sha256!~'^[a-f0-9]{64}$' or jsonb_typeof(p_receipts) is distinct from 'array' or jsonb_array_length(p_receipts) not between 1 and 3
  or p_input_sha256 is distinct from encode(sha256(convert_to(p_receipts::text,'UTF8')),'hex') then raise exception 'Exact bounded receipt review required';end if;
 perform set_config('lock_timeout','2000ms',true);
 perform 1 from cos_mhelp_placement_private.upload_control where singleton for update;
 -- Prevent source/claim/history phantoms while binding the captured graph. These
 -- SHARE locks do not block ordinary reads; NOWAIT refuses concurrent writers.
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,
  cos_mhelp_placement_private.links,public.equipment_unit_location_history,app_private.cos_owner_identity_claims,
  app_private.cos_owner_identity_resources,app_private.cos_owner_identity_revocations,
  app_private.cos_archived_representations,app_private.cos_archived_representation_revocations,
  app_private.cos_source_recorded_coordinates in share mode nowait;
 select z.* into b from cos_mhelp_placement_private.upload_control ctl join cos_mhelp_placement_private.upload_batches z on z.source_sha256=ctl.active_sha256 where ctl.singleton;
 if not found or b.source_sha256 is distinct from p_source_sha256 or b.payload_sha256 is distinct from p_payload_sha256 then raise exception 'Active upload changed';end if;
 for x in select value from jsonb_array_elements(p_receipts) loop
  if jsonb_typeof(x) is distinct from 'object' or (select count(*) from jsonb_object_keys(x))<>6 or not(x ?& array['receiptId','productId','uploadRecordSha256','cacheEvidenceSha256','cacheEvidence','linkageGraphSha256'])
   or x->>'productId'=any(seen) then raise exception 'Exact unique receipt required';end if;
  seen:=array_append(seen,x->>'productId');
  if (select count(*) from jsonb_array_elements(b.records) r where r->>'productId'=x->>'productId')<>1 then raise exception 'Upload ProductId is not unique';end if;
  select r into u from jsonb_array_elements(b.records) r where r->>'productId'=x->>'productId';
  if cos_mhelp_placement_private.source_estimate_record_current(u) is not true or x->>'uploadRecordSha256' is distinct from encode(sha256(convert_to(u::text,'UTF8')),'hex') then raise exception 'Upload identity, assignment, lifecycle or address changed';end if;
  if x->>'linkageGraphSha256' is distinct from cos_mhelp_placement_private.source_estimate_linkage_guard(x->>'productId') then raise exception 'Source linkage graph changed';end if;
  c:=x->'cacheEvidence';addr:=app_private.cos_source_address(u#>>'{sourceAddress,street}',u#>>'{sourceAddress,city}',u#>>'{sourceAddress,state}',u#>>'{sourceAddress,zip}');
  if jsonb_typeof(c) is distinct from 'object' or x->>'cacheEvidenceSha256' is distinct from encode(sha256(convert_to(c::text,'UTF8')),'hex')
   or c->>'contract' is distinct from 'COS_SAVED_ADDRESS_CACHE_V1' or c->>'status' is distinct from 'success' or c->'verified' is distinct from 'false'::jsonb or c->'liveGps' is distinct from 'false'::jsonb
   or c->>'address' is distinct from addr or c->>'addressSha256' is distinct from encode(sha256(convert_to(addr,'UTF8')),'hex')
   or jsonb_typeof(c->'latitude') is distinct from 'number' or jsonb_typeof(c->'longitude') is distinct from 'number'
   or (c->>'latitude')::numeric not between -90 and 90 or (c->>'longitude')::numeric not between -180 and 180
   or c->>'matchedAddress' is null or c->>'geocodedAt' is null or (c->>'geocodedAt')::timestamptz>clock_timestamp()
   or not coalesce((c->>'provider'='us_census_address_range' and c->>'benchmark'='Public_AR_Current' and c->>'accuracyType'='range_interpolation')
    or (c->>'provider'='geocodio' and c->>'accuracyType' in('rooftop','range_interpolation') and (c->>'accuracy')::numeric between 0.9 and 1
     and (c->'matchType'='null'::jsonb or c->>'accuracyType'='rooftop' and c->>'matchType' in('building_centroid','parcel_centroid'))),false) then raise exception 'Exact successful cache evidence required';end if;
  select * into existing from cos_mhelp_placement_private.source_equipment_estimates where receipt_id=(x->>'receiptId')::uuid;
  if found then
   if existing.source_sha256 is distinct from b.source_sha256 or existing.payload_sha256 is distinct from b.payload_sha256 or existing.product_id is distinct from x->>'productId' or existing.upload_record is distinct from u or existing.linkage_graph_sha256 is distinct from x->>'linkageGraphSha256' or existing.cache_evidence is distinct from c or existing.authorization_sha256 is distinct from p_authorization_sha256 then raise exception 'Receipt replay differs';end if;
   if exists(select 1 from cos_mhelp_placement_private.source_equipment_estimate_revocations where receipt_id=existing.receipt_id) then raise exception 'Receipt was revoked';end if;
  else
   insert into cos_mhelp_placement_private.source_equipment_estimates(receipt_id,source_sha256,payload_sha256,product_id,upload_record_sha256,upload_record,linkage_graph_sha256,cache_evidence_sha256,cache_evidence,authorization_sha256)
   values((x->>'receiptId')::uuid,b.source_sha256,b.payload_sha256,x->>'productId',x->>'uploadRecordSha256',u,x->>'linkageGraphSha256',x->>'cacheEvidenceSha256',c,p_authorization_sha256);
  end if;counted:=counted+1;
 end loop;
 return jsonb_build_object('receipts',counted,'sourceSha256',b.source_sha256,'payloadSha256',b.payload_sha256);
end$$;
create function cos_mhelp_placement_private.revoke_source_equipment_estimates(p_receipt_ids uuid[],p_authorization_sha256 text) returns integer language plpgsql set search_path='' as $$
declare target uuid;existing text;n integer:=0;
begin
 if current_user<>'postgres' then raise exception 'Existing SQL administrator required' using errcode='42501';end if;
 if p_receipt_ids is null or cardinality(p_receipt_ids) not between 1 and 3 or cardinality(p_receipt_ids)<>(select count(distinct id) from unnest(p_receipt_ids) id) or p_authorization_sha256 is null or p_authorization_sha256!~'^[a-f0-9]{64}$' then raise exception 'Exact bounded revocation required';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Read committed transaction required';end if;
 perform set_config('lock_timeout','2000ms',true);
 -- Serialize overlapping revocations in a consistent order before checking the
 -- immutable receipt's revocation. READ COMMITTED sees the preceding commit.
 perform 1 from cos_mhelp_placement_private.source_equipment_estimates where receipt_id=any(p_receipt_ids) order by receipt_id for update;
 for target in select id from unnest(p_receipt_ids) id order by id loop
  if not exists(select 1 from cos_mhelp_placement_private.source_equipment_estimates where receipt_id=target) then raise exception 'Unknown receipt';end if;
  select authorization_sha256 into existing from cos_mhelp_placement_private.source_equipment_estimate_revocations where receipt_id=target;
  if found and existing<>p_authorization_sha256 then raise exception 'Revocation replay differs';end if;
  insert into cos_mhelp_placement_private.source_equipment_estimate_revocations values(target,p_authorization_sha256,clock_timestamp()) on conflict(receipt_id) do nothing;
  select authorization_sha256 into existing from cos_mhelp_placement_private.source_equipment_estimate_revocations where receipt_id=target;
  if existing is distinct from p_authorization_sha256 then raise exception 'Revocation replay differs';end if;
  n:=n+1;
 end loop;return n;
end$$;
revoke all on function cos_mhelp_placement_private.source_estimate_linkage_graph(text),cos_mhelp_placement_private.source_estimate_linkage_guard(text),cos_mhelp_placement_private.source_estimate_append_only(),cos_mhelp_placement_private.source_estimate_record_current(jsonb),cos_mhelp_placement_private.review_source_equipment_estimates(text,text,text,jsonb,text),cos_mhelp_placement_private.revoke_source_equipment_estimates(uuid[],text) from public,anon,authenticated,service_role;
create function public.cos_source_equipment_estimates_snapshot(p_actor_user_id uuid,p_organization_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or app_private.has_permission(p_organization_id,'equipment.view') is not true then raise exception 'Equipment view required' using errcode='42501';end if;
 select jsonb_build_object('sourceSha256',b.source_sha256,'payloadSha256',b.payload_sha256,'records',coalesce((
  select jsonb_agg(e.cache_evidence||jsonb_build_object('receiptId',e.receipt_id,'productId',e.product_id,'sourceSha256',e.source_sha256,'payloadSha256',e.payload_sha256,'uploadRecordSha256',e.upload_record_sha256,'linkageGraphSha256',e.linkage_graph_sha256,'uploadRecord',e.upload_record) order by e.product_id)
  from cos_mhelp_placement_private.source_equipment_estimates e
  where e.source_sha256=b.source_sha256 and e.payload_sha256=b.payload_sha256 and e.linkage_graph_sha256=cos_mhelp_placement_private.source_estimate_linkage_guard(e.product_id) and not exists(select 1 from cos_mhelp_placement_private.source_equipment_estimate_revocations v where v.receipt_id=e.receipt_id)
   and (select count(*) from jsonb_array_elements(b.records) r where r->>'productId'=e.product_id)=1
   and exists(select 1 from jsonb_array_elements(b.records) r where r->>'productId'=e.product_id and r=e.upload_record and cos_mhelp_placement_private.source_estimate_record_current(r) is true)
 ),'[]')) into result from cos_mhelp_placement_private.upload_control c join cos_mhelp_placement_private.upload_batches b on b.source_sha256=c.active_sha256 where c.singleton;
 return result;
end$$;
revoke all on function public.cos_source_equipment_estimates_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cos_source_equipment_estimates_snapshot(uuid,uuid) to service_role;
commit;
