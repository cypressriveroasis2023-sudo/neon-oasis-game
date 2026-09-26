CREATE OR REPLACE FUNCTION public.accept_helios_handoff_v1(p_prep_id uuid, p_verifications jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role public.app_role; v_status public.prep_status; v_item record; v_verify jsonb; v_actual int; v_required int;
  v_it_photos int; v_service_photos int; v_parts_total int; v_parts_confirmed boolean; v_name text;
begin
  v_role:=public.current_app_role();
  if v_role not in ('service'::public.app_role,'owner'::public.app_role) then raise exception 'Service or Owner access required'; end if;
  select status,(solar_panel_qty+battery_replacement_qty+camera_replacement_qty+sim_replacement_qty+micro_sd_qty),service_parts_confirmed
  into v_status,v_parts_total,v_parts_confirmed from public.prep_tickets where id=p_prep_id;
  if not found or v_status<>'released' then raise exception 'Service handoff not found or no longer waiting for Service'; end if;
  if not exists(select 1 from public.prep_items where prep_ticket_id=p_prep_id and equipment_type='Helios' and purpose in ('DELIVERY','SWAP')) then raise exception 'This handoff does not require the Helios field workflow'; end if;
  if coalesce(v_parts_total,0)>0 and not coalesce(v_parts_confirmed,false) then raise exception 'Verify the listed parts from IT before accepting this equipment'; end if;
  if jsonb_typeof(p_verifications)<>'array' then raise exception 'Equipment checkout verifications are required'; end if;
  for v_item in select * from public.prep_items where prep_ticket_id=p_prep_id order by item_order loop
    select value into v_verify from jsonb_array_elements(p_verifications) where value->>'item_id'=v_item.id::text limit 1;
    if v_verify is null then raise exception 'Missing equipment checkout verification for item %',v_item.item_order; end if;
    if trim(v_verify->>'unit_tag') is distinct from v_item.unit_tag then raise exception 'Unit tag does not match IT-prepared item %',v_item.item_order; end if;
    v_required:=coalesce(v_item.required_battery_count,0);
    if v_required>0 then
      v_actual:=coalesce((v_verify->>'battery_count')::int,-1);
      if v_actual<>v_item.battery_count or v_actual<v_required then raise exception 'Battery count does not match the IT-prepared item %',v_item.item_order; end if;
      if coalesce((v_verify->>'battery_verified')::boolean,false) is not true then raise exception 'Battery verification is required for item %',v_item.item_order; end if;
    else v_actual:=null; end if;
    if coalesce((v_verify->>'unit_confirmed')::boolean,false) is not true then raise exception 'Exact item confirmation is required for item %',v_item.item_order; end if;
    update public.prep_items set service_battery_count=v_actual,service_unit_confirmed=true,service_verified_by=auth.uid(),service_verified_at=now() where id=v_item.id;
  end loop;
  select count(*) into v_it_photos from public.handoff_evidence where prep_ticket_id=p_prep_id and stage='it' and kind='photo';
  if v_it_photos<1 then raise exception 'IT handoff photo proof is required before Service can accept the equipment'; end if;
  if not exists(select 1 from public.handoff_evidence where prep_ticket_id=p_prep_id and stage='service' and kind='signature') then raise exception 'Service receipt signature is required'; end if;
  if not exists(select 1 from public.service_solar_checks where prep_ticket_id=p_prep_id and completed_at is not null) then raise exception 'Complete the Helios yard solar test before accepting the handoff'; end if;
  if not exists(select 1 from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_yard' and kind='photo') then raise exception 'Helios yard-test photo proof is required'; end if;
  if not exists(select 1 from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_yard' and kind='signature') then raise exception 'Helios yard-test signature is required'; end if;
  v_name:=public.actor_display_name();
  update public.service_solar_checks set handoff_accepted_at=now(),handoff_accepted_by=auth.uid(),handoff_accepted_by_name=v_name,updated_at=now() where prep_ticket_id=p_prep_id;
end;
$function$
