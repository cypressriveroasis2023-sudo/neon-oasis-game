-- Multi-return UI support. Existing matched-unit submit/intake writers are unchanged.
-- Unlinked truck items can be physically returned, but can never create Ready stock.
begin;
alter table app_private.techcheck_ticketfree_returns_v1 alter column returned_key drop not null;
alter table app_private.techcheck_ticketfree_returns_v1 add column identity_state text not null default 'matched' check(identity_state in ('matched','needs_review'));
alter table app_private.techcheck_ticketfree_returns_v1 add constraint ticketfree_identity_binding_v2 check((identity_state='matched' and returned_key is not null) or (identity_state='needs_review' and returned_key is null));
alter table app_private.techcheck_ticketfree_returns_v1 drop constraint techcheck_ticketfree_returns_v1_state_check;
alter table app_private.techcheck_ticketfree_returns_v1 add constraint techcheck_ticketfree_returns_v1_state_check check(state in ('waiting_it','checked_in','repair','identity_review'));
alter table app_private.techcheck_ticketfree_returns_v1 add constraint ticketfree_unlinked_stock_hold_v2 check(identity_state<>'needs_review' or state in ('waiting_it','identity_review'));
create unique index ticketfree_unlinked_open_v2 on app_private.techcheck_ticketfree_returns_v1(family,unit_tag) where identity_state='needs_review' and state in ('waiting_it','identity_review');

create function app_private.submit_techcheck_ticketfree_unlinked_v1(p_request_id uuid,p_family text,p_unit_tag text,p_notes text,p_photos text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; t public.service_truck_units%rowtype; ev app_private.techcheck_ticketfree_events_v1%rowtype; payload jsonb; result jsonb; name text; restock uuid; n integer;
begin
 p:=app_private.techcheck_ticketfree_actor_v1();
 if p.role::text<>'service' then raise exception 'Only the signed-in Service technician can return truck equipment.' using errcode='42501';end if;
 if p_request_id is null or nullif(btrim(p_family),'') is null or nullif(btrim(p_unit_tag),'') is null or p_notes is null or length(p_notes)>2000 then raise exception 'Select an assigned truck unit and retain its exact family and tag.';end if;
 payload:=jsonb_build_object('family',p_family,'unit_tag',p_unit_tag,'notes',p_notes,'photos',p_photos);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,41));
 select * into ev from app_private.techcheck_ticketfree_events_v1 where request_id=p_request_id;
 if found then
  if ev.actor_id<>p.user_id or ev.action<>'submit' or ev.payload<>payload then raise exception 'This request ID was already used for different information.';end if;
  return ev.result||jsonb_build_object('replayed',true);
 end if;
 perform app_private.techcheck_ticketfree_photos_v1(p_request_id,p_photos);
 perform set_config('lock_timeout','4s',true);
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 select * into t from public.service_truck_units where service_tech_id=p.user_id and equipment_type=p_family and unit_tag=p_unit_tag and status='assigned' for update;
 if not found then raise exception 'This exact unit is no longer assigned to your truck. Refresh before returning it.';end if;
 select count(*) into n from public.equipment_master where unit_tag=p_unit_tag and (canonical_family=p_family or workflow_type=p_family);
 if n=1 then raise exception 'This unit now has a matched identity. Refresh and select its catalogue entry.';end if;
 if exists(select 1 from public.equipment_master e join app_private.techcheck_transfer_reservations h on h.equipment_key=e.equipment_key where e.unit_tag=p_unit_tag and (e.canonical_family=p_family or e.workflow_type=p_family)) then raise exception 'This unit has an unresolved signed handoff.';end if;
 if exists(select 1 from public.unit_returns where equipment_type=p_family and unit_tag=p_unit_tag and status<>'completed') then raise exception 'This unit already has an unresolved return.';end if;
 if exists(select 1 from public.prep_items i join public.prep_tickets j on j.id=i.prep_ticket_id where i.equipment_type=p_family and i.unit_tag=p_unit_tag and j.status::text<>'closed' and not coalesce(j.is_test,false)) then raise exception 'This unit has an open preparation or handoff.';end if;
 if exists(select 1 from app_private.techcheck_ticketfree_returns_v1 where family=p_family and unit_tag=p_unit_tag and state in ('waiting_it','identity_review')) then raise exception 'This unit is already waiting for IT or unit-ID verification.';end if;
 name:=coalesce(nullif(p.full_name,''),p.username,'Service');
 update public.service_truck_units set status='used_restock_due',last_used_ticket_no=null,last_used_at=now(),old_unit_tag=p_unit_tag,updated_at=now() where service_tech_id=p.user_id and equipment_type=p_family;
 insert into public.service_truck_restock_requests(service_tech_id,service_tech_name,item_kind,item_type,qty_needed,used_unit_tag,old_unit_tag,status,reason)
 values(p.user_id,name,'unit',p_family,1,p_unit_tag,p_unit_tag,'awaiting_return','Unlinked truck return '||p_request_id::text||' — physical receipt and unit-ID review required.') returning id into restock;
 insert into app_private.techcheck_ticketfree_returns_v1(id,service_tech_id,service_tech_name,returned_key,family,unit_tag,source_mode,notes,photos,registry_key,original_registry,original_master,expected_lifecycle,restock_request_id,identity_state)
 values(p_request_id,p.user_id,name,null,p_family,p_unit_tag,'truck_return',p_notes,p_photos,'unlinked:'||p_request_id::text,'{}',to_jsonb(t),'identity_review',restock,'needs_review');
 insert into public.service_truck_unit_history(service_tech_id,equipment_type,unit_tag,event,actor_id,actor_name) values(p.user_id,p_family,p_unit_tag,'TRUCK RETURN - UNIT ID REVIEW - '||p_request_id::text,p.user_id,name);
 update public.service_truck_inventory_checks set ready=false,updated_at=now() where service_tech_id=p.user_id and check_date=timezone('America/Chicago',now())::date;
 insert into public.app_notifications(recipient_user_id,kind,title,body,unit_tag) select user_id,'returned_unit','Equipment waiting for IT check-in',name||' returned '||p_family||' '||p_unit_tag||'. Receive it in Returned by Service; verify the unit ID before stocking.',p_unit_tag from public.profiles where active and archived_at is null and role::text='it';
 result:=jsonb_build_object('request_id',p_request_id,'return_id',p_request_id,'revision',1,'state','waiting_it');
 insert into app_private.techcheck_ticketfree_events_v1 values(p_request_id,p_request_id,p.user_id,'submit',payload,result,now());
 return result;
