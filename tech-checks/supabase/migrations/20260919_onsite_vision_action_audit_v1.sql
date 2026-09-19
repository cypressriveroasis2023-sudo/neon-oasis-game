-- OnSite Vision Phase 4: confirmed AI action + audit layer
-- The AI model has no direct write access. These RPCs are called by the authenticated client
-- only after a proposed action has been reviewed/confirmed.

create table if not exists public.vision_action_audit (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_by_name text not null,
  conversation_id text,
  user_message text,
  ticket_no text,
  action_type text not null,
  requested_payload jsonb not null default '{}'::jsonb,
  canonical_payload jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed','blocked','confirmed','succeeded','failed','cancelled')),
  executable boolean not null default false,
  requires_confirmation boolean not null default true,
  before_state jsonb,
  after_state jsonb,
  error_text text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  executed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists vision_action_audit_ticket_idx
  on public.vision_action_audit(ticket_no, created_at desc);

create index if not exists vision_action_audit_actor_idx
  on public.vision_action_audit(requested_by, created_at desc);

alter table public.vision_action_audit enable row level security;

drop policy if exists vision_action_audit_owner_read on public.vision_action_audit;
create policy vision_action_audit_owner_read
on public.vision_action_audit
for select
to authenticated
using (public.current_app_role() = 'owner'::public.app_role);

revoke insert, update, delete on public.vision_action_audit from authenticated, anon;
grant select on public.vision_action_audit to authenticated;

create or replace function public.vision_action_job_snapshot_v1(p_ticket_no text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ticket_no', trim(p_ticket_no),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,
        'assigned_role',a.assigned_role,
        'assignee_user_id',a.assignee_user_id,
        'assignee_name',a.assignee_name,
        'assignment_scope',a.assignment_scope,
        'status',a.status,
        'scheduled_for',a.scheduled_for,
        'scheduled_time',a.scheduled_time,
        'work_type',a.work_type,
        'prep_ticket_id',a.prep_ticket_id,
        'updated_at',a.updated_at
      ) order by a.assigned_at,a.id)
      from public.job_assignments a
      where trim(a.ticket_no)=trim(p_ticket_no)
    ),'[]'::jsonb),
    'prep', (
      select jsonb_build_object(
        'id',p.id,'status',p.status,'work_type',p.work_type,'site',p.site,
        'equipment_manifest',p.equipment_manifest,'released_at',p.released_at,'closed_at',p.closed_at
      )
      from public.prep_tickets p
      where trim(p.ticket_no)=trim(p_ticket_no)
      order by p.created_at desc
      limit 1
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'equipment_type',i.equipment_type,'purpose',i.purpose,
        'unit_tag',i.unit_tag,'verified_at',i.verified_at,
        'spare_it_checked_out_at',i.spare_it_checked_out_at,'spare_outcome',i.spare_outcome
      ) order by i.item_order,i.id)
      from public.prep_items i
      join public.prep_tickets p on p.id=i.prep_ticket_id
      where trim(p.ticket_no)=trim(p_ticket_no)
    ),'[]'::jsonb),
    'service_solar_check', (
      select to_jsonb(s)
      from public.service_solar_checks s
      join public.prep_tickets p on p.id=s.prep_ticket_id
      where trim(p.ticket_no)=trim(p_ticket_no)
      order by s.updated_at desc
      limit 1
    ),
    'returns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'unit_tag',r.unit_tag,'equipment_type',r.equipment_type,
        'status',r.status,'returned_at',r.returned_at,'it_received_at',r.it_received_at,
        'manager_added_at',r.manager_added_at,'tag_scan_status',r.tag_scan_status
      ) order by r.created_at,r.id)
      from public.unit_returns r
      where trim(r.ticket_no)=trim(p_ticket_no)
    ),'[]'::jsonb)
  );
$$;

revoke all on function public.vision_action_job_snapshot_v1(text) from public, anon, authenticated;

