-- Cameras On Site Tech Check
-- Phase 7: Sniper DELIVERY/SWAP parity
-- Owner-taught 2026-09-19.
-- No table/column changes. This records the production function gates that make a
-- Sniper SWAP follow the same customer-deployment readiness checks as DELIVERY.
-- BACKUP remains hardware-ready only; existing Helios/solar/spare gates are preserved.

CREATE OR REPLACE FUNCTION public.enforce_tech_check_transition_v108()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status='released'::public.prep_status and old.status='draft'::public.prep_status then
    if exists(
      select 1 from public.prep_items i
      where i.prep_ticket_id=new.id and i.equipment_type='Helios'
        and i.purpose in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose,'BACKUP'::public.prep_purpose)
        and not(
          coalesce(i.helios_camera1_hardware_ok,false) and coalesce(i.helios_camera2_hardware_ok,false)
          and coalesce(i.helios_ptz_assembly_ok,false) and coalesce(i.helios_proxicast_4x4_ok,false)
          and coalesce(i.helios_router_sim_ok,false) and coalesce(i.helios_speaker_24v_ok,false)
          and coalesce(i.helios_cameras_12v_ok,false) and coalesce(i.helios_ptz_plate_4bolts_ok,false)
          and coalesce(i.helios_cerbo_network_ok,false) and coalesce(i.helios_cerbo_vrm_ok,false)
          and coalesce(i.helios_rear_unit_tag_ok,false) and coalesce(i.helios_battery_box_installed_ok,false)
          and coalesce(i.helios_battery_120v_charged_ok,false) and coalesce(i.helios_camera_router_programming_ok,false)
          and coalesce(i.helios_alibi_vigilant_ok,false) and coalesce(i.helios_3x1tb_sd_ok,false)
          and coalesce(i.helios_camera1_ports_ok,false) and coalesce(i.helios_camera2_ports_ok,false)
          and coalesce(i.helios_ptz_ports_ok,false) and coalesce(i.helios_speaker_ports_ok,false)
          and coalesce(i.delivery_sim_ok,false) and coalesce(i.delivery_camera_app_ok,false)
          and coalesce(i.delivery_batteries_charged_ok,false) and coalesce(i.delivery_sd_formatted_ok,false)
          and coalesce(i.delivery_recording_ok,false)
          and (i.purpose='BACKUP'::public.prep_purpose or (coalesce(i.delivery_customer_email_app_ok,false) and coalesce(i.delivery_monitoring_ok,false)))
        )
    ) then raise exception 'Every Helios must complete the full IT lab build/programming checklist before Service handoff'; end if;

    if exists(
      select 1 from public.prep_items i
      where i.prep_ticket_id=new.id
        and i.equipment_type='Sniper'
        and i.purpose='SWAP'::public.prep_purpose
        and not(
          coalesce(i.delivery_sim_ok,false)
          and coalesce(i.delivery_camera_app_ok,false)
          and coalesce(i.delivery_customer_email_app_ok,false)
          and coalesce(i.delivery_batteries_charged_ok,false)
          and coalesce(i.delivery_monitoring_ok,false)
          and coalesce(i.delivery_ticket_count_ok,false)
          and coalesce(i.delivery_sd_formatted_ok,false)
          and coalesce(i.delivery_recording_ok,false)
        )
    ) then raise exception 'Every Sniper SWAP must complete the same customer deployment readiness checks as a Sniper DELIVERY before Service handoff'; end if;

    if exists(select 1 from public.prep_items where prep_ticket_id=new.id and purpose='BACKUP'::public.prep_purpose and spare_it_checked_out_at is null) then raise exception 'READY is not CHECKED OUT. IT must explicitly CHECK OUT every truck spare before the Service handoff'; end if;
    if exists(select 1 from public.truck_spare_batteries where prep_ticket_id=new.id and coalesce(qty_prepared,0)>0 and it_checked_out_at is null) then raise exception 'IT must explicitly CHECK OUT every prepared spare-battery batch before the Service handoff'; end if;
  end if;
  if new.status='closed'::public.prep_status and old.status='released'::public.prep_status
     and exists(select 1 from public.prep_items where prep_ticket_id=new.id and equipment_type='Helios'
       and purpose in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose)) then
    if not exists(select 1 from public.service_solar_checks where prep_ticket_id=new.id and helios_owner_verified_at is not null) then
      raise exception 'Helios Delivery/SWAP requires Owner final verification after the field installation';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_prep(p_prep_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_no text;
  v_test boolean;
  v_name text;
  v_photos int;
  v_signed_at timestamptz;
  v_expected integer;
  v_items integer;
  v_assignment record;
  v_recipient record;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select ticket_no,is_test,expected_unit_count
  into v_no,v_test,v_expected
  from public.prep_tickets
  where id=p_prep_id and status='draft'
  for update;
  if not found then raise exception 'Draft equipment prep not found'; end if;

  select count(*) into v_items from public.prep_items where prep_ticket_id=p_prep_id;
  if v_expected is not null and v_items<>v_expected then
    raise exception 'This ticket requires % total job + truck-spare items, but % have been completed',v_expected,v_items;
  end if;

  if exists(
    select 1 from public.prep_items
    where prep_ticket_id=p_prep_id and (unit_tag is null or verified_at is null)
  ) then raise exception 'Every equipment item must be verified before the Service handoff'; end if;

  if exists(
    select 1 from public.prep_items
    where prep_ticket_id=p_prep_id
      and equipment_type not in ('Solar Stand','Solar Pole','110V Stand','Pole')
      and (
        purpose='DELIVERY'::public.prep_purpose
        or (equipment_type='Sniper' and purpose='SWAP'::public.prep_purpose)
      )
      and not(
        delivery_sim_ok and delivery_camera_app_ok and delivery_customer_email_app_ok
        and delivery_batteries_charged_ok and delivery_monitoring_ok and delivery_ticket_count_ok
        and delivery_sd_formatted_ok and delivery_recording_ok
      )
  ) then raise exception 'Every DELIVERY camera unit and Sniper SWAP must pass all customer deployment readiness checks before the Service handoff'; end if;

  if exists(
    select 1 from public.prep_items
    where prep_ticket_id=p_prep_id
      and equipment_type not in ('Solar Stand','Solar Pole','110V Stand','Pole')
      and purpose='BACKUP'::public.prep_purpose
      and not(
        delivery_sim_ok and delivery_camera_app_ok and delivery_batteries_charged_ok
        and delivery_sd_formatted_ok and delivery_recording_ok
      )
  ) then raise exception 'Every BACKUP unit must be hardware-ready before the Service handoff'; end if;

  if v_expected is not null then
    if exists(
      select 1
      from public.prep_items i
      where i.prep_ticket_id=p_prep_id
        and (select count(*) from public.handoff_evidence e where e.prep_ticket_id=p_prep_id and e.prep_item_id=i.id and e.stage='it' and e.kind='photo')<>1
    ) then raise exception 'Every item requires exactly one IT photo before the Service handoff'; end if;
    if exists(
      select 1 from public.prep_items i
      where i.prep_ticket_id=p_prep_id and not coalesce(i.photo_tag_match_ok,false)
    ) then raise exception 'Every IT photo must clearly show the matching unit tag before the Service handoff'; end if;
    if exists(
      select 1
      from public.prep_items i
      where i.prep_ticket_id=p_prep_id
        and not exists(select 1 from public.handoff_evidence e where e.prep_ticket_id=p_prep_id and e.prep_item_id=i.id and e.stage='it' and e.kind='signature')
    ) then raise exception 'Every item requires an IT signature before the Service handoff'; end if;
    select count(*),max(created_at)
    into v_photos,v_signed_at
    from public.handoff_evidence
    where prep_ticket_id=p_prep_id and stage='it' and kind='photo' and prep_item_id is not null;
  else
    select count(*) into v_photos
    from public.handoff_evidence
    where prep_ticket_id=p_prep_id and stage='it' and kind='photo';
    if v_photos<1 then raise exception 'Upload at least one IT handoff photo before creating the Service handoff'; end if;
    select max(created_at) into v_signed_at
    from public.handoff_evidence
    where prep_ticket_id=p_prep_id and stage='it' and kind='signature';
    if v_signed_at is null then raise exception 'IT signature is required before creating the Service handoff'; end if;
  end if;

  v_name:=public.actor_display_name();
  update public.prep_tickets
  set status='released',released_by=auth.uid(),released_by_name=v_name,released_at=now()
  where id=p_prep_id;

  update public.job_assignments
  set prep_ticket_id=p_prep_id,status='completed',completed_at=now(),updated_at=now()
  where assigned_role='it' and ticket_no=v_no and assignee_user_id=auth.uid() and status in ('assigned','started');

  for v_assignment in
    select * from public.job_assignments
    where assigned_role='service' and ticket_no=v_no and status in ('assigned','started')
  loop
    update public.job_assignments set prep_ticket_id=p_prep_id,updated_at=now() where id=v_assignment.id;
    if v_assignment.assignee_user_id is not null then
      perform public.enqueue_app_notification(
        v_assignment.assignee_user_id,'equipment_ready_service','Equipment ready from IT',
        'IT Tech '||v_name||' created the Service handoff for MHelpDesk #'||v_no||'. Verify the units, truck spares, and parts before accepting them.',
        v_assignment.id,v_no,null
      );
    else
      for v_recipient in select * from public.profiles where active=true and role='service' loop
        perform public.enqueue_app_notification(
          v_recipient.user_id,'equipment_ready_service','Equipment ready for Service',
          'IT Tech '||v_name||' created the Service handoff for MHelpDesk #'||v_no||'. Claim the Service task and verify the equipment and truck spares.',
          v_assignment.id,v_no,null
        );
      end loop;
    end if;
  end loop;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text,is_test)
  values(
    case when v_test then 'TEST IT EQUIPMENT SENT TO SERVICE' else 'IT EQUIPMENT SENT TO SERVICE' end,
    auth.uid(),v_name,v_no,
    'IT Tech '||v_name||' verified '||v_items||' item'||case when v_items=1 then '' else 's' end||
      ', including any truck BACKUP units, attached '||coalesce(v_photos,0)||' matching handoff photo'||
      case when coalesce(v_photos,0)=1 then '' else 's' end||
      ' with visible matching unit tags, completed signed verification, and created the Service handoff.',
    coalesce(v_test,false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_it_prep_item_draft(p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean, p_sim_ok boolean DEFAULT false, p_camera_app_ok boolean DEFAULT false, p_batteries_charged_ok boolean DEFAULT false, p_monitoring_ok boolean DEFAULT false, p_ticket_count_ok boolean DEFAULT false, p_sd_formatted_ok boolean DEFAULT false, p_recording_ok boolean DEFAULT false, p_mppt_updated_ok boolean DEFAULT false, p_mppt_tested_ok boolean DEFAULT false, p_pv_charging_ok boolean DEFAULT false, p_solar_panels_match_ok boolean DEFAULT false, p_ticket_item_match_ok boolean DEFAULT false, p_customer_email_app_ok boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.prep_status;
  v_purpose public.prep_purpose;
  v_required int;
  v_type text;
  v_tag text;
  v_count int;
  v_ready boolean;
  v_deploy_ready boolean;
  v_customer_deploy boolean;
  v_hardware_deploy boolean;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select t.status,i.purpose,i.required_battery_count,i.equipment_type
  into v_status,v_purpose,v_required,v_type
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id
  for update of i,t;
  if not found then raise exception 'Prep item not found'; end if;
  if v_status<>'draft'::public.prep_status then
    raise exception 'Return the Service handoff to IT before editing. Completed Service verification is locked.';
  end if;

  v_tag:=nullif(trim(p_unit_tag),'');
  v_count:=greatest(coalesce(p_battery_count,0),0);

  if v_tag is not null and exists(
    select 1
    from public.prep_items oi
    join public.prep_tickets ot on ot.id=oi.prep_ticket_id
    where oi.id<>p_item_id
      and lower(oi.unit_tag)=lower(v_tag)
      and ot.status<>'closed'::public.prep_status
  ) then
    raise exception 'Unit tag is already assigned to another active equipment prep';
  end if;

  v_customer_deploy := v_purpose='DELIVERY'::public.prep_purpose
    or (v_type='Sniper' and v_purpose='SWAP'::public.prep_purpose);
  v_hardware_deploy := v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose)
    or (v_type='Sniper' and v_purpose='SWAP'::public.prep_purpose);

  v_deploy_ready := case
    when v_customer_deploy then
      coalesce(p_sim_ok,false)
      and coalesce(p_camera_app_ok,false)
      and coalesce(p_customer_email_app_ok,false)
      and (v_type='Solar Spotter' or coalesce(p_batteries_charged_ok,false))
      and coalesce(p_monitoring_ok,false)
      and (v_type='Helios' or coalesce(p_ticket_count_ok,false))
      and coalesce(p_sd_formatted_ok,false)
      and coalesce(p_recording_ok,false)
    when v_purpose='BACKUP'::public.prep_purpose then
      coalesce(p_sim_ok,false)
      and coalesce(p_camera_app_ok,false)
      and (v_type='Solar Spotter' or coalesce(p_batteries_charged_ok,false))
      and coalesce(p_sd_formatted_ok,false)
      and coalesce(p_recording_ok,false)
    else true
  end;

  if v_type in ('Solar Stand','Solar Pole','110V Stand','Pole') then
    v_ready:=v_tag is not null and coalesce(p_ticket_item_match_ok,false);
  elsif v_type='Ranger' then
    v_ready:=v_tag is not null
      and coalesce(p_power_ok,false)
      and coalesce(p_functions_ok,false)
      and coalesce(p_safe_ok,false)
      and v_count>=coalesce(v_required,0)
      and coalesce(p_mppt_updated_ok,false)
      and coalesce(p_mppt_tested_ok,false)
      and coalesce(p_pv_charging_ok,false)
      and v_deploy_ready;
  elsif v_type='Helios' then
    v_ready:=v_tag is not null
      and coalesce(p_power_ok,false)
      and coalesce(p_functions_ok,false)
      and coalesce(p_safe_ok,false)
      and v_count>=coalesce(v_required,0)
      and (v_purpose not in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) or (
        coalesce(p_mppt_updated_ok,false)
        and coalesce(p_mppt_tested_ok,false)
        and coalesce(p_pv_charging_ok,false)
        and coalesce(p_solar_panels_match_ok,false)
      ))
      and v_deploy_ready;
  else
    v_ready:=v_tag is not null
      and coalesce(p_power_ok,false)
      and coalesce(p_functions_ok,false)
      and coalesce(p_safe_ok,false)
      and v_count>=coalesce(v_required,0)
      and v_deploy_ready;
  end if;

  update public.prep_items set
    unit_tag=v_tag,
    battery_count=v_count,
    power_ok=coalesce(p_power_ok,false),
    functions_ok=coalesce(p_functions_ok,false),
    safe_ok=coalesce(p_safe_ok,false),
    verified_by=case when v_ready then auth.uid() else null end,
    verified_at=case when v_ready then now() else null end,
    delivery_sim_ok=case when v_hardware_deploy then coalesce(p_sim_ok,false) else false end,
    delivery_camera_app_ok=case when v_hardware_deploy then coalesce(p_camera_app_ok,false) else false end,
    delivery_customer_email_app_ok=case when v_customer_deploy then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=case
      when v_type='Solar Spotter' and v_hardware_deploy then true
      when v_hardware_deploy then coalesce(p_batteries_charged_ok,false)
      else false end,
    delivery_monitoring_ok=case when v_customer_deploy then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case
      when v_type='Helios' and v_customer_deploy then true
      when v_customer_deploy then coalesce(p_ticket_count_ok,false)
      else false end,
    delivery_sd_formatted_ok=case when v_hardware_deploy then coalesce(p_sd_formatted_ok,false) else false end,
    delivery_recording_ok=case when v_hardware_deploy then coalesce(p_recording_ok,false) else false end,
    solar_mppt_updated_ok=case when v_type in ('Ranger','Helios') then coalesce(p_mppt_updated_ok,false) else false end,
    solar_mppt_tested_ok=case when v_type in ('Ranger','Helios') then coalesce(p_mppt_tested_ok,false) else false end,
    solar_pv_charging_ok=case when v_type in ('Ranger','Helios') then coalesce(p_pv_charging_ok,false) else false end,
    solar_panels_match_ok=case when v_type='Helios' then coalesce(p_solar_panels_match_ok,false) else false end,
    ticket_item_match_ok=case when v_type in ('Solar Stand','Solar Pole','110V Stand','Pole') then coalesce(p_ticket_item_match_ok,false) else false end
  where id=p_item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_delivery_item_checks(p_item_id uuid, p_sim_ok boolean, p_camera_app_ok boolean, p_batteries_charged_ok boolean, p_monitoring_ok boolean, p_ticket_count_ok boolean, p_sd_formatted_ok boolean, p_recording_ok boolean, p_customer_email_app_ok boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.prep_status;
  v_purpose public.prep_purpose;
  v_type text;
  v_customer_deploy boolean;
  v_hardware_deploy boolean;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select t.status,i.purpose,i.equipment_type
  into v_status,v_purpose,v_type
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id;
  if not found then raise exception 'Deployable prep item not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft equipment prep can be verified'; end if;

  v_customer_deploy := v_purpose='DELIVERY'::public.prep_purpose
    or (v_type='Sniper' and v_purpose='SWAP'::public.prep_purpose);
  v_hardware_deploy := v_purpose='BACKUP'::public.prep_purpose or v_customer_deploy;

  if not v_hardware_deploy then
    raise exception 'Deploy-ready checks apply only to DELIVERY, BACKUP, or Sniper SWAP items';
  end if;

  if v_customer_deploy then
    if not coalesce(p_sim_ok,false)
       or not coalesce(p_camera_app_ok,false)
       or not coalesce(p_customer_email_app_ok,false)
       or not coalesce(p_batteries_charged_ok,false)
       or not coalesce(p_monitoring_ok,false)
       or not coalesce(p_ticket_count_ok,false)
       or not coalesce(p_sd_formatted_ok,false)
       or not coalesce(p_recording_ok,false)
    then raise exception 'All Sniper/customer deployment readiness checks are required'; end if;
  else
    if not coalesce(p_sim_ok,false)
       or not coalesce(p_camera_app_ok,false)
       or not coalesce(p_batteries_charged_ok,false)
       or not coalesce(p_sd_formatted_ok,false)
       or not coalesce(p_recording_ok,false)
    then raise exception 'BACKUP units must be hardware-ready before leaving in the Service truck'; end if;
  end if;

  update public.prep_items set
    delivery_sim_ok=coalesce(p_sim_ok,false),
    delivery_camera_app_ok=coalesce(p_camera_app_ok,false),
    delivery_customer_email_app_ok=case when v_customer_deploy then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=coalesce(p_batteries_charged_ok,false),
    delivery_monitoring_ok=case when v_customer_deploy then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case when v_customer_deploy then coalesce(p_ticket_count_ok,false) else false end,
    delivery_sd_formatted_ok=coalesce(p_sd_formatted_ok,false),
    delivery_recording_ok=coalesce(p_recording_ok,false)
  where id=p_item_id;
end;
$function$;
