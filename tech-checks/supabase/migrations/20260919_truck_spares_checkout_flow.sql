-- Tech Check truck-spare workflow.
-- Production migrations are preserved below in the exact order applied to Supabase.
-- Project: goqrnolcvqnirjmzaeyk
-- Generated from supabase_migrations.schema_migrations after successful application.

-- ============================================================
-- 20260919042119  truck_spares_checkout_flow
-- ============================================================

alter table public.prep_items
  add column if not exists spare_outcome text,
  add column if not exists spare_outcome_by uuid,
  add column if not exists spare_outcome_by_name text,
  add column if not exists spare_outcome_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='prep_items_spare_outcome_check'
      and conrelid='public.prep_items'::regclass
  ) then
    alter table public.prep_items
      add constraint prep_items_spare_outcome_check
      check (spare_outcome is null or spare_outcome in ('used','returned_unused'));
  end if;
end $$;

create table if not exists public.truck_spare_batteries (
  id uuid primary key default gen_random_uuid(),
  prep_ticket_id uuid not null references public.prep_tickets(id) on delete cascade,
  ticket_no text not null,
  equipment_type text not null,
  battery_type text not null,
  qty_prepared integer not null check (qty_prepared > 0),
  ready_ok boolean not null default false,
  prepared_by uuid not null,
  prepared_by_name text not null,
  service_tech_id uuid,
  service_tech_name text,
  status text not null default 'prepared' check (status in ('prepared','in_truck','resolved')),
  qty_used integer not null default 0 check (qty_used >= 0),
  qty_returned integer not null default 0 check (qty_returned >= 0),
  accepted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(prep_ticket_id,equipment_type,battery_type)
);

alter table public.truck_spare_batteries enable row level security;
revoke all on table public.truck_spare_batteries from anon;
revoke insert,update,delete on table public.truck_spare_batteries from authenticated;
grant select on table public.truck_spare_batteries to authenticated;

drop policy if exists truck_spare_batteries_select on public.truck_spare_batteries;
create policy truck_spare_batteries_select
on public.truck_spare_batteries
for select to authenticated
using (
  public.current_app_role()='owner'::public.app_role
  or prepared_by=(select auth.uid())
  or service_tech_id=(select auth.uid())
  or exists (
    select 1 from public.job_assignments a
    where a.ticket_no=truck_spare_batteries.ticket_no
      and a.status in ('assigned','started')
      and a.assignee_user_id=(select auth.uid())
  )
);

