-- Cameras On Site Tech Check
-- Phase 7: Spotter / Recon II / Ranger workflow rules
-- Owner-taught 2026-09-19.

alter table public.prep_items
  add column if not exists camera_port_81_ok boolean not null default false,
  add column if not exists camera_port_554_ok boolean not null default false,
  add column if not exists unit_programmed_ok boolean not null default false,
  add column if not exists recon_camera_count integer,
  add column if not exists ranger_field_victron_updated_ok boolean not null default false,
  add column if not exists ranger_field_victron_updated_by uuid references auth.users(id),
  add column if not exists ranger_field_victron_updated_by_name text,
  add column if not exists ranger_field_victron_updated_at timestamptz;

alter table public.prep_items drop constraint if exists prep_items_recon_camera_count_check;
alter table public.prep_items add constraint prep_items_recon_camera_count_check
check (recon_camera_count is null or recon_camera_count >= 1);

CREATE OR REPLACE FUNCTION public.enforce_camera_family_before_release_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status<>'released'::public.prep_status or old.status='released'::public.prep_status then
    return new;
  end if;

  if exists(
    select 1
    from public.prep_items i
    where i.prep_ticket_id=new.id
      and i.equipment_type in ('Spotter','Recon 2','Ranger')
      and i.purpose in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose,'BACKUP'::public.prep_purpose)
      and not(
        coalesce(i.camera_port_81_ok,false)
        and coalesce(i.camera_port_554_ok,false)
        and (i.equipment_type='Ranger' or coalesce(i.unit_programmed_ok,false))
        and (i.equipment_type<>'Recon 2' or coalesce(i.recon_camera_count,0)>=1)
      )
  ) then
    raise exception 'Spotter, Recon II, and Ranger must pass their programming/camera-count and router port 81/554 checks before the Service handoff';
  end if;

  if exists(
    select 1
    from public.prep_items i
    where i.prep_ticket_id=new.id
      and i.equipment_type in ('Spotter','Recon 2','Ranger')
      and i.purpose='SWAP'::public.prep_purpose
      and not(
        coalesce(i.delivery_sim_ok,false)
        and coalesce(i.delivery_camera_app_ok,false)
        and coalesce(i.delivery_customer_email_app_ok,false)
        and (i.equipment_type='Spotter' or coalesce(i.delivery_batteries_charged_ok,false))
        and coalesce(i.delivery_monitoring_ok,false)
        and coalesce(i.delivery_ticket_count_ok,false)
        and coalesce(i.delivery_sd_formatted_ok,false)
        and coalesce(i.delivery_recording_ok,false)
      )
  ) then
    raise exception 'Spotter, Recon II, and Ranger SWAP replacements must pass the same customer deployment readiness checks as DELIVERY';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_standard_field_before_close_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_required int;
  v_returned int;
  v_type text;
