-- Helios Delivery / Swap / Spare workflow hardening
-- release-qa-v108
-- Additive only: preserves existing Tech Check / Supabase data.

alter table public.prep_items
  add column if not exists helios_camera1_hardware_ok boolean not null default false,
  add column if not exists helios_camera2_hardware_ok boolean not null default false,
  add column if not exists helios_ptz_assembly_ok boolean not null default false,
  add column if not exists helios_proxicast_4x4_ok boolean not null default false,
  add column if not exists helios_router_sim_ok boolean not null default false,
  add column if not exists helios_speaker_24v_ok boolean not null default false,
  add column if not exists helios_cameras_12v_ok boolean not null default false,
  add column if not exists helios_ptz_plate_4bolts_ok boolean not null default false,
  add column if not exists helios_cerbo_network_ok boolean not null default false,
  add column if not exists helios_cerbo_vrm_ok boolean not null default false,
  add column if not exists helios_rear_unit_tag_ok boolean not null default false,
  add column if not exists helios_battery_box_installed_ok boolean not null default false,
  add column if not exists helios_battery_120v_charged_ok boolean not null default false,
  add column if not exists helios_camera_router_programming_ok boolean not null default false,
  add column if not exists helios_alibi_vigilant_ok boolean not null default false,
  add column if not exists helios_3x1tb_sd_ok boolean not null default false;

alter table public.service_solar_checks
  add column if not exists helios_yard_pv_connected_ok boolean not null default false,
  add column if not exists helios_yard_switch_pv_ok boolean not null default false,
  add column if not exists helios_yard_victron_bluetooth_ok boolean not null default false,
  add column if not exists helios_yard_updates_status_ok boolean not null default false,
  add column if not exists helios_yard_solar_charging_ok boolean not null default false,
  add column if not exists helios_yard_ptz_wrapped_ok boolean not null default false,
  add column if not exists handoff_accepted_at timestamptz,
  add column if not exists handoff_accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists handoff_accepted_by_name text,
  add column if not exists helios_field_box_mounted_ok boolean not null default false,
  add column if not exists helios_field_pv_connected_ok boolean not null default false,
  add column if not exists helios_field_ptz_secured_ok boolean not null default false,
  add column if not exists helios_field_switch_pv_ok boolean not null default false,
  add column if not exists helios_field_unit_battery_on_ok boolean not null default false,
  add column if not exists helios_field_it_online_verified_ok boolean not null default false,
  add column if not exists helios_field_cameras_aimed_ok boolean not null default false,
  add column if not exists helios_field_recording_ok boolean not null default false,
  add column if not exists helios_field_tower_20ft_ok boolean not null default false,
  add column if not exists helios_field_mast_lock_bolt_ok boolean not null default false,
  add column if not exists helios_field_panel_45deg_ok boolean not null default false,
  add column if not exists helios_field_panel_bolt_ok boolean not null default false,
  add column if not exists helios_field_4_sandbags_ok boolean not null default false,
  add column if not exists helios_field_completed_at timestamptz,
  add column if not exists helios_field_completed_by uuid references auth.users(id) on delete set null,
  add column if not exists helios_field_completed_by_name text,
  add column if not exists helios_owner_verified_at timestamptz,
  add column if not exists helios_owner_verified_by uuid references auth.users(id) on delete set null,
  add column if not exists helios_owner_verified_by_name text;

alter table public.service_solar_evidence
  drop constraint if exists service_solar_evidence_category_check;
alter table public.service_solar_evidence
  add constraint service_solar_evidence_category_check
  check (category in ('solar_stand','batteries','mppt','helios_cerbo_mppt','helios_yard','helios_install'));

