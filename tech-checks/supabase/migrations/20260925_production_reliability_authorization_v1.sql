-- Tech Check production reliability hardening — 2026-09-25
-- Consolidates the live Supabase reliability migrations applied during the
-- Solar/Helios, Service Return, IT Intake, handoff-ownership, and Owner Closeout audit.
-- This file is intentionally idempotent so repository state can reproduce the
-- authoritative production backend without changing technician UI behavior.

create or replace function public.enforce_service_solar_assignment_write_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
  v_prep_id uuid;
  v_ticket text;
  v_is_test boolean;
begin
  v_role:=public.current_app_role();

  if v_role='owner'::public.app_role then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_role is distinct from 'service'::public.app_role then
    raise exception 'Service or Owner access required';
  end if;

  v_prep_id:=case when tg_op='DELETE' then old.prep_ticket_id else new.prep_ticket_id end;

  select p.ticket_no,coalesce(p.is_test,false)
  into v_ticket,v_is_test
  from public.prep_tickets p
  where p.id=v_prep_id;

  if not found then
    raise exception 'Equipment prep not found';
  end if;

  if not exists(
    select 1
    from public.job_assignments a
    where a.assigned_role='service'
      and a.assignee_user_id=auth.uid()
      and a.status in ('assigned','started')
      and (
        a.prep_ticket_id=v_prep_id
        or (a.prep_ticket_id is null and btrim(a.ticket_no)=btrim(v_ticket))
      )
      and (
        (v_is_test and a.created_from='owner_test_center')
        or
        (not v_is_test and coalesce(a.created_from,'')<>'owner_test_center')
      )
  ) then
    raise exception 'This Service handoff is not actively assigned to you';
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

drop trigger if exists trg_service_solar_checks_assignment_write on public.service_solar_checks;
create trigger trg_service_solar_checks_assignment_write
before insert or update or delete on public.service_solar_checks
for each row execute function public.enforce_service_solar_assignment_write_v1();

drop trigger if exists trg_service_solar_evidence_assignment_write on public.service_solar_evidence;
create trigger trg_service_solar_evidence_assignment_write
before insert or update or delete on public.service_solar_evidence
for each row execute function public.enforce_service_solar_assignment_write_v1();

revoke all on function public.enforce_service_solar_assignment_write_v1() from public;
revoke execute on function public.enforce_service_solar_assignment_write_v1() from anon, authenticated;
grant execute on function public.enforce_service_solar_assignment_write_v1() to postgres, service_role;

