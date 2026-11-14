-- PREPARED ONLY. Apply after operations/db/20261112_fleet_unit_status_hand_edits.sql.
-- No existing edit or live unit is changed. Deploy the matching handler/UI after this migration.
begin;
alter table cos_fleet_hand_edit_private.unit_status_edit_log add column if not exists address_request jsonb;
-- Preserve the installed non-address implementation, including PR #396's name
-- support if present. The private delegate cannot be called by API roles.
do $$ begin
 if to_regprocedure('cos_fleet_hand_edit_private.unit_status_edit_nonaddress_v1(uuid,uuid,uuid,jsonb)') is null then
  alter function public.cos_camera_unit_hand_edit_v1(uuid,uuid,uuid,jsonb) rename to unit_status_edit_nonaddress_v1;
  alter function public.unit_status_edit_nonaddress_v1(uuid,uuid,uuid,jsonb) set schema cos_fleet_hand_edit_private;
 end if;
end $$;
revoke all on function cos_fleet_hand_edit_private.unit_status_edit_nonaddress_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.cos_camera_unit_hand_edit_state_v1(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public,cos_fleet_hand_edit_private,app_private as $$
declare rows jsonb;
begin
 -- Owner or verified IT. A read is not a write, so the write flag stays false.
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
 select coalesce(jsonb_agg(jsonb_build_object(
   'revision',e.id,'unit_key',upper(btrim(e.unit_key)),'field',e.field,'action',e.action,'value',e.value,
   'provider_value',e.provider_value,'actor_name',e.actor_name,'actor_role',e.actor_role,
   'reason',e.reason,'created_at',e.recorded_at,
   'latitude',e.latitude,'longitude',e.longitude,'matched_address',e.matched_address) order by e.seq),'[]'::jsonb)
 into rows from cos_fleet_hand_edit_private.unit_status_edit_current(p_organization_id) e;
 return jsonb_build_object('contract','COS_UNIT_STATUS_HAND_EDITS_V1','edits',rows);
end;$$;

create or replace function public.cos_camera_unit_hand_edit_v1(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,cos_fleet_hand_edit_private,app_private as $$
declare unit text; f text; act text; val text; prov text; who text; role_name text; why text; lat double precision; lng double precision; matched text; seen cos_fleet_hand_edit_private.unit_status_edit_log; current_address cos_fleet_hand_edit_private.unit_status_edit_log; address_request jsonb;
begin
 -- Non-address behavior is the exact previously installed implementation.
 if coalesce(p_payload->>'field','')<>'address' then
  return cos_fleet_hand_edit_private.unit_status_edit_nonaddress_v1(p_actor_user_id,p_organization_id,p_request_id,p_payload);
 end if;
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
 if unit='' or length(unit)>120 or f not in('placement','site','address','public_ip','camera') or (act not in('set','clear') and not (f='address' and act='clear_pin'))
  or who='' or length(who)>120 or role_name not in('owner','it')
  or (why is not null and length(why)>400) or (val is not null and length(val)>200) then
  raise exception 'Hand edit is incomplete' using errcode='PT409'; end if;
 -- Address operations share the existing transaction lock. The revision is
 -- checked here, after geocoding and immediately before the append, not only in HTTP.
 perform pg_advisory_xact_lock(hashtextextended('cos_camera_unit_hand_edit',0));
 if f='address' then
  if not (p_payload ? 'expectedAddressRevision') or
    (p_payload->'expectedAddressRevision'<>'null'::jsonb and
     coalesce(p_payload->>'expectedAddressRevision','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
   raise exception 'Refresh the saved address before editing it' using errcode='PT409';
  end if;
  address_request:=jsonb_build_object('action',act,'value',p_payload->'value',
   'expectedAddressRevision',p_payload->'expectedAddressRevision','reason',why);
  select * into seen from cos_fleet_hand_edit_private.unit_status_edit_log where id=p_request_id;
  if found then
   if seen.organization_id=p_organization_id and seen.actor=p_actor_user_id
    and upper(btrim(seen.unit_key))=upper(unit) and seen.field=f
    and seen.address_request is not distinct from address_request then
    return jsonb_build_object('contract','COS_UNIT_STATUS_HAND_EDIT_RESULT_V1','id',seen.id,
      'applied',false,'repeat',true,'value',seen.value,'latitude',seen.latitude,'longitude',seen.longitude);
   end if;
   raise exception 'Request id was already used for a different edit' using errcode='PT409';
  end if;
  select * into current_address from cos_fleet_hand_edit_private.unit_status_edit_log
   where organization_id=p_organization_id and upper(btrim(unit_key))=upper(unit) and field='address'
   order by seq desc limit 1;
  if current_address.id::text is distinct from lower(p_payload->>'expectedAddressRevision') then
   raise exception 'The saved address changed. Refresh before editing it' using errcode='PT409';
  end if;
  if act='clear_pin' then
   if val is not null or lat is not null or lng is not null or matched is not null then
    raise exception 'Removing only a pin does not take a value or coordinates' using errcode='PT409';
   end if;
   if current_address.action is distinct from 'set' or current_address.value is null then
    raise exception 'There is no saved address to keep' using errcode='PT409';
   end if;
   -- Keep the exact stored text, including its case and spacing. Earlier rows
   -- and their points remain immutable; address_request records clear_pin.
   val:=current_address.value; act:='set';
  elsif act='set' then
   val:=p_payload->>'value';
  end if;
 end if;
 if act='set' and (val is null or btrim(val)='') then raise exception 'A value is required' using errcode='PT409'; end if;
 if act='clear' and val is not null and f<>'camera' then raise exception 'Clearing a hand edit does not take a value' using errcode='PT409'; end if;
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
   id,organization_id,unit_key,field,action,value,provider_value,actor,actor_name,actor_role,reason,latitude,longitude,matched_address,address_request)
 values (p_request_id,p_organization_id,unit,f,act,val,prov,p_actor_user_id,who,role_name,why,lat,lng,matched,address_request);
 return jsonb_build_object('contract','COS_UNIT_STATUS_HAND_EDIT_RESULT_V1','id',p_request_id,'applied',true,'repeat',false,
   'unit',upper(unit),'field',f,'action',act,'value',val,'latitude',lat,'longitude',lng);
end;$$;

revoke all on function public.cos_camera_unit_hand_edit_state_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cos_camera_unit_hand_edit_v1(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cos_camera_unit_hand_edit_state_v1(uuid,uuid) to service_role;
grant execute on function public.cos_camera_unit_hand_edit_v1(uuid,uuid,uuid,jsonb) to service_role;
commit;
