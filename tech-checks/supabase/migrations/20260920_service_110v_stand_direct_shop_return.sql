-- Owner-approved 110V Stand pickup/return workflow.
-- Service returns 110V Stands directly to Shop Inventory. IT Intake is not required.
-- 110V Stands may legitimately have no physical tag.

alter table public.unit_returns
  alter column unit_tag drop not null;

create or replace function public.guard_unit_return_conflict()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_key text;
  v_existing public.unit_registry%rowtype;
begin
  v_key := public.normalize_unit_key(new.unit_tag);

  if new.equipment_type='110V Stand' and new.status='completed' then
    return new;
  end if;

  if v_key='' then
    raise exception 'Unit tag is required';
  end if;

  if tg_op='INSERT' then
    select * into v_existing
    from public.unit_registry
    where unit_key=v_key
    for update;

    if found and v_existing.lifecycle_status<>'deployed' then
      raise exception 'Unit % cannot be returned because its current status is %',
        new.unit_tag,
        replace(upper(v_existing.lifecycle_status),'_',' ');
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.sync_unit_registry_from_return()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_key text;
  v_prev record;
  v_status text;
begin
  if tg_op='DELETE' then
    v_key := public.normalize_unit_key(old.unit_tag);
    if v_key='' then return old; end if;

    select i.id as prep_item_id,i.prep_ticket_id,i.unit_tag,i.equipment_type,
           t.ticket_no,t.status,t.closed_by,t.closed_by_name
    into v_prev
    from public.prep_items i
    join public.prep_tickets t on t.id=i.prep_ticket_id
    where public.normalize_unit_key(i.unit_tag)=v_key
    order by t.created_at desc, i.item_order desc
    limit 1;

    if found then
      v_status := case v_prev.status::text
        when 'draft' then 'it_prep'
        when 'released' then 'ready_for_service'
        else 'deployed'
      end;

      insert into public.unit_registry(
        unit_key,unit_tag,equipment_type,lifecycle_status,ticket_no,
        prep_ticket_id,prep_item_id,current_holder_id,current_holder_name,last_event,updated_at
      )
      values(
        v_key,v_prev.unit_tag,v_prev.equipment_type,v_status,v_prev.ticket_no,
        v_prev.prep_ticket_id,v_prev.prep_item_id,
        case when v_status='deployed' then v_prev.closed_by else null end,
        case when v_status='deployed' then v_prev.closed_by_name else null end,
        'Return tracking removed by Owner',now()
      )
      on conflict(unit_key) do update set
        unit_tag=excluded.unit_tag,
        equipment_type=excluded.equipment_type,
        lifecycle_status=excluded.lifecycle_status,
        ticket_no=excluded.ticket_no,
        prep_ticket_id=excluded.prep_ticket_id,
        prep_item_id=excluded.prep_item_id,
        current_holder_id=excluded.current_holder_id,
        current_holder_name=excluded.current_holder_name,
        last_event=excluded.last_event,
        updated_at=now();
    else
      delete from public.unit_registry
      where unit_key=v_key
        and lifecycle_status in ('returned_waiting_it','waiting_manager');
    end if;

    return old;
  end if;

  v_key := public.normalize_unit_key(new.unit_tag);
  if v_key='' then return new; end if;

  v_status := case new.status
    when 'waiting_it' then 'returned_waiting_it'
    when 'pending_mhelp_inventory' then 'waiting_manager'
    else 'shop_inventory'
  end;

  insert into public.unit_registry(
    unit_key,unit_tag,equipment_type,lifecycle_status,ticket_no,
    prep_ticket_id,prep_item_id,current_holder_id,current_holder_name,last_event,updated_at
  )
  values(
    v_key,btrim(new.unit_tag),new.equipment_type,v_status,new.ticket_no,
    new.prep_ticket_id,new.prep_item_id,
    case
      when v_status='returned_waiting_it' then new.service_tech_id
      when v_status='waiting_manager' then new.it_tech_id
      else null
    end,
    case
      when v_status='returned_waiting_it' then new.service_tech_name
      when v_status='waiting_manager' then new.it_tech_name
      else null
    end,
    case v_status
      when 'returned_waiting_it' then 'Returned by Service — waiting IT intake'
      when 'waiting_manager' then 'IT intake complete — waiting Manager/MHelpDesk'
      else 'Back in Shop Inventory'
    end,
    now()
  )
  on conflict(unit_key) do update set
    unit_tag=excluded.unit_tag,
    equipment_type=coalesce(excluded.equipment_type,public.unit_registry.equipment_type),
    lifecycle_status=excluded.lifecycle_status,
    ticket_no=excluded.ticket_no,
    prep_ticket_id=coalesce(excluded.prep_ticket_id,public.unit_registry.prep_ticket_id),
    prep_item_id=coalesce(excluded.prep_item_id,public.unit_registry.prep_item_id),
    current_holder_id=excluded.current_holder_id,
    current_holder_name=excluded.current_holder_name,
    last_event=excluded.last_event,
    updated_at=now();

  return new;