create or replace function public.vision_prepare_action_v1(
  p_conversation_id text,
  p_action jsonb,
  p_user_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_name text;
  v_type text:=lower(trim(coalesce(p_action->>'type','')));
  v_ticket text:=trim(coalesce(p_action->>'ticket_no',''));
  v_role text:=lower(trim(coalesce(p_action->>'role','')));
  v_tech_name text:=trim(coalesce(p_action->>'technician_name',''));
  v_tech_id uuid;
  v_tech_display text;
  v_tech_count int:=0;
  v_assignment public.job_assignments%rowtype;
  v_assignment_count int:=0;
  v_active_count int:=0;
  v_date date;
  v_time time;
  v_has_date boolean:=false;
  v_has_time boolean:=false;
  v_prep_id uuid;
  v_canonical jsonb:='{}'::jsonb;
  v_validation jsonb:='{}'::jsonb;
  v_executable boolean:=false;
  v_status text:='blocked';
  v_reason text:='';
  v_id uuid;
begin
  perform public.require_role(array['owner'::public.app_role]);
  v_actor_name:=public.actor_display_name();

  if jsonb_typeof(p_action)<>'object' then
    raise exception 'Vision action payload must be an object.';
  end if;

  if v_type not in (
    'assign','schedule','cancel','owner_approve',
    'create_job','update','handoff','verify','complete','return','check_out','check_in'
  ) then
    raise exception 'Unsupported Vision action type: %',coalesce(v_type,'');
  end if;

  if v_type<>'create_job' and v_ticket='' then
    raise exception 'MHelpDesk ticket number is required for this action.';
  end if;

  if v_type='assign' then
    if v_role not in ('it','service') then
      raise exception 'Assignment role must be IT or Service.';
    end if;

    if v_tech_name<>'' then
      select count(*), min(user_id), min(coalesce(full_name,username,'Technician'))
      into v_tech_count,v_tech_id,v_tech_display
      from public.profiles
      where active=true and archived_at is null
        and role::text=v_role
        and (
          lower(trim(coalesce(full_name,'')))=lower(v_tech_name)
          or lower(trim(coalesce(username,'')))=lower(v_tech_name)
        );

      if v_tech_count=0 then
        raise exception 'Active % technician "%" was not found.',upper(v_role),v_tech_name;
      elsif v_tech_count>1 then
        raise exception 'Technician name "%" is ambiguous. Choose the exact technician.',v_tech_name;
      end if;
    end if;

    select count(*) into v_assignment_count
    from public.job_assignments
    where trim(ticket_no)=v_ticket
      and assigned_role=v_role
      and status in ('assigned','started');

    if v_assignment_count>1 then
      raise exception 'More than one active % assignment exists for MHelpDesk #% — choose the exact assignment in the Owner dashboard.',upper(v_role),v_ticket;
    end if;

    if v_assignment_count=1 then
      select * into v_assignment
      from public.job_assignments
      where trim(ticket_no)=v_ticket
        and assigned_role=v_role
        and status in ('assigned','started')
      order by updated_at desc
      limit 1;
    end if;

    if not exists(
      select 1 from public.job_assignments where trim(ticket_no)=v_ticket
      union all
      select 1 from public.prep_tickets where trim(ticket_no)=v_ticket
    ) then
      raise exception 'MHelpDesk #% is not present in Tech Check.',v_ticket;
    end if;

    v_canonical:=jsonb_build_object(
      'type','assign',
      'ticket_no',v_ticket,
      'role',v_role,
      'technician_user_id',v_tech_id,
      'technician_name',coalesce(v_tech_display,case when v_role='it' then 'IT Department' else 'Service Department' end),
      'assignment_id',v_assignment.id,
      'create_new_assignment',v_assignment_count=0
    );
    v_executable:=true;
    v_status:='proposed';
    v_validation:=jsonb_build_object('ok',true,'rule','Owner assignment/reassignment uses existing Tech Check assignment rules.');

  elsif v_type='schedule' then
    if nullif(trim(coalesce(p_action->>'date','')),'') is not null then
      begin
        v_date:=(p_action->>'date')::date;
        v_has_date:=true;
      exception when others then
        raise exception 'Schedule date must use YYYY-MM-DD.';
      end;
    end if;
    if nullif(trim(coalesce(p_action->>'time','')),'') is not null then
      begin
        v_time:=(p_action->>'time')::time;
        v_has_time:=true;
      exception when others then
        raise exception 'Schedule time must use HH:MM.';
      end;
    end if;
    if not v_has_date and not v_has_time then
      raise exception 'A new date or time is required.';
    end if;

    select count(*) into v_active_count
    from public.job_assignments
    where trim(ticket_no)=v_ticket and status in ('assigned','started');

    if v_active_count=0 then
      raise exception 'MHelpDesk #% has no active assignment to reschedule.',v_ticket;
    end if;

    v_canonical:=jsonb_build_object(
      'type','schedule','ticket_no',v_ticket,
      'date',case when v_has_date then to_char(v_date,'YYYY-MM-DD') else null end,
      'time',case when v_has_time then to_char(v_time,'HH24:MI') else null end
    );
    v_executable:=true;
    v_status:='proposed';
    v_validation:=jsonb_build_object('ok',true,'active_assignments',v_active_count);

  elsif v_type='cancel' then
    if v_role<>'' and v_role not in ('it','service') then
      raise exception 'Cancellation role must be IT or Service.';
    end if;

    if v_role<>'' then
      select count(*) into v_assignment_count
      from public.job_assignments
      where trim(ticket_no)=v_ticket and assigned_role=v_role and status in ('assigned','started');
    else
      select count(*) into v_assignment_count
      from public.job_assignments
      where trim(ticket_no)=v_ticket and status in ('assigned','started');
    end if;

    if v_assignment_count=0 then
      raise exception 'There is no active assignment matching this cancellation.';
    elsif v_assignment_count>1 then
      raise exception 'More than one active assignment matches. Specify IT or Service before cancelling.';
    end if;

    select * into v_assignment
    from public.job_assignments
    where trim(ticket_no)=v_ticket
      and status in ('assigned','started')
      and (v_role='' or assigned_role=v_role)
    order by updated_at desc
    limit 1;

    v_canonical:=jsonb_build_object(
      'type','cancel','ticket_no',v_ticket,
      'role',v_assignment.assigned_role,
      'assignment_id',v_assignment.id,
      'assignee_name',v_assignment.assignee_name
    );
    v_executable:=true;
    v_status:='proposed';
    v_validation:=jsonb_build_object('ok',true,'rule','Only the selected active assignment will be cancelled.');

  elsif v_type='owner_approve' then
    select coalesce(
      (
        select prep_ticket_id
        from public.job_assignments
        where trim(ticket_no)=v_ticket and prep_ticket_id is not null
        order by updated_at desc
        limit 1
      ),
      (
        select id from public.prep_tickets
        where trim(ticket_no)=v_ticket
        order by created_at desc
        limit 1
      )
    ) into v_prep_id;

    if v_prep_id is null then
      raise exception 'No Tech Check prep record is linked to MHelpDesk #%.' ,v_ticket;
    end if;

    v_canonical:=jsonb_build_object(
      'type','owner_approve','ticket_no',v_ticket,'prep_ticket_id',v_prep_id
    );
    v_executable:=true;
    v_status:='proposed';
    v_validation:=jsonb_build_object(
      'ok',true,
      'rule','Final approval will call the existing Helios Owner verification RPC; all photos, signatures, swap return documentation and field checks remain mandatory.'
    );

  else
    v_executable:=false;
    v_status:='blocked';
    v_reason:=case v_type
      when 'handoff' then 'Handoff requires exact unit verification plus the required Service evidence/checklist. Open the handoff workflow instead of bypassing it.'
      when 'return' then 'Return requires old-unit identity, condition/issues, repair notes and photo evidence. Open the Service Return workflow.'
      when 'check_in' then 'Check-in requires the returned unit and IT Intake checks. Open IT Intake.'
      when 'check_out' then 'Checkout requires an exact prepared unit/spare plus readiness evidence. Open the equipment checkout workflow.'
      when 'complete' then 'Completion is role- and workflow-gated. The assigned technician must finish the required checklist/evidence first.'
      when 'verify' then 'Verification requires the applicable product checklist/evidence. Open the matching verification workflow.'
      when 'create_job' then 'New work orders continue through the guided Vision draft so all required fields are collected before creation.'
      else 'This action still requires a guided Tech Check workflow and cannot be one-click executed by Vision.'
    end;
    v_canonical:=jsonb_build_object('type',v_type,'ticket_no',v_ticket);
    v_validation:=jsonb_build_object('ok',false,'reason',v_reason,'route','guided_workflow');
  end if;

  insert into public.vision_action_audit(
    requested_by,requested_by_name,conversation_id,user_message,ticket_no,action_type,
    requested_payload,canonical_payload,validation,status,executable,requires_confirmation,before_state
  )
  values(
    v_actor,v_actor_name,nullif(trim(coalesce(p_conversation_id,'')),''),
    nullif(trim(coalesce(p_user_message,'')),''),
    nullif(v_ticket,''),v_type,p_action,v_canonical,v_validation,v_status,v_executable,true,
    case when v_ticket<>'' then public.vision_action_job_snapshot_v1(v_ticket) else null end
  )
  returning id into v_id;

  return jsonb_build_object(
    'action_id',v_id,
    'status',v_status,
    'executable',v_executable,
    'requires_confirmation',true,
    'canonical_action',v_canonical,
    'validation',v_validation
  );
end;
$$;

revoke all on function public.vision_prepare_action_v1(text,jsonb,text) from public, anon;
grant execute on function public.vision_prepare_action_v1(text,jsonb,text) to authenticated;

create or replace function public.vision_cancel_action_v1(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.vision_action_audit%rowtype;
begin
  perform public.require_role(array['owner'::public.app_role]);

  select * into v_row
  from public.vision_action_audit
  where id=p_action_id and requested_by=auth.uid()
  for update;

  if not found then raise exception 'Vision action was not found.'; end if;
  if v_row.status<>'proposed' then
    return jsonb_build_object('action_id',v_row.id,'status',v_row.status);
  end if;

  update public.vision_action_audit
  set status='cancelled',cancelled_at=now(),updated_at=now()
  where id=v_row.id;

  return jsonb_build_object('action_id',v_row.id,'status','cancelled');
end;
$$;

revoke all on function public.vision_cancel_action_v1(uuid) from public, anon;
grant execute on function public.vision_cancel_action_v1(uuid) to authenticated;

create or replace function public.vision_execute_action_v1(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.vision_action_audit%rowtype;
  v_action jsonb;
  v_type text;
  v_ticket text;
  v_role text;
  v_assignment_id uuid;
  v_tech_id uuid;
  v_create_new boolean;
  v_date date;
  v_time time;
  v_new_assignment uuid;
  v_base public.job_assignments%rowtype;
  v_prep public.prep_tickets%rowtype;
  v_work_type text:='service';
  v_requires_handoff boolean:=false;
  v_error text;
  v_after jsonb;
begin
  perform public.require_role(array['owner'::public.app_role]);

  select * into v_row
  from public.vision_action_audit
  where id=p_action_id and requested_by=auth.uid()
  for update;

  if not found then raise exception 'Vision action was not found.'; end if;
  if v_row.status='succeeded' then
    return jsonb_build_object('action_id',v_row.id,'status','succeeded','after_state',v_row.after_state);
  end if;
  if v_row.status<>'proposed' then
    raise exception 'Vision action is % and cannot be executed.',v_row.status;
  end if;
  if not v_row.executable then
    raise exception 'This Vision action requires the guided Tech Check workflow.';
  end if;

  v_action:=v_row.canonical_payload;
  v_type:=v_row.action_type;
  v_ticket:=trim(coalesce(v_row.ticket_no,''));

  update public.vision_action_audit
  set status='confirmed',confirmed_at=now(),updated_at=now()
  where id=v_row.id;

  begin
    if v_type='assign' then
      v_role:=v_action->>'role';
      v_assignment_id:=nullif(v_action->>'assignment_id','')::uuid;
      v_tech_id:=nullif(v_action->>'technician_user_id','')::uuid;
      v_create_new:=coalesce((v_action->>'create_new_assignment')::boolean,false);

      if not v_create_new then
        perform public.owner_reassign_job_assignment(v_assignment_id,v_tech_id);
      else
        select * into v_base
        from public.job_assignments
        where trim(ticket_no)=v_ticket
        order by
          case when status in ('assigned','started') then 0 else 1 end,
          updated_at desc nulls last
        limit 1;

        select * into v_prep
        from public.prep_tickets
        where trim(ticket_no)=v_ticket
        order by created_at desc
        limit 1;

        if exists(
          select 1 from public.prep_items i
          join public.prep_tickets p on p.id=i.prep_ticket_id
          where trim(p.ticket_no)=v_ticket and i.purpose='SWAP'::public.prep_purpose
        ) then
          v_work_type:='swap';
        elsif exists(
          select 1 from public.prep_items i
          join public.prep_tickets p on p.id=i.prep_ticket_id
          where trim(p.ticket_no)=v_ticket and i.purpose='DELIVERY'::public.prep_purpose
        ) then
          v_work_type:='delivery';
        else
          v_work_type:=coalesce(nullif(lower(v_prep.work_type),''),nullif(lower(v_base.work_type),''),'service');
        end if;

        v_requires_handoff:=(v_role='service' and v_work_type in ('delivery','swap'));

        v_new_assignment:=public.owner_assign_job_v8(
          v_ticket,
          coalesce(v_prep.site,v_base.site,''),
          v_role,
          v_tech_id,
          coalesce(v_base.requested_unit_count,0),
          coalesce(v_base.unit_summary,''),
          coalesce(v_base.job_description,''),
          coalesce(v_base.notes,''),
          coalesce(v_base.solar_panel_qty,v_prep.solar_panel_qty,0),
          coalesce(v_base.battery_replacement_qty,v_prep.battery_replacement_qty,0),
          coalesce(v_base.camera_replacement_qty,v_prep.camera_replacement_qty,0),
          coalesce(v_base.sim_replacement_qty,v_prep.sim_replacement_qty,0),
          coalesce(v_base.micro_sd_qty,v_prep.micro_sd_qty,0),
          coalesce(v_base.equipment_manifest,v_prep.equipment_manifest,'[]'::jsonb),
          v_requires_handoff,
          coalesce(v_base.scheduled_for,current_date),
          v_work_type
        );

        if v_base.scheduled_time is not null then
          update public.job_assignments
          set scheduled_time=v_base.scheduled_time,updated_at=now()
          where id=v_new_assignment;
        end if;
      end if;

    elsif v_type='schedule' then
      if nullif(v_action->>'date','') is not null then v_date:=(v_action->>'date')::date; end if;
      if nullif(v_action->>'time','') is not null then v_time:=(v_action->>'time')::time; end if;

      update public.job_assignments
      set scheduled_for=coalesce(v_date,scheduled_for),
          scheduled_time=case when v_action ? 'time' and nullif(v_action->>'time','') is not null then v_time else scheduled_time end,
          updated_at=now()
      where trim(ticket_no)=v_ticket and status in ('assigned','started');

      if not found then raise exception 'No active assignment remains for MHelpDesk #%.' ,v_ticket; end if;

    elsif v_type='cancel' then
      v_assignment_id:=(v_action->>'assignment_id')::uuid;
      perform public.owner_cancel_job_assignment(v_assignment_id);

    elsif v_type='owner_approve' then
      perform public.owner_verify_helios_install_v1((v_action->>'prep_ticket_id')::uuid);

    else
      raise exception 'Vision action type % is not executable.',v_type;
    end if;

    v_after:=public.vision_action_job_snapshot_v1(v_ticket);

    update public.vision_action_audit
    set status='succeeded',executed_at=now(),after_state=v_after,error_text=null,updated_at=now()
    where id=v_row.id;

    return jsonb_build_object(
      'action_id',v_row.id,
      'status','succeeded',
      'ticket_no',v_ticket,
      'action_type',v_type,
      'after_state',v_after
    );

  exception when others then
    v_error:=sqlerrm;
    update public.vision_action_audit
    set status='failed',executed_at=now(),error_text=v_error,updated_at=now()
    where id=v_row.id;

    return jsonb_build_object(
      'action_id',v_row.id,
      'status','failed',
      'ticket_no',v_ticket,
      'action_type',v_type,
      'error',v_error
    );
  end;
end;
$$;

revoke all on function public.vision_execute_action_v1(uuid) from public, anon;
grant execute on function public.vision_execute_action_v1(uuid) to authenticated;

comment on table public.vision_action_audit is
  'Audit ledger for OnSite Vision proposed/confirmed actions. The AI model cannot write this table directly.';
comment on function public.vision_prepare_action_v1(text,jsonb,text) is
  'Owner-only validator/canonicalizer for AI-proposed Tech Check actions. Does not execute the action.';
comment on function public.vision_execute_action_v1(uuid) is
  'Owner-confirmed action executor. Routes only approved action types through existing Tech Check rules and records before/after audit state.';
