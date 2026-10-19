-- Ticket-free physical custody: Service truck -> IT -> native COS inventory.
-- Additive to the signed handoff and legacy ticket-return workflows.
-- No mHelpDesk calls, geocoding, provider checks, identity rewrites, or imported address edits.
begin;
create table app_private.techcheck_ticketfree_returns_v1 (
 id uuid primary key, service_tech_id uuid not null references public.profiles(user_id),
 service_tech_name text not null, returned_key text not null references public.equipment_master(equipment_key),
 family text not null, unit_tag text not null,
 used_key text references public.equipment_master(equipment_key), used_family text, used_tag text,
 source_mode text not null check(source_mode in ('swap','truck_return','field_return')),
 notes text not null default '', photos text[] not null default '{}',
 state text not null default 'waiting_it' check(state in ('waiting_it','checked_in','repair')),
 registry_key text not null, original_registry jsonb not null, original_master jsonb not null,
 expected_lifecycle text not null, restock_request_id uuid references public.service_truck_restock_requests(id),
 submitted_at timestamptz not null default now(), received_at timestamptz,
 it_tech_id uuid references public.profiles(user_id), it_tech_name text,
 checks jsonb, intake_notes text, intake_photos text[] not null default '{}',
 revision integer not null default 1 check(revision in (1,2))
);
create unique index techcheck_ticketfree_open_unit_v1 on app_private.techcheck_ticketfree_returns_v1(returned_key) where state='waiting_it';
create index techcheck_ticketfree_actor_v1 on app_private.techcheck_ticketfree_returns_v1(service_tech_id,submitted_at desc);
create table app_private.techcheck_ticketfree_events_v1 (
 request_id uuid primary key, return_id uuid not null references app_private.techcheck_ticketfree_returns_v1(id),
 actor_id uuid not null references public.profiles(user_id), action text not null check(action in ('submit','receive')),
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table app_private.techcheck_ticketfree_returns_v1 enable row level security;
alter table app_private.techcheck_ticketfree_events_v1 enable row level security;
revoke all on app_private.techcheck_ticketfree_returns_v1,app_private.techcheck_ticketfree_events_v1 from public,anon,authenticated,service_role;

create function app_private.techcheck_ticketfree_actor_v1() returns public.profiles
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
 select * into p from public.profiles where user_id=auth.uid() and active and archived_at is null and role::text in ('service','it','owner');
 if not found then raise exception 'Sign in with an active Service, IT or Owner account.' using errcode='42501';end if;
 return p;
end$$;
revoke all on function app_private.techcheck_ticketfree_actor_v1() from public,anon,authenticated,service_role;

create function app_private.techcheck_ticketfree_photos_v1(p_id uuid,p_paths text[]) returns void
language plpgsql security definer set search_path='' as $$
declare path text;
begin
 if p_paths is null or cardinality(p_paths)>8 then raise exception 'Use no more than eight photos.';end if;
 foreach path in array p_paths loop
  if path is null or path!~('^'||auth.uid()::text||'/'||p_id::text||'/[a-f0-9]{64}[.]jpg$')
   or not exists(select 1 from storage.objects where bucket_id='techcheck-ticketfree-evidence' and name=path
      and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880)
  then raise exception 'Save each photo under this signed-in return before submitting.';end if;
 end loop;
end$$;
revoke all on function app_private.techcheck_ticketfree_photos_v1(uuid,text[]) from public,anon,authenticated,service_role;

create function app_private.techcheck_ticketfree_context_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype; r jsonb; t jsonb; e jsonb;
begin
 p:=app_private.techcheck_ticketfree_actor_v1();
 select coalesce(jsonb_agg(to_jsonb(x) order by x.submitted_at desc),'[]') into r from (
  select id,service_tech_id,service_tech_name,returned_key,family,unit_tag,used_key,used_family,used_tag,
   source_mode,notes,photos,state,submitted_at,received_at,it_tech_name,checks,intake_notes,intake_photos,revision
  from app_private.techcheck_ticketfree_returns_v1
  where (p.role::text in ('it','owner') or service_tech_id=p.user_id)
   and (state='waiting_it' or id in (select id from app_private.techcheck_ticketfree_returns_v1 where state<>'waiting_it' and (p.role::text in ('it','owner') or service_tech_id=p.user_id) order by submitted_at desc limit 50))
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
revoke all on function app_private.techcheck_ticketfree_context_v1() from public,anon,service_role;
grant execute on function app_private.techcheck_ticketfree_context_v1() to authenticated;
create function public.techcheck_ticketfree_context_v1() returns jsonb language sql security invoker set search_path='' as $$select app_private.techcheck_ticketfree_context_v1()$$;
revoke all on function public.techcheck_ticketfree_context_v1() from public,anon,service_role;
grant execute on function public.techcheck_ticketfree_context_v1() to authenticated;

create function app_private.submit_techcheck_ticketfree_return_v1(p_request_id uuid,p_returned_key text,p_used_key text,p_notes text,p_photos text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; e public.equipment_master%rowtype; used public.equipment_master%rowtype;
 u public.unit_registry%rowtype; truck public.service_truck_units%rowtype; ev app_private.techcheck_ticketfree_events_v1%rowtype;
 payload jsonb; result jsonb; name text; mode text:='field_return'; rk text; life text; stock_family text;
 restock uuid; k text; n integer; original jsonb;
begin
 p:=app_private.techcheck_ticketfree_actor_v1();
 if p.role::text<>'service' then raise exception 'Only the signed-in Service technician can send a return.' using errcode='42501';end if;
 if p_request_id is null or p_returned_key is null or p_notes is null or length(p_notes)>2000 or p_photos is null then raise exception 'Return information is incomplete.';end if;
 payload:=jsonb_build_object('returned_key',p_returned_key,'used_key',p_used_key,'notes',p_notes,'photos',p_photos);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,41));
 select * into ev from app_private.techcheck_ticketfree_events_v1 where request_id=p_request_id;
 if found then
  if ev.actor_id<>p.user_id or ev.action<>'submit' or ev.payload<>payload then raise exception 'This request ID was already used for different information.';end if;
  return ev.result||jsonb_build_object('replayed',true);
 end if;
 perform app_private.techcheck_ticketfree_photos_v1(p_request_id,p_photos);
 perform set_config('lock_timeout','4s',true);
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(p.user_id::text,0));
 for k in select distinct key from unnest(array[p_returned_key,p_used_key]) key where key is not null order by key loop
  perform pg_advisory_xact_lock(hashtextextended(k,2));
  if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=k) then raise exception 'This unit has a signed handoff or intake hold. Complete that handoff before changing custody.';end if;
 end loop;
 select * into e from public.equipment_master where equipment_key=p_returned_key for update;
 if not found then raise exception 'Select the returned unit from COS inventory so its exact identity is preserved.';end if;
 if exists(select 1 from app_private.techcheck_ticketfree_returns_v1 where returned_key=e.equipment_key and state='waiting_it') then raise exception 'This unit has already been sent to IT. Open its pending return.';end if;
 if exists(select 1 from public.unit_returns where equipment_type=e.canonical_family and unit_tag=e.unit_tag and status<>'completed') then raise exception 'This unit already has an unresolved IT return or repair hold.';end if;
 if exists(select 1 from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id where i.equipment_type=e.canonical_family and i.unit_tag=e.unit_tag and t.status::text<>'closed' and not coalesce(t.is_test,false)) then raise exception 'This unit is in an open preparation or handoff.';end if;
 if exists(select 1 from public.service_truck_units where unit_tag=e.unit_tag and equipment_type in (e.canonical_family,e.workflow_type) and status='assigned' and service_tech_id<>p.user_id) then raise exception 'This unit is still assigned to another Service technician.';end if;
 if p_used_key is not null then
  if p_used_key=p_returned_key then raise exception 'The installed replacement and removed unit must be different. For an unused return, leave the replacement empty.';end if;
  select * into used from public.equipment_master where equipment_key=p_used_key for update;
  if not found then raise exception 'The replacement identity is not in COS inventory.';end if;
  if used.tracker_state='retired' then raise exception 'The replacement is retired and cannot be installed.';end if;
  if exists(select 1 from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id where i.equipment_type=used.canonical_family and i.unit_tag=used.unit_tag and t.status::text<>'closed' and not coalesce(t.is_test,false)) then raise exception 'The replacement is still in an open preparation or handoff.';end if;
  select count(*) into n from public.service_truck_units where service_tech_id=p.user_id and unit_tag=used.unit_tag and equipment_type in (used.canonical_family,used.workflow_type) and status='assigned';
  if n<>1 then raise exception 'That replacement is no longer assigned to your truck. Refresh your truck inventory.';end if;
  select * into truck from public.service_truck_units where service_tech_id=p.user_id and unit_tag=used.unit_tag and equipment_type in (used.canonical_family,used.workflow_type) and status='assigned' for update;
  mode:='swap';
 else
  select * into truck from public.service_truck_units where service_tech_id=p.user_id and unit_tag=e.unit_tag and equipment_type in (e.canonical_family,e.workflow_type) and status='assigned' for update;
  if found then mode:='truck_return';end if;
 end if;
 select count(*) into n from public.unit_registry where equipment_type=e.canonical_family and unit_tag=e.unit_tag;
 if n>1 then raise exception 'IT must resolve duplicate native identities for this unit before moving it.';end if;
 select * into u from public.unit_registry where equipment_type=e.canonical_family and unit_tag=e.unit_tag for update;
 original:=case when found then to_jsonb(u) else '{}'::jsonb end;
 rk:=coalesce(u.unit_key,e.equipment_key);
 if exists(select 1 from public.unit_registry where unit_key=rk and (equipment_type is distinct from e.canonical_family or unit_tag is distinct from e.unit_tag)) then raise exception 'The native inventory identity does not match the selected unit.';end if;
 if u.lifecycle_status in ('returned_waiting_it','waiting_manager','it_prep','ready_for_service') then raise exception 'This unit already has an unresolved inventory workflow.';end if;
 if u.lifecycle_status='shop_inventory' and mode<>'truck_return' and e.tracker_state='shop' then raise exception 'This unit is already checked into Shop. Refresh and verify the returned unit number.';end if;
 if u.lifecycle_status='assigned_to_tech' and u.current_holder_id is distinct from p.user_id then raise exception 'This unit is assigned to a different technician.';end if;
 life:=case when e.tracker_state='retired' or u.lifecycle_status='retired' then 'retired' when u.lifecycle_status='maintenance' then 'maintenance' else 'returned_waiting_it' end;
 name:=coalesce(nullif(p.full_name,''),p.username,'Service');
 if mode in ('swap','truck_return') then
  stock_family:=truck.equipment_type;
  if exists(select 1 from public.service_truck_restock_requests where service_tech_id=p.user_id and item_kind='unit' and item_type=stock_family and used_unit_tag=truck.unit_tag and status in ('awaiting_return','preparing','ready')) then raise exception 'This truck slot already has an active restock request. Refresh before submitting.';end if;
  update public.service_truck_units set status='used_restock_due',last_used_ticket_no=null,last_used_at=now(),old_unit_tag=e.unit_tag,updated_at=now() where service_tech_id=p.user_id and equipment_type=stock_family;
  insert into public.service_truck_restock_requests(service_tech_id,service_tech_name,item_kind,item_type,qty_needed,used_unit_tag,old_unit_tag,status,reason)
   values(p.user_id,name,'unit',stock_family,1,truck.unit_tag,e.unit_tag,'awaiting_return','Ticket-free return '||p_request_id::text||': waiting for IT physical check-in.') returning id into restock;
  insert into public.service_truck_unit_history(service_tech_id,equipment_type,unit_tag,event,old_unit_tag,actor_id,actor_name)
   values(p.user_id,stock_family,truck.unit_tag,case when mode='swap' then 'USED IN SWAP - TICKET-FREE' else 'RETURNED UNUSED - WAITING IT' end,e.unit_tag,p.user_id,name);
  update public.service_truck_inventory_checks set ready=false,updated_at=now() where service_tech_id=p.user_id and check_date=timezone('America/Chicago',now())::date;
 end if;
 if mode='swap' then
  -- Installed equipment leaves truck availability, without guessing an address.
  if exists(select 1 from public.unit_returns where equipment_type=used.canonical_family and unit_tag=used.unit_tag and status<>'completed') then raise exception 'The replacement has an unresolved return or repair hold.';end if;
  if exists(select 1 from public.unit_registry where equipment_type=used.canonical_family and unit_tag=used.unit_tag and lifecycle_status in ('maintenance','retired','returned_waiting_it','waiting_manager')) then raise exception 'The replacement has an inventory hold.';end if;
  update public.equipment_master set tracker_state='field_or_unknown',updated_at=now() where equipment_key=used.equipment_key;
  update public.unit_registry set lifecycle_status='deployed',current_holder_id=null,current_holder_name=null,last_event='Truck replacement installed; ticket-free swap '||p_request_id::text,updated_at=now() where equipment_type=used.canonical_family and unit_tag=used.unit_tag;
 end if;
 insert into app_private.techcheck_ticketfree_returns_v1(id,service_tech_id,service_tech_name,returned_key,family,unit_tag,used_key,used_family,used_tag,source_mode,notes,photos,registry_key,original_registry,original_master,expected_lifecycle,restock_request_id)
  values(p_request_id,p.user_id,name,e.equipment_key,e.canonical_family,e.unit_tag,used.equipment_key,used.canonical_family,used.unit_tag,mode,p_notes,p_photos,rk,original,to_jsonb(e),life,restock);
 insert into public.unit_registry(unit_key,unit_tag,equipment_type,lifecycle_status,current_holder_id,current_holder_name,last_event,updated_at)
  values(rk,e.unit_tag,e.canonical_family,life,p.user_id,name,'Service sent to IT; physical receipt pending '||p_request_id::text,now())
  on conflict(unit_key) do update set lifecycle_status=excluded.lifecycle_status,current_holder_id=excluded.current_holder_id,current_holder_name=excluded.current_holder_name,last_event=excluded.last_event,updated_at=now();
 insert into public.app_notifications(recipient_user_id,kind,title,body,unit_tag)
  select user_id,'returned_unit','Equipment waiting for IT check-in',name||' sent '||e.canonical_family||' '||e.unit_tag||' to IT. Open Returned by Service. No ticket is required; physical receipt is still pending.',e.unit_tag
  from public.profiles where active and archived_at is null and role::text='it';
 result:=jsonb_build_object('return_id',p_request_id,'request_id',p_request_id,'state','waiting_it','revision',1);
 insert into app_private.techcheck_ticketfree_events_v1 values(p_request_id,p_request_id,p.user_id,'submit',payload,result,now());
 return result;