create or replace function public.add_it_truck_spare_unit(
  p_prep_id uuid,
  p_equipment_type text,
  p_recon_battery_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_order integer;
  v_required integer;
  v_id uuid;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select status into v_status
  from public.prep_tickets where id=p_prep_id for update;
  if not found then raise exception 'Equipment prep not found'; end if;
  if v_status<>'draft'::public.prep_status then raise exception 'Truck spares can only be added before the Service handoff'; end if;

  if p_equipment_type not in ('Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2') then
    raise exception 'Choose a camera/unit type for the truck spare';
  end if;

  v_required:=case p_equipment_type
    when 'Sniper' then 2
    when 'Ranger' then 1
    when 'Solar Spotter' then 0
    when 'Helios' then 1
    when 'Recon 2' then greatest(1,coalesce(p_recon_battery_count,1))
    else 0 end;

  select coalesce(max(item_order),0)+1 into v_order
  from public.prep_items where prep_ticket_id=p_prep_id;

  insert into public.prep_items(
    prep_ticket_id,item_order,equipment_type,purpose,required_battery_count
  )
  values(
    p_prep_id,v_order,p_equipment_type,'BACKUP'::public.prep_purpose,v_required
  )
  returning id into v_id;

  update public.prep_tickets
  set expected_unit_count=coalesce(expected_unit_count,0)+1
  where id=p_prep_id;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  select 'TRUCK SPARE ADDED',auth.uid(),public.actor_display_name(),ticket_no,
    'IT added a fully checked '||p_equipment_type||' BACKUP unit for the Service truck.'
  from public.prep_tickets where id=p_prep_id;

  return v_id;
end;
$function$;

revoke all on function public.add_it_truck_spare_unit(uuid,text,integer) from public,anon;
grant execute on function public.add_it_truck_spare_unit(uuid,text,integer) to authenticated;

create or replace function public.save_it_truck_spare_battery(
  p_prep_id uuid,
  p_equipment_type text,
  p_battery_type text,
  p_qty integer,
  p_ready_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_ticket text;
  v_qty integer:=greatest(coalesce(p_qty,0),0);
  v_type text:=btrim(coalesce(p_equipment_type,''));
  v_battery text:=btrim(coalesce(p_battery_type,''));
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select status,ticket_no into v_status,v_ticket
  from public.prep_tickets where id=p_prep_id for update;
  if not found then raise exception 'Equipment prep not found'; end if;
  if v_status<>'draft'::public.prep_status then raise exception 'Spare batteries can only be changed before the Service handoff'; end if;

  if not (
    (v_type='Solar Spotter' and v_battery in ('AGM 12V 110Ah','12V 350Ah'))
    or (v_type='Ranger' and v_battery='LiTime 12V 110Ah')
    or (v_type='Helios' and v_battery='Helios Battery Box')
    or (v_type='Recon 2' and v_battery='Recon II Battery')
  ) then
    raise exception 'That spare battery type does not match the selected equipment';
  end if;

  if v_qty=0 then
    delete from public.truck_spare_batteries
    where prep_ticket_id=p_prep_id
      and equipment_type=v_type
      and battery_type=v_battery
      and status='prepared';
    return;
  end if;

  insert into public.truck_spare_batteries(
    prep_ticket_id,ticket_no,equipment_type,battery_type,qty_prepared,ready_ok,
    prepared_by,prepared_by_name,status,updated_at
  )
  values(
    p_prep_id,v_ticket,v_type,v_battery,v_qty,coalesce(p_ready_ok,false),
    auth.uid(),public.actor_display_name(),'prepared',now()
  )
  on conflict(prep_ticket_id,equipment_type,battery_type)
  do update set
    qty_prepared=excluded.qty_prepared,
    ready_ok=excluded.ready_ok,
    prepared_by=excluded.prepared_by,
    prepared_by_name=excluded.prepared_by_name,
    updated_at=now();
end;
$function$;

revoke all on function public.save_it_truck_spare_battery(uuid,text,text,integer,boolean) from public,anon;
grant execute on function public.save_it_truck_spare_battery(uuid,text,text,integer,boolean) to authenticated;

create or replace function public.resolve_my_truck_spare_unit(
  p_item_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item public.prep_items%rowtype;
  v_prep public.prep_tickets%rowtype;
  v_name text;
  v_key text;
  v_owner boolean;
  v_asset public.asset_inventory%rowtype;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);
  v_owner:=public.current_app_role()='owner'::public.app_role;
  if p_outcome not in ('used','returned_unused') then raise exception 'Choose used or returned_unused'; end if;

  select * into v_item from public.prep_items where id=p_item_id for update;
  if not found or v_item.purpose<>'BACKUP'::public.prep_purpose then raise exception 'Truck spare unit not found'; end if;
  if v_item.spare_outcome is not null then raise exception 'This truck spare has already been resolved'; end if;

  select * into v_prep from public.prep_tickets where id=v_item.prep_ticket_id;
  if not found or v_prep.status<>'closed'::public.prep_status then raise exception 'Service must accept the IT handoff before resolving a truck spare'; end if;
  if not v_owner and v_prep.closed_by is distinct from auth.uid() then raise exception 'This truck spare is assigned to another Service Tech'; end if;

  v_name:=public.actor_display_name();
  update public.prep_items
  set spare_outcome=p_outcome,
      spare_outcome_by=auth.uid(),
      spare_outcome_by_name=v_name,
      spare_outcome_at=now()
  where id=p_item_id;

  v_key:=public.normalize_unit_key(v_item.unit_tag);

  if p_outcome='returned_unused' then
    update public.unit_registry
    set lifecycle_status='shop_inventory',
        ticket_no=null,
        prep_ticket_id=null,
        prep_item_id=null,
        current_holder_id=null,
        current_holder_name=null,
        last_event='Unused truck spare returned to shop by Service Tech '||v_name,
        updated_at=now()
    where unit_key=v_key;

    select * into v_asset from public.asset_inventory where unit_key=v_key for update;
    if found then
      insert into public.asset_inventory_history(
        unit_key,unit_tag,action,from_status,to_status,
        from_user_id,from_user_name,actor_id,actor_name,notes
      ) values(
        v_asset.unit_key,v_asset.unit_tag,'truck_spare_returned_unused',
        v_asset.availability_status,'shop',
        v_asset.assigned_to,v_asset.assigned_to_name,
        auth.uid(),v_name,'Unused truck spare returned after MHelpDesk #'||v_prep.ticket_no
      );
      update public.asset_inventory
      set availability_status='shop',assigned_to=null,assigned_to_name=null,
          last_event='Unused truck spare returned by Service Tech '||v_name,updated_at=now()
      where unit_key=v_key;
    end if;
  else
    update public.unit_registry
    set lifecycle_status='deployed',
        current_holder_id=auth.uid(),
        current_holder_name=v_name,
        last_event='Truck spare used in field on MHelpDesk #'||v_prep.ticket_no,
        updated_at=now()
    where unit_key=v_key;
  end if;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    case when p_outcome='used' then 'TRUCK SPARE USED' else 'TRUCK SPARE RETURNED UNUSED' end,
    auth.uid(),v_name,v_prep.ticket_no,
    case when p_outcome='used'
      then 'Service Tech '||v_name||' used BACKUP '||v_item.equipment_type||' '||coalesce(v_item.unit_tag,'')||' in the field. Any replaced/failed unit should be returned through IT Intake.'
      else 'Service Tech '||v_name||' checked unused BACKUP '||v_item.equipment_type||' '||coalesce(v_item.unit_tag,'')||' back into shop inventory.'
    end
  );
end;
$function$;

revoke all on function public.resolve_my_truck_spare_unit(uuid,text) from public,anon;
grant execute on function public.resolve_my_truck_spare_unit(uuid,text) to authenticated;

create or replace function public.resolve_my_truck_spare_battery(
  p_spare_id uuid,
  p_used_qty integer
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_row public.truck_spare_batteries%rowtype;
  v_used integer:=greatest(coalesce(p_used_qty,0),0);
  v_returned integer;
  v_name text;
  v_owner boolean;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);
  v_owner:=public.current_app_role()='owner'::public.app_role;

  select * into v_row from public.truck_spare_batteries where id=p_spare_id for update;
  if not found or v_row.status<>'in_truck' then raise exception 'Active truck spare battery checkout not found'; end if;
  if not v_owner and v_row.service_tech_id is distinct from auth.uid() then raise exception 'This spare battery checkout belongs to another Service Tech'; end if;
  if v_used>v_row.qty_prepared then raise exception 'Used quantity cannot exceed the prepared spare quantity'; end if;

  v_returned:=v_row.qty_prepared-v_used;
  v_name:=public.actor_display_name();

  update public.truck_spare_batteries
  set qty_used=v_used,qty_returned=v_returned,status='resolved',
      resolved_at=now(),updated_at=now()
  where id=p_spare_id;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'TRUCK SPARE BATTERIES RESOLVED',auth.uid(),v_name,v_row.ticket_no,
    'Service Tech '||v_name||' resolved spare '||v_row.battery_type||
    ': '||v_used||' used, '||v_returned||' returned unused.'
  );
end;
$function$;

revoke all on function public.resolve_my_truck_spare_battery(uuid,integer) from public,anon;
grant execute on function public.resolve_my_truck_spare_battery(uuid,integer) to authenticated;

create or replace function public.activate_truck_spares_on_close()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item record;
  v_key text;
  v_asset public.asset_inventory%rowtype;
begin
  if new.status<>'closed'::public.prep_status or old.status='closed'::public.prep_status then return new; end if;

  update public.truck_spare_batteries
  set service_tech_id=new.closed_by,
      service_tech_name=new.closed_by_name,
      status='in_truck',
      accepted_at=now(),
      updated_at=now()
  where prep_ticket_id=new.id and status='prepared';

  for v_item in
    select id,unit_tag,equipment_type
    from public.prep_items
    where prep_ticket_id=new.id and purpose='BACKUP'::public.prep_purpose
  loop
    v_key:=public.normalize_unit_key(v_item.unit_tag);
    update public.unit_registry
    set lifecycle_status='deployed',
        current_holder_id=new.closed_by,
        current_holder_name=new.closed_by_name,
        last_event='Truck spare checked out to Service Tech '||coalesce(new.closed_by_name,'Service Tech')||' for MHelpDesk #'||new.ticket_no,
        updated_at=now()
    where unit_key=v_key;

    select * into v_asset from public.asset_inventory where unit_key=v_key for update;
    if found then
      insert into public.asset_inventory_history(
        unit_key,unit_tag,action,from_status,to_status,
        from_user_id,from_user_name,to_user_id,to_user_name,
        actor_id,actor_name,notes
      ) values(
        v_asset.unit_key,v_asset.unit_tag,'truck_spare_checkout',
        v_asset.availability_status,'assigned',
        v_asset.assigned_to,v_asset.assigned_to_name,
        new.closed_by,new.closed_by_name,
        new.closed_by,new.closed_by_name,
        'Truck spare for MHelpDesk #'||new.ticket_no
      );
      update public.asset_inventory
      set availability_status='assigned',
          assigned_to=new.closed_by,
          assigned_to_name=new.closed_by_name,
          last_event='Truck spare checked out for MHelpDesk #'||new.ticket_no,
          updated_at=now()
      where unit_key=v_key;
    end if;
  end loop;

  return new;
