-- Safe current mHelpDesk service-location evidence, separate from operational inventory and GPS.
create table cos_mhelp_placement_private.locations (
 kind text not null check(kind in('equipment_unit','tracker')),unit_id uuid not null,unit_number text not null,
 guard text not null check(guard~'^[a-f0-9]{64}$'),observation jsonb not null,observed_at timestamptz not null default clock_timestamp(),
 last_good jsonb,last_good_at timestamptz,primary key(kind,unit_id)
);
alter table cos_mhelp_placement_private.locations enable row level security;
revoke all on cos_mhelp_placement_private.locations from public,anon,authenticated,service_role;
create function cos_mhelp_placement_private.location_guard(p_kind text,p_id uuid) returns text
 language plpgsql stable set search_path='' as $$
declare data jsonb;label text;org uuid;
begin
 if p_kind='equipment_unit' then
  select to_jsonb(u),u.unit_number,u.organization_id into data,label,org from public.equipment_units u where u.id=p_id and u.retired_at is null;
  if exists(select 1 from app_private.cos_archived_representations a where p_id in(a.archived_native_id,a.canonical_native_id)) then return null;end if;
 elsif p_kind='tracker' then
  select to_jsonb(t),t.unit_number,t.organization_id into data,label,org from app_private.vision_tracker_locations t where t.id=p_id;
  if exists(select 1 from app_private.cos_archived_representations a where p_id in(a.archived_tracker_id,a.canonical_tracker_id)) then return null;end if;
 else return null;end if;
 if data is null or org<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or coalesce(label,'')='' or length(label)>160 or label~'[[:cntrl:]<>]' then return null;end if;
 return encode(sha256(convert_to(data::text,'UTF8')),'hex');
end $$;
create function public.cos_mhelp_location_candidates() returns jsonb language sql security definer set search_path='' as $$
 with candidates as(
  select 'equipment_unit'::text kind,u.id,u.unit_number,cos_mhelp_placement_private.location_guard('equipment_unit',u.id) guard,
   (u.retired_at is not null or u.status in('retired','missing','stolen','decommissioned')) inactive
   from public.equipment_units u where u.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
  union all
  select 'tracker',t.id,t.unit_number,cos_mhelp_placement_private.location_guard('tracker',t.id),false
   from app_private.vision_tracker_locations t where t.organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
    and not exists(select 1 from app_private.cos_geocode_sources s where s.tracker_id=t.id and s.active and s.entity_kind='equipment_unit' and s.native_unit_id is not null)
 ) select coalesce(jsonb_agg(jsonb_build_object('kind',c.kind,'unitId',c.id,'unitNumber',c.unit_number,'guard',c.guard,'inactive',c.inactive,
  'previous',case when l.guard=c.guard then l.last_good else null end) order by c.kind,c.id),'[]') from candidates c
  left join cos_mhelp_placement_private.locations l on l.kind=c.kind and l.unit_id=c.id where c.guard is not null
$$;
create function cos_mhelp_placement_private.store_location(r jsonb) returns void language plpgsql set search_path='' as $$
declare k text:=r->>'kind';i uuid:=(r->>'unitId')::uuid;g text:=r->>'guard';label text:=r->>'unitNumber';v jsonb:=r-array['kind','unitId','unitNumber','guard'];
begin
 if k not in('equipment_unit','tracker') or coalesce(g,'')!~'^[a-f0-9]{64}$' or coalesce(label,'')='' or length(label)>160
  or (r-array['kind','unitId','unitNumber','guard','state','reason','equipmentId','equipmentUpdatedAt','placement','customer','site','address','point','coordinateSource'])<>'{}'::jsonb then raise exception 'Invalid location receipt';end if;
 if g is distinct from cos_mhelp_placement_private.location_guard(k,i) then raise exception 'Inventory changed during location read' using errcode='40001';end if;
 if (k='equipment_unit' and not exists(select 1 from public.equipment_units where id=i and unit_number=label))
  or (k='tracker' and not exists(select 1 from app_private.vision_tracker_locations where id=i and unit_number=label)) then raise exception 'Unit label changed';end if;
 if v->>'state'='confirmed' then
  if coalesce(v->>'placement','') not in('FIELD','SHOP') or coalesce(v->>'equipmentId','')!~'^[1-9][0-9]{0,14}$'
   or coalesce(v->>'customer','')='' or length(v->>'customer')>250 or coalesce(v->>'site','')='' or length(v->>'site')>250
   or ((v->>'customer')||(v->>'site')||coalesce(v->>'address',''))~'[[:cntrl:]<>]' or length(v->>'address')>600
   or (v->>'placement'='SHOP') is distinct from (lower(btrim(v->>'customer')) in('cameras onsite','cameras onsite llc'))
   or (v->>'placement'='SHOP' and (v->>'address' is not null or jsonb_typeof(v->'point')<>'null'))
   or (v->>'coordinateSource' is not null and v->>'coordinateSource' not in('mHelpDesk service location','Census address estimate')) then raise exception 'Invalid safe service location';end if;
  if jsonb_typeof(v->'point') is distinct from 'null' and (jsonb_typeof(v->'point') is distinct from 'array' or jsonb_array_length(v->'point')<>2) then raise exception 'Invalid service point';end if;
  if jsonb_typeof(v->'point')='array' and (jsonb_typeof(v->'point'->0)<>'number' or jsonb_typeof(v->'point'->1)<>'number' or abs((v->'point'->>0)::numeric)>90 or abs((v->'point'->>1)::numeric)>180) then raise exception 'Invalid service coordinates';end if;
 elsif v->>'state'='held' and v->>'reason' in('not_numbered_field_equipment','inactive_equipment','duplicate_inventory_identity','duplicate_mhelp_identity','mhelp_equipment_not_found','mhelp_location_read_unavailable','service_location_unverified') then null;
 else raise exception 'Invalid location state';end if;
 insert into cos_mhelp_placement_private.locations(kind,unit_id,unit_number,guard,observation,last_good,last_good_at)
 values(k,i,label,g,v,case when v->>'state'='confirmed' then v end,case when v->>'state'='confirmed' then clock_timestamp() end)
 on conflict(kind,unit_id) do update set unit_number=excluded.unit_number,guard=excluded.guard,observation=excluded.observation,observed_at=clock_timestamp(),
  last_good=case when excluded.observation->>'state'='confirmed' then excluded.observation else locations.last_good end,
  last_good_at=case when excluded.observation->>'state'='confirmed' then clock_timestamp() else locations.last_good_at end;
