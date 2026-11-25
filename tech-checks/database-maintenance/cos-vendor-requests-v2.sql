-- COS vendor emails, v2 (25 Nov 2026, James): the Eyeforce account add and unit swap become the full
-- Eyeforce CIF form, and approved IT may fill and send those two (the Owner still sends everything).
--   * cos_vendor_actor_v1 also answers 'fleet' (the Owner or approved IT, the same rule as the board).
--   * cos_vendor_unit_cameras_v1 lists a unit's active cameras so the form's camera tab starts filled in.
--   * cos_vendor_log_secret_v1 hands the function the camera cron secret, so it can ask the Operations function
--     cos-deactivation-log to add the cancellation row as the COS service account (James's own Google sign-in
--     cannot write that sheet; the service account's key stays in Operations).
-- Both are service_role only; the edge function cos-vendor-request is the only caller.
-- Camera passwords are never stored: the function replaces them with '(given)' before it records a request.
-- Rollback: re-run cos-vendor-requests-v1.sql (actor without 'fleet') and
--   drop function public.cos_vendor_unit_cameras_v1(text); drop function public.cos_vendor_log_secret_v1();

create or replace function public.cos_vendor_actor_v1(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('owner', coalesce(bool_or(p.role::text = 'owner' and p.active and p.archived_at is null), false),
                            'fleet', coalesce(app_private.cos_verified_fleet_actor(p_user), false),
                            'name', max(coalesce(nullif(p.full_name,''), p.username)))
  from public.profiles p where p.user_id = p_user
$$;

-- The unit's cameras, in name order: name, type, public IP, the forwarded ports, serial.
-- Port rule of the camera units: local 192.168.10.N is forwarded as N*100 (web) and N*100+54 (RTSP).
create or replace function public.cos_vendor_unit_cameras_v1(p_unit text) returns jsonb
language sql stable security definer set search_path='' as $$
  with u as (select regexp_replace(upper(coalesce(p_unit,'')), '[^A-Z0-9]', '', 'g') k),
  c as (
    select d.device_name, d.device_serial, d.device_model, d.device_type, host(d.public_ip) ip,
           nullif(substring(d.source_metadata->>'localIp' from '^192\.168\.10\.(\d{1,3})$'), '')::int oct
    from public.camera_devices d, u
    where u.k <> '' and regexp_replace(upper(coalesce(d.unit_key,'')), '[^A-Z0-9]', '', 'g') = u.k
      and coalesce(d.activation_state,'active') <> 'deactivated' and coalesce(d.do_not_use,false) = false)
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', device_name,
      'type', case when upper(device_type) = 'NVR' then 'NVR' when device_model ilike '%-PZ%' then 'PTZ Camera' else 'IP Camera' end,
      'ip', coalesce(ip, ''),
      'port', case when oct between 10 and 99 then (oct*100)::text || ' web, ' || (oct*100+54)::text || ' RTSP' else '' end,
      'serial', coalesce(device_serial, '')) order by device_name), '[]'::jsonb)
  from (select * from c order by device_name limit 16) x
$$;

create or replace function public.cos_vendor_log_secret_v1() returns text
language plpgsql stable security definer set search_path='' as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'camera_health_cron_secret' limit 1);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.cos_vendor_actor_v1(uuid)','public.cos_vendor_unit_cameras_v1(text)','public.cos_vendor_log_secret_v1()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;