end$$;
revoke all on function app_private.submit_techcheck_ticketfree_unlinked_v1(uuid,text,text,text,text[]) from public,anon,service_role;
grant execute on function app_private.submit_techcheck_ticketfree_unlinked_v1(uuid,text,text,text,text[]) to authenticated;

-- One database transaction, with the existing immutable request ID per unit.
-- Any failed unit rolls back the entire selection, including staff notices.
create function public.submit_techcheck_ticketfree_return_batch_v1(p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; results jsonb:='[]'; result jsonb; photos text[];
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Select equipment before sending it.';end if;
 if jsonb_array_length(p_items) not between 1 and 24 then raise exception 'Send between one and 24 units together.';end if;
 if exists(select 1 from jsonb_array_elements(p_items) i where jsonb_typeof(i) is distinct from 'object' or nullif(i->>'request_id','') is null or jsonb_typeof(i->'photos') is distinct from 'array') then raise exception 'Saved return selection is incomplete.';end if;
 if exists(select 1 from jsonb_array_elements(p_items) i group by i->>'request_id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_items) i group by coalesce(i->>'returned_key','unlinked:'||coalesce(i->>'unlinked_family','')||':'||coalesce(i->>'unlinked_tag','')) having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_items) i where nullif(i->>'used_key','') is not null group by i->>'used_key' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_items) a join jsonb_array_elements(p_items) b on a->>'used_key'=b->>'returned_key') then raise exception 'The same equipment cannot be returned twice, installed twice, or both installed and returned.';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  photos:=array(select jsonb_array_elements_text(item->'photos'));
  if nullif(item->>'returned_key','') is not null then
   result:=public.submit_techcheck_ticketfree_return_v1((item->>'request_id')::uuid,item->>'returned_key',nullif(item->>'used_key',''),item->>'notes',photos);
  else
   if nullif(item->>'used_key','') is not null then raise exception 'Unlinked truck equipment can be returned for review, not recorded as an installed replacement.';end if;
   result:=app_private.submit_techcheck_ticketfree_unlinked_v1((item->>'request_id')::uuid,item->>'unlinked_family',item->>'unlinked_tag',item->>'notes',photos);
  end if;
  results:=results||jsonb_build_array(result);
 end loop;
 return jsonb_build_object('version',1,'results',results);
end$$;
revoke all on function public.submit_techcheck_ticketfree_return_batch_v1(jsonb) from public,anon,service_role;
grant execute on function public.submit_techcheck_ticketfree_return_batch_v1(jsonb) to authenticated;

create function app_private.receive_techcheck_ticketfree_unlinked_v1(p_request_id uuid,p_return_id uuid,p_revision integer,p_received boolean,p_disposition text,p_checks jsonb,p_notes text,p_photos text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; r app_private.techcheck_ticketfree_returns_v1%rowtype; ev app_private.techcheck_ticketfree_events_v1%rowtype; payload jsonb; result jsonb; name text; f text;
begin
 p:=app_private.techcheck_ticketfree_actor_v1();
 if p.role::text not in ('it','owner') then raise exception 'IT must confirm physical receipt.' using errcode='42501';end if;
 if p_request_id is null or p_return_id is null or p_revision is null or p_received is distinct from true or p_disposition is distinct from 'review' or p_notes is null or length(p_notes)>2000 then raise exception 'Confirm physical receipt. Unlinked equipment must stay in unit-ID review, not Ready inventory.';end if;
 payload:=jsonb_build_object('return_id',p_return_id,'revision',p_revision,'received',p_received,'disposition',p_disposition,'checks',p_checks,'notes',p_notes,'photos',p_photos);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,41));
 select * into ev from app_private.techcheck_ticketfree_events_v1 where request_id=p_request_id;
 if found then
  if ev.actor_id<>p.user_id or ev.action<>'receive' or ev.payload<>payload then raise exception 'This request ID was already used for different information.';end if;
  return ev.result||jsonb_build_object('replayed',true);
 end if;
 select * into r from app_private.techcheck_ticketfree_returns_v1 where id=p_return_id for update;
 if not found or r.state<>'waiting_it' or r.revision<>p_revision or r.identity_state<>'needs_review' or r.returned_key is not null then raise exception 'This return changed or was already received. Refresh the IT queue.';end if;
 foreach f in array array['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'] loop
  if jsonb_typeof(p_checks->f) is distinct from 'boolean' then raise exception 'Answer all six intake condition checks.';end if;
 end loop;
 perform app_private.techcheck_ticketfree_photos_v1(p_request_id,p_photos);
 name:=coalesce(nullif(p.full_name,''),p.username,'IT');
 update app_private.techcheck_ticketfree_returns_v1 set state='identity_review',it_tech_id=p.user_id,it_tech_name=name,received_at=now(),checks=p_checks,intake_notes=p_notes,intake_photos=p_photos,revision=2 where id=r.id;
 update public.service_truck_restock_requests set status='requested',reason='IT physically received the unlinked unit; its identity must be verified before available stock.',updated_at=now() where id=r.restock_request_id and status='awaiting_return';
 insert into public.service_truck_unit_history(service_tech_id,equipment_type,unit_tag,event,actor_id,actor_name) values(r.service_tech_id,r.family,r.unit_tag,'IT RECEIVED - UNIT ID REVIEW - '||r.id::text,p.user_id,name);
 insert into public.app_notifications(recipient_user_id,kind,title,body,unit_tag) values(r.service_tech_id,'equipment_ready_service','IT received your return',name||' received '||r.family||' '||r.unit_tag||'. Unit ID verification is required before it can become available inventory.',r.unit_tag);
 result:=jsonb_build_object('request_id',p_request_id,'return_id',r.id,'state','identity_review','revision',2);
 insert into app_private.techcheck_ticketfree_events_v1 values(p_request_id,r.id,p.user_id,'receive',payload,result,now());
 return result;
end$$;
revoke all on function app_private.receive_techcheck_ticketfree_unlinked_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) from public,anon,service_role;
grant execute on function app_private.receive_techcheck_ticketfree_unlinked_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) to authenticated;
create function public.receive_techcheck_ticketfree_unlinked_v1(p_request_id uuid,p_return_id uuid,p_revision integer,p_received boolean,p_disposition text,p_checks jsonb,p_notes text default '',p_photos text[] default '{}') returns jsonb language sql security invoker set search_path='' as $$select app_private.receive_techcheck_ticketfree_unlinked_v1(p_request_id,p_return_id,p_revision,p_received,p_disposition,p_checks,p_notes,p_photos)$$;
revoke all on function public.receive_techcheck_ticketfree_unlinked_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) from public,anon,service_role;
grant execute on function public.receive_techcheck_ticketfree_unlinked_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) to authenticated;

