-- Moved in VCC: camera records COS holds that no longer match VCC (Tech Check project, goqrnolcvqnirjmzaeyk).
--
-- James, 2026-11-25: Spotter 265 was split into four cameras and one of them had been 253's CAM 1. VCC was
-- right; COS kept the old name and unit, never added the new camera, and kept the old NVR. The VCC sync
-- deliberately never moves, adds or turns off a camera record by itself, so this lists what VCC now says
-- differently and lets the Owner or approved IT apply one item at a time ("build move in VCC").
--
--   cos_vcc_moves_state_v1()            the list, worked out fresh from the last full VCC sync
--   cos_vcc_move_apply_v1(key, name)    apply one listed item, only if it is still listed and safe
--
-- Three kinds, VCC cameras only (source = 'vigilant_control_center'):
--   moved  VCC names a camera for a different unit number than COS has it under. One tap moves it to that
--          unit, with VCC's name, when exactly one COS unit has that family and number.
--   new    VCC has a camera COS has never matched. One tap adds it to the unit its name gives, when exactly
--          one COS unit has that family and number; its other fields are copied from that unit's camera.
--   gone   a full account sync has not seen the camera for 12 hours. One tap turns its record off
--          (activation_state = 'deactivated', the state the board already hides).
-- Anything with no single unit to go to is listed for a person to check, with no button.
--
-- Spotter, Solar Spotter and SS Hybrid count as one family here: VCC calls 253 "Spotter 253 (Solar
-- Compatible)" while COS calls it SOLARSPOTTER 253, so a family difference alone is never a move.
--
-- Every apply saves the row before and after, who and when, in app_private.cos_vcc_move_log. Nothing is
-- written to camera_inventory_audit, so the camera sweep's allow-list is untouched.
--
-- Rollback:
--   drop function if exists public.cos_vcc_move_apply_v1(text, text);
--   drop function if exists public.cos_vcc_moves_state_v1();
--   drop function if exists app_private.cos_vcc_moves_compute();
--   drop function if exists app_private.cos_vcc_unit_of(text);
--   (keep app_private.cos_vcc_move_log: it is the record of what was applied and how to undo each one)
begin;

create table if not exists app_private.cos_vcc_move_log (
  id bigint generated always as identity primary key,
  move_key text not null,
  kind text not null check (kind in ('moved','new','gone')),
  camera_device_id bigint,
  before_row jsonb,
  after_row jsonb,
  actor_user uuid not null,
  actor_name text not null,
  applied_at timestamptz not null default now()
);
revoke all on app_private.cos_vcc_move_log from public, anon, authenticated;

-- "Spotter 265 (Solar Compatible) CAM 4" -> spotter|265; "SOLARSPOTTER 029" -> spotter|29; "Helios 017 Cam 001" -> helios|17.
create or replace function app_private.cos_vcc_unit_of(p_name text)
returns text language sql immutable set search_path to '' as $$
  with n as (select upper(regexp_replace(coalesce(p_name,''),'\s+',' ','g')) s)
  select case
    when s ~ '(HELIOS|ALPHA)\s*_?\s*\d' then 'helios|'||(substring(s from '(?:HELIOS|ALPHA)\s*_?\s*(\d+)'))::int
    when s ~ 'RANGER\s*_?\s*\d' then 'ranger|'||(substring(s from 'RANGER\s*_?\s*(\d+)'))::int
    when s ~ 'SS\s*HYBRID\s*_?\s*\d' then 'spotter|'||(substring(s from 'SS\s*HYBRID\s*_?\s*(\d+)'))::int
    when s ~ 'SOLAR\s*SPOTTER\s*_?\s*\d' then 'spotter|'||(substring(s from 'SOLAR\s*SPOTTER\s*_?\s*(\d+)'))::int
    when s ~ '^SS\s*_?\s*\d' then 'spotter|'||(substring(s from '^SS\s*_?\s*(\d+)'))::int
    when s ~ 'SPOTTER\s*(?:_?NVR)?\s*_?\s*\d' then 'spotter|'||(substring(s from 'SPOTTER\s*(?:_?NVR)?\s*_?\s*(\d+)'))::int
    when s ~ '^SP\s*\d' then 'spotter|'||(substring(s from '^SP\s*(\d+)'))::int
    else null end
  from n;
$$;