create or replace function public.save_it_helios_deploy_checks_v1(
  p_item_id uuid,
  p_camera1_hardware_ok boolean,
  p_camera2_hardware_ok boolean,
  p_ptz_assembly_ok boolean,
  p_proxicast_4x4_ok boolean,
  p_router_sim_ok boolean,
  p_speaker_24v_ok boolean,
  p_cameras_12v_ok boolean,
  p_ptz_plate_4bolts_ok boolean,
  p_cerbo_network_ok boolean,
  p_cerbo_vrm_ok boolean,
  p_rear_unit_tag_ok boolean,
  p_battery_box_installed_ok boolean,
  p_battery_120v_charged_ok boolean,
  p_camera_router_programming_ok boolean,
  p_alibi_vigilant_ok boolean,
  p_3x1tb_sd_ok boolean,
  p_camera1_ports_ok boolean,
  p_camera2_ports_ok boolean,
  p_ptz_ports_ok boolean,
  p_speaker_ports_ok boolean,
  p_sim_ok boolean,
  p_camera_app_ok boolean,
  p_customer_email_app_ok boolean,
  p_monitoring_ok boolean,
  p_sd_formatted_ok boolean,
  p_recording_ok boolean
) returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_status public.prep_status;
  v_type text;
  v_purpose public.prep_purpose;
  v_ready boolean;
  v_customer_specific boolean;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select t.status,i.equipment_type,i.purpose
    into v_status,v_type,v_purpose
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id
  for update of i,t;
  if not found then raise exception 'Prep item not found'; end if;
  if v_status<>'draft'::public.prep_status then raise exception 'Only draft equipment prep can be edited'; end if;
  if v_type<>'Helios' or v_purpose not in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose,'BACKUP'::public.prep_purpose) then
    raise exception 'Helios deploy checks apply only to DELIVERY, SWAP, or BACKUP Helios items';
  end if;

  v_customer_specific := v_purpose in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose);

  update public.prep_items set
    helios_camera1_hardware_ok=coalesce(p_camera1_hardware_ok,false),
    helios_camera2_hardware_ok=coalesce(p_camera2_hardware_ok,false),
    helios_ptz_assembly_ok=coalesce(p_ptz_assembly_ok,false),
    helios_proxicast_4x4_ok=coalesce(p_proxicast_4x4_ok,false),
    helios_router_sim_ok=coalesce(p_router_sim_ok,false),
    helios_speaker_24v_ok=coalesce(p_speaker_24v_ok,false),
    helios_cameras_12v_ok=coalesce(p_cameras_12v_ok,false),
    helios_ptz_plate_4bolts_ok=coalesce(p_ptz_plate_4bolts_ok,false),
    helios_cerbo_network_ok=coalesce(p_cerbo_network_ok,false),
    helios_cerbo_vrm_ok=coalesce(p_cerbo_vrm_ok,false),
    helios_rear_unit_tag_ok=coalesce(p_rear_unit_tag_ok,false),
    helios_battery_box_installed_ok=coalesce(p_battery_box_installed_ok,false),
    helios_battery_120v_charged_ok=coalesce(p_battery_120v_charged_ok,false),
    helios_camera_router_programming_ok=coalesce(p_camera_router_programming_ok,false),
    helios_alibi_vigilant_ok=coalesce(p_alibi_vigilant_ok,false),
    helios_3x1tb_sd_ok=coalesce(p_3x1tb_sd_ok,false),
    helios_camera1_ports_ok=coalesce(p_camera1_ports_ok,false),
    helios_camera2_ports_ok=coalesce(p_camera2_ports_ok,false),
    helios_ptz_ports_ok=coalesce(p_ptz_ports_ok,false),
    helios_speaker_ports_ok=coalesce(p_speaker_ports_ok,false),
    delivery_sim_ok=coalesce(p_sim_ok,false),
    delivery_camera_app_ok=coalesce(p_camera_app_ok,false),
    delivery_customer_email_app_ok=case when v_customer_specific then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=coalesce(p_battery_120v_charged_ok,false),
    delivery_monitoring_ok=case when v_customer_specific then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=true,
    delivery_sd_formatted_ok=coalesce(p_sd_formatted_ok,false),
    delivery_recording_ok=coalesce(p_recording_ok,false)
  where id=p_item_id;

  select
    nullif(trim(unit_tag),'') is not null
    and coalesce(power_ok,false)
    and coalesce(functions_ok,false)
    and coalesce(safe_ok,false)
    and coalesce(battery_count,0)>=greatest(1,coalesce(required_battery_count,0))
    and helios_camera1_hardware_ok and helios_camera2_hardware_ok and helios_ptz_assembly_ok
    and helios_proxicast_4x4_ok and helios_router_sim_ok and helios_speaker_24v_ok and helios_cameras_12v_ok
    and helios_ptz_plate_4bolts_ok and helios_cerbo_network_ok and helios_cerbo_vrm_ok and helios_rear_unit_tag_ok
    and helios_battery_box_installed_ok and helios_battery_120v_charged_ok and helios_camera_router_programming_ok
    and helios_alibi_vigilant_ok and helios_3x1tb_sd_ok
    and helios_camera1_ports_ok and helios_camera2_ports_ok and helios_ptz_ports_ok and helios_speaker_ports_ok
    and delivery_sim_ok and delivery_camera_app_ok and delivery_batteries_charged_ok
    and delivery_sd_formatted_ok and delivery_recording_ok
    and (not v_customer_specific or (delivery_customer_email_app_ok and delivery_monitoring_ok))
  into v_ready
  from public.prep_items where id=p_item_id;

  update public.prep_items
  set verified_by=case when v_ready then auth.uid() else null end,
      verified_at=case when v_ready then now() else null end
  where id=p_item_id;