end;
$function$;

drop trigger if exists activate_truck_spares_on_close_trigger on public.prep_tickets;
create trigger activate_truck_spares_on_close_trigger
after update of status on public.prep_tickets
for each row execute function public.activate_truck_spares_on_close();

create or replace function public.enforce_truck_spares_before_release()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if new.status='released'::public.prep_status
     and old.status is distinct from 'released'::public.prep_status
     and exists(
       select 1 from public.truck_spare_batteries b
       where b.prep_ticket_id=new.id and b.qty_prepared>0 and not b.ready_ok
     )
  then
    raise exception 'Every spare battery batch must be physically present, charged, and marked READY before the Service handoff';
  end if;
  return new;
end;
$function$;

drop trigger if exists enforce_truck_spares_before_release_trigger on public.prep_tickets;
create trigger enforce_truck_spares_before_release_trigger
before update of status on public.prep_tickets
for each row execute function public.enforce_truck_spares_before_release();

create or replace function public.validate_prep_manifest_on_release()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_expected integer := 0;
  v_actual integer := 0;
  v_item jsonb;
  v_label text;
  v_qty integer;
  v_actual_type_count integer;
begin
  if new.status::text <> 'released' or old.status::text = 'released' then return new; end if;

  if jsonb_typeof(coalesce(new.equipment_manifest,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.equipment_manifest,'[]'::jsonb)) = 0 then
    return new;
  end if;

  select coalesce(sum((value->>'qty')::integer),0)
  into v_expected
  from jsonb_array_elements(new.equipment_manifest)
  where value->>'category' in ('device','stand');

  select count(*)
  into v_actual
  from public.prep_items
  where prep_ticket_id=new.id
    and purpose<>'BACKUP'::public.prep_purpose;

  if v_actual <> v_expected then
    raise exception 'Equipment selection requires % job items, but % non-spare items were prepared. Match the Unit Area and Stand Area before release.',
      v_expected,v_actual;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(new.equipment_manifest)
    where value->>'category' in ('device','stand')
  loop
    v_label := v_item->>'label';
    v_qty := (v_item->>'qty')::integer;

    select count(*)
    into v_actual_type_count
    from public.prep_items
    where prep_ticket_id=new.id
      and purpose<>'BACKUP'::public.prep_purpose
      and equipment_type=v_label;

    if v_actual_type_count <> v_qty then
      raise exception 'Equipment selection requires % x %, but % non-spare items were prepared. Match the Unit Area / Stand Area before release.',
        v_qty,v_label,v_actual_type_count;
    end if;
  end loop;

  if exists(
    select 1
    from public.prep_items i
    where i.prep_ticket_id=new.id
      and i.purpose<>'BACKUP'::public.prep_purpose
      and not exists(
        select 1
        from jsonb_array_elements(new.equipment_manifest) m
        where m->>'category' in ('device','stand')
          and m->>'label'=i.equipment_type
      )
  ) then
    raise exception 'A prepared job-equipment type is not listed in the Unit Area / Stand Area for this ticket.';
  end if;

  return new;
end;
$function$;

create or replace function public.verify_delivery_item_checks(
  p_item_id uuid,
  p_sim_ok boolean,
  p_camera_app_ok boolean,
  p_batteries_charged_ok boolean,
  p_monitoring_ok boolean,
  p_ticket_count_ok boolean,
  p_sd_formatted_ok boolean,
  p_recording_ok boolean,
  p_customer_email_app_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_purpose public.prep_purpose;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select t.status,i.purpose
  into v_status,v_purpose
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id;
  if not found then raise exception 'Deployable prep item not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft equipment prep can be verified'; end if;
  if v_purpose not in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then
    raise exception 'Deploy-ready checks apply only to DELIVERY or BACKUP items';
  end if;
  if not coalesce(p_sim_ok,false)
     or not coalesce(p_camera_app_ok,false)
     or not coalesce(p_customer_email_app_ok,false)
     or not coalesce(p_batteries_charged_ok,false)
     or not coalesce(p_monitoring_ok,false)
     or not coalesce(p_ticket_count_ok,false)
     or not coalesce(p_sd_formatted_ok,false)
     or not coalesce(p_recording_ok,false)
  then raise exception 'All deploy-ready checks are required'; end if;

  update public.prep_items set
    delivery_sim_ok=true,
    delivery_camera_app_ok=true,
    delivery_customer_email_app_ok=true,
    delivery_batteries_charged_ok=true,
    delivery_monitoring_ok=true,
    delivery_ticket_count_ok=true,
    delivery_sd_formatted_ok=true,
    delivery_recording_ok=true
  where id=p_item_id;
end;
$function$;

create or replace function public.save_it_helios_port_checks(
  p_item_id uuid,
  p_camera1_ports_ok boolean,
  p_camera2_ports_ok boolean,
  p_ptz_ports_ok boolean,
  p_speaker_ports_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_type text;
  v_purpose public.prep_purpose;
  v_ready boolean;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select t.status, i.equipment_type, i.purpose
  into v_status, v_type, v_purpose
  from public.prep_items i
  join public.prep_tickets t on t.id = i.prep_ticket_id
  where i.id = p_item_id
  for update of i,t;

  if not found then raise exception 'Prep item not found'; end if;
  if v_status <> 'draft'::public.prep_status then
    raise exception 'Return the Service handoff to IT before editing. Completed Service verification is locked.';
  end if;
  if v_type <> 'Helios' or v_purpose not in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then
    raise exception 'Helios port checks apply only to deployable DELIVERY/BACKUP Helios items';
  end if;

  update public.prep_items
  set helios_camera1_ports_ok = coalesce(p_camera1_ports_ok,false),
      helios_camera2_ports_ok = coalesce(p_camera2_ports_ok,false),
      helios_ptz_ports_ok = coalesce(p_ptz_ports_ok,false),
      helios_speaker_ports_ok = coalesce(p_speaker_ports_ok,false)
  where id = p_item_id;

  select
    nullif(trim(unit_tag),'') is not null
    and coalesce(power_ok,false)
    and coalesce(functions_ok,false)
    and coalesce(safe_ok,false)
    and coalesce(battery_count,0) >= coalesce(required_battery_count,0)
    and coalesce(solar_mppt_updated_ok,false)
    and coalesce(solar_mppt_tested_ok,false)
    and coalesce(solar_pv_charging_ok,false)
    and coalesce(solar_panels_match_ok,false)
    and coalesce(delivery_sim_ok,false)
    and coalesce(delivery_camera_app_ok,false)
    and coalesce(delivery_customer_email_app_ok,false)
    and coalesce(delivery_batteries_charged_ok,false)
    and coalesce(delivery_monitoring_ok,false)
    and coalesce(delivery_ticket_count_ok,false)
    and coalesce(delivery_sd_formatted_ok,false)
    and coalesce(delivery_recording_ok,false)
    and coalesce(helios_camera1_ports_ok,false)
    and coalesce(helios_camera2_ports_ok,false)
    and coalesce(helios_ptz_ports_ok,false)
    and coalesce(helios_speaker_ports_ok,false)
  into v_ready
  from public.prep_items
  where id = p_item_id;

  update public.prep_items
  set verified_by = case when v_ready then auth.uid() else null end,
      verified_at = case when v_ready then now() else null end
  where id = p_item_id;
end;
$function$;

create or replace function public.enforce_helios_ports_before_release()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if new.status = 'released'::public.prep_status
     and old.status is distinct from 'released'::public.prep_status
     and exists (
       select 1
       from public.prep_items i
       where i.prep_ticket_id = new.id
         and i.equipment_type = 'Helios'
         and i.purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose)
         and not (
           coalesce(i.helios_camera1_ports_ok,false)
           and coalesce(i.helios_camera2_ports_ok,false)
           and coalesce(i.helios_ptz_ports_ok,false)
           and coalesce(i.helios_speaker_ports_ok,false)
         )
     )
  then
    raise exception 'Helios Camera 1, Camera 2, PTZ, and IP Speaker device/router port checks must all be verified before Service handoff';
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_it_solar_delivery_before_release()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if new.status::text <> 'released' or old.status::text = 'released' then return new; end if;

  if exists(
    select 1 from public.prep_items i
    where i.prep_ticket_id=new.id
      and i.equipment_type='Ranger'
      and i.purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose)
      and not(
        coalesce(i.solar_mppt_updated_ok,false)
        and coalesce(i.solar_mppt_tested_ok,false)
        and coalesce(i.solar_pv_charging_ok,false)
      )
  ) then
    raise exception 'Every deployable Ranger must have the MPPT updated/tested and battery charging verified before the Service handoff.';
  end if;

  if exists(
    select 1 from public.prep_items i
    where i.prep_ticket_id=new.id
      and i.equipment_type='Helios'
      and i.purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose)
      and not(
        coalesce(i.solar_mppt_updated_ok,false)
        and coalesce(i.solar_mppt_tested_ok,false)
        and coalesce(i.solar_pv_charging_ok,false)
        and coalesce(i.solar_panels_match_ok,false)
      )
  ) then
    raise exception 'Every deployable Helios must have Cerbo/VRM verified, MPPT updated, solar charging verified, and all 3 required 1TB SD cards confirmed before the Service handoff.';
  end if;

  return new;
