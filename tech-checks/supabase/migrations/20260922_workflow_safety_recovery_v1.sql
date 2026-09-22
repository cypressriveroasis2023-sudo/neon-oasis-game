-- Cameras On Site — centralized workflow safety and recovery layer v1

create table if not exists public.workflow_repair_audit (
  id uuid primary key default gen_random_uuid(),
  issue_key text not null,
  ticket_no text,
  repair_type text not null,
  reason text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  repaired_by uuid not null references auth.users(id),
  repaired_by_name text not null,
  created_at timestamptz not null default now()
);

alter table public.workflow_repair_audit enable row level security;
revoke all on public.workflow_repair_audit from public, anon;
grant select on public.workflow_repair_audit to authenticated;

drop policy if exists workflow_repair_audit_owner_read on public.workflow_repair_audit;
create policy workflow_repair_audit_owner_read on public.workflow_repair_audit
for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.user_id=(select auth.uid()) and p.active=true and p.role='owner'
));

create or replace function public.get_workflow_health_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_issues jsonb := '[]'::jsonb;
  v_recovery jsonb := null;
  r record;
begin
  select * into v_profile from public.profiles
  where user_id=auth.uid() and active=true and archived_at is null;
  if not found then raise exception 'Active Tech Check account required.'; end if;

  if v_profile.role='owner' then
    for r in
      with duplicate_preps as (
        select trim(ticket_no) ticket_no,count(*) n,min(created_at) oldest
        from public.prep_tickets
        where status in ('draft','released') and not is_test
        group by trim(ticket_no) having count(*)>1
      ), released_unlinked as (
        select p.ticket_no,p.id prep_id,p.site,p.released_at,
          (select a.id from public.job_assignments a
           where trim(a.ticket_no)=trim(p.ticket_no) and a.assigned_role='service'
             and a.status in ('assigned','started') order by a.assigned_at desc limit 1) assignment_id
        from public.prep_tickets p
        where p.status='released' and not p.is_test
      ), issue_rows as (
        select 'duplicate_prep:'||ticket_no issue_key,ticket_no,'critical' severity,
          'DUPLICATE IT PREP' title,
          'More than one open IT prep exists for this MHelpDesk ticket.' detail,
          false repairable,'review_duplicate_prep' repair_type,oldest occurred_at
        from duplicate_preps
        union all
        select 'released_unlinked:'||trim(ticket_no),ticket_no,'warning',
          'SERVICE HANDOFF IS NOT LINKED',
          'IT completed the handoff, but the Service assignment is not connected to it.',
          true,'relink_service_assignment',released_at
        from released_unlinked
        where assignment_id is not null and not exists (
          select 1 from public.job_assignments a where a.id=assignment_id and a.prep_ticket_id=prep_id
        )
        union all
        select 'released_missing_service:'||trim(ticket_no),ticket_no,'critical',
          'SERVICE JOB IS MISSING',
          'IT completed the handoff, but no active Service assignment exists.',
          true,'recreate_service_assignment',released_at
        from released_unlinked where assignment_id is null
        union all
        select 'return_waiting:'||u.id,u.ticket_no,'warning',
          'RETURN IS WAITING FOR IT INTAKE',
          coalesce(u.equipment_type,'Unit')||' '||coalesce(u.unit_tag,'')||' has been waiting since '||to_char(u.returned_at at time zone 'America/Chicago','Mon DD at FMHH:MI AM')||'.',
          false,'open_it_intake',u.returned_at
        from public.unit_returns u
        where u.status='waiting_it' and u.returned_at < now()-interval '24 hours'
        union all
        select 'swap_registration:'||i.id,p.ticket_no,'warning',
          'SWAP SITE REGISTRATION IS STILL PENDING',
          coalesce(i.equipment_type,'Unit')||' '||coalesce(i.unit_tag,'')||' was installed and still needs IT site registration.',
          false,'open_site_registration',i.swap_outcome_at
        from public.prep_items i join public.prep_tickets p on p.id=i.prep_ticket_id
        where i.swap_outcome='installed'
          and coalesce(i.swap_site_registration_status,'pending')<>'completed'
          and i.swap_outcome_at < now()-interval '4 hours'
        union all
        select 'completed_return:'||a.id,a.ticket_no,'critical',
          'JOB CLOSED BEFORE IT INTAKE FINISHED',
          'The assignment says complete, but returned equipment is still waiting for IT Intake.',
          false,'open_it_intake',a.completed_at
        from public.job_assignments a
        where a.status='completed' and exists (
          select 1 from public.unit_returns u where trim(u.ticket_no)=trim(a.ticket_no)
            and u.status in ('waiting_it','pending_mhelp_inventory','needs_replacement')
        )
        union all
        select 'completed_spare:'||a.id,a.ticket_no,'critical',
          'SERVICE JOB HAS AN UNRESOLVED BACKUP OR SPARE',
          'The field job says complete, but backup equipment or spare batteries still need a used/returned decision.',
          false,'open_spare_resolution',a.completed_at
        from public.job_assignments a
        where a.assigned_role='service' and a.status='completed' and (
          exists (select 1 from public.prep_items i join public.prep_tickets p on p.id=i.prep_ticket_id
                  where trim(p.ticket_no)=trim(a.ticket_no) and i.purpose='BACKUP' and i.spare_outcome is null)
          or exists (select 1 from public.truck_spare_batteries b
                     where trim(b.ticket_no)=trim(a.ticket_no) and b.status not in ('resolved','returned'))
        )
      )
      select * from issue_rows order by case severity when 'critical' then 0 else 1 end,occurred_at
    loop
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object(
        'issue_key',r.issue_key,'ticket_no',r.ticket_no,'severity',r.severity,
        'title',r.title,'detail',r.detail,'repairable',r.repairable,
        'repair_type',r.repair_type,'occurred_at',r.occurred_at));
    end loop;
  end if;

  if v_profile.role='it' then
    select jsonb_build_object('kind','it_intake','ticket_no',u.ticket_no,'record_id',u.id,
      'title','MHELPDESK #'||u.ticket_no||' IS WAITING FOR IT INTAKE','step','Continue where you stopped.')
    into v_recovery from public.unit_returns u where u.status='waiting_it'
    order by u.returned_at limit 1;
    if v_recovery is null then
      select jsonb_build_object('kind','it_prep','ticket_no',p.ticket_no,'record_id',p.id,
        'title','RESUME MHELPDESK #'||p.ticket_no,'step','Continue IT equipment prep.')
      into v_recovery from public.prep_tickets p where p.status='draft' and p.created_by=auth.uid()
      order by p.created_at limit 1;
    end if;
  elsif v_profile.role='service' then
    select jsonb_build_object('kind','service_job','ticket_no',a.ticket_no,'record_id',a.id,
      'title','RESUME MHELPDESK #'||a.ticket_no,
      'step',case when a.status='started' then 'Continue the field job where you stopped.' else 'This job is ready to start.' end)
    into v_recovery from public.job_assignments a
    where a.assigned_role='service' and a.assignee_user_id=auth.uid()
      and a.status in ('assigned','started') and coalesce(a.scheduled_for,current_date)<=current_date
    order by case when a.status='started' then 0 else 1 end,a.assigned_at limit 1;
  end if;

  return jsonb_build_object(
    'version','workflow-health-v1','generated_at',now(),'role',v_profile.role,
    'issue_count',jsonb_array_length(v_issues),
    'critical_count',(select count(*) from jsonb_array_elements(v_issues) x where x->>'severity'='critical'),
    'issues',v_issues,'recovery',v_recovery);