create or replace function app_private.techcheck_ticketfree_context_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype; r jsonb; t jsonb; e jsonb;
begin
 p:=app_private.techcheck_ticketfree_actor_v1();
 select coalesce(jsonb_agg(to_jsonb(x) order by x.submitted_at desc),'[]') into r from (
  select id,service_tech_id,service_tech_name,returned_key,family,unit_tag,used_key,used_family,used_tag,
   identity_state,source_mode,notes,photos,state,submitted_at,received_at,it_tech_name,checks,intake_notes,intake_photos,revision
  from app_private.techcheck_ticketfree_returns_v1
  where (p.role::text in ('it','owner') or service_tech_id=p.user_id)
   and (state in ('waiting_it','identity_review') or id in (select id from app_private.techcheck_ticketfree_returns_v1 where state<>'waiting_it' and (p.role::text in ('it','owner') or service_tech_id=p.user_id) order by submitted_at desc limit 50))
  order by (state='waiting_it') desc,submitted_at desc
 )x;
 select coalesce(jsonb_agg(jsonb_build_object('family',u.equipment_type,'unit_tag',u.unit_tag,'status',u.status,
  'equipment_key',case when m.n=1 then m.key end) order by u.equipment_type),'[]') into t
 from public.service_truck_units u cross join lateral (
  select count(*) n,min(equipment_key) key from public.equipment_master
  where unit_tag=u.unit_tag and (canonical_family=u.equipment_type or workflow_type=u.equipment_type)
 )m where u.service_tech_id=p.user_id;
 select coalesce(jsonb_agg(jsonb_build_object('equipment_key',equipment_key,'family',canonical_family,
   'unit_tag',unit_tag,'name',canonical_family||' '||unit_tag) order by canonical_family,unit_tag),'[]') into e
 from public.equipment_master where canonical_family is not null and nullif(btrim(unit_tag),'') is not null;
 return jsonb_build_object('version',1,'actor_id',p.user_id,'role',p.role,'returns',r,'truck',t,'equipment',e,
  'pending_count',(select count(*) from app_private.techcheck_ticketfree_returns_v1 where state='waiting_it' and (p.role::text in ('it','owner') or service_tech_id=p.user_id)));