end;
$function$;

create or replace function public.save_it_prep_item_draft(
  p_item_id uuid,
  p_unit_tag text,
  p_battery_count integer,
  p_power_ok boolean,
  p_functions_ok boolean,
  p_safe_ok boolean,
  p_sim_ok boolean default false,
  p_camera_app_ok boolean default false,
  p_batteries_charged_ok boolean default false,
  p_monitoring_ok boolean default false,
  p_ticket_count_ok boolean default false,
  p_sd_formatted_ok boolean default false,
  p_recording_ok boolean default false,
  p_mppt_updated_ok boolean default false,
  p_mppt_tested_ok boolean default false,
  p_pv_charging_ok boolean default false,
  p_solar_panels_match_ok boolean default false,
  p_ticket_item_match_ok boolean default false,
  p_customer_email_app_ok boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_purpose public.prep_purpose;
  v_required int;
  v_type text;
  v_tag text;
  v_count int;
  v_ready boolean;
  v_deploy_ready boolean;
  v_needs_deploy_checks boolean;
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
  v_needs_deploy_checks:=v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose);

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

  v_deploy_ready := not v_needs_deploy_checks or (
    coalesce(p_sim_ok,false)
    and coalesce(p_camera_app_ok,false)
    and coalesce(p_customer_email_app_ok,false)
    and (v_type='Solar Spotter' or coalesce(p_batteries_charged_ok,false))
    and coalesce(p_monitoring_ok,false)
    and (v_type='Helios' or coalesce(p_ticket_count_ok,false))
    and coalesce(p_sd_formatted_ok,false)
    and coalesce(p_recording_ok,false)
  );

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
      and (not v_needs_deploy_checks or (
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
    delivery_sim_ok=case when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_sim_ok,false) else false end,
    delivery_camera_app_ok=case when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_camera_app_ok,false) else false end,
    delivery_customer_email_app_ok=case when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=case
      when v_type='Solar Spotter' and v_needs_deploy_checks then true
      when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_batteries_charged_ok,false)
      else false end,
    delivery_monitoring_ok=case when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case
      when v_type='Helios' and v_needs_deploy_checks then true
      when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_ticket_count_ok,false)
      else false end,
    delivery_sd_formatted_ok=case when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_sd_formatted_ok,false) else false end,
    delivery_recording_ok=case when v_type not in ('Solar Stand','Solar Pole','110V Stand','Pole') and v_needs_deploy_checks then coalesce(p_recording_ok,false) else false end,
    solar_mppt_updated_ok=case when v_type in ('Ranger','Helios') then coalesce(p_mppt_updated_ok,false) else false end,
    solar_mppt_tested_ok=case when v_type in ('Ranger','Helios') then coalesce(p_mppt_tested_ok,false) else false end,
    solar_pv_charging_ok=case when v_type in ('Ranger','Helios') then coalesce(p_pv_charging_ok,false) else false end,
    solar_panels_match_ok=case when v_type='Helios' then coalesce(p_solar_panels_match_ok,false) else false end,
    ticket_item_match_ok=case when v_type in ('Solar Stand','Solar Pole','110V Stand','Pole') then coalesce(p_ticket_item_match_ok,false) else false end
  where id=p_item_id;
end;
$function$;

create or replace function public.release_prep(p_prep_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
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
    select 1
    from public.prep_items
    where prep_ticket_id=p_prep_id
      and equipment_type not in ('Solar Stand','Solar Pole','110V Stand','Pole')
      and purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose)
      and not(
        delivery_sim_ok
        and delivery_camera_app_ok
        and delivery_customer_email_app_ok
        and delivery_batteries_charged_ok
        and delivery_monitoring_ok
        and delivery_ticket_count_ok
        and delivery_sd_formatted_ok
        and delivery_recording_ok
      )
  ) then raise exception 'Every DELIVERY/BACKUP camera unit must pass all deploy-ready checks before the Service handoff'; end if;

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