create or replace function public.save_my_helios_field_install_v1(
  p_prep_id uuid,
  p_box_mounted_ok boolean,
  p_pv_connected_ok boolean,
  p_ptz_secured_ok boolean,
  p_switch_pv_ok boolean,
  p_unit_battery_on_ok boolean,
  p_it_online_verified_ok boolean,
  p_cameras_aimed_ok boolean,
  p_recording_ok boolean,
  p_tower_20ft_ok boolean,
  p_mast_lock_bolt_ok boolean,
  p_panel_45deg_ok boolean,
  p_panel_bolt_ok boolean,
  p_4_sandbags_ok boolean
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
  v_status public.prep_status;
  v_ticket text;
  v_is_test boolean;
  v_helios int:=0;
  v_swaps int:=0;
  v_returns int:=0;
  v_name text;
  v_complete boolean;
  v_check public.service_solar_checks%rowtype;
begin
  v_role:=public.current_app_role();
  if v_role not in ('service'::public.app_role,'owner'::public.app_role) then
    raise exception 'Service or Owner access required';
  end if;

  select status,ticket_no,coalesce(is_test,false)
  into v_status,v_ticket,v_is_test
  from public.prep_tickets
  where id=p_prep_id
  for update;

  if not found or v_status<>'released' then
    raise exception 'Helios handoff is not open for field installation';
  end if;

  if v_role='service'::public.app_role and not exists(
    select 1
    from public.job_assignments a
    where a.assigned_role='service'
      and a.assignee_user_id=auth.uid()
      and a.status in ('assigned','started')
      and (
        a.prep_ticket_id=p_prep_id
        or (a.prep_ticket_id is null and btrim(a.ticket_no)=btrim(v_ticket))
      )
      and (
        (v_is_test and a.created_from='owner_test_center')
        or
        (not v_is_test and coalesce(a.created_from,'')<>'owner_test_center')
      )
  ) then
    raise exception 'This Service handoff is not actively assigned to you';
  end if;

  select *
  into v_check
  from public.service_solar_checks
  where prep_ticket_id=p_prep_id
  for update;

  if not found then
    raise exception 'Complete the Helios Service workflow before final submission';
  end if;

  if v_check.helios_field_completed_at is not null then
    return;
  end if;

  if exists(
    select 1 from public.prep_items
    where prep_ticket_id=p_prep_id
      and equipment_type='Helios'
      and purpose='SWAP'
      and swap_outcome is null
  ) then
    raise exception 'Answer whether each Helios SWAP replacement was actually installed before submitting the field installation.';
  end if;

  select
    count(*) filter(
      where equipment_type='Helios'
        and (purpose='DELIVERY' or (purpose='SWAP' and swap_outcome='installed'))
    ),
    count(*) filter(
      where equipment_type='Helios'
        and purpose='SWAP'
        and swap_outcome='installed'
    )
  into v_helios,v_swaps
  from public.prep_items
  where prep_ticket_id=p_prep_id;

  if v_helios<1 then
    raise exception 'No installed Helios remains on this ticket. Unused SWAP replacement units should return through IT Intake.';
  end if;

  if v_check.handoff_accepted_at is null then
    raise exception 'Accept the IT handoff after completing the yard test first';
  end if;

  if v_swaps>0 then
    select count(*) into v_returns
    from public.unit_returns r
    where btrim(r.ticket_no)=btrim(v_ticket)
      and r.equipment_type='Helios'
      and coalesce(array_length(r.return_photo_paths,1),0)>0
      and nullif(btrim(coalesce(r.return_notes,'')),'') is not null
      and coalesce(r.tag_scan_status,'')<>'mismatch'
      and not exists(
        select 1
        from public.prep_items replacement
        where replacement.prep_ticket_id=p_prep_id
          and replacement.purpose='SWAP'
          and public.normalize_unit_key(replacement.unit_tag)=public.normalize_unit_key(r.unit_tag)
      );

    if v_returns<v_swaps then
      raise exception 'Each installed Helios SWAP requires the OLD UNIT RETURNING tag photo, reason/issues/repair notes, and Service Return before final install submission';
    end if;
  end if;

  if (
    select count(*)
    from public.service_solar_evidence
    where prep_ticket_id=p_prep_id
      and category='helios_install'
      and kind='photo'
  )<v_helios then
    raise exception 'Upload at least one final installation photo for each installed Helios';
  end if;

  if not exists(
    select 1
    from public.service_solar_evidence
    where prep_ticket_id=p_prep_id
      and category='helios_install'
      and kind='signature'
  ) then
    raise exception 'A dated Service installation signature is required';
  end if;

  v_complete:=coalesce(p_box_mounted_ok,false)
    and coalesce(p_pv_connected_ok,false)
    and coalesce(p_ptz_secured_ok,false)
    and coalesce(p_switch_pv_ok,false)
    and coalesce(p_unit_battery_on_ok,false)
    and coalesce(p_it_online_verified_ok,false)
    and coalesce(p_cameras_aimed_ok,false)
    and coalesce(p_recording_ok,false)
    and coalesce(p_tower_20ft_ok,false)
    and coalesce(p_mast_lock_bolt_ok,false)
    and coalesce(p_panel_45deg_ok,false)
    and coalesce(p_panel_bolt_ok,false)
    and coalesce(p_4_sandbags_ok,false);

  if not v_complete then
    raise exception 'Complete every Helios field installation check before submitting to the Owner';
  end if;

  if not (
    coalesce(v_check.helios_field_box_mounted_ok,false)
    and coalesce(v_check.helios_field_pv_connected_ok,false)
    and coalesce(v_check.helios_field_ptz_secured_ok,false)
    and coalesce(v_check.helios_field_switch_pv_ok,false)
    and coalesce(v_check.helios_field_unit_battery_on_ok,false)
    and coalesce(v_check.helios_field_it_online_verified_ok,false)
    and coalesce(v_check.helios_field_cameras_aimed_ok,false)
    and coalesce(v_check.helios_field_panel_45deg_ok,false)
    and coalesce(v_check.helios_field_panel_bolt_ok,false)
    and coalesce(v_check.helios_field_tower_20ft_ok,false)
    and coalesce(v_check.helios_field_mast_lock_bolt_ok,false)
    and coalesce(v_check.helios_field_recording_ok,false)
    and coalesce(v_check.helios_field_4_sandbags_ok,false)
  ) then
    raise exception 'Saved Helios field-install steps are incomplete. Reload Tech Check and finish the required steps in order.';
  end if;

  v_name:=public.actor_display_name();

  update public.service_solar_checks
  set helios_field_completed_at=now(),
      helios_field_completed_by=auth.uid(),
      helios_field_completed_by_name=v_name,
      updated_at=now()
  where prep_ticket_id=p_prep_id;
end;
$function$;

drop policy if exists unit_returns_authenticated_insert on public.unit_returns;
drop policy if exists unit_returns_service_started_insert on public.unit_returns;
create policy unit_returns_service_started_insert
on public.unit_returns
for insert
to authenticated
with check (
  auth.uid()=service_tech_id
  and status='waiting_it'
  and exists(
    select 1
    from public.profiles p
    where p.user_id=auth.uid()
      and p.active=true
      and p.archived_at is null
      and p.role='service'::public.app_role
  )
  and exists(
    select 1
    from public.job_assignments a
    where a.assigned_role='service'
      and a.assignee_user_id=auth.uid()
      and a.status='started'
      and btrim(a.ticket_no)=btrim(unit_returns.ticket_no)
  )
);

create or replace function public.enforce_service_unit_return_insert_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
begin
  v_role:=public.current_app_role();

  if v_role='owner'::public.app_role then
    return new;
  end if;

  if v_role is distinct from 'service'::public.app_role then
    raise exception 'Service or Owner access required';
  end if;

  if new.service_tech_id is distinct from auth.uid() then
    raise exception 'Service return technician does not match the signed-in Service Tech';
  end if;

  if nullif(btrim(coalesce(new.ticket_no,'')),'') is null then
    raise exception 'MHelpDesk ticket number is required';
  end if;

  if new.prep_item_id is not null and exists(
    select 1
    from public.prep_items i
    join public.prep_tickets p on p.id=i.prep_ticket_id
    where i.id=new.prep_item_id
      and i.purpose='BACKUP'::public.prep_purpose
      and p.status='closed'::public.prep_status
      and p.closed_by=auth.uid()
      and btrim(p.ticket_no)=btrim(new.ticket_no)
  ) then
    return new;
  end if;

  if not exists(
    select 1
    from public.job_assignments a
    where a.assigned_role='service'
      and a.assignee_user_id=auth.uid()
      and a.status='started'
      and btrim(a.ticket_no)=btrim(new.ticket_no)
  ) then
    raise exception 'Start your assigned Service job before recording a return for this MHelpDesk ticket';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_service_unit_return_insert_authorization on public.unit_returns;
create trigger trg_service_unit_return_insert_authorization
before insert on public.unit_returns
for each row execute function public.enforce_service_unit_return_insert_v1();

revoke all on function public.enforce_service_unit_return_insert_v1() from public;
revoke execute on function public.enforce_service_unit_return_insert_v1() from anon, authenticated;
grant execute on function public.enforce_service_unit_return_insert_v1() to postgres, service_role;

drop policy if exists unit_returns_it_owner_update on public.unit_returns;
drop policy if exists unit_returns_owner_update on public.unit_returns;
drop policy if exists unit_returns_it_waiting_update on public.unit_returns;

create policy unit_returns_owner_update
on public.unit_returns
for update
to authenticated
using (
  exists(
    select 1 from public.profiles p
    where p.user_id=auth.uid()
      and p.active=true
      and p.archived_at is null
      and p.role='owner'::public.app_role
  )
)
with check (
  exists(
    select 1 from public.profiles p
    where p.user_id=auth.uid()
      and p.active=true
      and p.archived_at is null
      and p.role='owner'::public.app_role
  )
);

create policy unit_returns_it_waiting_update
on public.unit_returns
for update
to authenticated
using (
  status='waiting_it'
  and exists(
    select 1 from public.profiles p
    where p.user_id=auth.uid()
      and p.active=true
      and p.archived_at is null
      and p.role='it'::public.app_role
  )
)
with check (
  status in ('waiting_it','pending_mhelp_inventory')
  and exists(
    select 1 from public.profiles p
    where p.user_id=auth.uid()
      and p.active=true
      and p.archived_at is null
      and p.role='it'::public.app_role
  )
);

create or replace function public.enforce_it_intake_completion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
  v_encoded text;
  v_meta jsonb;
  v_answers jsonb;
  v_doc jsonb;
  v_name text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status<>'pending_mhelp_inventory' then
    return new;
  end if;

  v_role:=public.current_app_role();
  if v_role not in ('it'::public.app_role,'owner'::public.app_role) then
    raise exception 'IT or Owner access required for IT Intake completion';
  end if;

  if old.status<>'waiting_it' then
    raise exception 'This return is no longer waiting for IT Intake. Reload Tech Check before continuing.';
  end if;

  if coalesce(cardinality(new.intake_photo_paths),0)<1 then
    raise exception 'Take and save the required IT Intake photo before completing intake.';
  end if;

  if position('[[INTAKE_META:' in coalesce(new.damage_notes,''))=0 then
    raise exception 'Saved IT Intake checklist metadata is missing. Reload Tech Check and complete the intake questions.';
  end if;

  v_encoded:=split_part(
    split_part(coalesce(new.damage_notes,''),'[[INTAKE_META:',2),
    ']]',
    1
  );

  if nullif(v_encoded,'') is null then
    raise exception 'Saved IT Intake checklist metadata is missing. Reload Tech Check and complete the intake questions.';
  end if;

  begin
    v_meta:=convert_from(decode(v_encoded,'base64'),'UTF8')::jsonb;
  exception when others then
    raise exception 'Saved IT Intake checklist metadata is invalid. Reload Tech Check and complete the intake questions.';
  end;

  v_answers:=v_meta->'answers';
  if jsonb_typeof(v_answers) is distinct from 'array'
     or jsonb_array_length(v_answers)<>15
     or exists(
       select 1
       from jsonb_array_elements(v_answers) as x(value)
       where x.value is distinct from 'true'::jsonb
     )
  then
    raise exception 'Every required IT Intake check must be YES before the unit can move forward.';
  end if;

  v_doc:=v_meta->'cancellationDoc';
  if jsonb_typeof(v_doc) is distinct from 'object'
     or nullif(btrim(coalesce(v_doc->>'simCanceledDate','')),'') is null
     or nullif(btrim(coalesce(v_doc->>'ticket','')),'') is null
     or btrim(coalesce(v_doc->>'ticket',''))<>btrim(new.ticket_no)
     or nullif(btrim(coalesce(v_doc->>'unit','')),'') is null
     or public.normalize_unit_key(v_doc->>'unit') is distinct from public.normalize_unit_key(new.unit_tag)
     or nullif(btrim(coalesce(v_doc->>'techInitials','')),'') is null
     or nullif(btrim(coalesce(v_doc->>'techName','')),'') is null
  then
    raise exception 'SIM cancellation documentation must include the date, matching MHelpDesk ticket, matching unit, and IT technician identification.';
  end if;

  if v_role='it'::public.app_role then
    v_name:=public.actor_display_name();
    new.it_tech_id:=auth.uid();
    new.it_tech_name:=v_name;
    new.it_received_at:=coalesce(new.it_received_at,now());
  end if;

  new.mhelp_inventory_confirmed:=false;
  new.mhelp_confirmed_at:=null;
  new.completed_at:=null;
  new.updated_at:=now();

  return new;
end;
$function$;

drop trigger if exists trg_enforce_it_intake_completion on public.unit_returns;
create trigger trg_enforce_it_intake_completion
before update of status on public.unit_returns
for each row execute function public.enforce_it_intake_completion_v1();

revoke all on function public.enforce_it_intake_completion_v1() from public;
revoke execute on function public.enforce_it_intake_completion_v1() from anon, authenticated;
grant execute on function public.enforce_it_intake_completion_v1() to postgres, service_role;

create or replace function public.enforce_it_damage_hold_actor_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
  v_name text;
begin
  if new.status<>'needs_replacement' then
    return new;
  end if;

  v_role:=public.current_app_role();

  if v_role='owner'::public.app_role then
    return new;
  end if;

  if v_role is distinct from 'it'::public.app_role then
    raise exception 'IT or Owner access required for a Needs Replacement hold';
  end if;

  if old.status='waiting_it' then
    v_name:=public.actor_display_name();
    new.it_tech_id:=auth.uid();
    new.it_tech_name:=v_name;
    new.it_received_at:=coalesce(new.it_received_at,now());
    return new;
  end if;

  if old.status='needs_replacement' then
    if old.it_tech_id is distinct from auth.uid() then
      raise exception 'This Needs Replacement hold was already recorded by another IT Tech. Reload Tech Check before continuing.';
    end if;
    return new;
  end if;

  raise exception 'This return is no longer waiting for IT Intake. Reload Tech Check before continuing.';
end;
$function$;

drop trigger if exists trg_enforce_it_damage_hold_actor on public.unit_returns;
create trigger trg_enforce_it_damage_hold_actor
before update on public.unit_returns
for each row
when (new.status='needs_replacement')
execute function public.enforce_it_damage_hold_actor_v1();

revoke all on function public.enforce_it_damage_hold_actor_v1() from public;
revoke execute on function public.enforce_it_damage_hold_actor_v1() from anon, authenticated;
grant execute on function public.enforce_it_damage_hold_actor_v1() to postgres, service_role;

create or replace function public.enforce_return_inventory_completion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
begin
  if new.status is not distinct from old.status or new.status<>'completed' then
    return new;
  end if;

  v_role:=public.current_app_role();

  if v_role is distinct from 'owner'::public.app_role then
    raise exception 'Owner confirmation is required before this return can become completed Shop Inventory';
  end if;

  if old.status<>'pending_mhelp_inventory' then
    raise exception 'This return is not waiting for Owner MHelpDesk inventory confirmation';
  end if;

  if coalesce(new.mhelp_inventory_confirmed,false) is not true then
    raise exception 'Confirm the unit was added back to MHelpDesk inventory before completing this return';
  end if;

  new.mhelp_confirmed_at:=coalesce(new.mhelp_confirmed_at,now());
  new.completed_at:=coalesce(new.completed_at,now());
  new.updated_at:=now();

  return new;
end;
$function$;

drop trigger if exists trg_enforce_return_inventory_completion on public.unit_returns;
create trigger trg_enforce_return_inventory_completion
before update of status on public.unit_returns
for each row execute function public.enforce_return_inventory_completion_v1();

revoke all on function public.enforce_return_inventory_completion_v1() from public;
revoke execute on function public.enforce_return_inventory_completion_v1() from anon, authenticated;
grant execute on function public.enforce_return_inventory_completion_v1() to postgres, service_role;

create or replace function public.enforce_unit_return_identity_immutable_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
begin
  v_role:=public.current_app_role();

  if v_role='owner'::public.app_role then
    return new;
  end if;

  if v_role not in ('service'::public.app_role,'it'::public.app_role) then
    return new;
  end if;

  if btrim(coalesce(new.ticket_no,'')) is distinct from btrim(coalesce(old.ticket_no,'')) then
    raise exception 'The MHelpDesk ticket on a saved return cannot be changed. Start a new return if the ticket was entered incorrectly.';
  end if;

  if new.service_tech_id is distinct from old.service_tech_id then
    raise exception 'The Service Tech origin on a saved return cannot be changed.';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_unit_return_identity_immutable on public.unit_returns;
create trigger trg_enforce_unit_return_identity_immutable
before update on public.unit_returns
for each row execute function public.enforce_unit_return_identity_immutable_v1();

revoke all on function public.enforce_unit_return_identity_immutable_v1() from public;
revoke execute on function public.enforce_unit_return_identity_immutable_v1() from anon, authenticated;
grant execute on function public.enforce_unit_return_identity_immutable_v1() to postgres, service_role;

create or replace function public.enforce_prep_handoff_assignment_transition_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
  v_required_role text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status='draft'::public.prep_status and new.status='released'::public.prep_status then
    v_required_role:='it';
  elsif old.status='released'::public.prep_status and new.status='closed'::public.prep_status then
    v_required_role:='service';
  else
    return new;
  end if;

  v_role:=public.current_app_role();
  if v_role='owner'::public.app_role then
    return new;
  end if;

  if v_role::text is distinct from v_required_role then
    raise exception '% or Owner access required for this handoff transition',upper(v_required_role);
  end if;

  if not exists(
    select 1
    from public.job_assignments a
    where a.assigned_role=v_required_role
      and a.assignee_user_id=auth.uid()
      and a.status in ('assigned','started')
      and (
        a.prep_ticket_id=new.id
        or (a.prep_ticket_id is null and btrim(a.ticket_no)=btrim(new.ticket_no))
      )
      and (
        (coalesce(new.is_test,false) and a.created_from='owner_test_center')
        or
        (not coalesce(new.is_test,false) and coalesce(a.created_from,'')<>'owner_test_center')
      )
  ) then
    raise exception 'This % handoff is not actively assigned to you',upper(v_required_role);
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_prep_handoff_assignment_transition on public.prep_tickets;
create trigger trg_enforce_prep_handoff_assignment_transition
before update of status on public.prep_tickets
for each row execute function public.enforce_prep_handoff_assignment_transition_v1();

revoke all on function public.enforce_prep_handoff_assignment_transition_v1() from public;
revoke execute on function public.enforce_prep_handoff_assignment_transition_v1() from anon, authenticated;
grant execute on function public.enforce_prep_handoff_assignment_transition_v1() to postgres, service_role;

create or replace function public.enforce_handoff_evidence_assignment_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
  v_prep_id uuid;
  v_stage text;
  v_ticket text;
  v_is_test boolean;
begin
  v_role:=public.current_app_role();
  if v_role='owner'::public.app_role then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  v_prep_id:=case when tg_op='DELETE' then old.prep_ticket_id else new.prep_ticket_id end;
  v_stage:=case when tg_op='DELETE' then old.stage else new.stage end;

  if v_stage not in ('it','service') then
    raise exception 'Invalid handoff stage';
  end if;

  if v_role::text is distinct from v_stage then
    raise exception 'Only the assigned % technician or Owner can change this handoff evidence',upper(v_stage);
  end if;

  select p.ticket_no,coalesce(p.is_test,false)
  into v_ticket,v_is_test
  from public.prep_tickets p
  where p.id=v_prep_id;

  if not found then
    raise exception 'Equipment prep not found';
  end if;

  if not exists(
    select 1
    from public.job_assignments a
    where a.assigned_role=v_stage
      and a.assignee_user_id=auth.uid()
      and a.status in ('assigned','started')
      and (
        a.prep_ticket_id=v_prep_id
        or (a.prep_ticket_id is null and btrim(a.ticket_no)=btrim(v_ticket))
      )
      and (
        (v_is_test and a.created_from='owner_test_center')
        or
        (not v_is_test and coalesce(a.created_from,'')<>'owner_test_center')
      )
  ) then
    raise exception 'This % handoff is not actively assigned to you',upper(v_stage);
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$function$;

drop trigger if exists trg_enforce_handoff_evidence_assignment on public.handoff_evidence;
create trigger trg_enforce_handoff_evidence_assignment
before insert or update or delete on public.handoff_evidence
for each row execute function public.enforce_handoff_evidence_assignment_v1();

revoke all on function public.enforce_handoff_evidence_assignment_v1() from public;
revoke execute on function public.enforce_handoff_evidence_assignment_v1() from anon, authenticated;
grant execute on function public.enforce_handoff_evidence_assignment_v1() to postgres, service_role;

create or replace function public.enforce_service_parts_assignment_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_role public.app_role;
begin
  if new.service_parts_confirmed is not distinct from old.service_parts_confirmed then
    return new;
  end if;

  v_role:=public.current_app_role();
  if v_role='owner'::public.app_role then
    return new;
  end if;

  if v_role is distinct from 'service'::public.app_role then
    raise exception 'Service or Owner access required to confirm Service parts';
  end if;

  if not exists(
    select 1
    from public.job_assignments a
    where a.assigned_role='service'
      and a.assignee_user_id=auth.uid()
      and a.status in ('assigned','started')
      and (
        a.prep_ticket_id=new.id
        or (a.prep_ticket_id is null and btrim(a.ticket_no)=btrim(new.ticket_no))
      )
      and (
        (coalesce(new.is_test,false) and a.created_from='owner_test_center')
        or
        (not coalesce(new.is_test,false) and coalesce(a.created_from,'')<>'owner_test_center')
      )
  ) then
    raise exception 'This Service handoff is not actively assigned to you';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_service_parts_assignment on public.prep_tickets;
create trigger trg_enforce_service_parts_assignment
before update of service_parts_confirmed on public.prep_tickets
for each row execute function public.enforce_service_parts_assignment_v1();

revoke all on function public.enforce_service_parts_assignment_v1() from public;
revoke execute on function public.enforce_service_parts_assignment_v1() from anon, authenticated;
grant execute on function public.enforce_service_parts_assignment_v1() to postgres, service_role;

create or replace function public.owner_close_job_v1(p_ticket_no text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_ticket text:=btrim(coalesce(p_ticket_no,''));
  v_summary jsonb;
  v_name text;
  v_existing public.owner_job_reviews%rowtype;
begin
  perform public.require_role(array['owner'::public.app_role]);

  if v_ticket='' then
    raise exception 'MHelpDesk ticket number is required';
  end if;

  select *
  into v_existing
  from public.owner_job_reviews
  where ticket_no=v_ticket
  for update;

  if found and v_existing.status='closed' then
    return jsonb_build_object(
      'closed',true,
      'already_closed',true,
      'ticket_no',v_ticket,
      'reviewed_by_name',v_existing.reviewed_by_name,
      'summary',coalesce(v_existing.summary,'{}'::jsonb)
    );
  end if;

  v_summary:=public.owner_job_closeout_summary_v1(v_ticket);
  if not coalesce((v_summary->>'found')::boolean,false) then
    raise exception 'Tech Check job not found';
  end if;
  if not coalesce((v_summary->>'ready_for_owner_review')::boolean,false) then
    raise exception 'This job is not ready for Owner Review yet';
  end if;

  v_name:=public.actor_display_name();

  insert into public.owner_job_reviews(
    ticket_no,site,status,summary,ready_at,reviewed_at,reviewed_by,reviewed_by_name,
    correction_reason,correction_role,updated_at
  ) values(
    v_ticket,nullif(v_summary->>'site',''),'closed',v_summary,now(),now(),auth.uid(),v_name,
    null,null,now()
  )
  on conflict(ticket_no) do update
  set site=excluded.site,status='closed',summary=excluded.summary,
      ready_at=coalesce(owner_job_reviews.ready_at,excluded.ready_at),
      reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by,
      reviewed_by_name=excluded.reviewed_by_name,
      correction_reason=null,correction_role=null,updated_at=now();

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'OWNER JOB CLOSED',auth.uid(),v_name,v_ticket,
    'Owner reviewed the Tech Check closeout overview and closed the job in Tech Check. MHelpDesk remains separate.'
  );

  return jsonb_build_object(
    'closed',true,
    'already_closed',false,
    'ticket_no',v_ticket,
    'reviewed_by_name',v_name,
    'summary',v_summary
  );
end;
$function$;
