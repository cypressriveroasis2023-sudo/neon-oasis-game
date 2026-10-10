-- Local synthetic-test contract evidence only. Never deploy this fixture.
-- Definitions read with pg_get_functiondef on 2026-10-10; no row data.
-- Read-only pg_get_functiondef capture, project goqrnolcvqnirjmzaeyk, 2026-10-10 UTC. Never applied.
CREATE OR REPLACE FUNCTION public.claim_my_department_assignment(p_assignment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_assignment public.job_assignments%rowtype;
  v_name text;
  v_is_owner boolean;
  v_departure jsonb;
begin
  select * into v_profile from public.profiles where user_id=auth.uid() and active=true;
  if not found then raise exception 'Active account required.'; end if;
  v_is_owner := v_profile.role='owner';

  select * into v_assignment from public.job_assignments where id=p_assignment_id for update;
  if not found then raise exception 'Assignment not found.'; end if;
  if v_assignment.assignment_scope<>'department' or v_assignment.assignee_user_id is not null or v_assignment.status<>'assigned' then
    raise exception 'This department task has already been claimed or is no longer available.';
  end if;
  if not v_is_owner and v_assignment.assigned_role<>v_profile.role::text then
    raise exception 'This task belongs to a different technician department.';
  end if;

  if not v_is_owner
     and v_assignment.assigned_role='it'
     and lower(coalesce(v_assignment.work_type,''))='pickup'
     and not exists(
       select 1 from public.unit_returns r
       where trim(r.ticket_no)=trim(v_assignment.ticket_no)
         and r.status='waiting_it'
     ) then
    raise exception 'WAITING FOR SERVICE RETURN. This IT task is not available to claim yet.';
  end if;

  if not v_is_owner
     and v_assignment.assigned_role='service'
     and coalesce(v_assignment.requires_it_handoff,false)
     and not exists(
       select 1 from public.prep_tickets p
       where trim(p.ticket_no)=trim(v_assignment.ticket_no)
         and p.status in ('released','closed')
     ) then
    raise exception 'WAITING FOR IT HANDOFF. This Service task is not available to claim yet.';
  end if;

  if not v_is_owner and v_assignment.assigned_role='service' then
    v_departure:=public.service_departure_readiness_v1(auth.uid());
    if coalesce((v_departure->>'departure_ready')::boolean,false) is not true then
      raise exception 'NOT READY TO LEAVE SHOP. Complete the daily Truck / Trailer Inspection and required permanent truck inventory check/restock before claiming a new Service job.';
    end if;
  end if;

  v_name := coalesce(v_profile.full_name,v_profile.username,case when v_is_owner then 'Owner/Admin' else 'Technician' end);

  update public.job_assignments
  set assignee_user_id=auth.uid(),
      assignee_name=v_name,
      status='started',
      started_at=coalesce(started_at,now()),
      claimed_at=now(),
      updated_at=now()
  where id=p_assignment_id;

  update public.app_notifications
  set read_at=coalesce(read_at,now())
  where assignment_id=p_assignment_id and recipient_user_id<>auth.uid();

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'DEPARTMENT TASK CLAIMED',auth.uid(),v_name,v_assignment.ticket_no,
    (case when v_assignment.assigned_role='it' then 'IT ' else 'Service ' end)||
    case when v_is_owner then 'Owner preview ' else 'Tech ' end||
    v_name||' claimed the department task and started the process.'
  );

  return p_assignment_id;
end;
$function$;

-- Read-only pg_get_functiondef capture, project goqrnolcvqnirjmzaeyk, 2026-10-10 UTC. Never applied.
CREATE OR REPLACE FUNCTION public.my_managed_tickets_v1()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with me as (
    select user_id,role from public.profiles
    where user_id=auth.uid() and active=true and archived_at is null
  ),
  tickets as (
    select
      a.ticket_no,
      max(a.site) as site,
      max(a.work_type) as work_type,
      max(a.scheduled_for) as scheduled_for,
      max(a.scheduled_time) as scheduled_time,
      max(a.job_lead_user_id::text)::uuid as job_lead_user_id,
      max(a.job_lead_name) as job_lead_name,
      max(a.job_description) as job_description,
      max(a.notes) as notes,
      max(a.unit_summary) as unit_summary,
      max(a.requested_unit_count) as requested_unit_count,
      max(a.equipment_manifest::text)::jsonb as equipment_manifest,
      max(a.solar_panel_qty) as solar_panel_qty,
      max(a.battery_replacement_qty) as battery_replacement_qty,
      max(a.camera_replacement_qty) as camera_replacement_qty,
      max(a.sim_replacement_qty) as sim_replacement_qty,
      max(a.micro_sd_qty) as micro_sd_qty,
      max(case when a.assigned_role='service' then a.assignee_user_id::text end)::uuid as service_assignee_user_id,
      max(case when a.assigned_role='service' then a.assignee_name end) as service_assignee_name,
      bool_or(a.status='started') as any_started,
      bool_or(a.status='completed') as any_completed,
      bool_and(a.status in ('completed','cancelled')) as all_finished,
      min(a.assigned_at) as created_at,
      max(a.updated_at) as updated_at
    from public.job_assignments a, me
    where a.job_lead_user_id=me.user_id
      and a.status<>'cancelled'
    group by a.ticket_no
  )
  select coalesce(jsonb_agg(to_jsonb(tickets) order by all_finished asc, scheduled_for asc, created_at desc),'[]'::jsonb)
  from tickets;
$function$;


-- Exact targeted production function definition read on 2026-10-10 UTC.
CREATE OR REPLACE FUNCTION public.current_app_role()
 RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 select coalesce((select role from public.profiles where user_id=auth.uid() and active),'pending'::public.app_role)
$function$;
CREATE OR REPLACE FUNCTION public.my_available_assignments(p_role text)
 RETURNS SETOF job_assignments LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
declare v_role public.app_role;
begin
 v_role:=public.current_app_role();
 if p_role not in ('it','service') then raise exception 'Invalid role'; end if;
 if v_role::text<>p_role and v_role<>'owner'::public.app_role then raise exception 'That assignment queue is not available to your role.'; end if;
 return query select a.* from public.job_assignments a where a.assigned_role=p_role
 and a.status in ('assigned','started') and (a.assignee_user_id=auth.uid()
 or (a.assignee_user_id is null and a.assignment_scope='department' and a.status='assigned'))
 order by case when a.assignee_user_id=auth.uid() then 0 else 1 end,a.assigned_at asc;
end;
$function$;
