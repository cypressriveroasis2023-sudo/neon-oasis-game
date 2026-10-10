-- Local synthetic-test contract evidence only. Never deploy this fixture.
-- Exact read-only function definitions captured 2026-10-10 UTC. No row data.
-- Read-only pg_get_functiondef capture, project goqrnolcvqnirjmzaeyk, 2026-10-10 UTC. Never applied.
CREATE OR REPLACE FUNCTION public.require_role(allowed app_role[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.app_role;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select public.current_app_role() into r;
  if not (r = any(allowed)) then raise exception 'Not authorized for this action'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.owner_cancel_job_assignment(p_assignment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_app_role() <> 'owner'::public.app_role then
    raise exception 'Only the Owner/Admin can cancel assignments.';
  end if;

  update job_assignments
  set status='cancelled', cancelled_at=now(), updated_at=now()
  where id=p_assignment_id and status in ('assigned','started');
end;
$function$;

CREATE OR REPLACE FUNCTION public.owner_update_ticket_equipment_v1(p_ticket_no text, p_equipment_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ticket text:=trim(coalesce(p_ticket_no,''));
  v_manifest jsonb:='[]'::jsonb;
  v_device_count int:=0;
  v_assignment_rows int:=0;
  v_prep_rows int:=0;
  v_before jsonb;
begin
  perform public.require_role(array['owner'::public.app_role]);
  if v_ticket='' then raise exception 'MHelpDesk ticket number is required.'; end if;
  if jsonb_typeof(coalesce(p_equipment_manifest,'[]'::jsonb))<>'array' then
    raise exception 'Equipment manifest must be an array.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category',case when lower(trim(x->>'category')) in ('device','stand','other') then lower(trim(x->>'category')) else 'other' end,
      'label',trim(x->>'label'),
      'qty',(x->>'qty')::int
    )
    order by ord
  ),'[]'::jsonb)
  into v_manifest
  from jsonb_array_elements(coalesce(p_equipment_manifest,'[]'::jsonb)) with ordinality e(x,ord)
  where nullif(trim(x->>'label'),'') is not null
    and (x->>'qty') ~ '^[0-9]+$'
    and (x->>'qty')::int > 0;

  if exists(
    select 1 from jsonb_array_elements(coalesce(p_equipment_manifest,'[]'::jsonb)) x
    where nullif(trim(x->>'label'),'') is not null
      and (
        not ((x->>'qty') ~ '^[0-9]+$')
        or (x->>'qty')::int < 0
        or (x->>'qty')::int > 999
      )
  ) then
    raise exception 'Equipment quantities must be whole numbers from 0 to 999.';
  end if;

  select coalesce(sum((x->>'qty')::int),0)
  into v_device_count
  from jsonb_array_elements(v_manifest) x
  where x->>'category'='device';

  select jsonb_build_object(
    'assignments',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'role',a.assigned_role,'status',a.status,'equipment_manifest',a.equipment_manifest)),'[]'::jsonb)
  )
  into v_before
  from public.job_assignments a
  where trim(a.ticket_no)=v_ticket and a.status in ('assigned','started');

  update public.job_assignments
  set equipment_manifest=v_manifest,
      requested_unit_count=v_device_count,
      updated_at=now()
  where trim(ticket_no)=v_ticket
    and status in ('assigned','started');
  get diagnostics v_assignment_rows=row_count;

  update public.prep_tickets
  set equipment_manifest=v_manifest,
      requested_unit_count=v_device_count
  where trim(ticket_no)=v_ticket
    and status in ('draft','released');
  get diagnostics v_prep_rows=row_count;

  if v_assignment_rows=0 and v_prep_rows=0 then
    raise exception 'No active Tech Check record exists for MHelpDesk #%.' ,v_ticket;
  end if;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    'OWNER EQUIPMENT UPDATE',
    auth.uid(),
    public.actor_display_name(),
    v_ticket,
    'Owner updated Tech Check equipment quantities to '||v_manifest::text||'. MHelpDesk unchanged.'
  );

  return jsonb_build_object(
    'ok',true,
    'ticket_no',v_ticket,
    'equipment_manifest',v_manifest,
    'requested_unit_count',v_device_count,
    'assignment_rows_updated',v_assignment_rows,
    'prep_rows_updated',v_prep_rows,
    'before_state',v_before
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_pickup_assignment_completion_from_return_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ticket text:=btrim(coalesce(new.ticket_no,''));
  v_assignment public.job_assignments%rowtype;
  v_manifest_required integer;
  v_required integer;
  v_recorded integer;
  v_processed integer;
  v_waiting integer;
  v_qty integer;
  v_actor_name text;
begin
  if v_ticket='' then
    return new;
  end if;

  v_actor_name:=public.actor_display_name();

  for v_assignment in
    select a.*
    from public.job_assignments a
    where btrim(a.ticket_no)=v_ticket
      and a.status in ('assigned','started')
      and lower(coalesce(a.work_type,''))='pickup'
      and a.assigned_role in ('service','it')
    order by a.assigned_at
    for update
  loop
    select coalesce(sum(
      case
        when lower(coalesce(x.item->>'category','')) in ('device','stand')
          or coalesce(x.item->>'label','') in ('Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2','Recon II','110V Stand','Solar Stand','Pole','Solar Pole')
          or coalesce(x.item->>'equipment_type','') in ('Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2','Recon II','110V Stand','Solar Stand','Pole','Solar Pole')
        then case
          when coalesce(x.item->>'qty','') ~ '^[0-9]+$' then greatest(0,(x.item->>'qty')::integer)
          when coalesce(x.item->>'quantity','') ~ '^[0-9]+$' then greatest(0,(x.item->>'quantity')::integer)
          else 1
        end
        else 0
      end
    ),0)::integer
    into v_manifest_required
    from jsonb_array_elements(coalesce(v_assignment.equipment_manifest,'[]'::jsonb)) as x(item);

    v_required:=case
      when v_manifest_required>0 then v_manifest_required
      else greatest(0,coalesce(v_assignment.requested_unit_count,0))
    end;

    -- No guessed completion. If the assignment does not contain an authoritative
    -- equipment quantity, leave it active for Owner review/correction.
    if v_required<=0 then
      continue;
    end if;

    if v_assignment.assigned_role='service' then
      select count(*)::integer
      into v_recorded
      from public.unit_returns r
      where btrim(r.ticket_no)=v_ticket;

      if v_recorded>=v_required then
        update public.job_assignments
        set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now()
        where id=v_assignment.id
          and status in ('assigned','started');

        if found then
          insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
          values(
            'JOB ASSIGNMENT COMPLETED',
            auth.uid(),
            v_actor_name,
            v_ticket,
            'Service pickup assignment completed after all '||v_required||' authoritative equipment return record'||case when v_required=1 then '' else 's' end||' were saved.'
          );
        end if;
      end if;
    else
      select
        count(*) filter(where r.status in ('pending_mhelp_inventory','needs_replacement','completed'))::integer,
        count(*) filter(where r.status='waiting_it')::integer
      into v_processed,v_waiting
      from public.unit_returns r
      where btrim(r.ticket_no)=v_ticket;

      if v_processed>=v_required and v_waiting=0 then
        update public.job_assignments
        set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now()
        where id=v_assignment.id
          and status in ('assigned','started');

        if found then
          insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
          values(
            'JOB ASSIGNMENT COMPLETED',
            auth.uid(),
            v_actor_name,
            v_ticket,
            'IT pickup/intake assignment completed after all '||v_required||' authoritative equipment return record'||case when v_required=1 then '' else 's' end||' finished IT Intake.'
          );
        end if;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;