begin
  if new.status<>'closed'::public.prep_status or old.status='closed'::public.prep_status then
    return new;
  end if;

  if exists(
    select 1 from public.prep_items i
    where i.prep_ticket_id=new.id
      and i.equipment_type='Ranger'
      and i.purpose in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose)
      and not coalesce(i.ranger_field_victron_updated_ok,false)
  ) then
    raise exception 'Complete the Ranger field Victron Bluetooth update/verification before closing this Tech Check';
  end if;

  foreach v_type in array array['Sniper','Spotter','Recon 2']
  loop
    select count(*) into v_required
    from public.prep_items
    where prep_ticket_id=new.id
      and equipment_type=v_type
      and purpose='SWAP'::public.prep_purpose;

    if v_required>0 then
      select count(*) into v_returned
      from public.unit_returns
      where ticket_no=new.ticket_no
        and equipment_type=v_type;

      if v_returned<v_required then
        raise exception '% SWAP requires % replaced field unit return(s) in IT Intake before the Tech Check can close; % recorded',
          v_type,v_required,v_returned;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reset_camera_family_checks_on_definition_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.equipment_type is distinct from old.equipment_type
     or new.purpose is distinct from old.purpose then
    new.camera_port_81_ok := false;
    new.camera_port_554_ok := false;
    new.unit_programmed_ok := false;
    new.recon_camera_count := null;
    new.ranger_field_victron_updated_ok := false;
    new.ranger_field_victron_updated_by := null;
    new.ranger_field_victron_updated_by_name := null;
    new.ranger_field_victron_updated_at := null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_it_camera_family_checks_v1(p_item_id uuid, p_programmed_ok boolean, p_port_81_ok boolean, p_port_554_ok boolean, p_recon_camera_count integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.prep_status;
  v_type text;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select t.status,i.equipment_type
  into v_status,v_type
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id
  for update of i,t;

  if not found then raise exception 'Prep item not found'; end if;
  if v_status<>'draft'::public.prep_status then
    raise exception 'Only draft IT equipment can be edited';
  end if;
  if v_type not in ('Spotter','Recon 2','Ranger') then
    raise exception 'Camera-family checks apply only to Spotter, Recon II, or Ranger';
  end if;
  if v_type='Recon 2' and coalesce(p_recon_camera_count,0)<1 then
    raise exception 'Recon II requires the number of cameras being prepared';
  end if;

  update public.prep_items set
    unit_programmed_ok=case when v_type in ('Spotter','Recon 2') then coalesce(p_programmed_ok,false) else true end,
    camera_port_81_ok=coalesce(p_port_81_ok,false),
    camera_port_554_ok=coalesce(p_port_554_ok,false),
    recon_camera_count=case when v_type='Recon 2' then greatest(1,coalesce(p_recon_camera_count,1)) else null end
  where id=p_item_id;
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
    ticket_item_match_ok=case when v_type in ('Solar Stand','Solar Pole','110V Stand','Pole') then coalesce(p_ticket_item_match_ok,false) else false end
  where id=p_item_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_my_ranger_field_check_v1(p_item_id uuid, p_victron_updated_ok boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.prep_status;
  v_type text;
  v_purpose public.prep_purpose;
  v_name text;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);

  select t.status,i.equipment_type,i.purpose
  into v_status,v_type,v_purpose
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id
  for update of i,t;

  if not found then raise exception 'Ranger prep item not found'; end if;
  if v_status<>'released'::public.prep_status then
    raise exception 'Ranger field verification is available only after the IT → Service handoff';
  end if;
  if v_type<>'Ranger' or v_purpose not in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose) then
    raise exception 'Ranger field verification applies only to Ranger DELIVERY or SWAP';
  end if;
  if not coalesce(p_victron_updated_ok,false) then
    raise exception 'Verify the Ranger is up to date in the Victron Bluetooth app before completing the field job';
  end if;

  v_name:=public.actor_display_name();
  update public.prep_items set
    ranger_field_victron_updated_ok=true,
    ranger_field_victron_updated_by=auth.uid(),
    ranger_field_victron_updated_by_name=v_name,
    ranger_field_victron_updated_at=now()
  where id=p_item_id;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  select 'RANGER FIELD VICTRON VERIFIED',auth.uid(),v_name,t.ticket_no,
    'Service Tech '||v_name||' verified Ranger '||coalesce(i.unit_tag,'unit')||' is up to date in the Victron Bluetooth app in the field.'
  from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id;
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
    or (v_type in ('Sniper','Spotter','Recon 2','Ranger') and v_purpose='SWAP'::public.prep_purpose);
  v_hardware_deploy := v_purpose='BACKUP'::public.prep_purpose or v_customer_deploy;

  if not v_hardware_deploy then
    raise exception 'Deploy-ready checks apply only to DELIVERY, BACKUP, or supported camera-unit SWAP items';
  end if;

  if v_customer_deploy then
    if not coalesce(p_sim_ok,false)
       or not coalesce(p_camera_app_ok,false)
       or not coalesce(p_customer_email_app_ok,false)
       or (v_type<>'Spotter' and not coalesce(p_batteries_charged_ok,false))
       or not coalesce(p_monitoring_ok,false)
       or not coalesce(p_ticket_count_ok,false)
       or not coalesce(p_sd_formatted_ok,false)
       or not coalesce(p_recording_ok,false)
    then raise exception 'All customer deployment readiness checks are required'; end if;
  else
    if not coalesce(p_sim_ok,false)
       or not coalesce(p_camera_app_ok,false)
       or (v_type<>'Spotter' and not coalesce(p_batteries_charged_ok,false))
       or not coalesce(p_sd_formatted_ok,false)
       or not coalesce(p_recording_ok,false)
    then raise exception 'BACKUP units must be hardware-ready before leaving in the Service truck'; end if;
  end if;

  update public.prep_items set
    delivery_sim_ok=coalesce(p_sim_ok,false),
    delivery_camera_app_ok=coalesce(p_camera_app_ok,false),
    delivery_customer_email_app_ok=case when v_customer_deploy then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=case when v_type='Spotter' then true else coalesce(p_batteries_charged_ok,false) end,
    delivery_monitoring_ok=case when v_customer_deploy then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case when v_customer_deploy then coalesce(p_ticket_count_ok,false) else false end,
    delivery_sd_formatted_ok=coalesce(p_sd_formatted_ok,false),
    delivery_recording_ok=coalesce(p_recording_ok,false)
  where id=p_item_id;
end;
$function$;

revoke execute on function public.save_it_camera_family_checks_v1(uuid,boolean,boolean,boolean,integer) from public, anon;
grant execute on function public.save_it_camera_family_checks_v1(uuid,boolean,boolean,boolean,integer) to authenticated;
revoke execute on function public.save_my_ranger_field_check_v1(uuid,boolean) from public, anon;
grant execute on function public.save_my_ranger_field_check_v1(uuid,boolean) to authenticated;

drop trigger if exists reset_camera_family_checks_on_definition_change_trigger on public.prep_items;
create trigger reset_camera_family_checks_on_definition_change_trigger
before update of equipment_type,purpose on public.prep_items
for each row execute function public.reset_camera_family_checks_on_definition_change();

drop trigger if exists enforce_camera_family_before_release_v1_trigger on public.prep_tickets;
create trigger enforce_camera_family_before_release_v1_trigger
before update of status on public.prep_tickets
for each row execute function public.enforce_camera_family_before_release_v1();

drop trigger if exists enforce_standard_field_before_close_v1_trigger on public.prep_tickets;
create trigger enforce_standard_field_before_close_v1_trigger
before update of status on public.prep_tickets
for each row execute function public.enforce_standard_field_before_close_v1();
