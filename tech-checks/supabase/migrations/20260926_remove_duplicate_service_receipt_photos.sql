CREATE OR REPLACE FUNCTION public.close_prep_ticket(p_prep_id uuid, p_verifications jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_item record;
  v_verify jsonb;
  v_actual int;
  v_tag text;
  v_required int;
  v_no text;
  v_test boolean;
  v_name text;
  v_photos int;
  v_it_photos int;
  v_signed_at timestamptz;
  v_expected int;
  v_items int;
  v_parts_total int;
  v_parts_confirmed boolean;
  v_actor_id uuid;
  v_role public.app_role;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);
  v_role:=public.current_app_role();

  select ticket_no,is_test,expected_unit_count,
         (solar_panel_qty+battery_replacement_qty+camera_replacement_qty+sim_replacement_qty+micro_sd_qty),
         service_parts_confirmed
  into v_no,v_test,v_expected,v_parts_total,v_parts_confirmed
  from public.prep_tickets
  where id=p_prep_id and status='released';

  if not found then raise exception 'Service handoff not found or no longer waiting for Service'; end if;
  if coalesce(v_parts_total,0)>0 and not coalesce(v_parts_confirmed,false) then
    raise exception 'Verify the listed parts from IT before accepting this equipment.';
  end if;
  if jsonb_typeof(p_verifications)<>'array' then raise exception 'Equipment checkout verifications are required'; end if;

  v_actor_id:=auth.uid();
  v_name:=public.actor_display_name();

  if coalesce(v_test,false) and v_role='owner'::public.app_role then
    select a.assignee_user_id,coalesce(a.assignee_name,p.full_name,p.username,'Test Service')
      into v_actor_id,v_name
    from public.job_assignments a
    left join public.profiles p on p.user_id=a.assignee_user_id
    where trim(a.ticket_no)=trim(v_no)
      and a.assigned_role='service'
      and a.created_from='owner_test_center'
      and a.assignee_user_id is not null
    order by a.assigned_at desc
    limit 1;

    if v_actor_id is null then
      v_actor_id:=auth.uid();
      v_name:=public.actor_display_name();
    end if;
  end if;

  select count(*) into v_items from public.prep_items where prep_ticket_id=p_prep_id;

  for v_item in
    select * from public.prep_items where prep_ticket_id=p_prep_id order by item_order
  loop
    select value into v_verify
    from jsonb_array_elements(p_verifications)
    where value->>'item_id'=v_item.id::text
    limit 1;

    if v_verify is null then raise exception 'Missing equipment checkout verification for item %',v_item.item_order; end if;

    v_tag:=trim(v_verify->>'unit_tag');
    if v_tag is distinct from v_item.unit_tag then
      raise exception 'Unit tag does not match IT-prepared item %',v_item.item_order;
    end if;

    v_required:=coalesce(v_item.required_battery_count,0);
    if v_required>0 then
      v_actual:=coalesce((v_verify->>'battery_count')::int,-1);
      if v_actual<>v_item.battery_count then
        raise exception 'Battery count does not match IT-prepared count for item %',v_item.item_order;
      end if;
      if v_actual<v_required then
        raise exception 'Battery count is below the required count for item %',v_item.item_order;
      end if;
      if coalesce((v_verify->>'battery_verified')::boolean,false) is not true then
        raise exception 'Battery verification is required for item %',v_item.item_order;
      end if;
    else
      v_actual:=null;
    end if;

    if coalesce((v_verify->>'unit_confirmed')::boolean,false) is not true then
      raise exception 'Exact item confirmation is required for item %',v_item.item_order;
    end if;

    update public.prep_items
    set service_battery_count=v_actual,
        service_unit_confirmed=true,
        service_verified_by=v_actor_id,
        service_verified_at=now()
    where id=v_item.id;
  end loop;

  select count(*) into v_it_photos
  from public.handoff_evidence
  where prep_ticket_id=p_prep_id and stage='it' and kind='photo';

  if v_expected is not null then
    if v_it_photos<>v_items then raise exception 'IT photo count does not match the % prepared items',v_items; end if;
  elsif v_it_photos<1 then
    raise exception 'IT handoff photo proof is required before Service can accept the equipment';
  end if;

  select max(created_at) into v_signed_at
  from public.handoff_evidence
  where prep_ticket_id=p_prep_id and stage='service' and kind='signature';

  if v_signed_at is null then
    raise exception 'Service signature is required before marking equipment deployed to field';
  end if;

  update public.prep_tickets
  set status='closed',closed_by=v_actor_id,closed_by_name=v_name,closed_at=now()
  where id=p_prep_id;

  update public.job_assignments
  set prep_ticket_id=p_prep_id,
      status='completed',
      completed_at=now(),
      updated_at=now()
  where assigned_role='service'
    and ticket_no=v_no
    and assignee_user_id=v_actor_id
    and status in ('assigned','started');

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text,is_test)
  values(
    case when v_test then 'TEST EQUIPMENT DEPLOYED TO FIELD' else 'EQUIPMENT DEPLOYED TO FIELD' end,
    v_actor_id,
    v_name,
    v_no,
    'Service Tech '||v_name||' verified the exact IT-prepared equipment'||
      case when coalesce(v_parts_total,0)>0 then ' and all listed parts' else '' end||
      ', reviewed the IT handoff photo/signature evidence, signed the Service receipt, and equipment was marked deployed to field.',
    coalesce(v_test,false)
  );
end;
$function$
