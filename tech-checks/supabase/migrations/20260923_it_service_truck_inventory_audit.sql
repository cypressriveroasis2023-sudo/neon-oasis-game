-- IT Service Truck Inventory authority + immutable audit trail
-- IT/Owner maintain the official truck inventory. Service only physically verifies it.

create table if not exists public.service_truck_inventory_audit (
  id uuid primary key default gen_random_uuid(),
  service_tech_id uuid not null references public.profiles(user_id) on delete cascade,
  service_tech_name text,
  item_kind text not null check (item_kind in ('unit','sim','stock')),
  item_slot text not null,
  before_value text,
  after_value text,
  action text not null check (action in ('added','removed','changed','updated')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_role text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists service_truck_inventory_audit_tech_created_idx
  on public.service_truck_inventory_audit(service_tech_id, created_at desc);
create index if not exists service_truck_inventory_audit_actor_created_idx
  on public.service_truck_inventory_audit(actor_id, created_at desc);

alter table public.service_truck_inventory_audit enable row level security;

drop policy if exists service_truck_inventory_audit_owner_it_read on public.service_truck_inventory_audit;
create policy service_truck_inventory_audit_owner_it_read
on public.service_truck_inventory_audit
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.active=true
      and p.role::text in ('owner','it')
  )
);

create or replace function public.log_service_truck_inventory_audit_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_before text;
  v_after text;
  v_slot text;
  v_kind text;
  v_action text;
begin
  select * into v_actor from public.profiles where user_id=auth.uid();
  select * into v_target from public.profiles where user_id=coalesce(new.service_tech_id,old.service_tech_id);

  v_actor_name:=coalesce(
    v_actor.full_name,
    v_actor.username,
    to_jsonb(new)->>'assigned_by_name',
    to_jsonb(new)->>'updated_by_name',
    'System'
  );
  v_actor_role:=coalesce(v_actor.role::text,case when auth.uid() is null then 'system' else 'unknown' end);

  if tg_table_name='service_truck_units' then
    if row(old.unit_tag,old.status) is not distinct from row(new.unit_tag,new.status) then return new; end if;
    v_kind:='unit';
    v_slot:=new.equipment_type;
    v_before:=nullif(btrim(coalesce(old.unit_tag,'')),'');
    v_after:=nullif(btrim(coalesce(new.unit_tag,'')),'');
  elsif tg_table_name='service_truck_sims' then
    if row(old.sim_number,old.status) is not distinct from row(new.sim_number,new.status) then return new; end if;
    v_kind:='sim';
    v_slot:='SIM '||new.slot_no;
    v_before:=nullif(btrim(coalesce(old.sim_number,'')),'');
    v_after:=nullif(btrim(coalesce(new.sim_number,'')),'');
  elsif tg_table_name='service_truck_stock' then
    if old.recon_battery_qty is distinct from new.recon_battery_qty then
      insert into public.service_truck_inventory_audit(service_tech_id,service_tech_name,item_kind,item_slot,before_value,after_value,action,actor_id,actor_name,actor_role,details)
      values(new.service_tech_id,coalesce(v_target.full_name,v_target.username,'Service Tech'),'stock','Recon Battery',old.recon_battery_qty::text,new.recon_battery_qty::text,
        case when new.recon_battery_qty>old.recon_battery_qty then 'added' when new.recon_battery_qty<old.recon_battery_qty then 'removed' else 'updated' end,
        auth.uid(),v_actor_name,v_actor_role,jsonb_build_object('qty_before',old.recon_battery_qty,'qty_after',new.recon_battery_qty));
    end if;
    if old.agm_12v_110ah_qty is distinct from new.agm_12v_110ah_qty then
      insert into public.service_truck_inventory_audit(service_tech_id,service_tech_name,item_kind,item_slot,before_value,after_value,action,actor_id,actor_name,actor_role,details)
      values(new.service_tech_id,coalesce(v_target.full_name,v_target.username,'Service Tech'),'stock','AGM 12V 110Ah',old.agm_12v_110ah_qty::text,new.agm_12v_110ah_qty::text,
        case when new.agm_12v_110ah_qty>old.agm_12v_110ah_qty then 'added' when new.agm_12v_110ah_qty<old.agm_12v_110ah_qty then 'removed' else 'updated' end,
        auth.uid(),v_actor_name,v_actor_role,jsonb_build_object('qty_before',old.agm_12v_110ah_qty,'qty_after',new.agm_12v_110ah_qty));
    end if;
    if old.litime_12v_100ah_qty is distinct from new.litime_12v_100ah_qty then
      insert into public.service_truck_inventory_audit(service_tech_id,service_tech_name,item_kind,item_slot,before_value,after_value,action,actor_id,actor_name,actor_role,details)
      values(new.service_tech_id,coalesce(v_target.full_name,v_target.username,'Service Tech'),'stock','LiTime 12V 100Ah',old.litime_12v_100ah_qty::text,new.litime_12v_100ah_qty::text,
        case when new.litime_12v_100ah_qty>old.litime_12v_100ah_qty then 'added' when new.litime_12v_100ah_qty<old.litime_12v_100ah_qty then 'removed' else 'updated' end,
        auth.uid(),v_actor_name,v_actor_role,jsonb_build_object('qty_before',old.litime_12v_100ah_qty,'qty_after',new.litime_12v_100ah_qty));
    end if;
    return new;
  else
    return new;
  end if;

  v_action:=case
    when v_before is null and v_after is not null then 'added'
    when v_before is not null and v_after is null then 'removed'
    when v_before is distinct from v_after then 'changed'
    else 'updated'
  end;

  insert into public.service_truck_inventory_audit(service_tech_id,service_tech_name,item_kind,item_slot,before_value,after_value,action,actor_id,actor_name,actor_role,details)
  values(new.service_tech_id,coalesce(v_target.full_name,v_target.username,'Service Tech'),v_kind,v_slot,v_before,v_after,v_action,
    auth.uid(),v_actor_name,v_actor_role,jsonb_build_object('status_before',old.status,'status_after',new.status));

  return new;