-- ============================================================
-- 20260919042254  mark_truck_spare_checkout
-- ============================================================

alter table public.prep_items
  add column if not exists spare_checked_out_at timestamptz,
  add column if not exists spare_checked_out_to uuid,
  add column if not exists spare_checked_out_to_name text;

create or replace function public.activate_truck_spares_on_close()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item record;
  v_key text;
  v_asset public.asset_inventory%rowtype;
begin
  if new.status<>'closed'::public.prep_status or old.status='closed'::public.prep_status then return new; end if;

  update public.truck_spare_batteries
  set service_tech_id=new.closed_by,
      service_tech_name=new.closed_by_name,
      status='in_truck',
      accepted_at=now(),
      updated_at=now()
  where prep_ticket_id=new.id and status='prepared';

  update public.prep_items
  set spare_checked_out_at=now(),
      spare_checked_out_to=new.closed_by,
      spare_checked_out_to_name=new.closed_by_name
  where prep_ticket_id=new.id
    and purpose='BACKUP'::public.prep_purpose
    and spare_checked_out_at is null;

  for v_item in
    select id,unit_tag,equipment_type
    from public.prep_items
    where prep_ticket_id=new.id and purpose='BACKUP'::public.prep_purpose
  loop
    v_key:=public.normalize_unit_key(v_item.unit_tag);
    update public.unit_registry
    set lifecycle_status='deployed',
        current_holder_id=new.closed_by,
        current_holder_name=new.closed_by_name,
        last_event='Truck spare checked out to Service Tech '||coalesce(new.closed_by_name,'Service Tech')||' for MHelpDesk #'||new.ticket_no,
        updated_at=now()
    where unit_key=v_key;

    select * into v_asset from public.asset_inventory where unit_key=v_key for update;
    if found then
      insert into public.asset_inventory_history(
        unit_key,unit_tag,action,from_status,to_status,
        from_user_id,from_user_name,to_user_id,to_user_name,
        actor_id,actor_name,notes
      ) values(
        v_asset.unit_key,v_asset.unit_tag,'truck_spare_checkout',
        v_asset.availability_status,'assigned',
        v_asset.assigned_to,v_asset.assigned_to_name,
        new.closed_by,new.closed_by_name,
        new.closed_by,new.closed_by_name,
        'Truck spare for MHelpDesk #'||new.ticket_no
      );
      update public.asset_inventory
      set availability_status='assigned',
          assigned_to=new.closed_by,
          assigned_to_name=new.closed_by_name,
          last_event='Truck spare checked out for MHelpDesk #'||new.ticket_no,
          updated_at=now()
      where unit_key=v_key;
    end if;
  end loop;

  return new;
end;
$function$;


-- ============================================================
-- 20260919042544  separate_backup_from_customer_delivery_checks
-- ============================================================

create or replace function public.verify_delivery_item_checks(
  p_item_id uuid,
  p_sim_ok boolean,
  p_camera_app_ok boolean,
  p_batteries_charged_ok boolean,
  p_monitoring_ok boolean,
  p_ticket_count_ok boolean,
  p_sd_formatted_ok boolean,
  p_recording_ok boolean,
  p_customer_email_app_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_purpose public.prep_purpose;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  select t.status,i.purpose
  into v_status,v_purpose
  from public.prep_items i
  join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.id=p_item_id;
  if not found then raise exception 'Deployable prep item not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft equipment prep can be verified'; end if;
  if v_purpose not in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then
    raise exception 'Deploy-ready checks apply only to DELIVERY or BACKUP items';
  end if;

  if v_purpose='DELIVERY'::public.prep_purpose then
    if not coalesce(p_sim_ok,false)
       or not coalesce(p_camera_app_ok,false)
       or not coalesce(p_customer_email_app_ok,false)
       or not coalesce(p_batteries_charged_ok,false)
       or not coalesce(p_monitoring_ok,false)
       or not coalesce(p_ticket_count_ok,false)
       or not coalesce(p_sd_formatted_ok,false)
       or not coalesce(p_recording_ok,false)
    then raise exception 'All delivery readiness checks are required'; end if;
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
    delivery_customer_email_app_ok=case when v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=coalesce(p_batteries_charged_ok,false),
    delivery_monitoring_ok=case when v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case when v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_ticket_count_ok,false) else false end,
    delivery_sd_formatted_ok=coalesce(p_sd_formatted_ok,false),
    delivery_recording_ok=coalesce(p_recording_ok,false)
  where id=p_item_id;
end;
$function$;

create or replace function public.save_it_prep_item_draft(
  p_item_id uuid,
  p_unit_tag text,
  p_battery_count integer,
  p_power_ok boolean,
  p_functions_ok boolean,
  p_safe_ok boolean,
  p_sim_ok boolean default false,
  p_camera_app_ok boolean default false,
  p_batteries_charged_ok boolean default false,
  p_monitoring_ok boolean default false,
  p_ticket_count_ok boolean default false,
  p_sd_formatted_ok boolean default false,
  p_recording_ok boolean default false,
  p_mppt_updated_ok boolean default false,
  p_mppt_tested_ok boolean default false,
  p_pv_charging_ok boolean default false,
  p_solar_panels_match_ok boolean default false,
  p_ticket_item_match_ok boolean default false,
  p_customer_email_app_ok boolean default false
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_purpose public.prep_purpose;
  v_required int;
  v_type text;
  v_tag text;
  v_count int;
  v_ready boolean;
  v_deploy_ready boolean;
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

  v_deploy_ready := case
    when v_purpose='DELIVERY'::public.prep_purpose then
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
    delivery_sim_ok=case when v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then coalesce(p_sim_ok,false) else false end,
    delivery_camera_app_ok=case when v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then coalesce(p_camera_app_ok,false) else false end,
    delivery_customer_email_app_ok=case when v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_customer_email_app_ok,false) else false end,
    delivery_batteries_charged_ok=case
      when v_type='Solar Spotter' and v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then true
      when v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then coalesce(p_batteries_charged_ok,false)
      else false end,
    delivery_monitoring_ok=case when v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_monitoring_ok,false) else false end,
    delivery_ticket_count_ok=case
      when v_type='Helios' and v_purpose='DELIVERY'::public.prep_purpose then true
      when v_purpose='DELIVERY'::public.prep_purpose then coalesce(p_ticket_count_ok,false)
      else false end,
    delivery_sd_formatted_ok=case when v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then coalesce(p_sd_formatted_ok,false) else false end,
    delivery_recording_ok=case when v_purpose in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then coalesce(p_recording_ok,false) else false end,
    solar_mppt_updated_ok=case when v_type in ('Ranger','Helios') then coalesce(p_mppt_updated_ok,false) else false end,
    solar_mppt_tested_ok=case when v_type in ('Ranger','Helios') then coalesce(p_mppt_tested_ok,false) else false end,
    solar_pv_charging_ok=case when v_type in ('Ranger','Helios') then coalesce(p_pv_charging_ok,false) else false end,
    solar_panels_match_ok=case when v_type='Helios' then coalesce(p_solar_panels_match_ok,false) else false end,
    ticket_item_match_ok=case when v_type in ('Solar Stand','Solar Pole','110V Stand','Pole') then coalesce(p_ticket_item_match_ok,false) else false end
  where id=p_item_id;
