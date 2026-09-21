-- Connect offline-unit escalation records to permanent Technician, Unit,
-- Customer/Site history and block Owner closeout while an escalation is unresolved.

CREATE OR REPLACE FUNCTION public.get_company_history_v1(p_kind text, p_value text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_kind text := lower(btrim(coalesce(p_kind,'')));
  v_value text := btrim(coalesce(p_value,''));
  v_limit integer := greatest(1, least(coalesce(p_limit,100),250));
  v_profile public.profiles%rowtype;
  v_key text;
  v_site text;
  v_subject jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  perform public.require_role(array['owner'::public.app_role]);

  if v_kind not in ('technician','unit','site') then
    raise exception 'History kind must be technician, unit, or site';
  end if;
  if v_value = '' then
    raise exception 'History lookup value is required';
  end if;

  if v_kind = 'technician' then
    select p.* into v_profile
    from public.profiles p
    where p.user_id::text = v_value
       or lower(coalesce(p.username,'')) = lower(v_value)
       or lower(coalesce(p.full_name,'')) = lower(v_value)
    order by
      case when p.user_id::text = v_value then 0
           when lower(coalesce(p.username,'')) = lower(v_value) then 1
           else 2 end,
      p.archived_at nulls first,
      p.full_name
    limit 1;

    if not found then
      return jsonb_build_object('kind',v_kind,'query',v_value,'found',false,'events','[]'::jsonb);
    end if;

    v_subject := jsonb_build_object(
      'user_id',v_profile.user_id,
      'full_name',v_profile.full_name,
      'username',v_profile.username,
      'role',v_profile.role,
      'active',v_profile.active,
      'archived_at',v_profile.archived_at
    );

    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_at desc),'[]'::jsonb)
    into v_events
    from (
      select * from (
        select
          coalesce(j.completed_at,j.started_at,j.assigned_at,j.updated_at) as event_at,
          'job_assignment'::text as event_type,
          j.ticket_no,
          j.site,
          null::text as unit_tag,
          coalesce(j.assignee_name,v_profile.full_name,v_profile.username) as actor_name,
          ('Role: '||coalesce(j.assigned_role,'')||' · Status: '||coalesce(j.status,'' )||
           case when nullif(j.work_type,'') is not null then ' · '||upper(j.work_type) else '' end) as detail,
          'job_assignments'::text as source
        from public.job_assignments j
        where j.assignee_user_id=v_profile.user_id

        union all

        select
          r.created_at,'report',r.ticket_no,null::text,null::text,
          coalesce(r.actor_name,v_profile.full_name,v_profile.username),
          coalesce(r.kind,'REPORT')||case when nullif(r.text,'') is not null then ' · '||r.text else '' end,
          'reports'
        from public.reports r
        where r.actor_id=v_profile.user_id

        union all

        select
          w.created_at,'workflow_change',w.ticket_no,null::text,
          coalesce(w.after_data->>'unit_tag',w.before_data->>'unit_tag'),
          coalesce(w.changed_by_name,v_profile.full_name,v_profile.username),
          coalesce(w.operation,'CHANGE')||' · '||coalesce(w.source_table,'workflow'),
          'workflow_checkpoints'
        from public.workflow_checkpoints w
        where w.changed_by=v_profile.user_id

        union all

        select
          h.created_at,'inventory_history',null::text,null::text,h.unit_tag,
          coalesce(h.actor_name,v_profile.full_name,v_profile.username),
          coalesce(h.action,'inventory change')||
          case when h.from_status is not null or h.to_status is not null
               then ' · '||coalesce(h.from_status,'—')||' → '||coalesce(h.to_status,'—') else '' end||
          case when nullif(h.notes,'') is not null then ' · '||h.notes else '' end,
          'asset_inventory_history'
        from public.asset_inventory_history h
        where h.actor_id=v_profile.user_id
           or h.from_user_id=v_profile.user_id
           or h.to_user_id=v_profile.user_id

        union all

        select
          u.returned_at,'service_return',u.ticket_no,null::text,u.unit_tag,
          coalesce(u.service_tech_name,v_profile.full_name,v_profile.username),
          'Service returned '||coalesce(u.equipment_type,'equipment')||
          case when nullif(u.return_notes,'') is not null then ' · '||u.return_notes else '' end,
          'unit_returns'
        from public.unit_returns u
        where u.service_tech_id=v_profile.user_id

        union all

        select
          u.it_received_at,'it_intake',u.ticket_no,null::text,u.unit_tag,
          coalesce(u.it_tech_name,v_profile.full_name,v_profile.username),
          'IT Intake · '||coalesce(u.equipment_type,'equipment')||
          case when nullif(u.damage_notes,'') is not null then ' · '||u.damage_notes else '' end,
          'unit_returns'
        from public.unit_returns u
        where u.it_tech_id=v_profile.user_id and u.it_received_at is not null

        union all

        select
          f.service_started_at,'offline_unit_service',f.ticket_no,f.site,f.unit_tag,
          f.service_tech_name,
          'Service verified power and called IT · '||f.original_problem||
          ' · Service: '||f.service_troubleshooting_notes,
          'field_escalations'
        from public.field_escalations f
        where f.service_tech_id=v_profile.user_id

        union all

        select
          coalesce(f.owner_resolved_at,f.resolved_at,f.updated_at),
          'offline_unit_it',f.ticket_no,f.site,f.unit_tag,
          coalesce(f.it_tech_name,v_profile.full_name,v_profile.username),
          'IT troubleshooting · '||replace(upper(f.status),'_',' ')||
          case when nullif(f.it_troubleshooting_notes,'') is not null
               then ' · IT: '||f.it_troubleshooting_notes else '' end||
          case when nullif(f.owner_resolution,'') is not null
               then ' · Owner: '||f.owner_resolution else '' end,
          'field_escalations'
        from public.field_escalations f
        where f.it_tech_id=v_profile.user_id
      ) x
      where x.event_at is not null
      order by x.event_at desc
      limit v_limit
    ) e;

  elsif v_kind = 'unit' then
    v_key := public.normalize_unit_key(v_value);

    select to_jsonb(u) into v_subject
    from public.unit_registry u
    where u.unit_key=v_key
    order by u.updated_at desc
    limit 1;

    if v_subject is null then
      select to_jsonb(a) into v_subject
      from public.asset_inventory a
      where a.unit_key=v_key
      order by a.updated_at desc
      limit 1;
    end if;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_at desc),'[]'::jsonb)
    into v_events
    from (
      select * from (
        select
          h.created_at as event_at,
          'inventory_history'::text as event_type,
          null::text as ticket_no,
          null::text as site,
          h.unit_tag,
          h.actor_name,
          coalesce(h.action,'inventory change')||
          case when h.from_status is not null or h.to_status is not null
               then ' · '||coalesce(h.from_status,'—')||' → '||coalesce(h.to_status,'—') else '' end||
          case when nullif(h.notes,'') is not null then ' · '||h.notes else '' end as detail,
          'asset_inventory_history'::text as source
        from public.asset_inventory_history h
        where h.unit_key=v_key

        union all

        select
          pi.verified_at,'it_verification',pt.ticket_no,pt.site,pi.unit_tag,
          coalesce(p.full_name,p.username),
          'IT verified '||coalesce(pi.equipment_type,'equipment')||' for '||coalesce(pi.purpose::text,'work'),
          'prep_items'
        from public.prep_items pi
        join public.prep_tickets pt on pt.id=pi.prep_ticket_id
        left join public.profiles p on p.user_id=pi.verified_by
        where public.normalize_unit_key(pi.unit_tag)=v_key
          and pi.verified_at is not null

        union all

        select
          u.returned_at,'service_return',u.ticket_no,null::text,u.unit_tag,u.service_tech_name,
          'Service returned '||coalesce(u.equipment_type,'equipment')||
          case when nullif(u.return_notes,'') is not null then ' · '||u.return_notes else '' end,
          'unit_returns'
        from public.unit_returns u
        where public.normalize_unit_key(u.unit_tag)=v_key and u.returned_at is not null

        union all

        select
          u.it_received_at,'it_intake',u.ticket_no,null::text,u.unit_tag,u.it_tech_name,
          'IT Intake · '||coalesce(u.equipment_type,'equipment')||
          case when nullif(u.damage_notes,'') is not null then ' · '||u.damage_notes else '' end,
          'unit_returns'
        from public.unit_returns u
        where public.normalize_unit_key(u.unit_tag)=v_key and u.it_received_at is not null

        union all

        select
          w.created_at,'workflow_change',w.ticket_no,null::text,
          coalesce(w.after_data->>'unit_tag',w.before_data->>'unit_tag'),
          w.changed_by_name,
          coalesce(w.operation,'CHANGE')||' · '||coalesce(w.source_table,'workflow'),
          'workflow_checkpoints'
        from public.workflow_checkpoints w
        where public.normalize_unit_key(coalesce(w.after_data->>'unit_tag',w.before_data->>'unit_tag'))=v_key

        union all

        select
          coalesce(f.owner_resolved_at,f.resolved_at,f.updated_at),
          'offline_unit_escalation',f.ticket_no,f.site,f.unit_tag,
          coalesce(f.it_tech_name,f.service_tech_name),
          'Offline unit · '||replace(upper(f.status),'_',' ')||
          ' · Service verified power'||
          case when nullif(f.service_troubleshooting_notes,'') is not null
               then ' · Service: '||f.service_troubleshooting_notes else '' end||
          case when nullif(f.it_troubleshooting_notes,'') is not null
               then ' · IT: '||f.it_troubleshooting_notes else '' end||
          case when nullif(f.backup_unit_tag,'') is not null
               then ' · Backup '||f.backup_unit_tag else '' end||
          case when nullif(f.owner_resolution,'') is not null
               then ' · Owner: '||f.owner_resolution else '' end,
          'field_escalations'
        from public.field_escalations f
        where public.normalize_unit_key(f.unit_tag)=v_key
      ) x
      where x.event_at is not null
      order by x.event_at desc
      limit v_limit
    ) e;

    if v_subject is null and jsonb_array_length(v_events)=0 then
      return jsonb_build_object('kind',v_kind,'query',v_value,'unit_key',v_key,'found',false,'events','[]'::jsonb);
    end if;

  else
    select site into v_site
    from (
      select j.site, max(coalesce(j.updated_at,j.assigned_at)) as at
      from public.job_assignments j
      where lower(btrim(coalesce(j.site,'')))=lower(v_value)
      group by j.site
      union all
      select p.site, max(coalesce(p.closed_at,p.released_at,p.created_at)) as at
      from public.prep_tickets p
      where lower(btrim(coalesce(p.site,'')))=lower(v_value)
      group by p.site
      union all
      select f.site, max(f.updated_at) as at
      from public.field_escalations f
      where lower(btrim(coalesce(f.site,'')))=lower(v_value)
      group by f.site
    ) s
    order by at desc nulls last
    limit 1;

    if v_site is null then
      return jsonb_build_object('kind',v_kind,'query',v_value,'found',false,'events','[]'::jsonb);
    end if;

    v_subject := jsonb_build_object('site',v_site);

    with tickets as (
      select distinct j.ticket_no
      from public.job_assignments j
      where lower(btrim(coalesce(j.site,'')))=lower(v_site)
      union
      select distinct p.ticket_no
      from public.prep_tickets p
      where lower(btrim(coalesce(p.site,'')))=lower(v_site)
    )
    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_at desc),'[]'::jsonb)
    into v_events
    from (
      select * from (
        select
          coalesce(j.completed_at,j.started_at,j.assigned_at,j.updated_at) as event_at,
          'job_assignment'::text as event_type,
          j.ticket_no,
          j.site,
          null::text as unit_tag,
          j.assignee_name as actor_name,
          ('Role: '||coalesce(j.assigned_role,'')||' · Status: '||coalesce(j.status,'')||
           case when nullif(j.work_type,'') is not null then ' · '||upper(j.work_type) else '' end) as detail,
          'job_assignments'::text as source
        from public.job_assignments j
        where lower(btrim(coalesce(j.site,'')))=lower(v_site)

        union all

        select
          coalesce(p.closed_at,p.released_at,p.created_at),'prep_ticket',p.ticket_no,p.site,null::text,
          coalesce(p.closed_by_name,p.released_by_name),
          'Equipment workflow · '||coalesce(p.status::text,'unknown'),
          'prep_tickets'
        from public.prep_tickets p
        where lower(btrim(coalesce(p.site,'')))=lower(v_site)

        union all

        select
          pi.verified_at,'unit_work',pt.ticket_no,pt.site,pi.unit_tag,
          coalesce(pr.full_name,pr.username),
          'IT verified '||coalesce(pi.equipment_type,'equipment')||' · '||coalesce(pi.purpose::text,'work'),
          'prep_items'
        from public.prep_items pi
        join public.prep_tickets pt on pt.id=pi.prep_ticket_id
        left join public.profiles pr on pr.user_id=pi.verified_by
        where lower(btrim(coalesce(pt.site,'')))=lower(v_site)
          and pi.verified_at is not null

        union all

        select
          r.created_at,'report',r.ticket_no,v_site,null::text,r.actor_name,
          coalesce(r.kind,'REPORT')||case when nullif(r.text,'') is not null then ' · '||r.text else '' end,
          'reports'
        from public.reports r
        where r.ticket_no in (select ticket_no from tickets)

        union all

        select
          u.returned_at,'service_return',u.ticket_no,v_site,u.unit_tag,u.service_tech_name,
          'Service returned '||coalesce(u.equipment_type,'equipment')||
          case when nullif(u.return_notes,'') is not null then ' · '||u.return_notes else '' end,
          'unit_returns'
        from public.unit_returns u
        where u.ticket_no in (select ticket_no from tickets) and u.returned_at is not null

        union all

        select
          w.created_at,'workflow_change',w.ticket_no,v_site,
          coalesce(w.after_data->>'unit_tag',w.before_data->>'unit_tag'),
          w.changed_by_name,
          coalesce(w.operation,'CHANGE')||' · '||coalesce(w.source_table,'workflow'),
          'workflow_checkpoints'
        from public.workflow_checkpoints w
        where w.ticket_no in (select ticket_no from tickets)

        union all

        select
          coalesce(f.owner_resolved_at,f.resolved_at,f.updated_at),
          'offline_unit_escalation',f.ticket_no,f.site,f.unit_tag,
          coalesce(f.it_tech_name,f.service_tech_name),
          'Offline unit · '||replace(upper(f.status),'_',' ')||
          ' · Problem: '||f.original_problem||
          case when nullif(f.it_troubleshooting_notes,'') is not null
               then ' · IT: '||f.it_troubleshooting_notes else '' end||
          case when nullif(f.owner_resolution,'') is not null
               then ' · Owner: '||f.owner_resolution else '' end,
          'field_escalations'
        from public.field_escalations f
        where lower(btrim(coalesce(f.site,'')))=lower(v_site)
      ) x
      where x.event_at is not null
      order by x.event_at desc
      limit v_limit
    ) e;
  end if;

  return jsonb_build_object(
    'kind',v_kind,
    'query',v_value,
    'found',true,
    'subject',coalesce(v_subject,'{}'::jsonb),
    'events',coalesce(v_events,'[]'::jsonb),
    'event_count',jsonb_array_length(coalesce(v_events,'[]'::jsonb))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.owner_job_closeout_summary_v1(p_ticket_no text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ticket text:=btrim(coalesce(p_ticket_no,''));
  v_site text;
  v_assignments integer:=0;
  v_active integer:=0;
  v_it_total integer:=0;
  v_it_open integer:=0;
  v_service_total integer:=0;
  v_service_complete integer:=0;
  v_service_open integer:=0;
  v_prep public.prep_tickets%rowtype;
  v_prep_found boolean:=false;
  v_return_total integer:=0;
  v_return_open integer:=0;
  v_required_swap_returns integer:=0;
  v_recorded_required_swap_returns integer:=0;
  v_missing_required_swap_returns integer:=0;
  v_it_photos integer:=0;
  v_service_photos integer:=0;
  v_service_signatures integer:=0;
  v_items integer:=0;
  v_review public.owner_job_reviews%rowtype;
  v_ready boolean:=false;
  v_owner_assigned text;
  v_it_status text;
  v_handoff_status text;
  v_service_status text;
  v_returns_status text;
  v_evidence_status text;
  v_offline_escalations integer:=0;
  v_open_offline_escalations integer:=0;
begin
  perform public.require_role(array['owner'::public.app_role]);
  if v_ticket='' then raise exception 'MHelpDesk ticket number is required'; end if;

  select
    count(*),
    count(*) filter(where status in ('assigned','started')),
    count(*) filter(where assigned_role='it'),
    count(*) filter(where assigned_role='it' and status in ('assigned','started')),
    count(*) filter(where assigned_role='service'),
    count(*) filter(where assigned_role='service' and status='completed'),
    count(*) filter(where assigned_role='service' and status in ('assigned','started')),
    max(site) filter(where nullif(btrim(coalesce(site,'')),'') is not null)
  into v_assignments,v_active,v_it_total,v_it_open,v_service_total,v_service_complete,v_service_open,v_site
  from public.job_assignments
  where btrim(ticket_no)=v_ticket;

  select * into v_prep
  from public.prep_tickets
  where btrim(ticket_no)=v_ticket
  order by created_at desc
  limit 1;
  v_prep_found:=found;
  if v_site is null and v_prep_found then v_site:=v_prep.site; end if;

  if v_assignments=0 and not v_prep_found then
    return jsonb_build_object('found',false,'ticket_no',v_ticket);
  end if;

  if v_prep_found then
    select count(*) into v_items
    from public.prep_items
    where prep_ticket_id=v_prep.id;

    select
      count(*) filter(where stage='it' and kind='photo'),
      count(*) filter(where stage='service' and kind='photo'),
      count(*) filter(where stage='service' and kind='signature')
    into v_it_photos,v_service_photos,v_service_signatures
    from public.handoff_evidence
    where prep_ticket_id=v_prep.id;

    with required as (
      select pi.equipment_type,count(*)::integer as required_count
      from public.prep_items pi
      where pi.prep_ticket_id=v_prep.id
        and pi.purpose::text='SWAP'
        and pi.equipment_type in ('Helios','Sniper','Spotter','Recon 2')
      group by pi.equipment_type
    ),
    returned as (
      select u.equipment_type,count(*)::integer as recorded_count
      from public.unit_returns u
      where btrim(u.ticket_no)=v_ticket
        and u.equipment_type in ('Helios','Sniper','Spotter','Recon 2')
      group by u.equipment_type
    )
    select
      coalesce(sum(r.required_count),0)::integer,
      coalesce(sum(least(r.required_count,coalesce(x.recorded_count,0))),0)::integer,
      coalesce(sum(greatest(r.required_count-coalesce(x.recorded_count,0),0)),0)::integer
    into v_required_swap_returns,v_recorded_required_swap_returns,v_missing_required_swap_returns
    from required r
    left join returned x using(equipment_type);
  end if;

  select
    count(*),
    count(*) filter(where status is distinct from 'completed')
  into v_return_total,v_return_open
  from public.unit_returns
  where btrim(ticket_no)=v_ticket;

  select
    count(*),
    count(*) filter(where resolved_at is null)
  into v_offline_escalations,v_open_offline_escalations
  from public.field_escalations
  where btrim(ticket_no)=v_ticket;

  select * into v_review
  from public.owner_job_reviews
  where ticket_no=v_ticket;

  v_owner_assigned:=case
    when v_assignments>0 then 'Complete'
    else 'MISSING INFORMATION'
  end;

  v_it_status:=case
    when v_it_total=0 then 'Not required by recorded assignment'
    when v_it_open=0 then 'Complete'
    else 'Pending'
  end;

  v_handoff_status:=case
    when not v_prep_found then 'Not required by recorded workflow'
    when v_prep.status='closed' then 'Complete'
    when v_prep.status='released' then 'IT handoff complete; Service closeout pending'
    else 'Pending'
  end;

  v_service_status:=case
    when v_service_complete>0 and v_service_open=0 then 'Complete'
    when v_service_open>0 then 'Pending'
    when v_service_total=0 then 'MISSING INFORMATION'
    else 'Pending'
  end;

  v_returns_status:=case
    when v_open_offline_escalations>0 then
      'Pending — '||v_open_offline_escalations||' offline-unit escalation(s) unresolved'
    when v_missing_required_swap_returns>0 then
      'Pending — '||v_missing_required_swap_returns||' of '||v_required_swap_returns||' required swap return(s) not recorded'
    when v_required_swap_returns>0 and v_return_open=0 then
      'Complete — all required swap returns recorded'
    when v_return_total=0 then 'No return records pending'
    when v_return_open=0 then 'Complete'
    else 'Pending'
  end;

  v_evidence_status:=case
    when not v_prep_found then
      'No equipment-handoff evidence gate applies to this recorded workflow'
    when v_prep.status='closed' then
      'Complete — Tech Check close gate passed'
    when v_it_photos>0 or v_service_photos>0 or v_service_signatures>0 then
      'Pending — evidence exists but workflow is not closed'
    else 'Pending'
  end;

  v_ready :=
    v_assignments>0
    and v_active=0
    and v_service_complete>0
    and (not v_prep_found or v_prep.status='closed')
    and v_return_open=0
    and v_open_offline_escalations=0
    and v_missing_required_swap_returns=0
    and coalesce(v_review.status,'')<>'closed';

  return jsonb_build_object(
    'found',true,
    'ticket_no',v_ticket,
    'site',coalesce(v_site,''),
    'ready_for_owner_review',v_ready,
    'review_status',coalesce(v_review.status,case when v_ready then 'ready' else 'not_ready' end),
    'reviewed_at',v_review.reviewed_at,
    'reviewed_by_name',v_review.reviewed_by_name,
    'correction_reason',v_review.correction_reason,
    'correction_role',v_review.correction_role,
    'overview',jsonb_build_object(
      'owner_assigned',v_owner_assigned,
      'it_completed',v_it_status,
      'handoff_completed',v_handoff_status,
      'service_completed',v_service_status,
      'equipment_returns_accounted_for',v_returns_status,
      'evidence_complete',v_evidence_status
    ),
    'counts',jsonb_build_object(
      'assignments',v_assignments,
      'active_assignments',v_active,
      'it_assignments',v_it_total,
      'service_assignments',v_service_total,
      'returns',v_return_total,
      'open_returns',v_return_open,
      'offline_unit_escalations',v_offline_escalations,
      'open_offline_unit_escalations',v_open_offline_escalations,
      'required_swap_returns',v_required_swap_returns,
      'recorded_required_swap_returns',v_recorded_required_swap_returns,
      'missing_required_swap_returns',v_missing_required_swap_returns,
      'prep_items',v_items,
      'it_photos',v_it_photos,
      'service_photos',v_service_photos,
      'service_signatures',v_service_signatures
    )
  );
end;
$function$;