end$$;

create or replace function app_private.techcheck_ticketfree_legacy_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v jsonb:=to_jsonb(new); before_row jsonb:='{}'; r app_private.techcheck_ticketfree_returns_v1%rowtype;
begin
 if tg_op='UPDATE' then before_row:=to_jsonb(old);end if;
 for r in select * from app_private.techcheck_ticketfree_returns_v1
  where state in ('waiting_it','identity_review') and ((family=v->>'equipment_type' and unit_tag=v->>'unit_tag')
    or (family=before_row->>'equipment_type' and unit_tag=before_row->>'unit_tag'))
  order by returned_key loop
  perform pg_advisory_xact_lock(hashtextextended(coalesce(r.returned_key,r.registry_key),2));
  -- IT has received the old item: replenishing its truck slot with a different
  -- unit does not release or reissue the held returned equipment.
  if tg_table_name='service_truck_units' and r.state='identity_review'
   and before_row->>'status'='used_restock_due'
   and before_row->>'service_tech_id'=r.service_tech_id::text
   and v->>'service_tech_id'=r.service_tech_id::text
   and v->>'equipment_type'=r.family
   and nullif(v->>'unit_tag','') is not null
   and v->>'unit_tag' is distinct from r.unit_tag then continue;end if;
  if tg_table_name='unit_registry' and v->>'unit_key'=r.registry_key and v->>'equipment_type'=r.family
   and v->>'unit_tag'=r.unit_tag and v->>'lifecycle_status'=r.expected_lifecycle
   and v->>'current_holder_id'=r.service_tech_id::text then continue;end if;
  raise exception 'This equipment is waiting for IT physical check-in; another workflow cannot issue or duplicate it.';
 end loop;
 return new;
end$$;

notify pgrst,'reload schema';
commit;