create or replace function app_private.cos_vcc_moves_compute()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare meta jsonb; synced timestamptz; fresh boolean; items jsonb := '[]'::jsonb;
begin
  select i.metadata, i.last_sync_at into meta, synced from public.camera_integrations i where i.provider='vigilant';
  -- Only a recent, complete, whole-account sync is evidence that VCC has or lacks a camera.
  fresh := synced is not null and synced > now() - interval '2 hours'
           and coalesce(meta->>'inventory_scope','')='account' and coalesce((meta->>'account_inventory_complete')::boolean,false);
  if not fresh then
    return jsonb_build_object('fresh',false,'syncedAt',synced,'items','[]'::jsonb);
  end if;

  with units as (
    select d.unit_key, app_private.cos_vcc_unit_of(d.unit_key) uk, count(*) cams
      from public.camera_devices d
     where d.source='vigilant_control_center' and d.activation_state='active' and d.unit_key is not null
     group by d.unit_key
  ), targets as (
    select uk, min(unit_key) unit_key, count(*) n from units where uk is not null group by uk
  ), moved as (
    select d.id, d.device_serial, d.unit_key, d.device_name, d.vigilant_status,
           regexp_replace(btrim(d.source_metadata->>'resourceName'),'\s+',' ','g') vname,
           d.source_metadata->>'organizationId' site,
           app_private.cos_vcc_unit_of(d.source_metadata->>'resourceName') vk
      from public.camera_devices d
     where d.source='vigilant_control_center' and d.activation_state='active'
       and d.source_metadata->>'identityStatus'='verified' and d.source_last_seen_at >= synced - interval '10 minutes'
  )
  select coalesce(jsonb_agg(x order by x->>'kind', x->>'vccName'),'[]'::jsonb) into items from (
    -- moved
    select jsonb_build_object('key','moved:'||lower(m.device_serial),'kind','moved','cameraId',m.id,'serial',m.device_serial,
             'vccName',m.vname,'cosName',m.device_name,'fromUnit',m.unit_key,'toUnit',t.unit_key,'status',m.vigilant_status,'site',m.site,
             'canApply',coalesce(t.n,0)=1,
             'why',case when coalesce(t.n,0)=1 then 'VCC names this camera for '||t.unit_key||'. COS has it under '||m.unit_key||'.'
                        when coalesce(t.n,0)=0 then 'VCC names this camera for a unit COS does not have. Check it in VCC.'
                        else 'More than one COS unit has that number. Check it in VCC.' end) x
      from moved m left join targets t on t.uk=m.vk
     where m.vk is not null and app_private.cos_vcc_unit_of(m.unit_key) is not null
       and m.vk is distinct from app_private.cos_vcc_unit_of(m.unit_key)
    union all
    -- new: in VCC, never matched to a COS camera
    select jsonb_build_object('key','new:'||lower(r->>'device_serial'),'kind','new','serial',r->>'device_serial',
             'vccName',regexp_replace(btrim(r->>'device_name'),'\s+',' ','g'),'toUnit',t.unit_key,'status',r->>'status',
             'site',r->'provider_resource'->>'organizationId','model',r->'provider_resource'->>'deviceModel',
             'canApply',coalesce(t.n,0)=1 and not exists(select 1 from public.camera_devices d where lower(d.device_serial)=lower(r->>'device_serial')),
             'why',case when coalesce(t.n,0)=1 then 'VCC has this camera on '||t.unit_key||'. COS has no record of it.'
                        when app_private.cos_vcc_unit_of(r->>'device_name') is null then 'Its VCC name gives no unit. Name it in VCC (for example "Spotter 265 CAM 1").'
                        when coalesce(t.n,0)=0 then 'VCC names it for a unit COS does not have. Check it in VCC.'
                        else 'More than one COS unit has that number. Check it in VCC.' end) x
      from jsonb_array_elements(coalesce(meta->'unmatched_resources','[]'::jsonb)) r
      left join targets t on t.uk=app_private.cos_vcc_unit_of(r->>'device_name')
     where coalesce(r->>'device_serial','')<>''
    union all
    -- gone: not seen by any full account sync for 12 hours
    select jsonb_build_object('key','gone:'||lower(d.device_serial),'kind','gone','cameraId',d.id,'serial',d.device_serial,
             'cosName',d.device_name,'fromUnit',d.unit_key,'status',d.vigilant_status,'seenAt',d.source_last_seen_at,'canApply',true,
             'why','VCC has not listed this camera since '||to_char(d.source_last_seen_at at time zone 'America/Chicago','Mon DD HH12:MI AM')||'. It may have been removed or replaced in VCC.') x
      from public.camera_devices d
     where d.source='vigilant_control_center' and d.activation_state='active'
       and (d.source_last_seen_at is null or d.source_last_seen_at < synced - interval '12 hours')
  ) q;
  return jsonb_build_object('fresh',true,'syncedAt',synced,'items',items);
