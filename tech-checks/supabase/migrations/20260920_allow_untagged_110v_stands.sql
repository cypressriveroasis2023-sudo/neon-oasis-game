-- Allow Cameras On Site 110V Stands to be intentionally untagged.

-- Other equipment types retain their existing tag requirements.



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
    where prep_ticket_id=p_prep_id and (verified_at is null or (equipment_type<>'110V Stand' and unit_tag is null))
  ) then raise exception 'Every equipment item must be verified before the Service handoff'; end if;

  if exists(
    select 1 from public.prep_items
    where prep_ticket_id=p_prep_id
      and equipment_type not in ('Solar Stand','110V Stand','Pole')
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
      and equipment_type not in ('Solar Stand','110V Stand','Pole')
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
      where i.prep_ticket_id=p_prep_id
        and not (i.equipment_type='110V Stand' and nullif(trim(coalesce(i.unit_tag,'')),'') is null)
        and not coalesce(i.photo_tag_match_ok,false)
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
      ' with matching unit tags where present, completed signed verification, and created the Service handoff.',
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
  v_camera_family_ready boolean;
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
    or (v_type in ('Sniper','Spotter','Recon 2','Ranger') and v_purpose='SWAP'::public.prep_purpose);
  v_hardware_deploy := v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose)
    or (v_type in ('Sniper','Spotter','Recon 2','Ranger') and v_purpose='SWAP'::public.prep_purpose);

  select case
    when v_type='Spotter' then coalesce(camera_port_81_ok,false) and coalesce(camera_port_554_ok,false) and coalesce(unit_programmed_ok,false)
    when v_type='Recon 2' then coalesce(camera_port_81_ok,false) and coalesce(camera_port_554_ok,false) and coalesce(unit_programmed_ok,false) and coalesce(recon_camera_count,0)>=1
    when v_type='Ranger' then coalesce(camera_port_81_ok,false) and coalesce(camera_port_554_ok,false)
    else true
  end
  into v_camera_family_ready
  from public.prep_items where id=p_item_id;

  v_deploy_ready := case
    when v_customer_deploy then
      coalesce(p_sim_ok,false)
      and coalesce(p_camera_app_ok,false)
      and coalesce(p_customer_email_app_ok,false)
      and (v_type in ('Solar Spotter','Spotter') or coalesce(p_batteries_charged_ok,false))
      and coalesce(p_monitoring_ok,false)
      and (v_type='Helios' or coalesce(p_ticket_count_ok,false))
      and coalesce(p_sd_formatted_ok,false)
      and coalesce(p_recording_ok,false)
      and v_camera_family_ready
    when v_purpose='BACKUP'::public.prep_purpose then
      coalesce(p_sim_ok,false)
      and coalesce(p_camera_app_ok,false)
      and (v_type in ('Solar Spotter','Spotter') or coalesce(p_batteries_charged_ok,false))
      and coalesce(p_sd_formatted_ok,false)
      and coalesce(p_recording_ok,false)
      and v_camera_family_ready
    else true
  end;

  if v_type='110V Stand' then
    v_ready:=coalesce(p_ticket_item_match_ok,false);
  elsif v_type in ('Solar Stand','Pole') then
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
      when v_type in ('Solar Spotter','Spotter') and v_hardware_deploy then true
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
    ticket_item_match_ok=case when v_type in ('Solar Stand','110V Stand','Pole') then coalesce(p_ticket_item_match_ok,false) else false end
  where id=p_item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_it_prep_item_draft(p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean, p_sim_ok boolean DEFAULT false, p_camera_app_ok boolean DEFAULT false, p_batteries_charged_ok boolean DEFAULT false, p_monitoring_ok boolean DEFAULT false, p_ticket_count_ok boolean DEFAULT false, p_sd_formatted_ok boolean DEFAULT false, p_recording_ok boolean DEFAULT false, p_mppt_updated_ok boolean DEFAULT false, p_mppt_tested_ok boolean DEFAULT false, p_pv_charging_ok boolean DEFAULT false, p_solar_panels_match_ok boolean DEFAULT false, p_ticket_item_match_ok boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.prep_status; v_purpose public.prep_purpose; v_required int; v_type text; v_tag text; v_count int; v_ready boolean;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select t.status,i.purpose,i.required_battery_count,i.equipment_type into v_status,v_purpose,v_required,v_type from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id where i.id=p_item_id for update of i,t;
  if not found then raise exception 'Prep item not found'; end if;
  if v_status<>'draft'::public.prep_status then raise exception 'Return the Service handoff to IT before editing. Completed Service verification is locked.'; end if;
  v_tag:=nullif(trim(p_unit_tag),''); v_count:=greatest(coalesce(p_battery_count,0),0);
  if v_tag is not null and exists(select 1 from public.prep_items oi join public.prep_tickets ot on ot.id=oi.prep_ticket_id where oi.id<>p_item_id and lower(oi.unit_tag)=lower(v_tag) and ot.status<>'closed'::public.prep_status) then raise exception 'Unit tag is already assigned to another active equipment prep'; end if;
  if v_type in ('Solar Stand') then
    v_ready:=v_tag is not null and v_count>=1 and coalesce(p_mppt_updated_ok,false) and coalesce(p_mppt_tested_ok,false) and coalesce(p_pv_charging_ok,false) and coalesce(p_solar_panels_match_ok,false) and coalesce(p_ticket_item_match_ok,false);
  elsif v_type='110V Stand' then
    v_ready:=coalesce(p_ticket_item_match_ok,false);
  elsif v_type='Pole' then
    v_ready:=v_tag is not null and coalesce(p_ticket_item_match_ok,false);
  else
    v_ready:=v_tag is not null and coalesce(p_power_ok,false) and coalesce(p_functions_ok,false) and coalesce(p_safe_ok,false) and v_count>=coalesce(v_required,0) and (v_purpose<>'DELIVERY'::public.prep_purpose or (coalesce(p_sim_ok,false) and coalesce(p_camera_app_ok,false) and coalesce(p_batteries_charged_ok,false) and coalesce(p_monitoring_ok,false) and coalesce(p_ticket_count_ok,false) and coalesce(p_sd_formatted_ok,false) and coalesce(p_recording_ok,false)));
  end if;
  update public.prep_items set unit_tag=v_tag,battery_count=v_count,power_ok=coalesce(p_power_ok,false),functions_ok=coalesce(p_functions_ok,false),safe_ok=coalesce(p_safe_ok,false),verified_by=case when v_ready then auth.uid() else null end,verified_at=case when v_ready then now() else null end,
    delivery_sim_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_sim_ok,false) else false end,
    delivery_camera_app_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_camera_app_ok,false) else false end,
    delivery_batteries_charged_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_batteries_charged_ok,false) else false end,
    delivery_monitoring_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_ticket_count_ok,false) else false end,
    delivery_sd_formatted_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_sd_formatted_ok,false) else false end,
    delivery_recording_ok=case when v_type not in ('Solar Stand','110V Stand','Pole') and v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_recording_ok,false) else false end,
    solar_mppt_updated_ok=case when v_type in ('Solar Stand') then coalesce(p_mppt_updated_ok,false) else false end,
    solar_mppt_tested_ok=case when v_type in ('Solar Stand') then coalesce(p_mppt_tested_ok,false) else false end,
    solar_pv_charging_ok=case when v_type in ('Solar Stand') then coalesce(p_pv_charging_ok,false) else false end,
    solar_panels_match_ok=case when v_type in ('Solar Stand') then coalesce(p_solar_panels_match_ok,false) else false end,
    ticket_item_match_ok=case when v_type in ('Solar Stand','110V Stand','Pole') then coalesce(p_ticket_item_match_ok,false) else false end
  where id=p_item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_and_release_prep_item(p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prep uuid;
  v_remaining integer;
begin
  perform public.verify_prep_item(p_item_id,p_unit_tag,p_battery_count,p_power_ok,p_functions_ok,p_safe_ok);
  select prep_ticket_id into v_prep from public.prep_items where id=p_item_id;
  select count(*)::integer into v_remaining
  from public.prep_items
  where prep_ticket_id=v_prep and (verified_at is null or (equipment_type<>'110V Stand' and unit_tag is null));

  if v_remaining = 0 then
    perform public.release_prep(v_prep);
    return jsonb_build_object('released',true,'remaining',0,'prep_id',v_prep);
  end if;
  return jsonb_build_object('released',false,'remaining',v_remaining,'prep_id',v_prep);
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_prep_item(p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text;
  v_prep uuid;
  v_required int := 0;
  v_status public.prep_status;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select i.equipment_type,i.prep_ticket_id,i.required_battery_count,t.status
  into v_type,v_prep,v_required,v_status
  from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id where i.id=p_item_id;
  if not found then raise exception 'Prep item not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft equipment prep can be verified'; end if;
  if v_type<>'110V Stand' and nullif(trim(p_unit_tag),'') is null then raise exception 'Unit tag is required'; end if;
  if not coalesce(p_power_ok,false) or not coalesce(p_functions_ok,false) or not coalesce(p_safe_ok,false) then raise exception 'All three IT equipment checks are required'; end if;
  if coalesce(p_battery_count,0) < coalesce(v_required,0) then raise exception 'Battery count is below the required count for %',v_type; end if;
  if nullif(trim(p_unit_tag),'') is not null and exists(
    select 1 from public.prep_items oi join public.prep_tickets ot on ot.id=oi.prep_ticket_id
    where oi.id<>p_item_id and lower(oi.unit_tag)=lower(trim(p_unit_tag)) and ot.status<>'closed'
  ) then raise exception 'Unit tag is already assigned to another active equipment prep'; end if;

  update public.prep_items
  set unit_tag=nullif(trim(p_unit_tag),''),battery_count=coalesce(p_battery_count,0),power_ok=true,functions_ok=true,safe_ok=true,verified_by=auth.uid(),verified_at=now()
  where id=p_item_id;
end;
$function$;