end $$;
create function public.cos_mhelp_fleet_finish(p_lease_id uuid,p_observations jsonb,p_locations jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;seen text[]:='{}';result jsonb;key text;
begin
 perform 1 from cos_mhelp_placement_private.control where singleton and enabled and lease_id=p_lease_id and lease_until>clock_timestamp() for update;
 if not found then return jsonb_build_object('committed',false);end if;
 if jsonb_typeof(p_locations) is distinct from 'array' or jsonb_array_length(p_locations)>2000 then raise exception 'Invalid fleet locations';end if;
 for r in select value from jsonb_array_elements(p_locations) loop
  key:=(r->>'kind')||':'||(r->>'unitId');if key=any(seen) then raise exception 'Duplicate unit receipt';end if;seen:=array_append(seen,key);
  perform cos_mhelp_placement_private.store_location(r);
 end loop;
 result:=public.cos_mhelp_placement_finish(p_lease_id,p_observations);
 if result->>'committed'<>'true' then raise exception 'Lease expired';end if;
 return result||jsonb_build_object('locationRecords',jsonb_array_length(p_locations));
end $$;
create function public.cos_mhelp_location_snapshot(p_actor_user_id uuid,p_organization_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'unitId',unit_id,'unitNumber',unit_number,'guardCurrent',guard=cos_mhelp_placement_private.location_guard(kind,unit_id),
  'state',observation->>'state','reason',observation->>'reason','placement',observation->>'placement','customer',observation->>'customer','site',observation->>'site',
  'address',observation->>'address','point',observation->'point','coordinateSource',observation->>'coordinateSource','observedAt',observed_at) order by unit_id),'[]') into items from cos_mhelp_placement_private.locations;
 return public.cos_mhelp_placement_status()||jsonb_build_object('contract','COS_MHELP_FLEET_LOCATIONS_V1','items',items);
end $$;
create function public.cos_mhelp_location_target(p_actor_user_id uuid,p_organization_id uuid,p_unit_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
 perform app_private.appdeploy_assume_actor(p_actor_user_id,p_organization_id);
 if p_organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or not app_private.has_permission(p_organization_id,'equipment.view') then raise exception 'Equipment view required' using errcode='42501';end if;
 select value into strict target from jsonb_array_elements(public.cos_mhelp_location_candidates()) where value->>'unitId'=p_unit_id::text;
 return target;
end $$;
create function public.cos_mhelp_location_record(p_actor_user_id uuid,p_organization_id uuid,p_unit_id uuid,p_guard text,p_observation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
 target:=public.cos_mhelp_location_target(p_actor_user_id,p_organization_id,p_unit_id);
 if target->>'guard' is distinct from p_guard then raise exception 'Inventory changed during location read' using errcode='40001';end if;
 perform cos_mhelp_placement_private.store_location(jsonb_build_object('kind',target->>'kind','unitId',p_unit_id,'unitNumber',target->>'unitNumber','guard',p_guard)||p_observation);
 return jsonb_build_object('recorded',true);
end $$;
revoke all on function cos_mhelp_placement_private.location_guard(text,uuid),cos_mhelp_placement_private.store_location(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cos_mhelp_location_candidates(),public.cos_mhelp_fleet_finish(uuid,jsonb,jsonb),public.cos_mhelp_location_snapshot(uuid,uuid),public.cos_mhelp_location_target(uuid,uuid,uuid),public.cos_mhelp_location_record(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cos_mhelp_location_candidates(),public.cos_mhelp_fleet_finish(uuid,jsonb,jsonb),public.cos_mhelp_location_snapshot(uuid,uuid),public.cos_mhelp_location_target(uuid,uuid,uuid),public.cos_mhelp_location_record(uuid,uuid,uuid,text,jsonb) to service_role;
