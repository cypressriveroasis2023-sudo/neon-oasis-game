-- Owner final Helios verification must validate the Service Tech's completed solar checkout/evidence.
CREATE OR REPLACE FUNCTION public.enforce_service_solar_check_before_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_spotters int:=0;
  v_rangers int:=0;
  v_helios int:=0;
  v_check public.service_solar_checks%rowtype;
  v_count int;
  v_actor_role public.app_role;
  v_evidence_actor uuid;
begin
  if new.status::text<>'closed' or old.status::text='closed' then return new; end if;

  select
    count(*) filter(where equipment_type='Solar Spotter' and purpose='DELIVERY'),
    count(*) filter(where equipment_type='Ranger' and purpose='DELIVERY'),
    count(*) filter(where equipment_type='Helios' and purpose='DELIVERY')
  into v_spotters,v_rangers,v_helios
  from public.prep_items
  where prep_ticket_id=new.id;

  if v_spotters+v_rangers+v_helios=0 then return new; end if;

  v_actor_role:=public.current_app_role();

  if v_actor_role='owner'::public.app_role then
    select * into v_check
    from public.service_solar_checks
    where prep_ticket_id=new.id
    order by updated_at desc
    limit 1;
  else
    select * into v_check
    from public.service_solar_checks
    where prep_ticket_id=new.id
      and service_tech_id=auth.uid()
    order by updated_at desc
    limit 1;
  end if;

  if not found or v_check.completed_at is null then
    raise exception 'Complete the Service solar equipment checkout before taking this equipment from the shop.';
  end if;

  v_evidence_actor:=v_check.service_tech_id;

  if v_spotters>0 then
    if v_check.battery_configuration not in ('agm_4x_12v_110ah','single_12v_350ah') then
      raise exception 'Select the Solar Spotter battery configuration.';
    end if;
    if v_check.battery_configuration='agm_4x_12v_110ah' and v_check.battery_count<>v_spotters*4 then
      raise exception 'Solar Spotter requires 4 AGM 12V 110Ah batteries per Solar Stand.';
    end if;
    if v_check.battery_configuration='single_12v_350ah' and v_check.battery_count<>v_spotters then
      raise exception 'Solar Spotter requires 1 12V 350Ah battery per Solar Stand for this selected setup.';
    end if;
    select count(*) into v_count
    from public.service_solar_evidence
    where prep_ticket_id=new.id
      and category='solar_stand'
      and kind='photo'
      and created_by=v_evidence_actor;
    if v_count<v_spotters then
      raise exception 'Take one Solar Stand tag photo for each Solar Spotter stand.';
    end if;
  end if;

  if v_rangers>0 then
    if v_check.solar_panel_count<>v_rangers then
      raise exception 'Ranger requires 1 removable solar panel per Ranger.';
    end if;
    if v_spotters=0 and v_check.battery_configuration<>'litime_1x_12v_110ah' then
      raise exception 'Ranger battery must be LiTime 12V 110Ah.';
    end if;
  end if;

  if v_helios>0 and not coalesce(v_check.helios_battery_box_charging_ok,false) then
    raise exception 'Verify the Helios battery box is charging on the Helios tower/stand.';
  end if;

  select count(*) into v_count
  from public.service_solar_evidence
  where prep_ticket_id=new.id
    and category='mppt'
    and kind='photo'
    and created_by=v_evidence_actor;
  if v_count<1 then raise exception 'Upload a photo of the MPPT / charging readings.'; end if;

  select count(*) into v_count
  from public.service_solar_evidence
  where prep_ticket_id=new.id
    and category='batteries'
    and kind='photo'
    and created_by=v_evidence_actor;
  if v_count<1 then raise exception 'Upload a photo verifying the battery or battery box checkout.'; end if;

  return new;
end
$function$
;
