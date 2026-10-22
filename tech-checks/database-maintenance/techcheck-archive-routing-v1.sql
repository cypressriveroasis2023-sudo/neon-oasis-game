-- REVIEW CANDIDATE. Requires explicit approval before privileged installation.
-- Ongoing filing only: no existing report, event, outbox, evidence or inventory
-- is changed. The routing gate starts FALSE and is activated separately.
-- Install after the existing named-transfer and Service daily delivery queues.
begin;

create table app_private.techcheck_archive_routing_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 root_folder_id text not null default '1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH'
  check(root_folder_id='1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH')
);
insert into app_private.techcheck_archive_routing_settings(singleton,enabled) values(true,false);

-- Exact reviewed profile UUIDs, never a display-name lookup. folder_name is
-- the verified Drive name; a later profile display-name edit cannot reroute it.
create table app_private.techcheck_archive_technicians (
 actor_id uuid primary key references public.profiles(user_id),
 folder_id text not null unique check(folder_id ~ '^[A-Za-z0-9_-]{3,200}$'),
 folder_name text not null check(length(btrim(folder_name)) between 1 and 120),
 verified_at timestamptz not null,
 verification_reference text not null check(length(btrim(verification_reference)) between 1 and 500)
);

-- One key across all jobs. A date slot is shared by transfer and daily sources.
-- One global folder_id constraint also prevents reuse at a different level/key.
create table app_private.techcheck_archive_folders (
 actor_id uuid not null references app_private.techcheck_archive_technicians(actor_id),
 check_date date not null,
 kind text not null check(kind in ('date','category')),
 category text not null,
 folder_id text not null unique check(folder_id ~ '^[A-Za-z0-9_-]{3,200}$'),
 parent_id text not null check(parent_id ~ '^[A-Za-z0-9_-]{3,200}$'),
 adopted boolean not null,
 source text not null check(source in ('transfer','daily')),
 source_id uuid not null,
 reserved_at timestamptz not null default now(),
 primary key(actor_id,check_date,kind,category),
 check((kind='date' and category='') or (kind='category' and category in ('IT Checks','Equipment Transfers','Truck Inspections'))),
 check(folder_id<>parent_id)
);

alter table app_private.techcheck_archive_routing_settings enable row level security;
alter table app_private.techcheck_archive_technicians enable row level security;
alter table app_private.techcheck_archive_folders enable row level security;
revoke all on app_private.techcheck_archive_routing_settings,app_private.techcheck_archive_technicians,
 app_private.techcheck_archive_folders from public,anon,authenticated,service_role;

create function app_private.techcheck_archive_folder_immutable_v1() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'A reserved archive folder identity cannot be replaced or removed.';end
$$;
revoke all on function app_private.techcheck_archive_folder_immutable_v1() from public,anon,authenticated,service_role;
create trigger techcheck_archive_folder_immutable before update or delete on app_private.techcheck_archive_folders
 for each row execute function app_private.techcheck_archive_folder_immutable_v1();

-- BEGIN VERIFIED TECHNICIAN FOLDER BINDINGS
-- Reviewed against the existing Drive metadata and an exact, four-row COS
-- profile readback on 2026-10-21. This is an installation preflight only;
-- Runtime routing uses immutable event UUID provenance, never a display name.
-- Purpose amendments use the original checkout technician, retaining their actual recorder.
do $$
begin
 if (select count(*) from public.profiles p join (values
  ('4f7044b5-86b6-411f-8898-39bb64b4ddbc'::uuid,'Teddy Hopper','it'),
  ('b7cc3cbf-d11e-4d4a-9742-c07701857911'::uuid,'Victor Garcia','it'),
  ('49dce28e-099a-40bb-a8d8-b39f9ffbabee'::uuid,'Josh Mireles','service'),
  ('78e54fbd-c2db-4d18-8e3d-a9740adcf285'::uuid,'Abel Cervantes','service')
 ) expected(actor_id,full_name,role) on p.user_id=expected.actor_id
 where p.full_name=expected.full_name and p.role::text=expected.role
  and p.active and p.archived_at is null)<>4 then
  raise exception 'Verified technician profile bindings changed. Reverify before installing archive routing.';
 end if;
