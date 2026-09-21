-- Offline-unit Service + IT troubleshooting escalation.
-- Final production state after field_offline_escalation_v1 and its verified fixes.
-- MHelpDesk remains a separate system; ticket_no is a reference only.

create table if not exists public.field_escalations (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null,
  site text,
  unit_tag text not null,
  equipment_type text,
  service_tech_id uuid not null references auth.users(id) on delete restrict,
  service_tech_name text not null,
  original_problem text not null,
  service_power_verified boolean not null default false,
  service_troubleshooting_notes text not null,
  service_started_at timestamptz not null default now(),
  it_tech_id uuid references auth.users(id) on delete set null,
  it_tech_name text,
  it_troubleshooting_notes text,
  status text not null default 'waiting_it'
    check (status in (
      'waiting_it','joint_troubleshooting','repaired_onsite',
      'backup_swap_authorized','failed_unit_in_it_intake',
      'unresolved_owner','owner_resolved'
    )),
  backup_prep_item_id uuid references public.prep_items(id) on delete set null,
  backup_unit_tag text,
  backup_equipment_type text,
  backup_authorized_at timestamptz,
  failed_return_id uuid references public.unit_returns(id) on delete set null,
  owner_summary text,
  owner_notified_at timestamptz,
  owner_resolution text,
  owner_resolved_by uuid references auth.users(id) on delete set null,
  owner_resolved_by_name text,
  owner_resolved_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists field_escalations_one_active_unit_idx
  on public.field_escalations(ticket_no, public.normalize_unit_key(unit_tag))
  where resolved_at is null;
create index if not exists field_escalations_status_idx
  on public.field_escalations(status, created_at desc);
create index if not exists field_escalations_service_tech_idx
  on public.field_escalations(service_tech_id);
create index if not exists field_escalations_it_tech_idx
  on public.field_escalations(it_tech_id);
create index if not exists field_escalations_backup_item_idx
  on public.field_escalations(backup_prep_item_id);
create index if not exists field_escalations_failed_return_idx
  on public.field_escalations(failed_return_id);
create index if not exists field_escalations_owner_resolved_by_idx
  on public.field_escalations(owner_resolved_by);

CREATE OR REPLACE FUNCTION public.touch_field_escalation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at=now();
  return new;
end;
$function$
;

drop trigger if exists trg_touch_field_escalation_v1 on public.field_escalations;
create trigger trg_touch_field_escalation_v1
before update on public.field_escalations
for each row execute function public.touch_field_escalation_v1();

alter table public.field_escalations enable row level security;
drop policy if exists field_escalations_select_v1 on public.field_escalations;
create policy field_escalations_select_v1
on public.field_escalations
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id=(select auth.uid())
      and p.active=true
      and (
        p.role in ('owner'::public.app_role,'it'::public.app_role)
        or (
          p.role='service'::public.app_role
          and field_escalations.service_tech_id=(select auth.uid())
        )
      )
  )
);

revoke all on table public.field_escalations from public, anon, authenticated;
grant select on table public.field_escalations to authenticated;

