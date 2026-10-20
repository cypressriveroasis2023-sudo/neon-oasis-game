begin;
do $$begin if to_regclass('app_private.cos_fleet_shop_moves') is not null or to_regprocedure('public.cos_fleet_shop_snapshot_v1(uuid,uuid)') is not null then raise exception 'Shop placement objects already exist; review before replacing';end if;end $$;
create table if not exists app_private.cos_fleet_shop_moves (
 id uuid primary key, organization_id uuid not null references public.organizations(id),
 unit_id uuid not null references public.equipment_units(id), unit_number text not null, model_id uuid not null,
 actor_id uuid not null references auth.users(id), reason text not null check(length(reason) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(), expected jsonb not null,
 before_status text, before_location_type text
);
create index if not exists cos_fleet_shop_moves_unit_time on app_private.cos_fleet_shop_moves(organization_id,unit_id,created_at desc,id);
alter table app_private.cos_fleet_shop_moves enable row level security;
revoke all on app_private.cos_fleet_shop_moves from public,anon,authenticated;
create or replace function app_private.cos_fleet_shop_actor(p_actor uuid,p_org uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app_private.appdeploy_assume_actor(p_actor,p_org);
 if not exists(select 1 from public.user_profiles up join public.user_roles ur on ur.user_id=up.user_id
  join public.roles r on r.id=ur.role_id and r.organization_id=up.organization_id
  where up.user_id=p_actor and up.organization_id=p_org and up.active
  and ((up.department='owner' and r.code='owner') or (up.department='it' and r.code='it_technician')))
 then raise exception 'Owner or IT placement access required' using errcode='42501';end if;
end $$;
revoke all on function app_private.cos_fleet_shop_actor(uuid,uuid) from public,anon,authenticated;
create or replace function public.cos_fleet_shop_action_v1(p_actor_user_id uuid,p_organization_id uuid,p_unit_id uuid,p_action text default 'read',p_request_id uuid default null,p_reason text default null,p_expected jsonb default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare u public.equipment_units; prior app_private.cos_fleet_shop_moves; latest app_private.cos_fleet_shop_moves; result jsonb; proof text;
begin
 perform app_private.cos_fleet_shop_actor(p_actor_user_id,p_organization_id);
 if p_action not in ('read','move') then raise exception 'Invalid placement operation' using errcode='22023';end if;
 if p_action='move' then
  if p_request_id is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'Reviewed placement and reason required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,20261020));
  select * into prior from app_private.cos_fleet_shop_moves where id=p_request_id;
  if found then
   if prior.actor_id<>p_actor_user_id or prior.unit_id<>p_unit_id or prior.organization_id<>p_organization_id or prior.reason<>btrim(p_reason) or prior.expected is distinct from p_expected then raise exception 'Move request was reused with different details' using errcode='40001';end if;
  end if;
 end if;
 if p_action='move' then select * into u from public.equipment_units where id=p_unit_id and organization_id=p_organization_id for update;
 else select * into u from public.equipment_units where id=p_unit_id and organization_id=p_organization_id;end if;
 if not found then raise exception 'Equipment unit unavailable' using errcode='P0002';end if;
 if u.status in ('retired','deleted') then raise exception 'Retired equipment requires review' using errcode='22023';end if;
 select * into latest from app_private.cos_fleet_shop_moves where unit_id=u.id and organization_id=p_organization_id order by created_at desc,id desc limit 1;
 proof:=encode(sha256(convert_to(jsonb_build_array(u.id,u.organization_id,u.unit_number,u.model_id,u.status,u.current_location_type)::text,'UTF8')),'hex');
 result:=jsonb_build_object('contract','COS_FLEET_SHOP_PLACEMENT_V1','unitId',u.id,'unitNumber',u.unit_number,'proof',proof,
  'auditId',latest.id::text,'recordedAt',latest.created_at,'placement',case when latest.id is not null and latest.unit_number=u.unit_number and latest.model_id=u.model_id and u.current_location_type='shop' and u.status='available' then 'SHOP' else 'UNKNOWN' end);
 if p_action='read' then return result;end if;
 if prior.id is not null then
  if latest.id<>prior.id or result->>'placement'<>'SHOP' then raise exception 'Placement changed after this move' using errcode='40001';end if;
  return result||jsonb_build_object('saved',true,'requestId',prior.id,'recordedAt',prior.created_at,'replayed',true);
 end if;
 if p_expected is distinct from (result-'recordedAt') then raise exception 'Equipment identity or placement changed. Reload placement.' using errcode='40001';end if;
 insert into app_private.cos_fleet_shop_moves(id,organization_id,unit_id,unit_number,model_id,actor_id,reason,expected,before_status,before_location_type)
 values(p_request_id,p_organization_id,u.id,u.unit_number,u.model_id,p_actor_user_id,btrim(p_reason),p_expected,u.status,u.current_location_type) returning * into latest;
 -- Physical placement only. Existing trigger records the native before/after.
 -- Keep installed-site references, GPS, serial/SIM fields, associations and jobs.
 update public.equipment_units set status='available',current_location_type='shop',updated_at=now() where id=u.id and organization_id=p_organization_id;
 select * into u from public.equipment_units where id=p_unit_id and organization_id=p_organization_id;
 proof:=encode(sha256(convert_to(jsonb_build_array(u.id,u.organization_id,u.unit_number,u.model_id,u.status,u.current_location_type)::text,'UTF8')),'hex');
 return jsonb_build_object('contract','COS_FLEET_SHOP_PLACEMENT_V1','unitId',u.id,'unitNumber',u.unit_number,'proof',proof,'auditId',latest.id::text,'placement','SHOP','saved',true,'requestId',latest.id,'recordedAt',latest.created_at,'replayed',false);
end $$;
revoke all on function public.cos_fleet_shop_action_v1(uuid,uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cos_fleet_shop_action_v1(uuid,uuid,uuid,text,uuid,text,jsonb) to service_role;
create or replace function public.cos_fleet_shop_snapshot_v1(p_actor_user_id uuid,p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 perform app_private.cos_fleet_shop_actor(p_actor_user_id,p_organization_id);
 select coalesce(jsonb_agg(jsonb_build_object('unitId',x.unit_id,'unitNumber',x.unit_number,'auditId',x.id,'recordedAt',x.created_at,'placement','SHOP')),'[]'::jsonb) into items
 from (select distinct on(m.unit_id) m.* from app_private.cos_fleet_shop_moves m
 join public.equipment_units u on u.id=m.unit_id and u.organization_id=m.organization_id
 where m.organization_id=p_organization_id and u.unit_number=m.unit_number and u.model_id=m.model_id and u.status='available' and u.current_location_type='shop'
 order by m.unit_id,m.created_at desc,m.id desc) x;
 return jsonb_build_object('contract','COS_FLEET_SHOP_OVERRIDES_V1','items',items);
end $$;
revoke all on function public.cos_fleet_shop_snapshot_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cos_fleet_shop_snapshot_v1(uuid,uuid) to service_role;
commit;