end$$;
insert into app_private.techcheck_archive_technicians(actor_id,folder_id,folder_name,verified_at,verification_reference) values
 ('4f7044b5-86b6-411f-8898-39bb64b4ddbc','1Im1trPgcC4NIw9eTfaobWTRSpNPlfgvt','Teddy Hopper','2026-10-21T20:59:48Z','Exact COS profile UUID/name/role/active readback and verified existing Drive parent/name: Technicians/1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH, 2026-10-21'),
 ('b7cc3cbf-d11e-4d4a-9742-c07701857911','1xa5s67_JsQWG5A9XG-6ZHlb1oyVEK4Lm','Victor Garcia','2026-10-21T20:59:48Z','Exact COS profile UUID/name/role/active readback and verified existing Drive parent/name: Technicians/1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH, 2026-10-21'),
 ('49dce28e-099a-40bb-a8d8-b39f9ffbabee','1gzBr-u6Xd6i19I7PE0rnB_47Ipi8IWWz','Josh Mireles','2026-10-21T20:59:48Z','Exact COS profile UUID/name/role/active readback and verified existing Drive parent/name: Technicians/1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH, 2026-10-21'),
 ('78e54fbd-c2db-4d18-8e3d-a9740adcf285','1NGanUoAXTVAZDPuHGE-pz6Xt6kkuanU6','Abel Cervantes','2026-10-21T20:59:48Z','Exact COS profile UUID/name/role/active readback and verified existing Drive parent/name: Technicians/1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH, 2026-10-21');
-- END VERIFIED TECHNICIAN FOLDER BINDINGS