end;
$$;

revoke all on function public.save_it_helios_deploy_checks_v1(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.save_it_helios_deploy_checks_v1(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

create or replace function public.service_solar_context_v2(p_prep_id uuid)
returns table(
  need_solar boolean, need_stand boolean, has_helios boolean, has_ranger boolean,
  solar_spotter_count integer, ranger_count integer, expected_batteries integer,
  expected_solar_panels integer, assignment_id uuid
)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_ticket text; v_role public.app_role; v_assignment uuid;
  v_spotters integer:=0; v_rangers integer:=0; v_helios integer:=0; v_explicit_stands integer:=0;
  v_owner_panels integer:=0; v_prep_panels integer:=0;
begin
  v_role:=public.current_app_role();
  if v_role is null or v_role not in ('service'::public.app_role,'owner'::public.app_role) then raise exception 'Service or Owner access required'; end if;
  select ticket_no,coalesce(solar_panel_qty,0) into v_ticket,v_prep_panels from public.prep_tickets where id=p_prep_id;
  if not found then raise exception 'Equipment prep not found'; end if;
  select
    count(*) filter(where equipment_type='Solar Spotter' and purpose='DELIVERY'::public.prep_purpose),
    count(*) filter(where equipment_type='Ranger' and purpose='DELIVERY'::public.prep_purpose),
    count(*) filter(where equipment_type='Helios' and purpose in ('DELIVERY'::public.prep_purpose,'SWAP'::public.prep_purpose,'BACKUP'::public.prep_purpose)),
    count(*) filter(where equipment_type in ('Solar Stand','Solar Pole') and purpose='DELIVERY'::public.prep_purpose)
  into v_spotters,v_rangers,v_helios,v_explicit_stands
  from public.prep_items where prep_ticket_id=p_prep_id;
  select a.id,coalesce(a.solar_panel_qty,0) into v_assignment,v_owner_panels
  from public.job_assignments a
  where a.assigned_role='service' and a.status in ('assigned','started','completed')
    and (a.prep_ticket_id=p_prep_id or trim(a.ticket_no)=trim(v_ticket))
    and (v_role='owner'::public.app_role or a.assignee_user_id=auth.uid())
  order by case when a.prep_ticket_id=p_prep_id then 0 else 1 end,a.assigned_at desc limit 1;
  return query select
    (v_spotters>0 or v_rangers>0 or v_helios>0 or v_explicit_stands>0),
    (v_spotters>0 or v_explicit_stands>0),(v_helios>0),(v_rangers>0),
    v_spotters,v_rangers,(v_spotters*4)+v_rangers+v_helios,greatest(v_rangers,v_owner_panels,v_prep_panels),v_assignment;
end;
$$;

create or replace function public.save_my_service_solar_check_v4(
  p_prep_id uuid,p_stand_tag text,p_battery_configuration text,p_mppt_updated_ok boolean,p_mppt_tested_ok boolean,
  p_solar_panel_count integer,p_solar_panels_verified boolean,p_batteries_charged_ok boolean,p_solar_charging_ok boolean,
  p_cerbo_updated_ok boolean default false,p_cerbo_online_ok boolean default false,p_helios_battery_box_charging_ok boolean default false,
  p_helios_yard_pv_connected_ok boolean default false,p_helios_yard_switch_pv_ok boolean default false,
  p_helios_yard_victron_bluetooth_ok boolean default false,p_helios_yard_updates_status_ok boolean default false,
  p_helios_yard_solar_charging_ok boolean default false,p_helios_yard_ptz_wrapped_ok boolean default false
) returns public.service_solar_checks
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  v_role public.app_role; v_name text; v_status public.prep_status; v_ticket text;
  v_spotters int:=0; v_rangers int:=0; v_helios int:=0; v_expected_panels int:=0; v_owner_panels int:=0; v_prep_panels int:=0;
  v_assignment uuid; v_complete boolean; v_row public.service_solar_checks%rowtype; v_batt_count int:=0; v_desc text:=''; v_spot_batt int:=0;
begin
  v_role:=public.current_app_role();
  if v_role not in ('service'::public.app_role,'owner'::public.app_role) then raise exception 'Service or Owner access required'; end if;
  select status,ticket_no,coalesce(solar_panel_qty,0) into v_status,v_ticket,v_prep_panels from public.prep_tickets where id=p_prep_id;
  if not found or v_status<>'released' then raise exception 'Equipment must be waiting for Service'; end if;
  select
    count(*) filter(where equipment_type='Solar Spotter' and purpose='DELIVERY'),
    count(*) filter(where equipment_type='Ranger' and purpose='DELIVERY'),
    count(*) filter(where equipment_type='Helios' and purpose in ('DELIVERY','SWAP','BACKUP'))
  into v_spotters,v_rangers,v_helios from public.prep_items where prep_ticket_id=p_prep_id;
  select id,coalesce(solar_panel_qty,0) into v_assignment,v_owner_panels from public.job_assignments
  where assigned_role='service' and (prep_ticket_id=p_prep_id or ticket_no=v_ticket)
    and (v_role='owner' or assignee_user_id=auth.uid()) order by assigned_at desc limit 1;
  v_expected_panels:=greatest(v_rangers,v_owner_panels,v_prep_panels);
  if v_spotters>0 then
    if p_battery_configuration='agm_4x_12v_110ah' then v_spot_batt:=v_spotters*4; v_desc:=v_spotters||' Solar Stand(s): 4 x AGM 12V 110Ah each';
    elsif p_battery_configuration='single_12v_350ah' then v_spot_batt:=v_spotters; v_desc:=v_spotters||' Solar Stand(s): 1 x 12V 350Ah each';
    else raise exception 'Choose the Solar Spotter battery setup: 4 x AGM 12V 110Ah OR 1 x 12V 350Ah per stand.'; end if;
  end if;
  v_batt_count:=v_spot_batt+v_rangers+v_helios;
  if v_rangers>0 then v_desc:=trim(both ' · ' from v_desc||' · '||v_rangers||' x LiTime 12V 110Ah'); end if;
  if v_helios>0 then v_desc:=trim(both ' · ' from v_desc||' · '||v_helios||' Helios battery box(es)'); end if;
  if v_desc='' then v_desc:='Battery system used for charging verification'; end if;
  if v_spotters=0 then
    if v_rangers>0 and v_helios=0 then p_battery_configuration:='litime_1x_12v_110ah';
    elsif v_helios>0 and v_rangers=0 then p_battery_configuration:='helios_battery_box';
    else p_battery_configuration:='mixed'; end if;
  end if;
  if v_spotters>0 and nullif(trim(coalesce(p_stand_tag,'')),'') is null then raise exception 'Enter the Solar Stand tag(s).'; end if;
  if v_expected_panels>0 and coalesce(p_solar_panel_count,0)<>v_expected_panels then raise exception 'This ticket requires % removable solar panel(s).',v_expected_panels; end if;
  v_complete:=coalesce(p_mppt_updated_ok,false) and coalesce(p_mppt_tested_ok,false)
    and coalesce(p_batteries_charged_ok,false) and coalesce(p_solar_charging_ok,false)
    and (v_expected_panels=0 or (p_solar_panel_count=v_expected_panels and coalesce(p_solar_panels_verified,false)))
    and (v_helios=0 or (
      coalesce(p_cerbo_updated_ok,false) and coalesce(p_cerbo_online_ok,false)
      and coalesce(p_helios_battery_box_charging_ok,false)
      and coalesce(p_helios_yard_pv_connected_ok,false) and coalesce(p_helios_yard_switch_pv_ok,false)
      and coalesce(p_helios_yard_victron_bluetooth_ok,false) and coalesce(p_helios_yard_updates_status_ok,false)
      and coalesce(p_helios_yard_solar_charging_ok,false) and coalesce(p_helios_yard_ptz_wrapped_ok,false)
    ));
  v_name:=public.actor_display_name();
  insert into public.service_solar_checks(
    prep_ticket_id,assignment_id,service_tech_id,service_tech_name,stand_tag,stand_verified,
    mppt_updated_ok,mppt_tested_ok,cerbo_updated_ok,cerbo_online_ok,solar_panel_count,solar_panels_verified,
    battery_count,batteries_charged_ok,solar_charging_ok,battery_configuration,battery_description,
    helios_battery_box_charging_ok,helios_yard_pv_connected_ok,helios_yard_switch_pv_ok,
    helios_yard_victron_bluetooth_ok,helios_yard_updates_status_ok,helios_yard_solar_charging_ok,helios_yard_ptz_wrapped_ok,
    completed_at,updated_at
  ) values(
    p_prep_id,v_assignment,auth.uid(),v_name,nullif(trim(coalesce(p_stand_tag,'')),''),v_spotters=0 or nullif(trim(coalesce(p_stand_tag,'')),'') is not null,
    p_mppt_updated_ok,p_mppt_tested_ok,case when v_helios>0 then p_cerbo_updated_ok else null end,
    case when v_helios>0 then p_cerbo_online_ok else null end,coalesce(p_solar_panel_count,0),
    case when v_expected_panels>0 then p_solar_panels_verified else true end,v_batt_count,p_batteries_charged_ok,p_solar_charging_ok,
    p_battery_configuration,v_desc,case when v_helios>0 then p_helios_battery_box_charging_ok else null end,
    case when v_helios>0 then p_helios_yard_pv_connected_ok else false end,
    case when v_helios>0 then p_helios_yard_switch_pv_ok else false end,
    case when v_helios>0 then p_helios_yard_victron_bluetooth_ok else false end,
    case when v_helios>0 then p_helios_yard_updates_status_ok else false end,
    case when v_helios>0 then p_helios_yard_solar_charging_ok else false end,
    case when v_helios>0 then p_helios_yard_ptz_wrapped_ok else false end,
    case when v_complete then now() else null end,now()
  )
  on conflict(prep_ticket_id) do update set
    assignment_id=excluded.assignment_id,service_tech_id=excluded.service_tech_id,service_tech_name=excluded.service_tech_name,
    stand_tag=excluded.stand_tag,stand_verified=excluded.stand_verified,mppt_updated_ok=excluded.mppt_updated_ok,mppt_tested_ok=excluded.mppt_tested_ok,
    cerbo_updated_ok=excluded.cerbo_updated_ok,cerbo_online_ok=excluded.cerbo_online_ok,solar_panel_count=excluded.solar_panel_count,
    solar_panels_verified=excluded.solar_panels_verified,battery_count=excluded.battery_count,batteries_charged_ok=excluded.batteries_charged_ok,
    solar_charging_ok=excluded.solar_charging_ok,battery_configuration=excluded.battery_configuration,battery_description=excluded.battery_description,
    helios_battery_box_charging_ok=excluded.helios_battery_box_charging_ok,
    helios_yard_pv_connected_ok=excluded.helios_yard_pv_connected_ok,helios_yard_switch_pv_ok=excluded.helios_yard_switch_pv_ok,
    helios_yard_victron_bluetooth_ok=excluded.helios_yard_victron_bluetooth_ok,helios_yard_updates_status_ok=excluded.helios_yard_updates_status_ok,
    helios_yard_solar_charging_ok=excluded.helios_yard_solar_charging_ok,helios_yard_ptz_wrapped_ok=excluded.helios_yard_ptz_wrapped_ok,
    completed_at=excluded.completed_at,updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.save_my_service_solar_check_v4(uuid,text,text,boolean,boolean,integer,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.save_my_service_solar_check_v4(uuid,text,text,boolean,boolean,integer,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

create or replace function public.record_service_solar_evidence(
  p_prep_id uuid,p_category text,p_kind text,p_storage_path text,p_original_name text default null
) returns uuid language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_role public.app_role; v_status public.prep_status; v_id uuid; v_name text;
begin
  v_role:=public.current_app_role();
  if v_role not in ('service'::public.app_role,'owner'::public.app_role) then raise exception 'Service or Owner access required'; end if;
  if p_category not in ('solar_stand','batteries','mppt','helios_cerbo_mppt','helios_yard','helios_install') then raise exception 'Invalid Solar / Helios evidence category'; end if;
  if p_kind not in ('photo','signature') then raise exception 'Invalid evidence type'; end if;
  if nullif(trim(p_storage_path),'') is null then raise exception 'Evidence file path is required'; end if;
  if split_part(p_storage_path,'/',1)<>auth.uid()::text then raise exception 'Evidence path does not belong to this technician'; end if;
  select status into v_status from public.prep_tickets where id=p_prep_id;
  if not found then raise exception 'Equipment prep not found'; end if;
  if v_status<>'released'::public.prep_status then raise exception 'Service Solar / Helios evidence can only be added while equipment is waiting for Service'; end if;
  v_name:=public.actor_display_name();
  if p_kind='signature' then delete from public.service_solar_evidence where prep_ticket_id=p_prep_id and category=p_category and kind='signature' and created_by=auth.uid(); end if;
  insert into public.service_solar_evidence(prep_ticket_id,category,kind,storage_path,original_name,created_by,created_by_name)
  values(p_prep_id,p_category,p_kind,trim(p_storage_path),nullif(trim(p_original_name),''),auth.uid(),v_name) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_service_solar_evidence(uuid,text,text,text,text) from public, anon;
grant execute on function public.record_service_solar_evidence(uuid,text,text,text,text) to authenticated;

create or replace function public.accept_helios_handoff_v1(p_prep_id uuid,p_verifications jsonb)
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $$
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
  select count(*) into v_service_photos from public.handoff_evidence where prep_ticket_id=p_prep_id and stage='service' and kind='photo';
  if v_it_photos<1 or v_service_photos<>v_it_photos then raise exception 'Service receipt photos must exactly match the IT photo count'; end if;
  if not exists(select 1 from public.handoff_evidence where prep_ticket_id=p_prep_id and stage='service' and kind='signature') then raise exception 'Service receipt signature is required'; end if;
  if not exists(select 1 from public.service_solar_checks where prep_ticket_id=p_prep_id and completed_at is not null) then raise exception 'Complete the Helios yard solar test before accepting the handoff'; end if;
  if not exists(select 1 from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_yard' and kind='photo') then raise exception 'Helios yard-test photo proof is required'; end if;
  if not exists(select 1 from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_yard' and kind='signature') then raise exception 'Helios yard-test signature is required'; end if;
  v_name:=public.actor_display_name();
  update public.service_solar_checks set handoff_accepted_at=now(),handoff_accepted_by=auth.uid(),handoff_accepted_by_name=v_name,updated_at=now() where prep_ticket_id=p_prep_id;
end;
$$;
revoke all on function public.accept_helios_handoff_v1(uuid,jsonb) from public, anon;
grant execute on function public.accept_helios_handoff_v1(uuid,jsonb) to authenticated;

create or replace function public.save_my_helios_field_install_v1(
  p_prep_id uuid,p_box_mounted_ok boolean,p_pv_connected_ok boolean,p_ptz_secured_ok boolean,p_switch_pv_ok boolean,
  p_unit_battery_on_ok boolean,p_it_online_verified_ok boolean,p_cameras_aimed_ok boolean,p_recording_ok boolean,
  p_tower_20ft_ok boolean,p_mast_lock_bolt_ok boolean,p_panel_45deg_ok boolean,p_panel_bolt_ok boolean,p_4_sandbags_ok boolean
) returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_role public.app_role; v_status public.prep_status; v_ticket text; v_helios int:=0; v_swaps int:=0; v_returns int:=0; v_name text; v_complete boolean;
begin
  v_role:=public.current_app_role();
  if v_role not in ('service'::public.app_role,'owner'::public.app_role) then raise exception 'Service or Owner access required'; end if;
  select status,ticket_no into v_status,v_ticket from public.prep_tickets where id=p_prep_id;
  if not found or v_status<>'released' then raise exception 'Helios handoff is not open for field installation'; end if;
  select count(*) filter(where equipment_type='Helios' and purpose in ('DELIVERY','SWAP')),count(*) filter(where equipment_type='Helios' and purpose='SWAP')
  into v_helios,v_swaps from public.prep_items where prep_ticket_id=p_prep_id;
  if v_helios<1 then raise exception 'No field-installed Helios is on this ticket'; end if;
  if not exists(select 1 from public.service_solar_checks where prep_ticket_id=p_prep_id and handoff_accepted_at is not null) then raise exception 'Accept the IT handoff after completing the yard test first'; end if;
  if v_swaps>0 then
    select count(*) into v_returns from public.unit_returns
    where trim(ticket_no)=trim(v_ticket) and equipment_type='Helios' and coalesce(array_length(return_photo_paths,1),0)>0
      and nullif(trim(coalesce(return_notes,'')),'') is not null and coalesce(tag_scan_status,'')<>'mismatch';
    if v_returns<v_swaps then raise exception 'Each Helios SWAP requires the OLD UNIT RETURNING tag photo, reason/issues/repair notes, and Service Return before final install submission'; end if;
  end if;
  if (select count(*) from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_install' and kind='photo')<v_helios then raise exception 'Upload at least one final installation photo for each Helios'; end if;
  if not exists(select 1 from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_install' and kind='signature') then raise exception 'A dated Service installation signature is required'; end if;
  v_complete:=coalesce(p_box_mounted_ok,false) and coalesce(p_pv_connected_ok,false) and coalesce(p_ptz_secured_ok,false)
    and coalesce(p_switch_pv_ok,false) and coalesce(p_unit_battery_on_ok,false) and coalesce(p_it_online_verified_ok,false)
    and coalesce(p_cameras_aimed_ok,false) and coalesce(p_recording_ok,false) and coalesce(p_tower_20ft_ok,false)
    and coalesce(p_mast_lock_bolt_ok,false) and coalesce(p_panel_45deg_ok,false) and coalesce(p_panel_bolt_ok,false)
    and coalesce(p_4_sandbags_ok,false);
  if not v_complete then raise exception 'Complete every Helios field installation check before submitting to the Owner'; end if;
  v_name:=public.actor_display_name();
  update public.service_solar_checks set
    helios_field_box_mounted_ok=p_box_mounted_ok,helios_field_pv_connected_ok=p_pv_connected_ok,helios_field_ptz_secured_ok=p_ptz_secured_ok,
    helios_field_switch_pv_ok=p_switch_pv_ok,helios_field_unit_battery_on_ok=p_unit_battery_on_ok,
    helios_field_it_online_verified_ok=p_it_online_verified_ok,helios_field_cameras_aimed_ok=p_cameras_aimed_ok,
    helios_field_recording_ok=p_recording_ok,helios_field_tower_20ft_ok=p_tower_20ft_ok,helios_field_mast_lock_bolt_ok=p_mast_lock_bolt_ok,
    helios_field_panel_45deg_ok=p_panel_45deg_ok,helios_field_panel_bolt_ok=p_panel_bolt_ok,helios_field_4_sandbags_ok=p_4_sandbags_ok,
    helios_field_completed_at=now(),helios_field_completed_by=auth.uid(),helios_field_completed_by_name=v_name,
    helios_owner_verified_at=null,helios_owner_verified_by=null,helios_owner_verified_by_name=null,updated_at=now()
  where prep_ticket_id=p_prep_id;
end;
$$;
revoke all on function public.save_my_helios_field_install_v1(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon;
grant execute on function public.save_my_helios_field_install_v1(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

create or replace function public.owner_verify_helios_install_v1(p_prep_id uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare v_status public.prep_status; v_ticket text; v_test boolean; v_name text; v_helios int:=0; v_swaps int:=0; v_returns int:=0;
begin
  perform public.require_role(array['owner'::public.app_role]);
  select status,ticket_no,is_test into v_status,v_ticket,v_test from public.prep_tickets where id=p_prep_id for update;
  if not found or v_status<>'released' then raise exception 'Helios job is not waiting for Owner verification'; end if;
  select count(*) filter(where equipment_type='Helios' and purpose in ('DELIVERY','SWAP')),count(*) filter(where equipment_type='Helios' and purpose='SWAP')
  into v_helios,v_swaps from public.prep_items where prep_ticket_id=p_prep_id;
  if v_helios<1 then raise exception 'No field-installed Helios is on this ticket'; end if;
  if not exists(select 1 from public.service_solar_checks where prep_ticket_id=p_prep_id and helios_field_completed_at is not null) then raise exception 'Service has not submitted the Helios field installation'; end if;
  if (select count(*) from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_install' and kind='photo')<v_helios then raise exception 'Final Helios installation photo proof is incomplete'; end if;
  if not exists(select 1 from public.service_solar_evidence where prep_ticket_id=p_prep_id and category='helios_install' and kind='signature') then raise exception 'Final Helios installation signature is missing'; end if;
  if v_swaps>0 then
    select count(*) into v_returns from public.unit_returns
    where trim(ticket_no)=trim(v_ticket) and equipment_type='Helios' and coalesce(array_length(return_photo_paths,1),0)>0
      and nullif(trim(coalesce(return_notes,'')),'') is not null and coalesce(tag_scan_status,'')<>'mismatch';
    if v_returns<v_swaps then raise exception 'OLD UNIT RETURNING documentation is incomplete for this Helios SWAP'; end if;
  end if;
  if exists(select 1 from public.prep_items where prep_ticket_id=p_prep_id and purpose='BACKUP' and spare_outcome is null) then raise exception 'Resolve every checked-out truck spare as USED FOR SWAP or RETURN UNUSED TO SHOP before final Owner verification'; end if;
  v_name:=public.actor_display_name();
  update public.service_solar_checks set helios_owner_verified_at=now(),helios_owner_verified_by=auth.uid(),helios_owner_verified_by_name=v_name,updated_at=now() where prep_ticket_id=p_prep_id;
  update public.prep_tickets set status='closed',closed_by=auth.uid(),closed_by_name=v_name,closed_at=now() where id=p_prep_id;
  update public.job_assignments set prep_ticket_id=p_prep_id,status='completed',completed_at=now(),updated_at=now()
  where assigned_role='service' and ticket_no=v_ticket and status in ('assigned','started');
  insert into public.reports(kind,actor_id,actor_name,ticket_no,text,is_test)
  values(case when coalesce(v_test,false) then 'TEST HELIOS OWNER FINAL VERIFIED' else 'HELIOS OWNER FINAL VERIFIED' end,
    auth.uid(),v_name,v_ticket,
    'Owner '||v_name||' reviewed the Helios field-install checklist, final photos, timestamped Service signature, and any OLD UNIT RETURNING swap documentation. The Helios deployment is final verified.',
    coalesce(v_test,false));
end;
$$;
revoke all on function public.owner_verify_helios_install_v1(uuid) from public, anon;
grant execute on function public.owner_verify_helios_install_v1(uuid) to authenticated;

create or replace function public.enforce_tech_check_transition_v108()
returns trigger language plpgsql set search_path to 'public','pg_temp'
as $$
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
$$;
drop trigger if exists trg_enforce_tech_check_transition_v108 on public.prep_tickets;
create trigger trg_enforce_tech_check_transition_v108 before update of status on public.prep_tickets
for each row execute function public.enforce_tech_check_transition_v108();
revoke all on function public.enforce_tech_check_transition_v108() from public, anon, authenticated;