end;
$$;

drop trigger if exists service_truck_units_inventory_audit on public.service_truck_units;
create trigger service_truck_units_inventory_audit after update on public.service_truck_units
for each row execute function public.log_service_truck_inventory_audit_v1();

drop trigger if exists service_truck_sims_inventory_audit on public.service_truck_sims;
create trigger service_truck_sims_inventory_audit after update on public.service_truck_sims
for each row execute function public.log_service_truck_inventory_audit_v1();

drop trigger if exists service_truck_stock_inventory_audit on public.service_truck_stock;
create trigger service_truck_stock_inventory_audit after update on public.service_truck_stock
for each row execute function public.log_service_truck_inventory_audit_v1();

create or replace function public.it_adjust_service_truck_inventory_v3(
  p_service_tech_id uuid,p_kind text,p_slot text,p_value text,p_checks jsonb,p_verified boolean,p_note text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_actor_name text;
  v_target_name text;
  v_old text;
  v_new text:=nullif(btrim(coalesce(p_value,'')),'');
  v_key text;
  v_qty integer;
  v_old_qty integer;
begin
  perform public.require_role(array['it'::public.app_role,'owner'::public.app_role]);

  select * into v_actor from public.profiles where user_id=auth.uid() and active=true;
  if not found then raise exception 'Active IT or Owner account required.'; end if;
  select * into v_target from public.profiles where user_id=p_service_tech_id and active=true and archived_at is null and role::text='service';
  if not found then raise exception 'Active Service Tech required.'; end if;

  v_actor_name:=coalesce(v_actor.full_name,v_actor.username,case when v_actor.role::text='owner' then 'Owner/Admin' else 'IT Technician' end);
  v_target_name:=coalesce(v_target.full_name,v_target.username,'Service Tech');
  perform public.ensure_service_truck_baseline_v1(p_service_tech_id);

  if p_kind='unit' then
    if p_slot not in ('Sniper','Ranger','Spotter','Solar Spotter') then raise exception 'Invalid permanent truck unit type.'; end if;
    select unit_tag into v_old from public.service_truck_units where service_tech_id=p_service_tech_id and equipment_type=p_slot for update;
    if coalesce(v_old,'')=coalesce(v_new,'') then return jsonb_build_object('ok',true,'changed',false); end if;

    if v_new is not null then
      if jsonb_typeof(coalesce(p_checks,'{}'::jsonb))<>'object'
         or not (p_checks ?& array['identity_ok','power_ok','functions_ok','programmed_online_ok','sd_storage_ok','sim_monitoring_ok','clean_safe_ok'])
         or exists(select 1 from jsonb_each(p_checks)
                   where key=any(array['identity_ok','power_ok','functions_ok','programmed_online_ok','sd_storage_ok','sim_monitoring_ok','clean_safe_ok'])
                     and value<>'true'::jsonb)
      then raise exception 'Complete every IT readiness check before assigning or correcting a truck unit.'; end if;

      if exists(select 1 from public.service_truck_units u
        where u.service_tech_id<>p_service_tech_id and u.status='assigned'
          and lower(regexp_replace(coalesce(u.unit_tag,''),'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(v_new,'[^a-zA-Z0-9]','','g')))
      then raise exception 'That unit is already assigned to another Service truck.'; end if;

      select equipment_key into v_key from public.equipment_master
      where lower(regexp_replace(coalesce(unit_tag,''),'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(v_new,'[^a-zA-Z0-9]','','g'))
        and lower(coalesce(workflow_type,canonical_family))=lower(p_slot)
      limit 1;
      if v_key is null then raise exception 'Unit % is not a known % in the 2026 Unit Tracker.',v_new,p_slot; end if;
    end if;

    if nullif(btrim(coalesce(v_old,'')),'') is not null and lower(coalesce(v_old,''))<>lower(coalesce(v_new,'')) then
      update public.unit_registry set lifecycle_status='shop',current_holder_id=null,current_holder_name='Shop',
        last_event='Removed from permanent Service truck inventory by '||v_actor_name,current_site=null,ticket_no=null,updated_at=now()
      where lower(regexp_replace(coalesce(unit_tag,''),'[^a-zA-Z0-9]','','g'))=lower(regexp_replace(v_old,'[^a-zA-Z0-9]','','g'));
    end if;

    update public.service_truck_units
    set unit_tag=v_new,status=case when v_new is null then 'unassigned' else 'assigned' end,last_used_ticket_no=null,last_used_at=null,
        old_unit_tag=v_old,assigned_by=auth.uid(),assigned_by_name=v_actor_name,assigned_at=now(),updated_at=now()
    where service_tech_id=p_service_tech_id and equipment_type=p_slot;

    insert into public.service_truck_unit_history(service_tech_id,equipment_type,unit_tag,event,ticket_no,old_unit_tag,actor_id,actor_name)
    values(p_service_tech_id,p_slot,coalesce(v_new,v_old),case when v_new is null then 'IT REMOVED FROM TRUCK' else 'IT CORRECTED TRUCK INVENTORY' end,
      null,v_old,auth.uid(),v_actor_name);

    if v_new is not null then
      insert into public.unit_registry(unit_key,unit_tag,equipment_type,lifecycle_status,current_holder_id,current_holder_name,last_event,current_site,updated_at)
      values(v_key,v_new,p_slot,'assigned_to_tech',p_service_tech_id,v_target_name,'IT assigned / corrected permanent Service truck inventory',null,now())
      on conflict(unit_key) do update set lifecycle_status='assigned_to_tech',current_holder_id=p_service_tech_id,current_holder_name=v_target_name,
        last_event=excluded.last_event,current_site=null,ticket_no=null,updated_at=now();
    end if;

  elsif p_kind='sim' then
    if p_slot not in ('1','2','3') then raise exception 'SIM slot must be 1, 2, or 3.'; end if;
    select sim_number into v_old from public.service_truck_sims where service_tech_id=p_service_tech_id and slot_no=p_slot::integer for update;
    if coalesce(v_old,'')=coalesce(v_new,'') then return jsonb_build_object('ok',true,'changed',false); end if;
    if v_new is not null and coalesce(p_verified,false) is not true then raise exception 'Physically verify the exact SIM number before saving it.'; end if;
    if v_new is not null and exists(select 1 from public.service_truck_sims s
      where s.status='assigned' and lower(btrim(coalesce(s.sim_number,'')))=lower(v_new)
        and not (s.service_tech_id=p_service_tech_id and s.slot_no=p_slot::integer))
    then raise exception 'That SIM number is already assigned to another Service truck slot.'; end if;

    update public.service_truck_sims
    set sim_number=v_new,status=case when v_new is null then 'unassigned' else 'assigned' end,last_used_ticket_no=null,last_used_at=null,
        assigned_by=auth.uid(),assigned_by_name=v_actor_name,assigned_at=now(),updated_at=now()
    where service_tech_id=p_service_tech_id and slot_no=p_slot::integer;

    insert into public.service_truck_sim_history(service_tech_id,slot_no,sim_number,event,ticket_no,actor_id,actor_name)
    values(p_service_tech_id,p_slot::integer,coalesce(v_new,v_old),case when v_new is null then 'IT REMOVED FROM TRUCK' else 'IT CORRECTED TRUCK INVENTORY' end,
      null,auth.uid(),v_actor_name);

  elsif p_kind='stock' then
    if p_slot not in ('Recon Battery','AGM 12V 110Ah','LiTime 12V 100Ah') then raise exception 'Invalid permanent truck stock type.'; end if;
    begin v_qty:=p_value::integer; exception when others then raise exception 'Enter a whole-number quantity.'; end;
    if v_qty<0 then raise exception 'Quantity cannot be negative.'; end if;

    if p_slot='Recon Battery' then
      select recon_battery_qty into v_old_qty from public.service_truck_stock where service_tech_id=p_service_tech_id for update;
      update public.service_truck_stock set recon_battery_qty=v_qty,updated_by=auth.uid(),updated_by_name=v_actor_name,updated_at=now() where service_tech_id=p_service_tech_id;
    elsif p_slot='AGM 12V 110Ah' then
      select agm_12v_110ah_qty into v_old_qty from public.service_truck_stock where service_tech_id=p_service_tech_id for update;
      update public.service_truck_stock set agm_12v_110ah_qty=v_qty,updated_by=auth.uid(),updated_by_name=v_actor_name,updated_at=now() where service_tech_id=p_service_tech_id;
    else
      select litime_12v_100ah_qty into v_old_qty from public.service_truck_stock where service_tech_id=p_service_tech_id for update;
      update public.service_truck_stock set litime_12v_100ah_qty=v_qty,updated_by=auth.uid(),updated_by_name=v_actor_name,updated_at=now() where service_tech_id=p_service_tech_id;
    end if;

    if coalesce(v_old_qty,0)<>v_qty then
      insert into public.service_truck_stock_history(service_tech_id,item_type,qty_before,qty_added,qty_after,actor_id,actor_name,note)
      values(p_service_tech_id,p_slot,coalesce(v_old_qty,0),v_qty-coalesce(v_old_qty,0),v_qty,auth.uid(),v_actor_name,
        coalesce(nullif(btrim(p_note),''),'IT set exact permanent truck stock count.'));
    end if;
  else
    raise exception 'Invalid inventory adjustment type.';
  end if;

  update public.service_truck_inventory_checks
  set ready=false,missing_items=jsonb_build_array(jsonb_build_object('kind','verification','item_type',p_slot,
      'message','IT changed permanent truck inventory. Service must physically verify the truck before leaving.')),updated_at=now()
  where service_tech_id=p_service_tech_id and check_date=timezone('America/Chicago',now())::date;

  perform public.close_stale_service_truck_restock_requests_v1();
  perform public.refresh_service_truck_restock_requests_v1();

  insert into public.reports(kind,actor_id,actor_name,text)
  values('IT SERVICE TRUCK INVENTORY ADJUSTED',auth.uid(),v_actor_name,
    v_target_name||' · '||p_kind||' · '||p_slot||' changed. Service re-verification required.'
      ||case when nullif(btrim(coalesce(p_note,'')),'') is not null then ' Note: '||btrim(p_note) else '' end);

  return public.service_departure_readiness_v1(p_service_tech_id);
end;
$$;

revoke all on function public.it_adjust_service_truck_inventory_v3(uuid,text,text,text,jsonb,boolean,text) from public,anon;
grant execute on function public.it_adjust_service_truck_inventory_v3(uuid,text,text,text,jsonb,boolean,text) to authenticated;

create or replace function public.service_truck_inventory_audit_v1(p_service_tech_id uuid)
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  from (
    select a.id,a.service_tech_id,a.service_tech_name,a.item_kind,a.item_slot,a.before_value,a.after_value,a.action,
           a.actor_id,a.actor_name,a.actor_role,a.details,a.created_at
    from public.service_truck_inventory_audit a
    where (p_service_tech_id is null or a.service_tech_id=p_service_tech_id)
    order by a.created_at desc
    limit 100
  ) x
  where exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.active=true and p.role::text in ('owner','it'));
$$;

revoke all on function public.service_truck_inventory_audit_v1(uuid) from public,anon;
grant execute on function public.service_truck_inventory_audit_v1(uuid) to authenticated;
