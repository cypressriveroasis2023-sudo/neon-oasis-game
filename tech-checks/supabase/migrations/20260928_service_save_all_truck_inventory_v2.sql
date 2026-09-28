create or replace function public.service_save_my_truck_inventory_v2(
  p_units jsonb,
  p_sims jsonb,
  p_recon_battery_qty integer,
  p_agm_12v_110ah_qty integer,
  p_litime_12v_100ah_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $body$
declare
  v_name text;
  v_type text;
  v_slot integer;
  v_value text;
begin
  perform public.require_role(array['service'::public.app_role]);

  select coalesce(full_name,username,'Service Tech')
  into v_name
  from public.profiles
  where user_id=auth.uid() and active=true and role::text='service';

  if v_name is null then
    raise exception 'Active Service Tech account required.';
  end if;

  if coalesce(p_recon_battery_qty,-1)<0
     or coalesce(p_agm_12v_110ah_qty,-1)<0
     or coalesce(p_litime_12v_100ah_qty,-1)<0 then
    raise exception 'Enter valid battery quantities before saving.';
  end if;

  perform public.ensure_service_truck_baseline_v1(auth.uid());

  foreach v_type in array array['Sniper','Ranger','Spotter','Solar Spotter']
  loop
    v_value:=nullif(btrim(coalesce(p_units->>v_type,'')),'');
    if v_value is not null and exists(
      select 1
      from public.service_truck_units u
      where u.service_tech_id<>auth.uid()
        and u.status='assigned'
        and lower(btrim(coalesce(u.unit_tag,'')))=lower(v_value)
    ) then
      raise exception 'Unit % is already assigned to another Service truck.',v_value;
    end if;

    update public.service_truck_units
    set unit_tag=v_value,
        status=case when v_value is null then 'unassigned' else 'assigned' end,
        assigned_by=auth.uid(),
        assigned_by_name=v_name,
        assigned_at=now(),
        updated_at=now()
    where service_tech_id=auth.uid() and equipment_type=v_type;
  end loop;

  for v_slot in 1..3
  loop
    v_value:=nullif(btrim(coalesce(p_sims->>(v_slot::text),'')),'');
    if v_value is not null and exists(
      select 1
      from public.service_truck_sims s
      where s.status='assigned'
        and lower(btrim(coalesce(s.sim_number,'')))=lower(v_value)
        and not(s.service_tech_id=auth.uid() and s.slot_no=v_slot)
    ) then
      raise exception 'SIM % is already assigned to another Service truck slot.',v_value;
    end if;

    update public.service_truck_sims
    set sim_number=v_value,
        status=case when v_value is null then 'unassigned' else 'assigned' end,
        assigned_by=auth.uid(),
        assigned_by_name=v_name,
        assigned_at=now(),
        updated_at=now()
    where service_tech_id=auth.uid() and slot_no=v_slot;
  end loop;

  update public.service_truck_stock
  set recon_battery_qty=p_recon_battery_qty,
      agm_12v_110ah_qty=p_agm_12v_110ah_qty,
      litime_12v_100ah_qty=p_litime_12v_100ah_qty,
      updated_by=auth.uid(),
      updated_by_name=v_name,
      updated_at=now()
  where service_tech_id=auth.uid();

  update public.service_truck_inventory_checks
  set ready=false,updated_at=now()
  where service_tech_id=auth.uid()
    and check_date=timezone('America/Chicago',now())::date;

  perform public.close_stale_service_truck_restock_requests_v1();

  return public.service_departure_readiness_v1(auth.uid());
end
$body$;

revoke all on function public.service_save_my_truck_inventory_v2(jsonb,jsonb,integer,integer,integer) from public,anon;
grant execute on function public.service_save_my_truck_inventory_v2(jsonb,jsonb,integer,integer,integer) to authenticated;