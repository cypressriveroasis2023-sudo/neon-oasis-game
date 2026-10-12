-- Private, reviewed mHelpDesk assignment receipts. Operational rows, GPS and provider data are never written.
create schema cos_mhelp_placement_private;
revoke all on schema cos_mhelp_placement_private from public,anon,authenticated,service_role;
create table cos_mhelp_placement_private.links(
 equipment_id text primary key check(equipment_id~'^[1-9][0-9]{0,14}$'),
 tracker_id uuid not null unique, native_unit_id uuid unique,
 tracker_label text not null, native_label text, full_label text not null, model text,
 source_revision uuid not null, baseline_guard text not null check(baseline_guard~'^[a-f0-9]{64}$'),
 baseline_customer_id text not null, baseline_location_id text,
 reviewed_at timestamptz not null default clock_timestamp(), authorization_sha256 text not null check(authorization_sha256~'^[a-f0-9]{64}$'),
 observation jsonb, observed_at timestamptz
);
create table cos_mhelp_placement_private.control(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 lease_id uuid,lease_until timestamptz,last_attempt_at timestamptz,last_success_at timestamptz,error_code text
);
create table cos_mhelp_placement_private.receipts(
 id uuid primary key,attempt_at timestamptz not null default clock_timestamp(),confirmed integer not null,held integer not null
);
alter table cos_mhelp_placement_private.links enable row level security;
alter table cos_mhelp_placement_private.control enable row level security;
alter table cos_mhelp_placement_private.receipts enable row level security;
revoke all on all tables in schema cos_mhelp_placement_private from public,anon,authenticated,service_role;
insert into cos_mhelp_placement_private.control(singleton) values(true);

-- Labels are denial guards only. Positive identities come from existing exact source UUID/ProductId bindings.
create function cos_mhelp_placement_private.guard(p_tracker uuid,p_native uuid) returns text
 language plpgsql stable set search_path='' as $$
declare t app_private.vision_tracker_locations;u public.equipment_units;s app_private.cos_geocode_sources;data jsonb;
begin
 select * into t from app_private.vision_tracker_locations where id=p_tracker and organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
 if not found or (select count(*) from app_private.vision_tracker_locations x where x.organization_id=t.organization_id and x.unit_key=t.unit_key)<>1 then return null;end if;
 select * into s from app_private.cos_geocode_sources where tracker_id=p_tracker and active and source_system='mhelpdesk_product_import';
 if not found or s.tracker_unit_number<>t.unit_number or (p_native is null and s.entity_kind<>'tracker') or (p_native is not null and (s.entity_kind<>'equipment_unit' or s.native_unit_id<>p_native)) then return null;end if;
 if exists(select 1 from app_private.cos_archived_representations a where p_tracker in(a.archived_tracker_id,a.canonical_tracker_id) or p_native in(a.archived_native_id,a.canonical_native_id)) then return null;end if;
 data:=jsonb_build_object('tracker',to_jsonb(t),'sourceIdentity',jsonb_build_array(s.product_id,s.source_revision,s.unit_number,s.tracker_unit_number));
 if p_native is not null then
  select * into u from public.equipment_units where id=p_native and organization_id=t.organization_id;
  if not found or u.unit_number<>s.unit_number or u.retired_at is not null or u.status<>'available' or u.installed_site_id is not null or u.current_location_ref is not null or nullif(u.current_location_type,'') is not null
   or u.gps_latitude is not null or u.gps_longitude is not null or u.gps_recorded_at is not null
   or (select count(*) from public.equipment_units x where x.organization_id=t.organization_id and app_private.cos_source_label(x.unit_number)=app_private.cos_source_label(u.unit_number))<>1
   or exists(select 1 from public.equipment_unit_location_history h where h.equipment_unit_id=p_native)
   or exists(select 1 from app_private.cos_owner_identity_claims c where c.native_unit_id=p_native)
  then return null;end if;
  data:=data||jsonb_build_object('native',to_jsonb(u));
 end if;
 return encode(sha256(convert_to(data::text,'UTF8')),'hex');
end $$;

-- Administrator-only admission, after protected live ID/label/customer verification. No end-user RPC or automatic matching.
create function cos_mhelp_placement_private.admit(p_links jsonb,p_authorization_sha256 text) returns integer
 language plpgsql set search_path='' as $$