end$$;
revoke all on function app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[]) from public,anon,service_role;
grant execute on function app_private.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[]) to authenticated;
create function public.submit_techcheck_ticketfree_return_v1(p_request_id uuid,p_returned_key text,p_used_key text default null,p_notes text default '',p_photos text[] default '{}') returns jsonb language sql security invoker set search_path='' as $$select app_private.submit_techcheck_ticketfree_return_v1(p_request_id,p_returned_key,p_used_key,p_notes,p_photos)$$;
revoke all on function public.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[]) from public,anon,service_role;
grant execute on function public.submit_techcheck_ticketfree_return_v1(uuid,text,text,text,text[]) to authenticated;

create function app_private.receive_techcheck_ticketfree_return_v1(p_request_id uuid,p_return_id uuid,p_revision integer,p_received boolean,p_disposition text,p_checks jsonb,p_notes text,p_photos text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; r app_private.techcheck_ticketfree_returns_v1%rowtype; ev app_private.techcheck_ticketfree_events_v1%rowtype;
 payload jsonb; result jsonb; u public.unit_registry%rowtype; f text; name text; next_state text;
begin
 p:=app_private.techcheck_ticketfree_actor_v1();
 if p.role::text not in ('it','owner') then raise exception 'IT must confirm physical receipt and check equipment back in.' using errcode='42501';end if;
 if p_request_id is null or p_return_id is null or p_revision is null or p_received is distinct from true or p_disposition is null or p_disposition not in ('ready','repair') or p_notes is null or length(p_notes)>2000 or p_photos is null then raise exception 'Confirm physical receipt and select Ready or Needs repair.';end if;
 payload:=jsonb_build_object('return_id',p_return_id,'revision',p_revision,'received',p_received,'disposition',p_disposition,'checks',p_checks,'notes',p_notes,'photos',p_photos);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,41));
 select * into ev from app_private.techcheck_ticketfree_events_v1 where request_id=p_request_id;
 if found then
  if ev.actor_id<>p.user_id or ev.action<>'receive' or ev.payload<>payload then raise exception 'This request ID was already used for different information.';end if;
  return ev.result||jsonb_build_object('replayed',true);
 end if;
 perform set_config('lock_timeout','4s',true);
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 select * into r from app_private.techcheck_ticketfree_returns_v1 where id=p_return_id for update;
 if not found or r.state<>'waiting_it' or r.revision<>p_revision then raise exception 'This return changed or has already been checked in. Refresh the IT queue.';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.returned_key,2));
 if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=r.returned_key) then raise exception 'An unresolved signed handoff now holds this equipment.';end if;
 if not exists(select 1 from public.equipment_master where equipment_key=r.returned_key and canonical_family=r.family and unit_tag=r.unit_tag) then raise exception 'The equipment identity changed; IT must reconcile it before check-in.';end if;
 if jsonb_typeof(p_checks) is distinct from 'object' then raise exception 'Answer all six intake condition checks.';end if;
 foreach f in array array['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'] loop
  if jsonb_typeof(p_checks->f) is distinct from 'boolean' then raise exception 'Answer all six intake condition checks.';end if;
  if p_disposition='ready' and p_checks->f is distinct from 'true'::jsonb then raise exception 'All condition checks must pass before Ready inventory. Select Needs repair for a failed check.';end if;
 end loop;
 if p_disposition='repair' and nullif(btrim(p_notes),'') is null then raise exception 'Describe the problem before checking equipment into repair.';end if;
 select * into u from public.unit_registry where unit_key=r.registry_key for update;
 if not found or u.equipment_type is distinct from r.family or u.unit_tag is distinct from r.unit_tag or u.lifecycle_status is distinct from r.expected_lifecycle or u.current_holder_id is distinct from r.service_tech_id then raise exception 'Equipment custody changed after this return. Refresh and resolve the conflicting movement.';end if;
 if p_disposition='ready' and (r.expected_lifecycle in ('maintenance','retired') or exists(select 1 from public.unit_returns where equipment_type=r.family and unit_tag=r.unit_tag and status<>'completed')) then raise exception 'This unit still has a repair or inventory hold and cannot become Ready stock.';end if;
 perform app_private.techcheck_ticketfree_photos_v1(p_request_id,p_photos);
 name:=coalesce(nullif(p.full_name,''),p.username,'IT');next_state:=case when p_disposition='ready' then 'checked_in' else 'repair' end;
 update app_private.techcheck_ticketfree_returns_v1 set state=next_state,received_at=now(),it_tech_id=p.user_id,it_tech_name=name,checks=p_checks,intake_notes=p_notes,intake_photos=p_photos,revision=2 where id=r.id;
 update public.unit_registry set lifecycle_status=case when r.expected_lifecycle='retired' then 'retired' when p_disposition='ready' then 'shop_inventory' else 'maintenance' end,
  current_holder_id=null,current_holder_name=null,current_site=null,last_event='Physically checked in by '||name||' — '||p_disposition||' — return '||r.id::text,updated_at=now() where unit_key=r.registry_key;
 update public.equipment_master set tracker_state='shop',updated_at=now() where equipment_key=r.returned_key;
 update public.service_truck_restock_requests set status='requested',reason='Returned equipment physically received by IT; replenish the truck.',updated_at=now() where id=r.restock_request_id and status='awaiting_return';
 insert into public.service_truck_unit_history(service_tech_id,equipment_type,unit_tag,event,actor_id,actor_name)
  values(r.service_tech_id,r.family,r.unit_tag,'IT CHECK-IN - '||upper(p_disposition)||' - '||r.id::text,p.user_id,name);
 insert into public.app_notifications(recipient_user_id,kind,title,body,unit_tag)
  values(r.service_tech_id,'equipment_ready_service','IT received your returned equipment',name||' checked in '||r.family||' '||r.unit_tag||case when p_disposition='ready' then ' to Ready Shop inventory.' else ' to repair, not Ready inventory.' end,r.unit_tag);
 result:=jsonb_build_object('return_id',r.id,'request_id',p_request_id,'state',next_state,'revision',2);
 insert into app_private.techcheck_ticketfree_events_v1 values(p_request_id,r.id,p.user_id,'receive',payload,result,now());
 return result;