end;
$$;
revoke all on function app_private.cos_vcc_moves_compute() from public, anon, authenticated;

create or replace function public.cos_vcc_moves_state_v1()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare c jsonb;
begin
  if not app_private.cos_verified_fleet_actor(auth.uid()) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  c := app_private.cos_vcc_moves_compute();
  return jsonb_build_object('contract','COS_VCC_MOVES_V1','fresh',c->'fresh','syncedAt',c->'syncedAt','items',c->'items');
end;
$$;

create or replace function public.cos_vcc_move_apply_v1(p_key text, p_actor_name text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare uid uuid := auth.uid(); k text := lower(btrim(coalesce(p_key,''))); who text := btrim(coalesce(p_actor_name,''));
  c jsonb; it jsonb; before_row public.camera_devices; after_row public.camera_devices; tmpl public.camera_devices; new_id bigint;
begin
  if not app_private.cos_verified_fleet_actor(uid) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  if k='' or length(k)>200 or who='' or length(who)>120 then raise exception 'The change is incomplete' using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cos_vcc_move',0));
  c := app_private.cos_vcc_moves_compute();
  if not coalesce((c->>'fresh')::boolean,false) then
    raise exception 'The last VCC read is too old to act on. Try again after the next VCC sync.' using errcode='PT409'; end if;
  select x into it from jsonb_array_elements(c->'items') x where x->>'key'=k;
  if it is null then raise exception 'This is no longer listed. VCC and COS may already agree; tap Refresh.' using errcode='PT409'; end if;
  if not coalesce((it->>'canApply')::boolean,false) then raise exception '%', it->>'why' using errcode='PT409'; end if;

  if it->>'kind'='moved' then
    select * into before_row from public.camera_devices where id=(it->>'cameraId')::bigint for update;
    select * into tmpl from public.camera_devices d where d.source='vigilant_control_center' and d.activation_state='active'
       and d.unit_key=it->>'toUnit' order by d.id desc limit 1;
    update public.camera_devices d set unit_key=it->>'toUnit', device_name=it->>'vccName',
        tech_check_unit_type=coalesce(tmpl.tech_check_unit_type,d.tech_check_unit_type),
        mhelp_product_id=null, updated_at=now()
     where d.id=before_row.id returning * into after_row;
  elsif it->>'kind'='new' then
    select * into tmpl from public.camera_devices d where d.source='vigilant_control_center' and d.activation_state='active'
       and d.unit_key=it->>'toUnit' order by d.id desc limit 1;
    insert into public.camera_devices (source,unit_key,device_name,device_type,device_model,device_owner,organization,device_serial,external_device_id,
        activation_state,activation_source,monitoring_enabled,monitoring_profile,expected_ports,port_labels,tech_check_unit_type,source_imported_at)
    values ('vigilant_control_center',it->>'toUnit',it->>'vccName',tmpl.device_type,coalesce(it->>'model',tmpl.device_model),tmpl.device_owner,tmpl.organization,
        it->>'serial',it->>'serial','active','vcc_move_hand',true,tmpl.monitoring_profile,tmpl.expected_ports,'{}'::jsonb,tmpl.tech_check_unit_type,now())
    returning * into after_row;
  elsif it->>'kind'='gone' then
    select * into before_row from public.camera_devices where id=(it->>'cameraId')::bigint for update;
    update public.camera_devices d set activation_state='deactivated', updated_at=now() where d.id=before_row.id returning * into after_row;
  else
    raise exception 'Unknown change' using errcode='PT409';
  end if;

  insert into app_private.cos_vcc_move_log(move_key,kind,camera_device_id,before_row,after_row,actor_user,actor_name)
  values (k, it->>'kind', after_row.id, case when before_row.id is null then null else to_jsonb(before_row) end, to_jsonb(after_row), uid, who);
  return jsonb_build_object('contract','COS_VCC_MOVE_RESULT_V1','key',k,'kind',it->>'kind','cameraId',after_row.id,
    'unit',after_row.unit_key,'name',after_row.device_name,'state',after_row.activation_state);
end;
$$;

revoke all on function public.cos_vcc_moves_state_v1() from public, anon;
revoke all on function public.cos_vcc_move_apply_v1(text,text) from public, anon;
grant execute on function public.cos_vcc_moves_state_v1() to authenticated, service_role;
grant execute on function public.cos_vcc_move_apply_v1(text,text) to authenticated, service_role;

commit;
