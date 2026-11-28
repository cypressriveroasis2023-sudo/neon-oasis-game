-- Router swapped: a unit's linked router is offline while an unlinked InHand router named for that unit is online
-- (Tech Check project, goqrnolcvqnirjmzaeyk).
--
-- James, 2026-11-25: "build router swap". Spotter 265 was still linked to its old router (offline) while a newer
-- router named "Spotter 265 (Solar)" was online in InHand but linked to nothing, so the card and the morning list
-- said "router offline". The Link router button refuses a unit that already has a router, so there was no way to
-- record a swap.
--
--   cos_router_swaps_state_v1()           the list (Owner or approved IT)
--   cos_router_swap_apply_v1(key, name)   move the unit's link to the new router, only if still listed
--
-- Listed only when all hold:
--   * the unlinked router is online in the latest InHand pull (pulled within 2 hours). InHand's last_seen is when it
--     last connected, so a router online for days looks old by that field (27 Nov: Spotter 265 dropped off the list);
--   * its name gives a family and number (same reader as Moved in VCC) and is not marked BAD, BROKEN or TEST;
--   * exactly one COS unit with a router row has that family and number;
--   * that unit's linked router is not online.
--
-- The apply writes one camera_inventory_audit row with the existing ADD_ROUTER_LINK action and the same
-- after_state shape the Link router button writes ({camera_unit_routers_id, inhand_serial, router_model}).
-- before_state is {"inhand_serial": <old>, "swap": true}: no "id" and no "public_ip", so the camera sweep's
-- endpoint claims (cos_tracker_endpoint_claims_v1) read nothing new from it and the allow-list is untouched.
-- The old serial is kept in camera_unit_routers.prior_inhand_serial; the router's status fields are cleared
-- so the card waits for the next InHand pull (within 30 minutes) instead of showing the old router's reading.
--
-- Rollback (functions only; a swap already applied is undone by putting prior_inhand_serial back):
--   drop function if exists public.cos_router_swap_apply_v1(text, text);
--   drop function if exists public.cos_router_swaps_state_v1();
--   drop function if exists app_private.cos_router_swaps_compute();
begin;

create or replace function app_private.cos_router_swaps_compute()
returns jsonb language sql stable security definer set search_path to '' as $$
  with cand as (
    select u.serial, u.name, u.model, u.last_seen, app_private.cos_vcc_unit_of(u.name) k
      from inhand_private.unmatched_routers u
     where u.online and u.observed_at > now() - interval '2 hours'
       and upper(u.name) !~ '(BAD|BROKEN|TEST)'
  ), linked as (
    select r.id, r.unit_key, r.inhand_serial, r.current_status, r.last_online_at, app_private.cos_vcc_unit_of(r.unit_key) k
      from public.camera_unit_routers r
     where exists (select 1 from public.camera_devices d where d.unit_key=r.unit_key and d.activation_state='active')
  ), pick as (
    select c.*, (select count(*) from linked l where l.k=c.k) n,
           (select to_jsonb(l) from linked l where l.k=c.k limit 1) l
      from cand c where c.k is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key','swap:'||lower(p.serial),'unit',p.l->>'unit_key','routerId',(p.l->>'id')::bigint,
      'oldSerial',p.l->>'inhand_serial','oldStatus',p.l->>'current_status','oldLastOnline',p.l->>'last_online_at',
      'newSerial',p.serial,'newName',p.name,'newModel',p.model,'newSeen',p.last_seen,
      'why','InHand lists "'||p.name||'" online, linked to nothing. '||(p.l->>'unit_key')||' is still linked to its old router, which is '
            ||coalesce(p.l->>'current_status','not reporting')||'.')
    order by p.l->>'unit_key'),'[]'::jsonb)
  from pick p
  where p.n=1 and coalesce(p.l->>'current_status','')<>'online';
$$;
revoke all on function app_private.cos_router_swaps_compute() from public, anon, authenticated;

create or replace function public.cos_router_swaps_state_v1()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not app_private.cos_verified_fleet_actor(auth.uid()) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  return jsonb_build_object('contract','COS_ROUTER_SWAPS_V1','items',app_private.cos_router_swaps_compute());
end;
$$;

create or replace function public.cos_router_swap_apply_v1(p_key text, p_actor_name text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare uid uuid := auth.uid(); k text := lower(btrim(coalesce(p_key,''))); who text := btrim(coalesce(p_actor_name,''));
  it jsonb; r public.camera_unit_routers; model text;
begin
  if not app_private.cos_verified_fleet_actor(uid) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  if k='' or length(k)>80 or who='' or length(who)>120 then raise exception 'The change is incomplete' using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cos_router_swap',0));
  select x into it from jsonb_array_elements(app_private.cos_router_swaps_compute()) x where x->>'key'=k;
  if it is null then raise exception 'This is no longer listed. The router may already be linked; tap Refresh.' using errcode='PT409'; end if;
  if exists (select 1 from public.camera_unit_routers where upper(btrim(inhand_serial))=upper(it->>'newSerial')) then
    raise exception 'That router is already linked to a unit.' using errcode='PT409'; end if;
  select * into r from public.camera_unit_routers where id=(it->>'routerId')::bigint for update;
  if r.id is null or r.unit_key is distinct from it->>'unit' or coalesce(r.inhand_serial,'') is distinct from coalesce(it->>'oldSerial','') then
    raise exception 'The unit''s router changed while you were looking. Tap Refresh.' using errcode='PT409'; end if;
  model := 'InHand '||coalesce(nullif(it->>'newModel',''),'router');
  update public.camera_unit_routers set prior_inhand_serial=r.inhand_serial, inhand_serial=upper(it->>'newSerial'),
      current_status=null, status_observed_at=null, reported_status='unknown', inhand_public_ip=null, inhand_signal=null,
      inhand_carrier=null, inhand_firmware=null, inhand_gps=null, inhand_details_at=null, updated_at=now()
   where id=r.id;
  delete from inhand_private.unmatched_routers where serial=it->>'newSerial';
  insert into public.camera_inventory_audit (actor_id, actor_name, action, unit_key, device_ids, before_state, after_state, reason, created_at)
  values (uid, left(who,120), 'ADD_ROUTER_LINK', r.unit_key, array[]::bigint[],
          jsonb_build_object('inhand_serial', r.inhand_serial, 'swap', true),
          jsonb_build_object('camera_unit_routers_id', r.id, 'inhand_serial', upper(it->>'newSerial'), 'router_model', model),
          left('Router swapped with Use the new router in COS: '||coalesce(r.inhand_serial,'none')||' -> '||upper(it->>'newSerial'),500), now());
  return jsonb_build_object('contract','COS_ROUTER_SWAP_RESULT_V1','key',k,'unit',r.unit_key,'oldSerial',r.inhand_serial,'newSerial',upper(it->>'newSerial'));
end;
$$;

revoke all on function public.cos_router_swaps_state_v1() from public, anon;
revoke all on function public.cos_router_swap_apply_v1(text,text) from public, anon;
grant execute on function public.cos_router_swaps_state_v1() to authenticated, service_role;
grant execute on function public.cos_router_swap_apply_v1(text,text) to authenticated, service_role;

commit;
