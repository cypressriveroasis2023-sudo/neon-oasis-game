-- Hand edits to unit camera status (Tech Check Platform).
--
-- James's direction 2026-11-12: the technicians move units in and out of the
-- field themselves, and only he and IT may change this. Star4Live stays the
-- source of truth for what it reports: a hand edit is recorded beside the
-- provider's reading, never over it, and the board applies it when read.
--
-- Four things are editable: where a unit is, the site it sits at, its street
-- address (which puts its pin on the map) and its public IP. Whether a camera is
-- online is never editable. An address is saved exactly as typed. When the
-- address service can locate it the map point is saved with it; when it cannot,
-- the address is saved without a point (James, 2026-11-13: "it should update
-- what i say"). The database does not geocode; it checks any point is real.
--
-- Append-only. A correction or a withdrawal is a new row, never an update or a
-- delete. The request id is the primary key, so the same request recorded twice
-- is the same edit.
begin;

create schema if not exists cos_fleet_hand_edit_private;

create table if not exists cos_fleet_hand_edit_private.unit_status_edit_log(
 id uuid primary key,
 seq bigint generated always as identity unique,
 organization_id uuid not null,
 unit_key text not null check(btrim(unit_key)<>'' and length(unit_key)<=120),
 field text not null check(field in('placement','site','address','public_ip')),
 action text not null check(action in('set','clear')),
 value text check(value is null or length(value)<=200),
 provider_value text check(provider_value is null or length(provider_value)<=200),
 actor uuid not null,
 actor_name text not null check(btrim(actor_name)<>'' and length(actor_name)<=120),
 actor_role text not null check(actor_role in('owner','it')),
 reason text check(reason is null or (btrim(reason)<>'' and length(reason)<=400)),
 latitude double precision check(latitude is null or latitude between -90 and 90),
 longitude double precision check(longitude is null or longitude between -180 and 180),
 matched_address text check(matched_address is null or (btrim(matched_address)<>'' and length(matched_address)<=200)),
 recorded_at timestamptz not null default clock_timestamp(),
 check((action='set')=(value is not null)),
 -- Only a set address may carry a map point, and a point is always both numbers.
 -- An address the service could not locate is still saved, without a point.
 constraint unit_status_edit_log_point_rule check((latitude is null)=(longitude is null) and (latitude is null or (field='address' and action='set'))),
 check(matched_address is null or latitude is not null),
 check(field<>'placement' or value is null or value in('FIELD','SHOP'))
);
comment on table cos_fleet_hand_edit_private.unit_status_edit_log is
 'Append-only hand edits to unit camera status by the Owner or verified IT. Never updated or deleted; a correction is a new row.';

create index if not exists unit_status_edit_log_lookup_idx
 on cos_fleet_hand_edit_private.unit_status_edit_log(organization_id,unit_key,field,seq desc);

create or replace function cos_fleet_hand_edit_private.unit_status_edit_append_only()
returns trigger language plpgsql as $$
begin raise exception 'Unit status hand edits are append-only; record a new edit instead' using errcode='PT409'; end;
$$;
drop trigger if exists unit_status_edit_log_no_change on cos_fleet_hand_edit_private.unit_status_edit_log;
create trigger unit_status_edit_log_no_change
 before update or delete on cos_fleet_hand_edit_private.unit_status_edit_log
 for each row execute function cos_fleet_hand_edit_private.unit_status_edit_append_only();

-- The latest edit per unit and field. Replaced edits stay on the record.
create or replace function cos_fleet_hand_edit_private.unit_status_edit_current(p_organization_id uuid)
returns setof cos_fleet_hand_edit_private.unit_status_edit_log
language sql stable as $$
 select distinct on (upper(btrim(unit_key)),field) *
 from cos_fleet_hand_edit_private.unit_status_edit_log
 where organization_id=p_organization_id
 order by upper(btrim(unit_key)),field,seq desc;
$$;

create or replace function public.cos_camera_unit_hand_edit_state_v1(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public,cos_fleet_hand_edit_private,app_private as $$
declare rows jsonb;
begin
 -- Owner or verified IT. A read is not a write, so the write flag stays false.
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
 select coalesce(jsonb_agg(jsonb_build_object(
   'unit_key',upper(btrim(e.unit_key)),'field',e.field,'action',e.action,'value',e.value,
   'provider_value',e.provider_value,'actor_name',e.actor_name,'actor_role',e.actor_role,
   'reason',e.reason,'created_at',e.recorded_at,
   'latitude',e.latitude,'longitude',e.longitude,'matched_address',e.matched_address) order by upper(btrim(e.unit_key)),e.field),'[]'::jsonb)
 into rows from cos_fleet_hand_edit_private.unit_status_edit_current(p_organization_id) e;
 return jsonb_build_object('contract','COS_UNIT_STATUS_HAND_EDITS_V1','edits',rows);
end;$$;

create or replace function public.cos_camera_unit_hand_edit_v1(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,cos_fleet_hand_edit_private,app_private as $$
declare unit text; f text; act text; val text; prov text; who text; role_name text; why text; lat double precision; lng double precision; matched text; seen cos_fleet_hand_edit_private.unit_status_edit_log;
begin
 -- Owner or verified IT, the same people who may already edit Fleet placement.
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
  raise exception 'Hand edit is incomplete' using errcode='PT409'; end if;
 unit:=btrim(coalesce(p_payload->>'unitKey',''));
 f:=coalesce(p_payload->>'field','');
 act:=coalesce(nullif(btrim(coalesce(p_payload->>'action','')),''),'set');
 val:=nullif(btrim(coalesce(p_payload->>'value','')),'');
 prov:=nullif(btrim(coalesce(p_payload->>'providerValue','')),'');
 who:=btrim(coalesce(p_payload->>'actorName',''));
 role_name:=coalesce(p_payload->>'actorRole','');
 why:=nullif(btrim(coalesce(p_payload->>'reason','')),'');
 matched:=nullif(btrim(coalesce(p_payload->>'matchedAddress','')),'');
 if jsonb_typeof(p_payload->'latitude')='number' and jsonb_typeof(p_payload->'longitude')='number' then
  lat:=(p_payload->>'latitude')::double precision; lng:=(p_payload->>'longitude')::double precision;
 elsif p_payload ? 'latitude' or p_payload ? 'longitude' then
  raise exception 'A map point is two numbers' using errcode='PT409';
 end if;
 if unit='' or length(unit)>120 or f not in('placement','site','address','public_ip') or act not in('set','clear')
  or who='' or length(who)>120 or role_name not in('owner','it')
  or (why is not null and length(why)>400) or (val is not null and length(val)>200) then
  raise exception 'Hand edit is incomplete' using errcode='PT409'; end if;
 if act='set' and val is null then raise exception 'A value is required' using errcode='PT409'; end if;
 if act='clear' and val is not null then raise exception 'Clearing a hand edit does not take a value' using errcode='PT409'; end if;
 if act='set' and f='placement' then
  val:=upper(val);
  if val not in('FIELD','SHOP') then raise exception 'A unit is either in the FIELD or in the SHOP' using errcode='PT409'; end if;
 end if;
 if act='set' and f='site' then
  if length(val)>120 or lower(val) in('root','shop') then raise exception 'Enter a customer and site; root is not a site name' using errcode='PT409'; end if;
 end if;
 if f='address' and act='set' then
  if lat is not null and (lat not between -90 and 90 or lng not between -180 and 180 or (lat=0 and lng=0)) then
   raise exception 'That is not a usable map point' using errcode='PT409'; end if;
  if lat is null and matched is not null then raise exception 'A matched address needs its map point' using errcode='PT409'; end if;
  if matched is not null and length(matched)>200 then raise exception 'Hand edit is incomplete' using errcode='PT409'; end if;
 elsif lat is not null or lng is not null or matched is not null then
  raise exception 'Only a set address carries a map point' using errcode='PT409';
 end if;
 if act='set' and f='public_ip' then
  if val!~'^([0-9]{1,3}\.){3}[0-9]{1,3}$' then raise exception 'Enter a public IPv4 address' using errcode='PT409'; end if;
  begin
   if host(val::inet)<>val or val::inet<<=any(array['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','127.0.0.0/8','169.254.0.0/16','100.64.0.0/10','0.0.0.0/8','224.0.0.0/3']::inet[]) then
    raise exception 'Enter a public IPv4 address' using errcode='PT409'; end if;
  exception when invalid_text_representation then raise exception 'Enter a public IPv4 address' using errcode='PT409'; end;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('cos_camera_unit_hand_edit',0));
 select * into seen from cos_fleet_hand_edit_private.unit_status_edit_log where id=p_request_id;
 if found then
  -- The same request sent twice is the same edit; a different one is a mistake.
  if seen.organization_id=p_organization_id and seen.actor=p_actor_user_id and upper(btrim(seen.unit_key))=upper(unit)
   and seen.field=f and seen.action=act and seen.value is not distinct from val
   and seen.latitude is not distinct from lat and seen.longitude is not distinct from lng then
   return jsonb_build_object('contract','COS_UNIT_STATUS_HAND_EDIT_RESULT_V1','id',seen.id,'applied',false,'repeat',true);
  end if;
  raise exception 'Request id was already used for a different edit' using errcode='PT409';
 end if;
 insert into cos_fleet_hand_edit_private.unit_status_edit_log(
   id,organization_id,unit_key,field,action,value,provider_value,actor,actor_name,actor_role,reason,latitude,longitude,matched_address)
 values (p_request_id,p_organization_id,unit,f,act,val,prov,p_actor_user_id,who,role_name,why,lat,lng,matched);
 return jsonb_build_object('contract','COS_UNIT_STATUS_HAND_EDIT_RESULT_V1','id',p_request_id,'applied',true,'repeat',false,
   'unit',upper(unit),'field',f,'action',act,'value',val,'latitude',lat,'longitude',lng);
end;$$;

revoke all on schema cos_fleet_hand_edit_private from anon,authenticated;
revoke all on cos_fleet_hand_edit_private.unit_status_edit_log from anon,authenticated,service_role;
revoke all on function public.cos_camera_unit_hand_edit_state_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cos_camera_unit_hand_edit_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant usage on schema cos_fleet_hand_edit_private to service_role;
grant execute on function public.cos_camera_unit_hand_edit_state_v1(uuid,uuid) to service_role;
grant execute on function public.cos_camera_unit_hand_edit_v1(uuid,uuid,uuid,jsonb) to service_role;

commit;