CREATE OR REPLACE FUNCTION public.it_update_offline_escalation_v1(p_escalation_id uuid, p_it_notes text, p_action text, p_backup_prep_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.field_escalations%rowtype;
  v_backup_id uuid;
  v_backup_tag text;
  v_backup_type text;
  v_backup_it_checked_out_at timestamptz;
  v_backup_checked_out_to uuid;
  v_backup_outcome text;
  v_backup_ticket text;
  v_name text;
  v_role public.app_role;
  v_status text;
  v_summary text;
  v_owner record;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);
  v_role:=public.current_app_role();
  v_name:=public.actor_display_name();

  if nullif(btrim(coalesce(p_it_notes,'')),'') is null then
    raise exception 'Record the IT troubleshooting checks and actions.';
  end if;
  if p_action not in ('continue_troubleshooting','repaired_onsite','authorize_backup_swap','unresolved_owner') then
    raise exception 'Choose a valid IT troubleshooting outcome.';
  end if;

  select * into v_row
  from public.field_escalations
  where id=p_escalation_id
  for update;
  if not found then raise exception 'Offline-unit escalation not found.'; end if;
  if v_row.resolved_at is not null or v_row.status not in ('waiting_it','joint_troubleshooting') then
    raise exception 'This offline-unit escalation is no longer waiting for an IT decision.';
  end if;

  if p_action='authorize_backup_swap' then
    if p_backup_prep_item_id is null then
      raise exception 'Choose the IT-checked-out backup unit being authorized.';
    end if;
    select i.id,i.unit_tag,i.equipment_type,i.spare_it_checked_out_at,
           i.spare_checked_out_to,i.spare_outcome,t.ticket_no
    into v_backup_id,v_backup_tag,v_backup_type,v_backup_it_checked_out_at,
         v_backup_checked_out_to,v_backup_outcome,v_backup_ticket
    from public.prep_items i
    join public.prep_tickets t on t.id=i.prep_ticket_id
    where i.id=p_backup_prep_item_id
      and i.purpose='BACKUP'::public.prep_purpose
    for update of i;

    if not found
       or v_backup_it_checked_out_at is null
       or v_backup_checked_out_to is distinct from v_row.service_tech_id
       or v_backup_outcome is not null
       or v_backup_ticket is distinct from v_row.ticket_no
    then
      raise exception 'The selected backup is not an active IT-checked-out unit for this Service Tech and MHelpDesk ticket.';
    end if;
  end if;

  v_status:=case p_action
    when 'continue_troubleshooting' then 'joint_troubleshooting'
    when 'repaired_onsite' then 'repaired_onsite'
    when 'authorize_backup_swap' then 'backup_swap_authorized'
    else 'unresolved_owner'
  end;

  v_summary:='MHelpDesk #'||v_row.ticket_no||' · Unit '||v_row.unit_tag||
    '. Original problem: '||v_row.original_problem||
    '. Service verified power and recorded: '||v_row.service_troubleshooting_notes||
    '. IT recorded: '||btrim(p_it_notes)||'.';

  update public.field_escalations
  set it_tech_id=auth.uid(),
      it_tech_name=v_name,
      it_troubleshooting_notes=btrim(p_it_notes),
      status=v_status,
      backup_prep_item_id=case when p_action='authorize_backup_swap' then v_backup_id else backup_prep_item_id end,
      backup_unit_tag=case when p_action='authorize_backup_swap' then v_backup_tag else backup_unit_tag end,
      backup_equipment_type=case when p_action='authorize_backup_swap' then v_backup_type else backup_equipment_type end,
      backup_authorized_at=case when p_action='authorize_backup_swap' then now() else backup_authorized_at end,
      owner_summary=case when p_action='unresolved_owner' then v_summary||' Service and IT could not determine a solution.' else owner_summary end,
      owner_notified_at=case when p_action='unresolved_owner' then now() else owner_notified_at end,
      resolved_at=case when p_action='repaired_onsite' then now() else resolved_at end
  where id=p_escalation_id;

  if p_action='unresolved_owner' then
    for v_owner in
      select user_id from public.profiles
      where active=true and role='owner'::public.app_role
    loop
      perform public.enqueue_app_notification(
        v_owner.user_id,'owner_action','Offline unit needs Owner decision',
        v_summary||' Service and IT could not determine a solution.',
        null,v_row.ticket_no,v_row.unit_tag
      );
    end loop;
  else
    perform public.enqueue_app_notification(
      v_row.service_tech_id,'equipment_ready_service',
      case p_action
        when 'authorize_backup_swap' then 'IT authorized backup swap'
        when 'repaired_onsite' then 'IT troubleshooting completed'
        else 'IT troubleshooting updated'
      end,
      case p_action
        when 'authorize_backup_swap' then 'IT Tech '||v_name||' authorized BACKUP '||v_backup_type||' Unit '||v_backup_tag||
          ' for MHelpDesk #'||v_row.ticket_no||'. Return the failed unit through IT Intake.'
        when 'repaired_onsite' then 'IT Tech '||v_name||' recorded the offline unit repaired onsite for MHelpDesk #'||v_row.ticket_no||'.'
        else 'IT Tech '||v_name||' recorded joint troubleshooting for Unit '||v_row.unit_tag||'. Continue Service + IT troubleshooting.'
      end,
      null,v_row.ticket_no,v_row.unit_tag
    );
  end if;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    case p_action
      when 'continue_troubleshooting' then 'OFFLINE UNIT - JOINT TROUBLESHOOTING'
      when 'repaired_onsite' then 'OFFLINE UNIT - REPAIRED ONSITE'
      when 'authorize_backup_swap' then 'OFFLINE UNIT - BACKUP SWAP AUTHORIZED'
      else 'OFFLINE UNIT - OWNER ESCALATION'
    end,
    auth.uid(),v_name,v_row.ticket_no,
    v_summary||
      case p_action
        when 'continue_troubleshooting' then ' Service + IT troubleshooting remains active.'
        when 'repaired_onsite' then ' IT recorded the unit repaired onsite.'
        when 'authorize_backup_swap' then ' IT authorized BACKUP '||v_backup_type||' Unit '||v_backup_tag||
          '. The failed unit must return through Service Return → IT Intake.'
        else ' Service and IT could not determine a solution; Owner was notified.'
      end
  );

  if v_role='owner'::public.app_role then
    insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
    values(
      'OWNER WORKFLOW OVERRIDE',auth.uid(),v_name,v_row.ticket_no,
      'Owner intentionally performed the IT troubleshooting decision for Unit '||v_row.unit_tag||
      ' with outcome '||replace(upper(p_action),'_',' ')||'.'
    );
  end if;

  return jsonb_build_object(
    'id',p_escalation_id,'status',v_status,
    'backup_unit_tag',case when p_action='authorize_backup_swap' then v_backup_tag else null end,
    'owner_notified',p_action='unresolved_owner'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.owner_resolve_offline_escalation_v1(p_escalation_id uuid, p_resolution text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.field_escalations%rowtype;
  v_name text;
begin
  perform public.require_role(array['owner'::public.app_role]);
  if nullif(btrim(coalesce(p_resolution,'')),'') is null then
    raise exception 'Record the Owner decision before resolving this escalation.';
  end if;

  select * into v_row from public.field_escalations where id=p_escalation_id for update;
  if not found then raise exception 'Offline-unit escalation not found.'; end if;
  if v_row.status<>'unresolved_owner' or v_row.resolved_at is not null then
    raise exception 'This escalation is not waiting for an Owner decision.';
  end if;

  v_name:=public.actor_display_name();
  update public.field_escalations
  set status='owner_resolved',
      owner_resolution=btrim(p_resolution),
      owner_resolved_by=auth.uid(),
      owner_resolved_by_name=v_name,
      owner_resolved_at=now(),
      resolved_at=now()
  where id=p_escalation_id;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'OFFLINE UNIT - OWNER DECISION',auth.uid(),v_name,v_row.ticket_no,
    'Owner '||v_name||' resolved the offline-unit escalation for Unit '||v_row.unit_tag||
      '. Decision: '||btrim(p_resolution)||' Earlier Service and IT troubleshooting remains in permanent history.'
  );

  return jsonb_build_object('id',p_escalation_id,'status','owner_resolved','resolution',btrim(p_resolution));
end;
$function$;

CREATE OR REPLACE FUNCTION public.service_link_offline_failed_return_v1(p_escalation_id uuid, p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.field_escalations%rowtype;
  v_return public.unit_returns%rowtype;
  v_item public.prep_items%rowtype;
  v_name text;
  v_role public.app_role;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);
  v_role:=public.current_app_role();
  v_name:=public.actor_display_name();

  select * into v_row from public.field_escalations where id=p_escalation_id for update;
  if not found then raise exception 'Offline-unit escalation not found.'; end if;
  if v_row.status<>'backup_swap_authorized' or v_row.resolved_at is not null then
    raise exception 'This escalation is not waiting for completion of an authorized backup swap.';
  end if;
  if v_role='service'::public.app_role and v_row.service_tech_id is distinct from auth.uid() then
    raise exception 'This offline-unit escalation belongs to another Service Tech.';
  end if;

  select * into v_item from public.prep_items where id=v_row.backup_prep_item_id for update;
  if not found or v_item.spare_outcome is distinct from 'used' then
    raise exception 'Mark the authorized backup unit USED FOR SWAP before linking the failed-unit return.';
  end if;

  select * into v_return from public.unit_returns where id=p_return_id for update;
  if not found then raise exception 'Failed-unit IT Intake return not found.'; end if;
  if v_return.ticket_no is distinct from v_row.ticket_no
     or public.normalize_unit_key(v_return.unit_tag) is distinct from public.normalize_unit_key(v_row.unit_tag)
  then
    raise exception 'The failed-unit return must match this MHelpDesk ticket and offline unit.';
  end if;
  if v_role='service'::public.app_role and v_return.service_tech_id is distinct from auth.uid() then
    raise exception 'This failed-unit return belongs to another Service Tech.';
  end if;

  update public.field_escalations
  set failed_return_id=p_return_id,
      status='failed_unit_in_it_intake',
      resolved_at=now()
  where id=p_escalation_id;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'OFFLINE UNIT - AUTHORIZED SWAP COMPLETED',auth.uid(),v_name,v_row.ticket_no,
    'Service Tech '||v_name||' completed the IT-authorized backup swap. BACKUP '||
      coalesce(v_row.backup_equipment_type,'Unit')||' Unit '||coalesce(v_row.backup_unit_tag,'—')||
      ' was used. Failed Unit '||v_row.unit_tag||' entered Service Return → IT Intake.'
  );

  if v_role='owner'::public.app_role then
    insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
    values(
      'OWNER WORKFLOW OVERRIDE',auth.uid(),v_name,v_row.ticket_no,
      'Owner intentionally linked the failed-unit IT Intake return to the authorized backup swap for Unit '||v_row.unit_tag||'.'
    );
  end if;

  return jsonb_build_object('id',p_escalation_id,'status','failed_unit_in_it_intake','failed_return_id',p_return_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.service_start_offline_escalation_v1(p_ticket_no text, p_site text, p_unit_tag text, p_equipment_type text, p_original_problem text, p_power_verified boolean, p_service_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
  v_name text;
  v_role public.app_role;
  v_it record;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);
  v_role:=public.current_app_role();
  v_name:=public.actor_display_name();

  if nullif(btrim(coalesce(p_ticket_no,'')),'') is null then
    raise exception 'Enter the current MHelpDesk ticket number.';
  end if;
  if nullif(btrim(coalesce(p_unit_tag,'')),'') is null then
    raise exception 'Enter the offline unit tag.';
  end if;
  if nullif(btrim(coalesce(p_original_problem,'')),'') is null then
    raise exception 'Describe the original offline-unit problem.';
  end if;
  if coalesce(p_power_verified,false) is not true then
    raise exception 'Service must physically verify power before calling IT.';
  end if;
  if nullif(btrim(coalesce(p_service_notes,'')),'') is null then
    raise exception 'Record the Service power check and troubleshooting completed before calling IT.';
  end if;

  if exists (
    select 1 from public.field_escalations e
    where e.ticket_no=btrim(p_ticket_no)
      and public.normalize_unit_key(e.unit_tag)=public.normalize_unit_key(p_unit_tag)
      and e.resolved_at is null
  ) then
    raise exception 'An active offline-unit escalation already exists for this MHelpDesk ticket and unit.';
  end if;

  insert into public.field_escalations(
    ticket_no,site,unit_tag,equipment_type,
    service_tech_id,service_tech_name,original_problem,
    service_power_verified,service_troubleshooting_notes
  ) values(
    btrim(p_ticket_no),nullif(btrim(coalesce(p_site,'')),''),
    btrim(p_unit_tag),nullif(btrim(coalesce(p_equipment_type,'')),''),
    auth.uid(),v_name,btrim(p_original_problem),
    true,btrim(p_service_notes)
  ) returning id into v_id;

  for v_it in
    select user_id from public.profiles
    where active=true and role='it'::public.app_role
  loop
    perform public.enqueue_app_notification(
      v_it.user_id,'new_assignment','Service needs IT troubleshooting',
      'Service Tech '||v_name||' verified power and needs joint troubleshooting for Unit '||
        btrim(p_unit_tag)||' on MHelpDesk #'||btrim(p_ticket_no)||'.',
      null,btrim(p_ticket_no),btrim(p_unit_tag)
    );
  end loop;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'OFFLINE UNIT - IT HELP REQUESTED',auth.uid(),v_name,btrim(p_ticket_no),
    'Service Tech '||v_name||' verified power on Unit '||btrim(p_unit_tag)||
      ' and called IT for joint troubleshooting. Original problem: '||btrim(p_original_problem)||
      ' Service checks: '||btrim(p_service_notes)
  );

  if v_role='owner'::public.app_role then
    insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
    values(
      'OWNER WORKFLOW OVERRIDE',auth.uid(),v_name,btrim(p_ticket_no),
      'Owner intentionally started the Service offline-unit escalation for Unit '||btrim(p_unit_tag)||'.'
    );
  end if;

  return jsonb_build_object('id',v_id,'status','waiting_it','it_notified',true);
end;
$function$;

revoke all on function public.service_start_offline_escalation_v1(text,text,text,text,text,boolean,text)
  from public, anon, authenticated;
revoke all on function public.it_update_offline_escalation_v1(uuid,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.service_link_offline_failed_return_v1(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.owner_resolve_offline_escalation_v1(uuid,text)
  from public, anon, authenticated;

grant execute on function public.service_start_offline_escalation_v1(text,text,text,text,text,boolean,text)
  to authenticated;
grant execute on function public.it_update_offline_escalation_v1(uuid,text,text,uuid)
  to authenticated;
grant execute on function public.service_link_offline_failed_return_v1(uuid,uuid)
  to authenticated;
grant execute on function public.owner_resolve_offline_escalation_v1(uuid,text)
  to authenticated;