end;
$function$;

create or replace function public.service_return_110v_stand_to_shop_v1(
  p_ticket_no text,
  p_unit_tag text default null,
  p_notes text default null,
  p_return_photo_paths text[] default '{}'::text[],
  p_return_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_id uuid := coalesce(p_return_id,gen_random_uuid());
  v_tag text := nullif(trim(coalesce(p_unit_tag,'')),'');
  v_key text := public.normalize_unit_key(p_unit_tag);
  v_name text;
  v_asset public.asset_inventory%rowtype;
begin
  perform public.require_role(array['service'::public.app_role,'owner'::public.app_role]);

  if nullif(trim(coalesce(p_ticket_no,'')),'') is null then
    raise exception 'MHelpDesk ticket number is required';
  end if;

  if coalesce(cardinality(p_return_photo_paths),0)<1 then
    raise exception 'Take a clear 110V Stand return photo before adding it back to Shop';
  end if;

  if v_tag is not null and exists(
    select 1 from public.unit_returns
    where trim(ticket_no)=trim(p_ticket_no)
      and equipment_type='110V Stand'
      and public.normalize_unit_key(unit_tag)=v_key
  ) then
    raise exception 'This 110V Stand has already been returned for MHelpDesk #% ', trim(p_ticket_no);
  end if;

  v_name:=public.actor_display_name();

  insert into public.unit_returns(
    id,ticket_no,unit_tag,equipment_type,
    service_tech_id,service_tech_name,return_notes,return_photo_paths,
    status,completed_at,updated_at
  )
  values(
    v_id,trim(p_ticket_no),v_tag,'110V Stand',
    auth.uid(),v_name,nullif(trim(coalesce(p_notes,'')),''),
    coalesce(p_return_photo_paths,'{}'::text[]),
    'completed',now(),now()
  );

  if v_tag is not null then
    select * into v_asset
    from public.asset_inventory
    where unit_key=v_key
    for update;

    if found then
      insert into public.asset_inventory_history(
        unit_key,unit_tag,action,from_status,to_status,
        from_user_id,from_user_name,actor_id,actor_name,notes
      ) values(
        v_asset.unit_key,v_asset.unit_tag,'service_returned_110v_to_shop',
        v_asset.availability_status,'shop',
        v_asset.assigned_to,v_asset.assigned_to_name,
        auth.uid(),v_name,
        '110V Stand returned directly to Shop by Service on MHelpDesk #'||trim(p_ticket_no)
      );

      update public.asset_inventory
      set availability_status='shop',
          assigned_to=null,
          assigned_to_name=null,
          last_event='110V Stand returned directly to Shop by Service',
          updated_at=now()
      where unit_key=v_key;
    end if;
  end if;

  insert into public.reports(kind,actor_id,actor_name,ticket_no,text)
  values(
    '110V STAND RETURNED TO SHOP',
    auth.uid(),v_name,trim(p_ticket_no),
    'Service Tech '||v_name||' returned a 110V Stand directly to Shop Inventory'||
      case when v_tag is null then ' with no physical tag.' else ' with tag '||v_tag||'.' end
  );

  return v_id;
end;
$function$;

revoke all on function public.service_return_110v_stand_to_shop_v1(text,text,text,text[],uuid) from public;
revoke all on function public.service_return_110v_stand_to_shop_v1(text,text,text,text[],uuid) from anon;
grant execute on function public.service_return_110v_stand_to_shop_v1(text,text,text,text[],uuid) to authenticated;