create function app_private.techcheck_archive_destination_v1(
 p_action text,p_source text,p_id uuid,p_lease uuid,p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid;v_actor_name text;v_source_actor uuid;v_source_actor_name text;v_day date;v_saved_day date;v_category text;v_lease_until timestamptz;
 v_settings app_private.techcheck_archive_routing_settings%rowtype;
 v_technician app_private.techcheck_archive_technicians%rowtype;
 v_slot app_private.techcheck_archive_folders%rowtype;
 v_date jsonb;v_destination jsonb;v_result jsonb;
 v_kind text;v_parent text;v_candidate text;v_adopted boolean;v_slot_category text;
begin
 if (select auth.jwt()->>'role') is distinct from 'service_role' then
  raise exception 'Server access required.' using errcode='42501';
 end if;
 if p_action is null or p_action not in ('context','reserve') or p_source is null or p_source not in ('transfer','daily')
  or p_id is null or p_lease is null or jsonb_typeof(p_data) is distinct from 'object' then
  raise exception 'Invalid archive destination request.';
 end if;
 if p_action='context' and p_data<>'{}'::jsonb then raise exception 'Archive context cannot accept a supplied destination or actor.';end if;

 -- Validate the exact current source lease. Row locks prevent the queue lease
 -- from being changed during this call; no source row is updated here.
 if p_source='transfer' then
  -- A purpose amendment belongs to the original technician's handoff archive.
  -- Its actual Owner/IT recorder stays on the immutable event and report.
  select case when e.kind='purpose_amendment' then original.actor_id else e.actor_id end,
   case when e.kind='purpose_amendment' then original.actor_name else e.actor_name end,
   e.actor_id,e.actor_name,timezone('America/Chicago',e.signed_at)::date,q.locked_until
   into v_actor,v_actor_name,v_source_actor,v_source_actor_name,v_day,v_lease_until
  from app_private.techcheck_transfer_outbox q
  join app_private.techcheck_transfer_events e on e.id=q.event_id and e.transfer_id=q.transfer_id
  left join app_private.techcheck_transfer_events original on e.kind='purpose_amendment'
   and original.id::text=e.snapshot->>'original_event_id' and original.transfer_id=e.transfer_id and original.kind='checkout'
  where q.event_id=p_id and q.status='processing' and q.lease_token=p_lease and q.locked_until>clock_timestamp()
  for share of q;
  v_category:='Equipment Transfers';
 else
  select r.service_tech_id,r.actor_name,timezone('America/Chicago',r.submitted_at)::date,r.check_date,r.locked_until
   into v_actor,v_actor_name,v_day,v_saved_day,v_lease_until
  from app_private.service_daily_reports r
  where r.id=p_id and r.delivery_status='processing' and r.lease_token=p_lease and r.locked_until>clock_timestamp()
  for share of r;
  v_source_actor:=v_actor;v_source_actor_name:=v_actor_name;
  v_category:='Truck Inspections';
 end if;
 if v_actor is null or v_day is null or v_lease_until is null then raise exception 'Archive delivery lease is unavailable or expired.';end if;
 if p_source='daily' and v_saved_day is distinct from v_day then raise exception 'Saved report date does not match its Central submission date.';end if;

 select * into v_settings from app_private.techcheck_archive_routing_settings where singleton;
 select * into v_technician from app_private.techcheck_archive_technicians where actor_id=v_actor;
 select jsonb_build_object('id',folder_id,'parent_id',parent_id,'name',to_char(check_date,'YYYY-MM-DD'),'adopted',adopted)
  into v_date from app_private.techcheck_archive_folders
  where actor_id=v_actor and check_date=v_day and kind='date' and category='';
 select jsonb_build_object('id',folder_id,'parent_id',parent_id,'name',category,'adopted',adopted)
  into v_destination from app_private.techcheck_archive_folders
  where actor_id=v_actor and check_date=v_day and kind='category' and category=v_category;
 -- Fail closed on any privileged/manual registry corruption. The service RPC
 -- cannot rewrite a destination to conceal a parent mismatch.
 if v_date is not null and (v_technician.actor_id is null or v_date->>'parent_id' is distinct from v_technician.folder_id)
  or v_destination is not null and (v_date is null or v_destination->>'parent_id' is distinct from v_date->>'id') then
  raise exception 'Saved archive parent chain requires review.';
 end if;
 v_result:=jsonb_build_object('version',1,'enabled',coalesce(v_settings.enabled,false),
  'ready',coalesce(v_settings.enabled,false) and v_technician.actor_id is not null,
  'status',case when not coalesce(v_settings.enabled,false) then 'disabled' when v_technician.actor_id is null then 'mapping_required' else 'ready' end,
  'source',p_source,'source_id',p_id,'actor_id',v_actor,'actor_name',v_actor_name,
  'source_actor_id',v_source_actor,'source_actor_name',v_source_actor_name,
  'check_date',to_char(v_day,'YYYY-MM-DD'),'category',v_category,
  'root_folder',jsonb_build_object('id',v_settings.root_folder_id,'name','Technicians','adopted',true),
  'technician_folder',case when v_technician.actor_id is not null then jsonb_build_object('id',v_technician.folder_id,
   'parent_id',v_settings.root_folder_id,'name',v_technician.folder_name,'adopted',true) end,
  'date_folder',v_date,'category_folder',v_destination);
 if p_action='context' then return v_result;end if;
 if not coalesce(v_settings.enabled,false) then raise exception 'Archive routing is awaiting release approval.';end if;
 if v_technician.actor_id is null then raise exception 'A verified technician folder mapping is required.';end if;

 if (select count(*) from jsonb_object_keys(p_data))<>4
  or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('kind','candidate_id','parent_id','adopted'))
  or jsonb_typeof(p_data->'kind') is distinct from 'string' or coalesce(p_data->>'kind','') not in ('date','category')
  or jsonb_typeof(p_data->'candidate_id') is distinct from 'string' or coalesce(p_data->>'candidate_id','') !~ '^[A-Za-z0-9_-]{3,200}$'
  or jsonb_typeof(p_data->'parent_id') is distinct from 'string' or coalesce(p_data->>'parent_id','') !~ '^[A-Za-z0-9_-]{3,200}$'
  or jsonb_typeof(p_data->'adopted') is distinct from 'boolean' then
  raise exception 'Invalid archive folder reservation.';
 end if;
 v_kind:=p_data->>'kind';v_candidate:=p_data->>'candidate_id';v_adopted:=(p_data->>'adopted')::boolean;
 v_parent:=case when v_kind='date' then v_technician.folder_id else v_date->>'id' end;
 v_slot_category:=case when v_kind='date' then '' else v_category end;
 if v_parent is null then raise exception 'Reserve the canonical date folder before its category.';end if;
 if p_data->>'parent_id' is distinct from v_parent then raise exception 'Archive folder parent does not match the canonical hierarchy.';end if;
 if v_candidate=v_parent or v_candidate=v_settings.root_folder_id
  or exists(select 1 from app_private.techcheck_archive_technicians where folder_id=v_candidate) then
  raise exception 'Archive folder candidate conflicts with the root or technician hierarchy.';
 end if;
 if v_lease_until<=clock_timestamp() then raise exception 'Archive delivery lease is unavailable or expired.';end if;

 -- DO NOTHING plus a subsequent SELECT uses the committed winning row after a
 -- concurrent insert waits. Neither a new candidate nor a changed adopted flag
 -- can replace it. The worker must create/resume only this returned ID.
 insert into app_private.techcheck_archive_folders(actor_id,check_date,kind,category,folder_id,parent_id,adopted,source,source_id)
  values(v_actor,v_day,v_kind,v_slot_category,v_candidate,v_parent,v_adopted,p_source,p_id)
  on conflict(actor_id,check_date,kind,category) do nothing;
 select * into strict v_slot from app_private.techcheck_archive_folders
  where actor_id=v_actor and check_date=v_day and kind=v_kind and category=v_slot_category;
 if v_slot.parent_id is distinct from v_parent then raise exception 'Saved archive parent chain requires review.';end if;
 return jsonb_build_object('id',v_slot.folder_id,'parent_id',v_slot.parent_id,
  'name',case when v_slot.kind='date' then to_char(v_slot.check_date,'YYYY-MM-DD') else v_slot.category end,'adopted',v_slot.adopted);
end$$;
revoke all on function app_private.techcheck_archive_destination_v1(text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.techcheck_archive_destination_v1(text,text,uuid,uuid,jsonb) to service_role;

create function public.techcheck_archive_destination_v1(
 p_action text,p_source text,p_id uuid,p_lease uuid,p_data jsonb default '{}'
) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.techcheck_archive_destination_v1(p_action,p_source,p_id,p_lease,p_data)
$$;
revoke all on function public.techcheck_archive_destination_v1(text,text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.techcheck_archive_destination_v1(text,text,uuid,uuid,jsonb) to service_role;
commit;