end;
$function$;

create or replace function public.save_it_helios_port_checks(
  p_item_id uuid,
  p_camera1_ports_ok boolean,
  p_camera2_ports_ok boolean,
  p_ptz_ports_ok boolean,
  p_speaker_ports_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_type text;
  v_purpose public.prep_purpose;
  v_ready boolean;
  v_deploy_ready boolean;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select t.status, i.equipment_type, i.purpose
  into v_status, v_type, v_purpose
  from public.prep_items i
  join public.prep_tickets t on t.id = i.prep_ticket_id
  where i.id = p_item_id
  for update of i,t;

  if not found then raise exception 'Prep item not found'; end if;
  if v_status <> 'draft'::public.prep_status then
    raise exception 'Return the Service handoff to IT before editing. Completed Service verification is locked.';
  end if;
  if v_type <> 'Helios' or v_purpose not in ('DELIVERY'::public.prep_purpose,'BACKUP'::public.prep_purpose) then
    raise exception 'Helios port checks apply only to deployable DELIVERY/BACKUP Helios items';
  end if;

  update public.prep_items
  set helios_camera1_ports_ok = coalesce(p_camera1_ports_ok,false),
      helios_camera2_ports_ok = coalesce(p_camera2_ports_ok,false),
      helios_ptz_ports_ok = coalesce(p_ptz_ports_ok,false),
      helios_speaker_ports_ok = coalesce(p_speaker_ports_ok,false)
  where id = p_item_id;

  select case
    when v_purpose='DELIVERY'::public.prep_purpose then
      coalesce(delivery_sim_ok,false)
      and coalesce(delivery_camera_app_ok,false)
      and coalesce(delivery_customer_email_app_ok,false)
      and coalesce(delivery_batteries_charged_ok,false)
      and coalesce(delivery_monitoring_ok,false)
      and coalesce(delivery_ticket_count_ok,false)
      and coalesce(delivery_sd_formatted_ok,false)
      and coalesce(delivery_recording_ok,false)
    else
      coalesce(delivery_sim_ok,false)
      and coalesce(delivery_camera_app_ok,false)
      and coalesce(delivery_batteries_charged_ok,false)
      and coalesce(delivery_sd_formatted_ok,false)
      and coalesce(delivery_recording_ok,false)
  end
  into v_deploy_ready
  from public.prep_items
  where id=p_item_id;

  select
    nullif(trim(unit_tag),'') is not null
    and coalesce(power_ok,false)
    and coalesce(functions_ok,false)
    and coalesce(safe_ok,false)
    and coalesce(battery_count,0) >= coalesce(required_battery_count,0)
    and coalesce(solar_mppt_updated_ok,false)
    and coalesce(solar_mppt_tested_ok,false)
    and coalesce(solar_pv_charging_ok,false)
    and coalesce(solar_panels_match_ok,false)
    and v_deploy_ready
    and coalesce(helios_camera1_ports_ok,false)
    and coalesce(helios_camera2_ports_ok,false)
    and coalesce(helios_ptz_ports_ok,false)
    and coalesce(helios_speaker_ports_ok,false)
  into v_ready
  from public.prep_items
  where id = p_item_id;

  update public.prep_items
  set verified_by = case when v_ready then auth.uid() else null end,
      verified_at = case when v_ready then now() else null end
  where id = p_item_id;
end;
$function$;

create or replace function public.release_prep(p_prep_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
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
      and purpose='DELIVERY'::public.prep_purpose
      and not(
        delivery_sim_ok and delivery_camera_app_ok and delivery_customer_email_app_ok
        and delivery_batteries_charged_ok and delivery_monitoring_ok and delivery_ticket_count_ok
        and delivery_sd_formatted_ok and delivery_recording_ok
      )
  ) then raise exception 'Every DELIVERY camera unit must pass all delivery readiness checks before the Service handoff'; end if;

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


-- ============================================================
-- 20260919043238  require_it_truck_spare_checkout
-- ============================================================

alter table public.prep_items
  add column if not exists spare_it_checked_out_at timestamptz,
  add column if not exists spare_it_checked_out_by uuid,
  add column if not exists spare_it_checked_out_by_name text;

alter table public.truck_spare_batteries
  add column if not exists it_checked_out_at timestamptz,
  add column if not exists it_checked_out_by uuid,
  add column if not exists it_checked_out_by_name text;

create or replace function public.it_checkout_truck_spare_unit(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item public.prep_items%rowtype;
  v_prep public.prep_tickets%rowtype;
  v_name text;
  v_photo_count integer;
  v_sig_count integer;
  v_key text;
  v_asset public.asset_inventory%rowtype;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select i.* into v_item
  from public.prep_items i
  where i.id=p_item_id
  for update;
  if not found then raise exception 'Truck spare unit not found'; end if;
  if v_item.purpose<>'BACKUP'::public.prep_purpose then
    raise exception 'Only a BACKUP unit can be checked out as a truck spare';
  end if;

  select * into v_prep
  from public.prep_tickets
  where id=v_item.prep_ticket_id
  for update;
  if not found or v_prep.status<>'draft'::public.prep_status then
    raise exception 'Truck spare checkout must happen while IT is still preparing the ticket';
  end if;

  if v_item.verified_at is null then
    raise exception 'Finish all required IT checks before checking out this spare';
  end if;
  if not coalesce(v_item.photo_tag_match_ok,false) then
    raise exception 'Confirm the spare photo clearly shows the matching unit tag before checkout';
  end if;

  select count(*) filter(where kind='photo'),
         count(*) filter(where kind='signature')
  into v_photo_count,v_sig_count
  from public.handoff_evidence
  where prep_ticket_id=v_item.prep_ticket_id
    and prep_item_id=v_item.id
    and stage='it';

  if v_photo_count<>1 then
    raise exception 'This spare requires exactly one IT photo before checkout';
  end if;
  if v_sig_count<1 then
    raise exception 'This spare requires the IT signature before checkout';
  end if;

  if v_item.spare_it_checked_out_at is not null then
    return;
  end if;

  v_name:=public.actor_display_name();

  update public.prep_items
  set spare_it_checked_out_at=now(),
      spare_it_checked_out_by=auth.uid(),
      spare_it_checked_out_by_name=v_name
  where id=p_item_id;

  v_key:=public.normalize_unit_key(v_item.unit_tag);

  update public.unit_registry
  set lifecycle_status='assigned_to_tech',
      current_holder_id=auth.uid(),
      current_holder_name=v_name,
      ticket_no=v_prep.ticket_no,
      prep_ticket_id=v_prep.id,
      prep_item_id=v_item.id,
      last_event='Truck spare checked out by IT Tech '||v_name||' for MHelpDesk #'||v_prep.ticket_no,
      updated_at=now()
  where unit_key=v_key;

  select * into v_asset
  from public.asset_inventory
  where unit_key=v_key
  for update;

  if found then
    if v_asset.availability_status='assigned'
       and v_asset.assigned_to is distinct from auth.uid() then
      raise exception 'This spare is already assigned to another technician';
    end if;
    if v_asset.availability_status in ('maintenance','retired') then
      raise exception 'This spare is not available for truck checkout';
    end if;

    insert into public.asset_inventory_history(
      unit_key,unit_tag,action,from_status,to_status,
      from_user_id,from_user_name,to_user_id,to_user_name,
      actor_id,actor_name,notes
    ) values(
      v_asset.unit_key,v_asset.unit_tag,'it_truck_spare_checkout',
      v_asset.availability_status,'assigned',
      v_asset.assigned_to,v_asset.assigned_to_name,
      auth.uid(),v_name,
      auth.uid(),v_name,
      'IT checked out truck spare for MHelpDesk #'||v_prep.ticket_no
    );

    update public.asset_inventory
    set availability_status='assigned',
        assigned_to=auth.uid(),
        assigned_to_name=v_name,
        last_event='IT truck spare checkout for MHelpDesk #'||v_prep.ticket_no,
        updated_at=now()
    where unit_key=v_key;
  end if;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'IT TRUCK SPARE CHECKOUT',
    auth.uid(),v_name,v_prep.ticket_no,
    'IT Tech '||v_name||' checked out BACKUP '||v_item.equipment_type||' '||coalesce(v_item.unit_tag,'')||
    ' before the Service handoff.'
  );
end;
$function$;

revoke all on function public.it_checkout_truck_spare_unit(uuid) from public,anon;
grant execute on function public.it_checkout_truck_spare_unit(uuid) to authenticated;

create or replace function public.it_checkout_truck_spare_battery(p_spare_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_row public.truck_spare_batteries%rowtype;
  v_status public.prep_status;
  v_name text;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select * into v_row
  from public.truck_spare_batteries
  where id=p_spare_id
  for update;
  if not found then raise exception 'Spare battery batch not found'; end if;

  select status into v_status
  from public.prep_tickets
  where id=v_row.prep_ticket_id
  for update;

  if v_status<>'draft'::public.prep_status or v_row.status<>'prepared' then
    raise exception 'Spare battery checkout must happen while IT is preparing the ticket';
  end if;
  if not coalesce(v_row.ready_ok,false) then
    raise exception 'Mark the spare battery batch physically present, charged, and READY before checkout';
  end if;

  if v_row.it_checked_out_at is not null then
    return;
  end if;

  v_name:=public.actor_display_name();

  update public.truck_spare_batteries
  set it_checked_out_at=now(),
      it_checked_out_by=auth.uid(),
      it_checked_out_by_name=v_name,
      updated_at=now()
  where id=p_spare_id;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'IT TRUCK SPARE BATTERY CHECKOUT',
    auth.uid(),v_name,v_row.ticket_no,
    'IT Tech '||v_name||' checked out '||v_row.qty_prepared||' × '||v_row.battery_type||
    ' as truck spare batteries for '||v_row.equipment_type||'.'
  );
end;
$function$;

revoke all on function public.it_checkout_truck_spare_battery(uuid) from public,anon;
grant execute on function public.it_checkout_truck_spare_battery(uuid) to authenticated;

create or replace function public.enforce_truck_spares_before_release()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if new.status='released'::public.prep_status
     and old.status is distinct from 'released'::public.prep_status
  then
    if exists(
      select 1
      from public.prep_items i
      where i.prep_ticket_id=new.id
        and i.purpose='BACKUP'::public.prep_purpose
        and i.spare_it_checked_out_at is null
    ) then
      raise exception 'IT must CHECK OUT every truck spare unit before creating the Service handoff';
    end if;

    if exists(
      select 1
      from public.truck_spare_batteries b
      where b.prep_ticket_id=new.id
        and b.qty_prepared>0
        and (
          not b.ready_ok
          or b.it_checked_out_at is null
        )
    ) then
      raise exception 'Every spare battery batch must be READY and CHECKED OUT by IT before the Service handoff';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.activate_truck_spares_on_close()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_item record;
  v_key text;
  v_asset public.asset_inventory%rowtype;
begin
  if new.status<>'closed'::public.prep_status or old.status='closed'::public.prep_status then return new; end if;

  if exists(
    select 1 from public.prep_items
    where prep_ticket_id=new.id
      and purpose='BACKUP'::public.prep_purpose
      and spare_it_checked_out_at is null
  ) then
    raise exception 'Service cannot take a truck spare that IT did not check out';
  end if;

  if exists(
    select 1 from public.truck_spare_batteries
    where prep_ticket_id=new.id
      and status='prepared'
      and it_checked_out_at is null
  ) then
    raise exception 'Service cannot take spare batteries that IT did not check out';
  end if;

  update public.truck_spare_batteries
  set service_tech_id=new.closed_by,
      service_tech_name=new.closed_by_name,
      status='in_truck',
      accepted_at=now(),
      updated_at=now()
  where prep_ticket_id=new.id
    and status='prepared'
    and it_checked_out_at is not null;

  update public.prep_items
  set spare_checked_out_at=now(),
      spare_checked_out_to=new.closed_by,
      spare_checked_out_to_name=new.closed_by_name
  where prep_ticket_id=new.id
    and purpose='BACKUP'::public.prep_purpose
    and spare_it_checked_out_at is not null
    and spare_checked_out_at is null;

  for v_item in
    select id,unit_tag,equipment_type
    from public.prep_items
    where prep_ticket_id=new.id
      and purpose='BACKUP'::public.prep_purpose
      and spare_it_checked_out_at is not null
  loop
    v_key:=public.normalize_unit_key(v_item.unit_tag);

    update public.unit_registry
    set lifecycle_status='deployed',
        current_holder_id=new.closed_by,
        current_holder_name=new.closed_by_name,
        last_event='IT checkout accepted by Service Tech '||coalesce(new.closed_by_name,'Service Tech')||
          ' for truck spare on MHelpDesk #'||new.ticket_no,
        updated_at=now()
    where unit_key=v_key;

    select * into v_asset
    from public.asset_inventory
    where unit_key=v_key
    for update;

    if found then
      insert into public.asset_inventory_history(
        unit_key,unit_tag,action,from_status,to_status,
        from_user_id,from_user_name,to_user_id,to_user_name,
        actor_id,actor_name,notes
      ) values(
        v_asset.unit_key,v_asset.unit_tag,'service_accepts_it_spare_checkout',
        v_asset.availability_status,'assigned',
        v_asset.assigned_to,v_asset.assigned_to_name,
        new.closed_by,new.closed_by_name,
        new.closed_by,new.closed_by_name,
        'Service accepted IT-checked-out truck spare for MHelpDesk #'||new.ticket_no
      );

      update public.asset_inventory
      set availability_status='assigned',
          assigned_to=new.closed_by,
          assigned_to_name=new.closed_by_name,
          last_event='Service accepted IT truck spare checkout for MHelpDesk #'||new.ticket_no,
          updated_at=now()
      where unit_key=v_key;
    end if;
  end loop;

  return new;
end;
$function$;


-- ============================================================
-- 20260919043359  lock_it_checked_out_truck_spares
-- ============================================================

create or replace function public.lock_checked_out_truck_spare_prep()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if old.purpose='BACKUP'::public.prep_purpose
     and old.spare_it_checked_out_at is not null
     and (
       new.unit_tag is distinct from old.unit_tag
       or new.equipment_type is distinct from old.equipment_type
       or new.purpose is distinct from old.purpose
       or new.required_battery_count is distinct from old.required_battery_count
       or new.battery_count is distinct from old.battery_count
       or new.power_ok is distinct from old.power_ok
       or new.functions_ok is distinct from old.functions_ok
       or new.safe_ok is distinct from old.safe_ok
       or new.delivery_sim_ok is distinct from old.delivery_sim_ok
       or new.delivery_camera_app_ok is distinct from old.delivery_camera_app_ok
       or new.delivery_customer_email_app_ok is distinct from old.delivery_customer_email_app_ok
       or new.delivery_batteries_charged_ok is distinct from old.delivery_batteries_charged_ok
       or new.delivery_monitoring_ok is distinct from old.delivery_monitoring_ok
       or new.delivery_ticket_count_ok is distinct from old.delivery_ticket_count_ok
       or new.delivery_sd_formatted_ok is distinct from old.delivery_sd_formatted_ok
       or new.delivery_recording_ok is distinct from old.delivery_recording_ok
       or new.solar_mppt_updated_ok is distinct from old.solar_mppt_updated_ok
       or new.solar_mppt_tested_ok is distinct from old.solar_mppt_tested_ok
       or new.solar_pv_charging_ok is distinct from old.solar_pv_charging_ok
       or new.solar_panels_match_ok is distinct from old.solar_panels_match_ok
       or new.ticket_item_match_ok is distinct from old.ticket_item_match_ok
       or new.helios_camera1_ports_ok is distinct from old.helios_camera1_ports_ok
       or new.helios_camera2_ports_ok is distinct from old.helios_camera2_ports_ok
       or new.helios_ptz_ports_ok is distinct from old.helios_ptz_ports_ok
       or new.helios_speaker_ports_ok is distinct from old.helios_speaker_ports_ok
       or new.photo_tag_match_ok is distinct from old.photo_tag_match_ok
       or new.verified_at is distinct from old.verified_at
       or new.verified_by is distinct from old.verified_by
     )
  then
    raise exception 'This truck spare has already been checked out by IT. Return/cancel the checkout before changing its prep details.';
  end if;
  return new;
end;
$function$;

drop trigger if exists lock_checked_out_truck_spare_prep_trigger on public.prep_items;
create trigger lock_checked_out_truck_spare_prep_trigger
before update on public.prep_items
for each row execute function public.lock_checked_out_truck_spare_prep();

create or replace function public.save_it_truck_spare_battery(
  p_prep_id uuid,
  p_equipment_type text,
  p_battery_type text,
  p_qty integer,
  p_ready_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_status public.prep_status;
  v_ticket text;
  v_qty integer:=greatest(coalesce(p_qty,0),0);
  v_type text:=btrim(coalesce(p_equipment_type,''));
  v_battery text:=btrim(coalesce(p_battery_type,''));
  v_existing public.truck_spare_batteries%rowtype;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select status,ticket_no into v_status,v_ticket
  from public.prep_tickets where id=p_prep_id for update;
  if not found then raise exception 'Equipment prep not found'; end if;
  if v_status<>'draft'::public.prep_status then
    raise exception 'Spare batteries can only be changed before the Service handoff';
  end if;

  if not (
    (v_type='Solar Spotter' and v_battery in ('AGM 12V 110Ah','12V 350Ah'))
    or (v_type='Ranger' and v_battery='LiTime 12V 110Ah')
    or (v_type='Helios' and v_battery='Helios Battery Box')
    or (v_type='Recon 2' and v_battery='Recon II Battery')
  ) then
    raise exception 'That spare battery type does not match the selected equipment';
  end if;

  select * into v_existing
  from public.truck_spare_batteries
  where prep_ticket_id=p_prep_id
    and equipment_type=v_type
    and battery_type=v_battery
  for update;

  if found and v_existing.it_checked_out_at is not null then
    raise exception 'This spare battery batch has already been checked out by IT and is locked';
  end if;

  if v_qty=0 then
    delete from public.truck_spare_batteries
    where prep_ticket_id=p_prep_id
      and equipment_type=v_type
      and battery_type=v_battery
      and status='prepared'
      and it_checked_out_at is null;
    return;
  end if;

  insert into public.truck_spare_batteries(
    prep_ticket_id,ticket_no,equipment_type,battery_type,qty_prepared,ready_ok,
    prepared_by,prepared_by_name,status,updated_at
  )
  values(
    p_prep_id,v_ticket,v_type,v_battery,v_qty,coalesce(p_ready_ok,false),
    auth.uid(),public.actor_display_name(),'prepared',now()
  )
  on conflict(prep_ticket_id,equipment_type,battery_type)
  do update set
    qty_prepared=excluded.qty_prepared,
    ready_ok=excluded.ready_ok,
    prepared_by=excluded.prepared_by,
    prepared_by_name=excluded.prepared_by_name,
    updated_at=now();
end;
$function$;
