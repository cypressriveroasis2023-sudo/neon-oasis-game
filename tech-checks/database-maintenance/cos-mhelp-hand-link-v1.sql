-- A# links by hand from the COS unit card (Tech Check project, goqrnolcvqnirjmzaeyk).
--
-- James, 2026-11-25: "it says it doesnt have an a# but i cant add it manualy" ... "build a# button".
--
-- Two functions, both for an active Owner or approved IT only
-- (app_private.cos_verified_fleet_actor(auth.uid()), the rule cos-hand-address-lookup uses):
--   cos_mhelp_hand_link_state_v1()  every unit's A# link, so the card knows a unit's A#
--   cos_mhelp_hand_link_v1(...)     link one COS unit to one mHelp A#, by hand
--
-- A link is written to app_private.cos_mhelp_unit_link with decided_by='hand' and who/when in
-- agreement. The A# must be on the mHelp list COS holds (app_private.cos_mhelp_field_list). A unit
-- that already has an A#, or an A# already linked to another unit, is refused with the reason.
-- A single-camera unit's camera also carries the A# (as cos_mhelp_unit_link_apply does); a
-- multi-camera unit is linked at unit level only, because camera_devices.mhelp_product_id is unique.
-- Nothing is written to camera_inventory_audit, so the camera sweep's allow-list is untouched.
begin;

create or replace function public.cos_mhelp_hand_link_state_v1()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not app_private.cos_verified_fleet_actor(auth.uid()) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  return jsonb_build_object('contract','COS_MHELP_HAND_LINKS_V1','links',
    coalesce((select jsonb_agg(jsonb_build_object('unitKey',l.unit_key,'productId',l.mhelp_product_id,'label',l.mhelp_label,'by',l.decided_by) order by l.unit_key)
              from app_private.cos_mhelp_unit_link l), '[]'::jsonb));
end;
$$;

create or replace function public.cos_mhelp_hand_link_v1(p_unit_key text, p_product_id text, p_actor_name text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare uid uuid := auth.uid(); unit text := btrim(coalesce(p_unit_key,'')); pid text := btrim(coalesce(p_product_id,''));
  who text := btrim(coalesce(p_actor_name,'')); rec record; held text; owner_unit text; cams int; stamped int := 0;
begin
  if not app_private.cos_verified_fleet_actor(uid) then
    raise exception 'An active Owner or approved IT account is required' using errcode='42501'; end if;
  if unit='' or length(unit)>120 or who='' or length(who)>120 then
    raise exception 'The A# link is incomplete' using errcode='PT409'; end if;
  if pid !~ '^[1-9][0-9]{0,14}$' then
    raise exception 'An A# is the number from mHelp, digits only' using errcode='PT409'; end if;
  select count(*) into cams from public.camera_devices d where d.unit_key=unit and d.activation_state='active';
  if cams=0 then raise exception 'COS has no cameras for %', unit using errcode='PT409'; end if;
  select f.unit_number, f.placement, f.placement_observed_at into rec from app_private.cos_mhelp_field_list f where f.mhelp_product_id=pid;
  if not found then raise exception 'A# % is not on the mHelp list COS holds. Check the number in mHelp.', pid using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cos_mhelp_hand_link',0));
  select l.mhelp_product_id into held from app_private.cos_mhelp_unit_link l where l.unit_key=unit;
  if found then
    if held=pid then return jsonb_build_object('contract','COS_MHELP_HAND_LINK_RESULT_V1','unitKey',unit,'productId',pid,'label',rec.unit_number,'repeat',true,'cameraRows',0); end if;
    raise exception '% already has A# %. Ask the manager to change it.', unit, held using errcode='PT409';
  end if;
  select l.unit_key into owner_unit from app_private.cos_mhelp_unit_link l where l.mhelp_product_id=pid;
  if found then raise exception 'A# % is already linked to %.', pid, owner_unit using errcode='PT409'; end if;
  if exists(select 1 from public.camera_devices d where d.mhelp_product_id=pid and d.unit_key<>unit) then
    raise exception 'A# % is already on another unit''s camera.', pid using errcode='PT409'; end if;
  insert into app_private.cos_mhelp_unit_link(unit_key,mhelp_product_id,mhelp_label,placement,placement_observed_at,decided_by,agreement,linked_at,refreshed_at)
  values(unit,pid,rec.unit_number,rec.placement,rec.placement_observed_at,'hand',
    jsonb_build_object('basis','set by hand on the COS unit card','approved_by',who,'approved_user',uid,'decided_at',now()),now(),now());
  if cams=1 then
    update public.camera_devices d set mhelp_product_id=pid
     where d.unit_key=unit and d.activation_state='active' and d.mhelp_product_id is null;
    get diagnostics stamped = row_count;
  end if;
  return jsonb_build_object('contract','COS_MHELP_HAND_LINK_RESULT_V1','unitKey',unit,'productId',pid,'label',rec.unit_number,'repeat',false,'cameraRows',stamped);
end;
$$;

revoke all on function public.cos_mhelp_hand_link_state_v1() from public, anon;
revoke all on function public.cos_mhelp_hand_link_v1(text,text,text) from public, anon;
grant execute on function public.cos_mhelp_hand_link_state_v1() to authenticated, service_role;
grant execute on function public.cos_mhelp_hand_link_v1(text,text,text) to authenticated, service_role;

commit;

-- Rollback:
-- drop function if exists public.cos_mhelp_hand_link_v1(text,text,text);
-- drop function if exists public.cos_mhelp_hand_link_state_v1();
-- delete from app_private.cos_mhelp_unit_link where decided_by='hand' and agreement->>'basis'='set by hand on the COS unit card';