end$$;
revoke all on function app_private.receive_techcheck_ticketfree_return_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) from public,anon,service_role;
grant execute on function app_private.receive_techcheck_ticketfree_return_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) to authenticated;
create function public.receive_techcheck_ticketfree_return_v1(p_request_id uuid,p_return_id uuid,p_revision integer,p_received boolean,p_disposition text,p_checks jsonb,p_notes text default '',p_photos text[] default '{}') returns jsonb language sql security invoker set search_path='' as $$select app_private.receive_techcheck_ticketfree_return_v1(p_request_id,p_return_id,p_revision,p_received,p_disposition,p_checks,p_notes,p_photos)$$;
revoke all on function public.receive_techcheck_ticketfree_return_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) from public,anon,service_role;
grant execute on function public.receive_techcheck_ticketfree_return_v1(uuid,uuid,integer,boolean,text,jsonb,text,text[]) to authenticated;

create function app_private.techcheck_ticketfree_file_v1(p_path text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
 select * into p from public.profiles where user_id=auth.uid() and active and archived_at is null and role::text in ('service','it','owner');
 if not found then return false;end if;
 if p_path~('^'||p.user_id::text||'/[a-f0-9-]{36}/[a-f0-9]{64}[.]jpg$') then return true;end if;
 if p_write then return false;end if;
 return exists(select 1 from app_private.techcheck_ticketfree_returns_v1 where (p.role::text in ('it','owner') or service_tech_id=p.user_id) and (p_path=any(photos) or p_path=any(intake_photos)));
end$$;
revoke all on function app_private.techcheck_ticketfree_file_v1(text,boolean) from public,anon,service_role;
grant execute on function app_private.techcheck_ticketfree_file_v1(text,boolean) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('techcheck-ticketfree-evidence','techcheck-ticketfree-evidence',false,5242880,array['image/jpeg']);
create policy techcheck_ticketfree_insert_v1 on storage.objects for insert to authenticated with check(bucket_id='techcheck-ticketfree-evidence' and app_private.techcheck_ticketfree_file_v1(name,true));
create policy techcheck_ticketfree_read_v1 on storage.objects for select to authenticated using(bucket_id='techcheck-ticketfree-evidence' and app_private.techcheck_ticketfree_file_v1(name,false));

-- Native writers retain their existing permissions; this added guard prevents
-- another workflow from releasing equipment while a physical return is pending.
create function app_private.techcheck_ticketfree_legacy_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v jsonb:=to_jsonb(new); before_row jsonb:='{}'; r app_private.techcheck_ticketfree_returns_v1%rowtype;
begin
 if tg_op='UPDATE' then before_row:=to_jsonb(old);end if;
 for r in select * from app_private.techcheck_ticketfree_returns_v1
  where state='waiting_it' and ((family=v->>'equipment_type' and unit_tag=v->>'unit_tag')
    or (family=before_row->>'equipment_type' and unit_tag=before_row->>'unit_tag'))
  order by returned_key loop
  perform pg_advisory_xact_lock(hashtextextended(r.returned_key,2));
  if tg_table_name='unit_registry' and v->>'unit_key'=r.registry_key and v->>'equipment_type'=r.family
   and v->>'unit_tag'=r.unit_tag and v->>'lifecycle_status'=r.expected_lifecycle
   and v->>'current_holder_id'=r.service_tech_id::text then continue;end if;
  raise exception 'This equipment is waiting for IT physical check-in; another workflow cannot issue or duplicate it.';
 end loop;
 return new;
end$$;
revoke all on function app_private.techcheck_ticketfree_legacy_guard_v1() from public,anon,authenticated,service_role;
create trigger techcheck_ticketfree_registry_guard_v1 before insert or update on public.unit_registry for each row execute function app_private.techcheck_ticketfree_legacy_guard_v1();
create trigger techcheck_ticketfree_return_guard_v1 before insert or update on public.unit_returns for each row execute function app_private.techcheck_ticketfree_legacy_guard_v1();
create trigger techcheck_ticketfree_prep_guard_v1 before insert or update on public.prep_items for each row execute function app_private.techcheck_ticketfree_legacy_guard_v1();
create trigger techcheck_ticketfree_truck_guard_v1 before insert or update on public.service_truck_units for each row execute function app_private.techcheck_ticketfree_legacy_guard_v1();

notify pgrst,'reload schema';
commit;