declare r jsonb;s app_private.cos_geocode_sources;t app_private.vision_tracker_locations;g text;n integer:=0;
begin
 if current_user not in('postgres','supabase_admin') then raise exception 'Administrator required' using errcode='42501';end if;
 if jsonb_typeof(p_links)<>'array' or jsonb_array_length(p_links)>1000 or p_authorization_sha256!~'^[a-f0-9]{64}$' then raise exception 'Invalid review';end if;
 -- NOWAIT freezes the native authority graph for this bounded administration transaction.
 lock table app_private.vision_tracker_locations,public.equipment_units,app_private.cos_geocode_sources,
  public.equipment_unit_location_history,app_private.cos_owner_identity_claims,app_private.cos_archived_representations in share mode nowait;
 for r in select value from jsonb_array_elements(p_links) loop
  if (r-array['equipmentId','trackerId','nativeUnitId','trackerLabel','nativeLabel','fullLabel','model','sourceRevision','expectedGuard','customerId','serviceLocationId','placement','customerLabel','siteLabel'])<>'{}'::jsonb
   or coalesce(r->>'equipmentId','')!~'^[1-9][0-9]{0,14}$' or coalesce(r->>'fullLabel','')='' or length(r->>'fullLabel')>180
   or r->>'fullLabel'~*'\m(do not use|missing|retired|decommissioned|stolen)\M' then raise exception 'Invalid identity review';end if;
  select * into strict s from app_private.cos_geocode_sources where tracker_id=(r->>'trackerId')::uuid and product_id=r->>'equipmentId' and source_system='mhelpdesk_product_import' and active;
  select * into strict t from app_private.vision_tracker_locations where id=s.tracker_id;
  g:=cos_mhelp_placement_private.guard(s.tracker_id,case when s.entity_kind='equipment_unit' then s.native_unit_id end);
  if g is null or g is distinct from r->>'expectedGuard' or s.source_revision is distinct from (r->>'sourceRevision')::uuid
   or t.unit_number is distinct from r->>'trackerLabel' or (case when s.entity_kind='equipment_unit' then s.native_unit_id::text end) is distinct from r->>'nativeUnitId'
   or (case when s.entity_kind='equipment_unit' then s.unit_number end) is distinct from r->>'nativeLabel'
   or t.placement is distinct from r->>'placement' or lower(btrim(t.customer)) is distinct from lower(btrim(r->>'customerLabel'))
   or lower(btrim(t.site)) is distinct from lower(btrim(r->>'siteLabel')) then raise exception 'Review evidence changed' using errcode='40001';end if;
  insert into cos_mhelp_placement_private.links(equipment_id,tracker_id,native_unit_id,tracker_label,native_label,full_label,model,source_revision,baseline_guard,baseline_customer_id,baseline_location_id,authorization_sha256)
  values(r->>'equipmentId',s.tracker_id,case when s.entity_kind='equipment_unit' then s.native_unit_id end,t.unit_number,r->>'nativeLabel',r->>'fullLabel',r->>'model',s.source_revision,g,r->>'customerId',r->>'serviceLocationId',p_authorization_sha256);
  n:=n+1;
 end loop;
 return n;
end $$;

create function public.cos_mhelp_placement_status() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('contract','COS_MHELP_PLACEMENT_V1','enabled',enabled,'sheetsPublisher',false,'lastAttemptAt',last_attempt_at,'lastSuccessAt',last_success_at,'errorCode',error_code,'links',(select count(*) from cos_mhelp_placement_private.links)) from cos_mhelp_placement_private.control where singleton
$$;
create function public.cos_mhelp_placement_begin() returns jsonb language plpgsql security definer set search_path='' as $$
declare s cos_mhelp_placement_private.control;v uuid;
begin
 select * into strict s from cos_mhelp_placement_private.control where singleton for update;
 if not s.enabled or s.lease_until>clock_timestamp() or s.last_attempt_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('leaseId',null);end if;
 v:=gen_random_uuid();update cos_mhelp_placement_private.control set lease_id=v,lease_until=clock_timestamp()+interval '4 minutes',last_attempt_at=clock_timestamp() where singleton;
 return jsonb_build_object('leaseId',v,'links',(select coalesce(jsonb_agg(jsonb_build_object('equipmentId',equipment_id,'fullLabel',full_label,'model',model) order by equipment_id),'[]') from cos_mhelp_placement_private.links));
