-- The morning list: field units with cameras down, newest first (Tech Check project, goqrnolcvqnirjmzaeyk).
--
-- James, 2026-11-25: "build the morning list". 153 VCC cameras read Offline, but 145 of them sit under VCC's
-- root, which the board already shows as "in the shop, not at the site". This lists only cameras at a site
-- that are down, splits them into "new" (last online within the window, default 24 hours) and "still down",
-- gives a likely cause from the unit's router, and a draft line for the IT sheet. It reads; it changes nothing.
--
--   cos_overnight_v1(p_hours int default 24)   Owner or approved IT only
--
-- Cameras counted:
--   VCC        active, vigilant_status Offline, not under root
--   others     active, monitoring on, not do_not_use, camera_health_current says offline
-- "Down since" is the camera's last time online (VCC last_online_at; otherwise the last successful check).
-- The router is a hint only, as on the unit card. Addresses are never put in the text.
--
-- Rollback:
--   drop function if exists public.cos_overnight_v1(int);
--   drop function if exists app_private.cos_overnight_compute(int);
begin;

create or replace function app_private.cos_overnight_compute(p_hours int)
returns jsonb language sql stable security definer set search_path to '' as $$
  with win as (select now() - make_interval(hours => greatest(1, least(coalesce(p_hours,24), 168))) since),
  down as (
    select d.unit_key, d.id, d.device_name, d.last_online_at down_since
      from public.camera_devices d
     where d.source='vigilant_control_center' and d.activation_state='active' and d.unit_key is not null
       and d.vigilant_status='Offline' and coalesce(d.organization,'')<>'root'
    union all
    select d.unit_key, d.id, d.device_name, coalesce(d.last_probe_online_at, d.last_online_at)
      from public.camera_devices d join public.camera_health_current h on h.camera_device_id=d.id
     where d.source<>'vigilant_control_center' and d.activation_state='active' and d.unit_key is not null
       and d.monitoring_enabled and d.do_not_use is not true and h.overall_status='offline'
  ),
  cams as (
    select unit_key, count(*) total from public.camera_devices d
     where d.activation_state='active' and d.unit_key is not null
       and (d.source<>'vigilant_control_center' or coalesce(d.organization,'')<>'root')
     group by unit_key
  ),
  units as (
    select dn.unit_key, count(*) n_down, max(dn.down_since) newest, min(dn.down_since) oldest,
           jsonb_agg(jsonb_build_object('name',dn.device_name,'downSince',dn.down_since) order by dn.device_name) cameras
      from down dn group by dn.unit_key
  ),
  rows as (
    select u.unit_key, u.n_down, coalesce(c.total,u.n_down) total, u.newest, u.oldest, u.cameras,
           u.newest is not null and u.newest >= (select since from win) is_new,
           r.current_status rstat, r.last_online_at rlast, r.inhand_carrier carrier, r.inhand_signal->>'level' bars
      from units u left join cams c on c.unit_key=u.unit_key
      left join lateral (select * from public.camera_unit_routers r where r.unit_key=u.unit_key order by r.updated_at desc limit 1) r on true
  ),
  told as (
    select x.*,
      case
        when rstat is null then 'No router linked to this unit, so COS cannot tell a router problem from a camera problem. Open the unit and use Check this unit now.'
        when rstat='offline' and rlast is not null and newest is not null and rlast < newest - interval '6 hours' then
          'The router has not reached InHand since '||to_char(rlast at time zone 'America/Chicago','Mon DD')||', long before the cameras stopped, so it does not explain this. Check power and battery first, then Check this unit now.'
        when rstat='offline' then 'The router is offline too: no power or no cell signal at the unit. Check battery and solar first, then the SIM (Coverage map, Downdetector, Simetry).'
        when rstat='online' and n_down>=total then 'The router is online but every camera is down: camera power or the cameras'' link to the router.'
        when rstat='online' then n_down||' of '||total||' cameras down with the router online: that camera''s power or cable. Try a reboot from its Web page.'
        else 'Router state unknown. Open the unit and use Check this unit now.' end cause,
      case when rstat is null then 'no router linked, check the unit'
           when rstat='offline' and rlast is not null and newest is not null and rlast < newest - interval '6 hours' then 'power, check battery first'
           when rstat='offline' then 'power or signal' when rstat='online' and n_down>=total then 'camera power'
           when rstat='online' then 'one camera, reboot it' else 'unknown, check the unit' end cause_short
    from rows x
  )
  select jsonb_build_object(
    'since',(select since from win),
    'items',coalesce(jsonb_agg(jsonb_build_object(
       'unitKey',unit_key,'new',is_new,'down',n_down,'total',total,'downSince',newest,'oldest',oldest,'cameras',cameras,
       'router',jsonb_build_object('status',rstat,'lastOnline',rlast,'carrier',carrier,'bars',bars),
       'cause',cause,
       'sheetLine',unit_key||': '||n_down||' of '||total||' camera'||case when total=1 then '' else 's' end||' offline'
          ||coalesce(' since '||to_char(newest at time zone 'America/Chicago','Mon DD HH12:MI AM'),'')
          ||case when rstat is null then '' else '. Router '||rstat end||'. Likely '||cause_short||'.')
       order by is_new desc, newest desc nulls last, unit_key),'[]'::jsonb))
  from told;
$$;
revoke all on function app_private.cos_overnight_compute(int) from public, anon, authenticated;

create or replace function public.cos_overnight_v1(p_hours int default 24)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not app_private.cos_verified_fleet_actor(auth.uid()) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  return jsonb_build_object('contract','COS_OVERNIGHT_V1') || app_private.cos_overnight_compute(p_hours);
end;
$$;
revoke all on function public.cos_overnight_v1(int) from public, anon;
grant execute on function public.cos_overnight_v1(int) to authenticated, service_role;

commit;
