-- Cameras On Site — security hardening + owner system health
-- Live migration: security_hardening_owner_health_v1

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

alter function public.normalize_unit_key(text)
  set search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_owner_system_health_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_anon_secdef int := 0;
  v_mutable_normalize int := 0;
  v_migrations int := 0;
  v_active_assignments int := 0;
  v_active_tickets int := 0;
  v_conversations int := 0;
  v_messages int := 0;
  v_audits int := 0;
  v_failed_audits int := 0;
  v_knowledge_approved int := 0;
  v_knowledge_draft int := 0;
  v_blank_approved int := 0;
  v_closed_active jsonb := '[]'::jsonb;
  v_inactive_assignee jsonb := '[]'::jsonb;
  v_released_camera_invalid jsonb := '[]'::jsonb;
  v_closed_ranger_invalid jsonb := '[]'::jsonb;
  v_closed_swap_invalid jsonb := '[]'::jsonb;
  v_registry_mismatch jsonb := '[]'::jsonb;
  v_released_no_service jsonb := '[]'::jsonb;
  v_unlinked_active jsonb := '[]'::jsonb;
  v_duplicate_active_names jsonb := '[]'::jsonb;
  v_duplicate_all_names jsonb := '[]'::jsonb;
  v_hard_errors int := 0;
  v_attention int := 0;