end $$;
create function public.cos_mhelp_placement_finish(p_lease_id uuid,p_observations jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s cos_mhelp_placement_private.control;r jsonb;l cos_mhelp_placement_private.links;seen text[]:='{}';c integer:=0;h integer:=0;
begin
 select * into strict s from cos_mhelp_placement_private.control where singleton for update;
 if not s.enabled or p_lease_id is null or s.lease_id is distinct from p_lease_id or s.lease_until<=clock_timestamp() then return jsonb_build_object('committed',false);end if;
 if jsonb_typeof(p_observations)<>'array' or jsonb_array_length(p_observations)<>(select count(*) from cos_mhelp_placement_private.links) then raise exception 'Incomplete observations';end if;
 for r in select value from jsonb_array_elements(p_observations) loop
  if jsonb_typeof(r)<>'object' or coalesce(r->>'equipmentId','')='' or r->>'equipmentId'=any(seen) or (r-array['equipmentId','state','reason','customerId','serviceLocationId','placement','customerLabel','siteLabel'])<>'{}'::jsonb then raise exception 'Invalid observation';end if;
  seen:=array_append(seen,r->>'equipmentId');select * into strict l from cos_mhelp_placement_private.links where equipment_id=r->>'equipmentId' for update;
  if r->>'state'='confirmed' then
   if coalesce(r->>'placement','') not in('FIELD','SHOP') or coalesce(r->>'customerLabel','')='' or coalesce(r->>'siteLabel','')='' or length(r->>'customerLabel')>250 or length(r->>'siteLabel')>250 or ((r->>'customerLabel')||(r->>'siteLabel'))~'[[:cntrl:]<>]'
    or coalesce(r->>'customerId','')!~'^[1-9][0-9]{0,14}$' or (r->>'serviceLocationId' is not null and r->>'serviceLocationId'!~'^[1-9][0-9]{0,14}$')
    or (r->>'placement'='SHOP') is distinct from (lower(btrim(r->>'customerLabel')) in('cameras onsite','cameras onsite llc')) then raise exception 'Invalid assignment';end if;
   c:=c+1;
  elsif r->>'state'='held' and r->>'reason' in('equipment_missing','identity_or_lifecycle_changed','customer_unverified','service_location_unverified') then h:=h+1;
  else raise exception 'Invalid observation state';end if;
  update cos_mhelp_placement_private.links set observation=r,observed_at=clock_timestamp() where equipment_id=l.equipment_id;
 end loop;
 insert into cos_mhelp_placement_private.receipts(id,confirmed,held) values(p_lease_id,c,h);
 update cos_mhelp_placement_private.control set lease_id=null,lease_until=null,last_success_at=clock_timestamp(),error_code=null where singleton;
 return jsonb_build_object('committed',true,'confirmed',c,'held',h,'sheetsPublisher',false);
end $$;
create function public.cos_mhelp_placement_fail(p_lease_id uuid) returns void language sql security definer set search_path='' as $$
 update cos_mhelp_placement_private.control set lease_id=null,lease_until=null,error_code='source_read_unavailable' where singleton and lease_id=p_lease_id
$$;
create function public.cos_mhelp_placement_snapshot(p_actor_user_id uuid,p_organization_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('trackerId',tracker_id,'nativeUnitId',native_unit_id,'trackerLabel',tracker_label,'nativeLabel',native_label,
  'state',case when observation->>'state'='confirmed' and cos_mhelp_placement_private.guard(tracker_id,native_unit_id)=baseline_guard then 'confirmed' else 'held' end,
  'placement',observation->>'placement','customerLabel',observation->>'customerLabel','siteLabel',observation->>'siteLabel','observedAt',observed_at,
  'locationReview',observation->>'customerId' is distinct from baseline_customer_id or observation->>'serviceLocationId' is distinct from baseline_location_id) order by tracker_id),'[]') into items from cos_mhelp_placement_private.links;
 return public.cos_mhelp_placement_status()||jsonb_build_object('items',items);
end $$;
revoke all on all functions in schema cos_mhelp_placement_private from public,anon,authenticated,service_role;
revoke all on function public.cos_mhelp_placement_status(),public.cos_mhelp_placement_begin(),public.cos_mhelp_placement_finish(uuid,jsonb),public.cos_mhelp_placement_fail(uuid),public.cos_mhelp_placement_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cos_mhelp_placement_status(),public.cos_mhelp_placement_begin(),public.cos_mhelp_placement_finish(uuid,jsonb),public.cos_mhelp_placement_fail(uuid),public.cos_mhelp_placement_snapshot(uuid,uuid) to service_role;