end;
$$;

revoke execute on function public.get_workflow_health_v1() from public,anon;
grant execute on function public.get_workflow_health_v1() to authenticated;

create or replace function public.repair_workflow_issue_v1(p_issue_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_ticket text;
  v_prep public.prep_tickets%rowtype;
  v_assignment public.job_assignments%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_repair text;
begin
  select * into v_profile from public.profiles
  where user_id=auth.uid() and active=true and archived_at is null and role='owner';
  if not found then raise exception 'Owner/Admin access required.'; end if;

  if p_issue_key like 'released_unlinked:%' then
    v_ticket:=substring(p_issue_key from length('released_unlinked:')+1);
    select * into v_prep from public.prep_tickets
      where trim(ticket_no)=trim(v_ticket) and status='released' and not is_test
      order by released_at desc limit 1 for update;
    select * into v_assignment from public.job_assignments
      where trim(ticket_no)=trim(v_ticket) and assigned_role='service' and status in ('assigned','started')
      order by assigned_at desc limit 1 for update;
    if v_prep.id is null or v_assignment.id is null then raise exception 'The records changed. Refresh Workflow Health.'; end if;
    v_before:=jsonb_build_object('assignment_id',v_assignment.id,'prep_ticket_id',v_assignment.prep_ticket_id);
    update public.job_assignments set prep_ticket_id=v_prep.id,updated_at=now() where id=v_assignment.id;
    v_after:=jsonb_build_object('assignment_id',v_assignment.id,'prep_ticket_id',v_prep.id);
    v_repair:='relink_service_assignment';
  elsif p_issue_key like 'released_missing_service:%' then
    v_ticket:=substring(p_issue_key from length('released_missing_service:')+1);
    select * into v_prep from public.prep_tickets
      where trim(ticket_no)=trim(v_ticket) and status='released' and not is_test
      order by released_at desc limit 1 for update;
    if v_prep.id is null then raise exception 'The IT handoff is no longer available. Refresh Workflow Health.'; end if;
    if exists(select 1 from public.job_assignments where trim(ticket_no)=trim(v_ticket) and assigned_role='service' and status in ('assigned','started')) then
      raise exception 'A Service assignment now exists. Refresh Workflow Health.';
    end if;
    v_before:=jsonb_build_object('service_assignment','missing','prep_ticket_id',v_prep.id);
    insert into public.job_assignments(ticket_no,site,assigned_role,assignee_name,status,prep_ticket_id,assigned_by,assigned_by_name,
      assigned_at,updated_at,assignment_scope,requires_it_handoff,work_type,requested_unit_count,equipment_manifest)
    values(v_prep.ticket_no,v_prep.site,'service','Service Department','assigned',v_prep.id,auth.uid(),coalesce(v_profile.full_name,v_profile.username,'Owner/Admin'),
      now(),now(),'department',true,v_prep.work_type,v_prep.requested_unit_count,v_prep.equipment_manifest)
    returning * into v_assignment;
    v_after:=jsonb_build_object('assignment_id',v_assignment.id,'prep_ticket_id',v_prep.id,'status','assigned');
    v_repair:='recreate_service_assignment';
  else
    raise exception 'This issue is review-only and cannot be repaired automatically.';
  end if;

  insert into public.workflow_repair_audit(issue_key,ticket_no,repair_type,reason,before_state,after_state,repaired_by,repaired_by_name)
  values(p_issue_key,v_ticket,v_repair,'Existing workflow records proved the safe next state. No technician evidence or physical confirmation was created.',
    v_before,v_after,auth.uid(),coalesce(v_profile.full_name,v_profile.username,'Owner/Admin'));
  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values('WORKFLOW REPAIRED',auth.uid(),coalesce(v_profile.full_name,v_profile.username,'Owner/Admin'),v_ticket,
    'Safe workflow repair: '||replace(v_repair,'_',' ')||'. Existing records were relinked; no evidence or technician answer was invented.');
  return jsonb_build_object('ok',true,'ticket_no',v_ticket,'repair_type',v_repair,'after_state',v_after);
end;
$$;

revoke execute on function public.repair_workflow_issue_v1(text) from public,anon;
grant execute on function public.repair_workflow_issue_v1(text) to authenticated;

comment on function public.get_workflow_health_v1() is 'Central server-truth resolver shared by Owner, technicians, and OnSite Vision.';
comment on function public.repair_workflow_issue_v1(text) is 'Owner-only allowlisted repair. Never fabricates evidence or physical confirmations.';