begin
  perform public.require_role(array['owner'::public.app_role]);

  select count(*) into v_anon_secdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.prosecdef
    and has_function_privilege('anon',p.oid,'EXECUTE');

  select count(*) into v_mutable_normalize
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='normalize_unit_key'
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig,array[]::text[])) cfg
      where cfg like 'search_path=%'
    );

  select count(*) into v_migrations from supabase_migrations.schema_migrations;

  select count(*), count(distinct ticket_no)
  into v_active_assignments, v_active_tickets
  from public.job_assignments
  where status in ('assigned','started');

  select count(*) into v_conversations from public.vision_conversations where archived_at is null;
  select count(*) into v_messages from public.vision_messages;
  select count(*) into v_audits from public.vision_action_audit;
  select count(*) into v_failed_audits from public.vision_action_audit where status='failed';

  select count(*) filter (where status='approved'),
         count(*) filter (where status='draft'),
         count(*) filter (where status='approved' and btrim(coalesce(content,''))='')
  into v_knowledge_approved, v_knowledge_draft, v_blank_approved
  from public.vision_knowledge_entries;

  select coalesce(jsonb_agg(x order by x->>'ticket_no'),'[]'::jsonb)
  into v_closed_active
  from (
    select distinct jsonb_build_object(
      'ticket_no',p.ticket_no,
      'site',p.site
    ) x
    from public.prep_tickets p
    join public.job_assignments a on a.prep_ticket_id=p.id
    where p.status::text='closed'
      and a.status in ('assigned','started')
  ) s;

  select coalesce(jsonb_agg(x order by x->>'ticket_no'),'[]'::jsonb)
  into v_inactive_assignee
  from (
    select jsonb_build_object(
      'ticket_no',a.ticket_no,
      'role',a.assigned_role,
      'assignee',a.assignee_name
    ) x
    from public.job_assignments a
    join public.profiles p on p.user_id=a.assignee_user_id
    where a.status in ('assigned','started')
      and (p.active is false or p.archived_at is not null)
  ) s;

  select coalesce(jsonb_agg(x order by x->>'ticket_no'),'[]'::jsonb)
  into v_released_camera_invalid
  from (
    select jsonb_build_object(
      'ticket_no',p.ticket_no,
      'equipment_type',i.equipment_type,
      'unit_tag',i.unit_tag,
      'purpose',i.purpose::text
    ) x
    from public.prep_tickets p
    join public.prep_items i on i.prep_ticket_id=p.id
    where p.status::text='released'
      and i.equipment_type in ('Spotter','Recon 2','Ranger')
      and i.purpose::text in ('DELIVERY','SWAP','BACKUP')
      and (
        not coalesce(i.camera_port_81_ok,false)
        or not coalesce(i.camera_port_554_ok,false)
        or (i.equipment_type<>'Ranger' and not coalesce(i.unit_programmed_ok,false))
        or (i.equipment_type='Recon 2' and coalesce(i.recon_camera_count,0)<1)
        or (
          i.purpose::text='SWAP' and not (
            coalesce(i.delivery_sim_ok,false)
            and coalesce(i.delivery_camera_app_ok,false)
            and coalesce(i.delivery_customer_email_app_ok,false)
            and (i.equipment_type='Spotter' or coalesce(i.delivery_batteries_charged_ok,false))
            and coalesce(i.delivery_monitoring_ok,false)
            and coalesce(i.delivery_ticket_count_ok,false)
            and coalesce(i.delivery_sd_formatted_ok,false)
            and coalesce(i.delivery_recording_ok,false)
          )
        )
      )
  ) s;

  select coalesce(jsonb_agg(x order by x->>'ticket_no'),'[]'::jsonb)
  into v_closed_ranger_invalid
  from (
    select jsonb_build_object(
      'ticket_no',p.ticket_no,
      'unit_tag',i.unit_tag,
      'purpose',i.purpose::text
    ) x
    from public.prep_tickets p
    join public.prep_items i on i.prep_ticket_id=p.id
    where p.status::text='closed'
      and i.equipment_type='Ranger'
      and i.purpose::text in ('DELIVERY','SWAP')
      and not coalesce(i.ranger_field_victron_updated_ok,false)
  ) s;

  with required as (
    select p.ticket_no,i.equipment_type,count(*)::int required_count
    from public.prep_tickets p
    join public.prep_items i on i.prep_ticket_id=p.id
    where p.status::text='closed'
      and i.purpose::text='SWAP'
      and i.equipment_type in ('Sniper','Spotter','Recon 2')
    group by p.ticket_no,i.equipment_type
  ),
  returned as (
    select ticket_no,equipment_type,count(*)::int returned_count
    from public.unit_returns
    group by ticket_no,equipment_type
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ticket_no',r.ticket_no,
    'equipment_type',r.equipment_type,
    'required_returns',r.required_count,
    'recorded_returns',coalesce(x.returned_count,0)
  ) order by r.ticket_no,r.equipment_type),'[]'::jsonb)
  into v_closed_swap_invalid
  from required r
  left join returned x using(ticket_no,equipment_type)
  where coalesce(x.returned_count,0)<r.required_count;

  select coalesce(jsonb_agg(x order by x->>'unit_tag'),'[]'::jsonb)
  into v_registry_mismatch
  from (
    select jsonb_build_object(
      'unit_tag',u.unit_tag,
      'registry_ticket',u.ticket_no,
      'prep_ticket',p.ticket_no,
      'equipment_type',u.equipment_type
    ) x
    from public.unit_registry u
    join public.prep_items i on i.id=u.prep_item_id
    join public.prep_tickets p on p.id=i.prep_ticket_id
    where u.prep_ticket_id is distinct from p.id
       or nullif(btrim(u.ticket_no),'') is distinct from nullif(btrim(p.ticket_no),'')
       or nullif(btrim(u.unit_tag),'') is distinct from nullif(btrim(i.unit_tag),'')
  ) s;

  select coalesce(jsonb_agg(x order by x->>'ticket_no'),'[]'::jsonb)
  into v_released_no_service
  from (
    select jsonb_build_object('ticket_no',p.ticket_no,'site',p.site) x
    from public.prep_tickets p
    where p.status::text='released'
      and not exists (
        select 1
        from public.job_assignments a
        where a.prep_ticket_id=p.id
          and a.assigned_role='service'
          and a.status in ('assigned','started')
      )
  ) s;

  select coalesce(jsonb_agg(x order by x->>'ticket_no'),'[]'::jsonb)
  into v_unlinked_active
  from (
    select jsonb_build_object(
      'ticket_no',a.ticket_no,
      'role',a.assigned_role,
      'assignee',a.assignee_name
    ) x
    from public.job_assignments a
    where a.status in ('assigned','started')
      and a.prep_ticket_id is null
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('name',full_name,'active_records',n) order by full_name),'[]'::jsonb)
  into v_duplicate_active_names
  from (
    select lower(btrim(full_name)) k,min(full_name) full_name,count(*)::int n
    from public.profiles
    where active=true and archived_at is null and nullif(btrim(full_name),'') is not null
    group by lower(btrim(full_name))
    having count(*)>1
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object('name',full_name,'records',n) order by full_name),'[]'::jsonb)
  into v_duplicate_all_names
  from (
    select lower(btrim(full_name)) k,min(full_name) full_name,count(*)::int n
    from public.profiles
    where nullif(btrim(full_name),'') is not null
    group by lower(btrim(full_name))
    having count(*)>1
  ) d;

  v_hard_errors :=
      v_anon_secdef
    + v_mutable_normalize
    + jsonb_array_length(v_closed_active)
    + jsonb_array_length(v_inactive_assignee)
    + jsonb_array_length(v_released_camera_invalid)
    + jsonb_array_length(v_closed_ranger_invalid)
    + jsonb_array_length(v_closed_swap_invalid)
    + jsonb_array_length(v_registry_mismatch)
    + v_blank_approved;

  v_attention :=
      jsonb_array_length(v_released_no_service)
    + jsonb_array_length(v_unlinked_active)
    + jsonb_array_length(v_duplicate_active_names)
    + jsonb_array_length(v_duplicate_all_names)
    + v_failed_audits
    + v_knowledge_draft;

  return jsonb_build_object(
    'health_version','owner-health-v1',
    'generated_at',now(),
    'status',case when v_hard_errors=0 then 'healthy' else 'critical' end,
    'hard_error_count',v_hard_errors,
    'attention_count',v_attention,
    'security',jsonb_build_object(
      'anonymous_security_definer_functions',v_anon_secdef,
      'normalize_unit_key_mutable_search_path',v_mutable_normalize
    ),
    'workflow',jsonb_build_object(
      'active_assignments',v_active_assignments,
      'active_tickets',v_active_tickets,
      'released_without_service',v_released_no_service,
      'unlinked_active_assignments',v_unlinked_active
    ),
    'integrity',jsonb_build_object(
      'closed_with_active_assignment',v_closed_active,
      'inactive_assignee_on_active_job',v_inactive_assignee,
      'released_camera_family_rule_violations',v_released_camera_invalid,
      'closed_ranger_without_field_victron',v_closed_ranger_invalid,
      'closed_swap_missing_return',v_closed_swap_invalid,
      'unit_registry_mismatches',v_registry_mismatch
    ),
    'people',jsonb_build_object(
      'duplicate_active_names',v_duplicate_active_names,
      'duplicate_names_all_profiles',v_duplicate_all_names
    ),
    'vision',jsonb_build_object(
      'active_conversations',v_conversations,
      'messages',v_messages,
      'audited_actions',v_audits,
      'failed_actions',v_failed_audits,
      'approved_knowledge_entries',v_knowledge_approved,
      'draft_knowledge_entries',v_knowledge_draft,
      'blank_approved_knowledge_entries',v_blank_approved
    ),
    'database',jsonb_build_object(
      'migration_count',v_migrations
    )
  );
end;
$function$
;

revoke execute on function public.get_owner_system_health_v1() from public;
revoke execute on function public.get_owner_system_health_v1() from anon;
grant execute on function public.get_owner_system_health_v1() to authenticated;
