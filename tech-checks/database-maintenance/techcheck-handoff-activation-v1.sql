-- Installs disabled. Enable only after verified integration deployment.
begin;
-- techcheck-named-handoffs-v1.sql
-- REVIEW CANDIDATE ONLY. Apply only after Owner approval and legacy custody gates.
-- This adds transfer records; it never updates truck stock, placement or camera health.

create table app_private.techcheck_transfer_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into app_private.techcheck_transfer_settings values(true,false);
alter table app_private.techcheck_transfer_settings enable row level security;
revoke all on app_private.techcheck_transfer_settings from public,anon,authenticated,service_role;
create table app_private.techcheck_transfer_rules (
 workflow_type text primary key, minimum_batteries integer not null, bool_fields jsonb not null,
 source_sha256 text not null
);
insert into app_private.techcheck_transfer_rules values
('Sniper',2,'["power_ok","delivery_sim_ok","delivery_camera_app_ok","delivery_recording_ok","delivery_batteries_charged_ok","delivery_sd_formatted_ok","functions_ok","safe_ok"]'::jsonb,'99805d0f6117fec7890d5f6b37f2674767b1f2e43cc18ea99a879eb414711874'),
('Ranger',1,'["power_ok","solar_mppt_updated_ok","solar_mppt_tested_ok","delivery_sim_ok","delivery_camera_app_ok","camera_port_81_ok","camera_port_554_ok","delivery_recording_ok","delivery_sd_formatted_ok","delivery_batteries_charged_ok","functions_ok","safe_ok"]'::jsonb,'99805d0f6117fec7890d5f6b37f2674767b1f2e43cc18ea99a879eb414711874'),
('Spotter',0,'["power_ok","unit_programmed_ok","delivery_sim_ok","delivery_camera_app_ok","camera_port_81_ok","camera_port_554_ok","delivery_recording_ok","delivery_sd_formatted_ok","functions_ok","safe_ok"]'::jsonb,'99805d0f6117fec7890d5f6b37f2674767b1f2e43cc18ea99a879eb414711874'),
('Solar Spotter',0,'["power_ok","delivery_sim_ok","delivery_camera_app_ok","delivery_recording_ok","delivery_sd_formatted_ok","functions_ok","safe_ok"]'::jsonb,'99805d0f6117fec7890d5f6b37f2674767b1f2e43cc18ea99a879eb414711874'),
('Recon 2',1,'["power_ok","unit_programmed_ok","delivery_sim_ok","delivery_camera_app_ok","camera_port_81_ok","camera_port_554_ok","delivery_recording_ok","delivery_batteries_charged_ok","delivery_sd_formatted_ok","functions_ok","safe_ok"]'::jsonb,'99805d0f6117fec7890d5f6b37f2674767b1f2e43cc18ea99a879eb414711874'),
('Helios',1,'["power_ok","helios_camera1_hardware_ok","helios_camera2_hardware_ok","helios_ptz_assembly_ok","helios_cameras_12v_ok","helios_ptz_plate_4bolts_ok","helios_router_sim_ok","helios_proxicast_4x4_ok","helios_speaker_24v_ok","helios_camera_router_programming_ok","delivery_sim_ok","delivery_camera_app_ok","helios_camera1_ports_ok","helios_camera2_ports_ok","helios_ptz_ports_ok","helios_speaker_ports_ok","helios_alibi_vigilant_ok","helios_cerbo_network_ok","helios_cerbo_vrm_ok","helios_rear_unit_tag_ok","helios_battery_box_installed_ok","helios_battery_120v_charged_ok","helios_3x1tb_sd_ok","delivery_recording_ok","delivery_sd_formatted_ok","functions_ok","safe_ok"]'::jsonb,'99805d0f6117fec7890d5f6b37f2674767b1f2e43cc18ea99a879eb414711874');
create table app_private.techcheck_transfers (
 id uuid primary key, it_actor uuid not null references public.profiles(user_id),
 service_actor uuid not null references public.profiles(user_id),
 it_name text not null, service_name text not null, manifest jsonb not null,
 state text not null check(state in ('awaiting_service','discrepancy','accepted','returned_review','returned_repair','cancelled')),
 revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.techcheck_transfer_events (
 id uuid primary key, transfer_id uuid not null references app_private.techcheck_transfers(id),
 actor_id uuid not null references public.profiles(user_id), actor_name text not null,
 kind text not null check(kind in ('checkout','receipt','return','cancel')),
 request jsonb not null, snapshot jsonb not null, photos jsonb not null,
 signed_at timestamptz not null default now()
);
create table app_private.techcheck_transfer_reservations (
 equipment_key text primary key references public.equipment_master(equipment_key),
 transfer_id uuid not null references app_private.techcheck_transfers(id)
);
create table app_private.techcheck_transfer_outbox (
 event_id uuid primary key references app_private.techcheck_transfer_events(id),
 transfer_id uuid not null references app_private.techcheck_transfers(id),
 status text not null default 'awaiting_delivery_adapter', created_at timestamptz not null default now()
);
create index techcheck_transfers_recipient on app_private.techcheck_transfers(service_actor,created_at desc);
alter table app_private.techcheck_transfer_rules enable row level security;
alter table app_private.techcheck_transfers enable row level security;
alter table app_private.techcheck_transfer_events enable row level security;
alter table app_private.techcheck_transfer_reservations enable row level security;
alter table app_private.techcheck_transfer_outbox enable row level security;
revoke all on app_private.techcheck_transfer_rules,app_private.techcheck_transfers,app_private.techcheck_transfer_events,app_private.techcheck_transfer_reservations,app_private.techcheck_transfer_outbox from public,anon,authenticated,service_role;

create function app_private.techcheck_transfer_role() returns text language sql stable security definer set search_path='' as $$
 select case when app_private.cos_verified_fleet_actor(auth.uid()) then 'it' when p.role::text='service' then 'service' end
 from public.profiles p where p.user_id=auth.uid() and p.active=true and p.archived_at is null
$$;
revoke all on function app_private.techcheck_transfer_role() from public,anon,authenticated;

create function app_private.techcheck_transfer_manifest(p_items jsonb,p_empty boolean default false) returns jsonb
 language plpgsql set search_path='' as $$
declare i jsonb; part jsonb; result jsonb:='[]'; sims jsonb; parts jsonb; keys text[]:='{}'; seen text[]:='{}';s text;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Invalid equipment list.';end if;
 if jsonb_array_length(p_items)>20 or (not p_empty and jsonb_array_length(p_items)=0) then raise exception 'Select 1 to 20 equipment units.';end if;
 for i in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(i) is distinct from 'object' then raise exception 'Invalid item.';end if;
  foreach s in array array['equipment_key','family','unit_tag'] loop
   if jsonb_typeof(i->s) is distinct from 'string' or length(btrim(i->>s)) not between 1 and 160 then raise exception 'Exact saved equipment identity required.';end if;
  end loop;
  if btrim(i->>'equipment_key')=any(keys) then raise exception 'Duplicate equipment identity.';end if; keys:=array_append(keys,btrim(i->>'equipment_key'));
  if jsonb_typeof(i->'sims') is distinct from 'array' then raise exception 'Exact SIM text list required.';end if;
  if jsonb_array_length(i->'sims')>10 then raise exception 'Too many SIMs.';end if;
  for part in select value from jsonb_array_elements(i->'sims') loop
   if jsonb_typeof(part) is distinct from 'string' or length(btrim(part#>>'{}')) not between 1 and 100 then raise exception 'SIM numbers must be exact strings.';end if;
   s:=btrim(part#>>'{}');if s=any(seen) then raise exception 'Duplicate SIM number.';end if;seen:=array_append(seen,s);
  end loop;
  select coalesce(jsonb_agg(btrim(value) order by btrim(value)),'[]') into sims from jsonb_array_elements_text(i->'sims');
  if jsonb_typeof(i->'battery_count') is distinct from 'number' or (i->>'battery_count')!~'^[0-9]{1,4}$' then raise exception 'Whole battery count required.';end if;
  if jsonb_typeof(i->'parts') is distinct from 'array' then raise exception 'Part list required.';end if;
  if jsonb_array_length(i->'parts')>20 then raise exception 'Too many parts.';end if;
  for part in select value from jsonb_array_elements(i->'parts') loop
   if jsonb_typeof(part->'name') is distinct from 'string' or length(btrim(part->>'name')) not between 1 and 100 or jsonb_typeof(part->'quantity') is distinct from 'number' or (part->>'quantity')!~'^[0-9]{1,4}$' then raise exception 'Part name and whole quantity required.';end if;
  end loop;
  if (select count(distinct btrim(value->>'name')) from jsonb_array_elements(i->'parts'))<>jsonb_array_length(i->'parts') then raise exception 'Duplicate part name.';end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',btrim(value->>'name'),'quantity',value->'quantity') order by btrim(value->>'name')),'[]') into parts from jsonb_array_elements(i->'parts');
  result:=result||jsonb_build_array(jsonb_build_object('equipment_key',btrim(i->>'equipment_key'),'family',btrim(i->>'family'),'unit_tag',btrim(i->>'unit_tag'),'sims',sims,'battery_count',i->'battery_count','parts',parts));
 end loop;
 return (select coalesce(jsonb_agg(value order by value->>'equipment_key'),'[]') from jsonb_array_elements(result));
end$$;
revoke all on function app_private.techcheck_transfer_manifest(jsonb,boolean) from public,anon,authenticated;

create function public.techcheck_transfer_context_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role text:=app_private.techcheck_transfer_role(); transfers jsonb; equipment jsonb:='[]'; team jsonb:='[]';
begin
 if (select enabled from app_private.techcheck_transfer_settings where singleton) is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 if role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'actor_name',e.actor_name,'snapshot',e.snapshot,'photos',e.photos,'signed_at',e.signed_at) order by e.signed_at),'[]') from app_private.techcheck_transfer_events e where e.transfer_id=t.id)) order by t.created_at desc),'[]') into transfers
 from (select * from app_private.techcheck_transfers where (role='it' or service_actor=auth.uid()) and (state not in ('cancelled','returned_review','returned_repair') or created_at>now()-interval '7 days') order by created_at desc limit 100) t;
 if role='it' then
  select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',coalesce(nullif(full_name,''),username)) order by full_name),'[]') into team from public.profiles p where p.role::text='service' and p.active and p.archived_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('equipment_key',e.equipment_key,'family',e.canonical_family,'unit_tag',e.unit_tag,'unit_name',e.source_label,'workflow_type',e.workflow_type,'updated_at',e.updated_at,'tracker_state',e.tracker_state,'reserved',r.equipment_key is not null,'supported',rules.workflow_type is not null) order by e.source_label),'[]') into equipment from public.equipment_master e left join app_private.techcheck_transfer_reservations r using(equipment_key) left join app_private.techcheck_transfer_rules rules on rules.workflow_type=e.workflow_type and rules.workflow_type=e.canonical_family;
 end if;
 return jsonb_build_object('version',1,'role',role,'transfers',transfers,'equipment',equipment,'technicians',team,'delivery','awaiting_delivery_adapter');
end$$;
revoke all on function public.techcheck_transfer_context_v1() from public,anon;
grant execute on function public.techcheck_transfer_context_v1() to authenticated;

-- The bucket is distinct from old evidence rules. Accepted event objects cannot be replaced.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('techcheck-transfer-evidence','techcheck-transfer-evidence',false,5242880,array['image/jpeg']);
create function app_private.techcheck_transfer_file(p_name text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select (select enabled from app_private.techcheck_transfer_settings where singleton) and app_private.techcheck_transfer_role() is not null
 and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$'
 and case when p_write then split_part(p_name,'/',1)=auth.uid()::text and not exists(select 1 from app_private.techcheck_transfer_events e where e.id::text=split_part(p_name,'/',2))
 else split_part(p_name,'/',1)=auth.uid()::text or exists(select 1 from app_private.techcheck_transfer_events e join app_private.techcheck_transfers t on t.id=e.transfer_id where e.id::text=split_part(p_name,'/',2) and (app_private.techcheck_transfer_role()='it' or t.service_actor=auth.uid()) and exists(select 1 from jsonb_array_elements(e.photos) p where p->>'path'=p_name)) end
$$;
revoke all on function app_private.techcheck_transfer_file(text,boolean) from public,anon;
grant execute on function app_private.techcheck_transfer_file(text,boolean) to authenticated;
create policy techcheck_transfer_insert on storage.objects for insert to authenticated with check(bucket_id='techcheck-transfer-evidence' and app_private.techcheck_transfer_file(name,true));
create policy techcheck_transfer_read on storage.objects for select to authenticated using(bucket_id='techcheck-transfer-evidence' and app_private.techcheck_transfer_file(name,false));

create function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); role text:=app_private.techcheck_transfer_role(); actor_name text; receiver_name text;
 previous app_private.techcheck_transfer_events%rowtype; t app_private.techcheck_transfers%rowtype;
 equipment public.equipment_master%rowtype; rules app_private.techcheck_transfer_rules%rowtype;
 request jsonb:=jsonb_build_object('transfer_id',p_transfer_id,'kind',p_kind,'revision',p_expected_revision,'service_actor',p_service_actor,'items',p_items,'checks',p_checks,'signature',p_signature,'photos',p_photos,'notes',p_notes);
 items jsonb; item jsonb; expected jsonb; photo jsonb; signature jsonb; differences jsonb:='[]'; snapshot jsonb; field text; next_state text; pass boolean:=true;
begin
 if (select enabled from app_private.techcheck_transfer_settings where singleton) is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 if role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('checkout','receipt','return','cancel') or p_request_id is null or p_transfer_id is null then raise exception 'Invalid transfer action.';end if;
 if (p_kind='receipt' and role<>'service') or (p_kind<>'receipt' and role<>'it') then raise exception 'This action is not allowed for your role.' using errcode='42501';end if;
 -- A lost response repeats the identical request, not a second custody change.
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into previous from app_private.techcheck_transfer_events where id=p_request_id;
 if found then
  if previous.actor_id<>actor or previous.request is distinct from request then raise exception 'Request ID already used with different details.';end if;
  return previous.snapshot||jsonb_build_object('event_id',previous.id,'replayed',true,'delivery','awaiting_delivery_adapter');
 end if;
 if p_notes is null or length(p_notes)>2000 then raise exception 'Notes must be at most 2000 characters.';end if;
 if jsonb_typeof(p_checks) is distinct from 'object' or jsonb_typeof(p_photos) is distinct from 'array' then raise exception 'Checks and photos required.';end if;
 if jsonb_array_length(p_photos)>60 then raise exception 'Too many photos.';end if;
 select coalesce(nullif(btrim(full_name),''),username) into actor_name from public.profiles where user_id=actor;
 if jsonb_typeof(p_signature) is distinct from 'object' or (p_signature->'confirmed') is distinct from 'true'::jsonb or p_signature->>'method' is null or p_signature->>'method' not in ('typed','drawn')
 or lower(regexp_replace(btrim(p_signature->>'name'),'[[:space:]]+',' ','g')) is distinct from lower(regexp_replace(btrim(actor_name),'[[:space:]]+',' ','g')) then raise exception 'Sign and confirm using your own technician account name.';end if;
 signature:=jsonb_build_object('method',p_signature->>'method','name',actor_name,'signed_by',actor,'signed_at',now(),'timezone','America/Chicago','statement_version',1,'statement','I physically checked the equipment listed in this transfer. My entries and photos accurately record what I handed over, received or returned.');
 items:=app_private.techcheck_transfer_manifest(p_items,p_kind in ('receipt','cancel'));
 if p_kind='checkout' then
  if p_transfer_id<>p_request_id or p_expected_revision is distinct from 0 then raise exception 'A new handoff needs a new request ID.';end if;
  select coalesce(nullif(btrim(full_name),''),username) into receiver_name from public.profiles p where p.user_id=p_service_actor and p.role::text='service' and p.active and p.archived_at is null;
  if not found then raise exception 'Choose an active Service technician.';end if;
  -- Sorted locks serialize intersecting equipment sets, including across different IT actors.
  for item in select value from jsonb_array_elements(items) order by value->>'equipment_key' loop
   perform pg_advisory_xact_lock(hashtextextended(item->>'equipment_key',2));
   select * into equipment from public.equipment_master where equipment_key=item->>'equipment_key' for update;
   if not found or equipment.tracker_state is distinct from 'shop' then raise exception 'Equipment is not recorded in Shop. Verify placement first.';end if;
   if item->>'family' is distinct from equipment.canonical_family or item->>'unit_tag' is distinct from equipment.unit_tag then raise exception 'Equipment identity changed. Reload and check the exact unit.';end if;
   if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=equipment.equipment_key) then raise exception 'Equipment already has an unresolved handoff or return.';end if;
   select * into rules from app_private.techcheck_transfer_rules where workflow_type=equipment.workflow_type and workflow_type=equipment.canonical_family;
   if not found then raise exception 'No approved check-only rule mapping exists for this equipment.';end if;
   for field in select jsonb_array_elements_text(rules.bool_fields) loop
    if (p_checks->equipment.equipment_key->field) is distinct from 'true'::jsonb then raise exception 'Pass every required IT equipment check.';end if;
   end loop;
   if (equipment.workflow_type='Helios' and (item->>'battery_count')::integer<>1) or (item->>'battery_count')::integer<rules.minimum_batteries then raise exception 'Unit battery requirement not met.';end if;
  end loop;
  next_state:='awaiting_service';
  insert into app_private.techcheck_transfers(id,it_actor,service_actor,it_name,service_name,manifest,state) values(p_transfer_id,actor,p_service_actor,actor_name,receiver_name,items,next_state) returning * into t;
  insert into app_private.techcheck_transfer_reservations select value->>'equipment_key',t.id from jsonb_array_elements(items);
 else
  select * into t from app_private.techcheck_transfers where id=p_transfer_id for update;
  if not found or (role='service' and t.service_actor<>actor) then raise exception 'Handoff unavailable for your account.' using errcode='42501';end if;
  if p_expected_revision is distinct from t.revision then raise exception 'Handoff changed. Reload before submitting.';end if;
  if p_service_actor is distinct from t.service_actor then raise exception 'The named Service technician cannot be changed.';end if;
  if p_kind='receipt' then
   if t.state not in ('awaiting_service','discrepancy') then raise exception 'This handoff cannot be accepted again.';end if;
   for expected in select value from jsonb_array_elements(t.manifest) loop
    select value into item from jsonb_array_elements(items) where value->>'equipment_key'=expected->>'equipment_key';
    if not found then differences:=differences||jsonb_build_array(jsonb_build_object('equipment_key',expected->>'equipment_key','field','item','expected','Present','actual','Missing'));
    else
     foreach field in array array['family','unit_tag','sims','battery_count','parts'] loop
      if item->field is distinct from expected->field then differences:=differences||jsonb_build_array(jsonb_build_object('equipment_key',expected->>'equipment_key','field',field,'expected',expected->field,'actual',item->field));end if;
     end loop;
    end if;
   end loop;
   for item in select value from jsonb_array_elements(items) loop
    if not exists(select 1 from jsonb_array_elements(t.manifest) where value->>'equipment_key'=item->>'equipment_key') then raise exception 'Unexpected equipment identity. Record a discrepancy against the assigned item.';end if;
   end loop;
   next_state:=case when jsonb_array_length(differences)=0 then 'accepted' else 'discrepancy' end;
  elsif p_kind='return' then
   if t.state<>'accepted' then raise exception 'Only accepted equipment can be checked back in.';end if;
   if items is distinct from t.manifest then raise exception 'Check in the exact equipment from this handoff. Resolve a partial return separately.';end if;
   for item in select value from jsonb_array_elements(t.manifest) loop
    foreach field in array array['physical_condition_ok','accessories_ok','batteries_ok','sd_cards_ok','electronics_ok','power_functions_ok'] loop
     if jsonb_typeof(p_checks->(item->>'equipment_key')->field) is distinct from 'boolean' then raise exception 'Answer every intake condition check.';end if;
     pass:=pass and (p_checks->(item->>'equipment_key')->>field)::boolean;
    end loop;
   end loop;
   if not pass and length(btrim(p_notes))=0 then raise exception 'Explain the failed intake check.';end if;
   next_state:=case when pass then 'returned_review' else 'returned_repair' end;
   -- No automatic shelf availability: retain reservation until legacy inventory review is reconciled.
  else
   if t.state not in ('awaiting_service','discrepancy') or length(btrim(p_notes))=0 or items<>'[]'::jsonb then raise exception 'Only an unaccepted handoff can be cancelled, with a reason.';end if;
   next_state:='cancelled';delete from app_private.techcheck_transfer_reservations where transfer_id=t.id;
  end if;
  update app_private.techcheck_transfers set state=next_state,revision=revision+1,updated_at=now() where id=t.id returning * into t;
 end if;
 if exists(select 1 from jsonb_array_elements(p_photos) group by value->>'equipment_key',value->>'kind' having count(*)>1) then raise exception 'Duplicate evidence slot.';end if;
 for photo in select value from jsonb_array_elements(p_photos) loop
  if coalesce(photo->>'kind','') not in ('unit','tag','signature') or (photo->>'path') is null or (photo->>'path')!~('^'||actor::text||'/'||p_request_id::text||'/[a-f0-9]{64}\.jpg$') then raise exception 'Invalid evidence identity.';end if;
  if photo->>'kind'<>'signature' and not exists(select 1 from jsonb_array_elements(items) where value->>'equipment_key'=photo->>'equipment_key') then raise exception 'Photo must belong to an item in this event.';end if;
  if not exists(select 1 from storage.objects where bucket_id='techcheck-transfer-evidence' and name=photo->>'path' and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload every evidence photo first.';end if;
 end loop;
 for item in select value from jsonb_array_elements(items) loop
  if not exists(select 1 from jsonb_array_elements(p_photos) where value->>'equipment_key'=item->>'equipment_key' and value->>'kind'='unit') then raise exception 'Photograph each equipment item.';end if;
 end loop;
 if p_signature->>'method'='drawn' then
  if (select count(*) from jsonb_array_elements(p_photos) where value->>'kind'='signature' and value->>'path'=p_signature->>'path')<>1 then raise exception 'Upload the drawn signature.';end if;
  signature:=signature||jsonb_build_object('path',p_signature->>'path');
 elsif exists(select 1 from jsonb_array_elements(p_photos) where value->>'kind'='signature') then raise exception 'Typed sign-off cannot include a drawn signature.';end if;
 snapshot:=jsonb_build_object('transfer_id',t.id,'state',next_state,'revision',t.revision,'it_name',t.it_name,'service_name',t.service_name,'expected',t.manifest,'actual',items,'checks',p_checks,'differences',differences,'signature',signature,'notes',p_notes);
 insert into app_private.techcheck_transfer_events(id,transfer_id,actor_id,actor_name,kind,request,snapshot,photos) values(p_request_id,t.id,actor,actor_name,p_kind,request,snapshot,p_photos);
 insert into app_private.techcheck_transfer_outbox(event_id,transfer_id) values(p_request_id,t.id);
 return snapshot||jsonb_build_object('event_id',p_request_id,'replayed',false,'delivery','awaiting_delivery_adapter');
end$$;
revoke all on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

-- techcheck-transfer-rollout-v2.sql
-- Additive release gate: install after techcheck-named-handoffs-v1.sql.
-- No feature activation, production inventory change or outbound request.

alter table app_private.techcheck_transfer_settings
 add column reports_ready boolean not null default false,
 add column receipt_link_ready boolean not null default false,
 add column custody_ready boolean not null default false;
-- These release attestations are deliberately false in the review migration.
-- They are not delivery results. Only a reviewed operator rollout may set them
-- after the adapter, signed daily linkage and global custody tests are complete.
create function app_private.techcheck_transfer_ready_v1() returns boolean
 language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and reports_ready and receipt_link_ready and custody_ready
   from app_private.techcheck_transfer_settings where singleton),false)
 and to_regprocedure('public.techcheck_transfer_context_v1()') is not null
 and to_regprocedure('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is not null
 and exists(select 1 from storage.buckets where id='techcheck-transfer-evidence' and public=false
   and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg']::text[])
$$;
revoke all on function app_private.techcheck_transfer_ready_v1() from public,anon,authenticated,service_role;

-- Minimal, account-bound rollout probe. No equipment, SIMs or other users' data.
create function public.techcheck_transfer_readiness_v1() returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare v_role text:=app_private.techcheck_transfer_role(); v_settings jsonb;
begin
 if v_role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 select to_jsonb(s) into v_settings from app_private.techcheck_transfer_settings s where singleton;
 return jsonb_build_object('version',1,'actor_id',auth.uid(),'role',v_role,
   'ready',app_private.techcheck_transfer_ready_v1(),'enabled',coalesce((v_settings->>'enabled')::boolean,false),
   'dependencies',jsonb_build_object(
     'read',to_regprocedure('public.techcheck_transfer_context_v1()') is not null,
     'submit',to_regprocedure('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is not null,
     'privateEvidence',exists(select 1 from storage.buckets where id='techcheck-transfer-evidence' and public=false
       and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg']::text[])),
   'release',jsonb_build_object('reports',coalesce((v_settings->>'reports_ready')::boolean,false),
     'receiptLink',coalesce((v_settings->>'receipt_link_ready')::boolean,false),
     'custody',coalesce((v_settings->>'custody_ready')::boolean,false)));
end$$;
revoke all on function public.techcheck_transfer_readiness_v1() from public,anon;
grant execute on function public.techcheck_transfer_readiness_v1() to authenticated;


-- Keep the implemented core unchanged, but remove all direct client entry points.
alter function public.techcheck_transfer_context_v1() set schema app_private;
alter function app_private.techcheck_transfer_context_v1() rename to techcheck_transfer_context_core_v1;
revoke all on function app_private.techcheck_transfer_context_core_v1() from public,anon,authenticated,service_role;
alter function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) set schema app_private;
alter function app_private.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) rename to submit_techcheck_transfer_core_v1;
revoke all on function app_private.submit_techcheck_transfer_core_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create function public.techcheck_transfer_context_v1() returns jsonb
 language plpgsql stable security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if app_private.techcheck_transfer_ready_v1() is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 return app_private.techcheck_transfer_context_core_v1();
end$$;
revoke all on function public.techcheck_transfer_context_v1() from public,anon;
grant execute on function public.techcheck_transfer_context_v1() to authenticated;

create function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if app_private.techcheck_transfer_ready_v1() is distinct from true then raise exception 'Named handoffs are held for release review.';end if;
 return app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
end$$;
revoke all on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

create or replace function app_private.techcheck_transfer_file(p_name text,p_write boolean) returns boolean
 language sql stable security definer set search_path='' as $$
 select app_private.techcheck_transfer_ready_v1() and app_private.techcheck_transfer_role() is not null
 and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$'
 and case when p_write then split_part(p_name,'/',1)=auth.uid()::text and not exists(select 1 from app_private.techcheck_transfer_events e where e.id::text=split_part(p_name,'/',2))
 else split_part(p_name,'/',1)=auth.uid()::text or exists(select 1 from app_private.techcheck_transfer_events e join app_private.techcheck_transfers t on t.id=e.transfer_id where e.id::text=split_part(p_name,'/',2) and (app_private.techcheck_transfer_role()='it' or t.service_actor=auth.uid()) and exists(select 1 from jsonb_array_elements(e.photos) p where p->>'path'=p_name)) end
$$;
revoke all on function app_private.techcheck_transfer_file(text,boolean) from public,anon;
grant execute on function app_private.techcheck_transfer_file(text,boolean) to authenticated;

-- techcheck-transfer-integration-v3.sql
-- Completes the named-handoff release. Activation is a separate verified step.

alter table app_private.techcheck_transfer_outbox
 add column drive_manifest jsonb not null default '{}',
 add column email_state text not null default 'pending' check(email_state in ('pending','sending','sent','review')),
 add column email_id text,
 add column lease_token uuid,
 add column locked_until timestamptz,
 add column attempts integer not null default 0,
 add column next_attempt_at timestamptz not null default now(),
 add column last_error text,
 add column delivered_at timestamptz;
alter table app_private.techcheck_transfer_outbox alter column status set default 'queued';
update app_private.techcheck_transfer_outbox set status='queued' where status='awaiting_delivery_adapter';
create index techcheck_transfer_queue_pending on app_private.techcheck_transfer_outbox(next_attempt_at,created_at)
 where status in ('queued','retry','blocked','processing');
create index techcheck_transfer_event_order on app_private.techcheck_transfer_events(transfer_id,signed_at,id);

-- Exact family and tag; a shared number never joins two equipment families.
create function app_private.techcheck_transfer_custody_hold_v1(p_key text) returns text
language sql stable security definer set search_path='' as $$
 select case
 when e.tracker_state is distinct from 'shop' then 'Not recorded in Shop'
 when exists(select 1 from public.unit_registry u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.lifecycle_status is distinct from 'shop_inventory') then 'Existing equipment custody or maintenance'
 when exists(select 1 from public.prep_items i join public.prep_tickets t on t.id=i.prep_ticket_id
  where i.equipment_type=e.canonical_family and i.unit_tag=e.unit_tag and not coalesce(t.is_test,false)
   and t.status::text is distinct from 'closed') then 'Existing preparation or handoff'
 when exists(select 1 from public.service_truck_units u where u.equipment_type=e.canonical_family and u.unit_tag=e.unit_tag and u.status is distinct from 'unassigned') then 'Assigned truck equipment'
 when exists(select 1 from public.unit_returns r where r.equipment_type=e.canonical_family and r.unit_tag=e.unit_tag and r.status is distinct from 'completed') then 'Unresolved equipment return'
 end from public.equipment_master e where e.equipment_key=p_key
$$;
revoke all on function app_private.techcheck_transfer_custody_hold_v1(text) from public,anon,authenticated,service_role;

-- Serialize with legacy physical-custody writes. The legacy triggers below
-- protect the other direction after a named-handoff reservation is committed.
create or replace function public.submit_techcheck_transfer_v1(
 p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,
 p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_hold text; v_result jsonb;
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 -- Replays must remain valid even when newer placement or custody has changed.
 if p_kind='checkout' and not exists(select 1 from app_private.techcheck_transfer_events where id=p_request_id) then
  for v_item in select value from jsonb_array_elements(app_private.techcheck_transfer_manifest(p_items,false)) loop
   v_hold:=app_private.techcheck_transfer_custody_hold_v1(v_item->>'equipment_key');
   if v_hold is not null then raise exception 'Equipment unavailable: %.',v_hold;end if;
  end loop;
 end if;
 -- Shared technician lock gives the signed daily snapshot a precise ordering
 -- against Service receipts; no receipt can be silently added after sign-off.
 if p_kind='receipt' then perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));end if;
 v_result:=app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
 return v_result||jsonb_build_object('delivery',(select status from app_private.techcheck_transfer_outbox where event_id=p_request_id));
end$$;
revoke all on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text) to authenticated;

create or replace function public.techcheck_transfer_context_v1() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;v_equipment jsonb;v_transfers jsonb;
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 v_result:=app_private.techcheck_transfer_context_core_v1();
 select coalesce(jsonb_agg(e||jsonb_build_object('reserved',coalesce((e->>'reserved')::boolean,false) or h.reason is not null,'hold_reason',h.reason)),'[]') into v_equipment
 from jsonb_array_elements(v_result->'equipment') e
 cross join lateral(select app_private.techcheck_transfer_custody_hold_v1(e->>'equipment_key') reason) h;
 select coalesce(jsonb_agg(t||jsonb_build_object('events',(
  select coalesce(jsonb_agg(e||jsonb_build_object('delivery',o.status,'report_url',case when coalesce((o.drive_manifest->'summary_pdf_v1'->>'done')::boolean,false) then 'https://drive.google.com/file/d/'||(o.drive_manifest->'summary_pdf_v1'->>'id')||'/view' end)),'[]')
  from jsonb_array_elements(t->'events') e left join app_private.techcheck_transfer_outbox o on o.event_id=(e->>'id')::uuid))),'[]') into v_transfers
 from jsonb_array_elements(v_result->'transfers') t;
 return v_result||jsonb_build_object('equipment',v_equipment,'transfers',v_transfers,'delivery','queued');
end$$;

create function app_private.techcheck_transfer_legacy_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_transfer app_private.techcheck_transfers%rowtype;v_key text;v_row jsonb:=to_jsonb(new);
begin
 if tg_op='UPDATE' and to_jsonb(old) is not distinct from v_row then return new;end if;
 for v_key in select e.equipment_key from public.equipment_master e
  where e.canonical_family=v_row->>'equipment_type' and e.unit_tag=v_row->>'unit_tag' order by e.equipment_key loop
  perform pg_advisory_xact_lock(hashtextextended(v_key,2));
  select t.* into v_transfer from app_private.techcheck_transfer_reservations r join app_private.techcheck_transfers t on t.id=r.transfer_id where r.equipment_key=v_key;
  if found and not coalesce(v_transfer.state='accepted' and (
   tg_table_name='service_truck_units' and v_transfer.service_actor::text=v_row->>'service_tech_id'
   or tg_table_name='unit_registry' and v_transfer.service_actor::text=v_row->>'current_holder_id' and v_row->>'lifecycle_status'='assigned_to_tech'),false) then
   raise exception 'Equipment has an unresolved named handoff or intake review.';
  end if;
 end loop;
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_legacy_guard_v1() from public,anon,authenticated,service_role;
create trigger techcheck_named_handoff_prep_guard before insert or update on public.prep_items for each row execute function app_private.techcheck_transfer_legacy_guard_v1();
create trigger techcheck_named_handoff_truck_guard before insert or update on public.service_truck_units for each row execute function app_private.techcheck_transfer_legacy_guard_v1();
create trigger techcheck_named_handoff_return_guard before insert or update on public.unit_returns for each row execute function app_private.techcheck_transfer_legacy_guard_v1();
create trigger techcheck_named_handoff_registry_guard before insert or update on public.unit_registry for each row execute function app_private.techcheck_transfer_legacy_guard_v1();

create function app_private.techcheck_transfer_legacy_ticket_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status::text is distinct from 'closed' and not coalesce(new.is_test,false) and exists(
  select 1 from public.prep_items i join public.equipment_master e on e.canonical_family=i.equipment_type and e.unit_tag=i.unit_tag
   join app_private.techcheck_transfer_reservations r on r.equipment_key=e.equipment_key where i.prep_ticket_id=new.id)
 then raise exception 'Equipment has an unresolved named handoff or intake review.';end if;
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_legacy_ticket_guard_v1() from public,anon,authenticated,service_role;
create trigger techcheck_named_handoff_ticket_guard before update on public.prep_tickets for each row execute function app_private.techcheck_transfer_legacy_ticket_guard_v1();

-- New signed daily reports reference exactly the receipts present at sign-off.
-- Existing reports and their immutable evidence are never rewritten.
create function app_private.techcheck_transfer_daily_link_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_receipts jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.service_tech_id::text,0));
 select coalesce(jsonb_agg(jsonb_build_object('transfer_id',e.transfer_id,'event_id',e.id,'revision',e.snapshot->'revision','state',e.snapshot->>'state',
  'signed_at',e.signed_at,'it_name',e.snapshot->>'it_name','service_name',e.actor_name,'actual',e.snapshot->'actual','differences',e.snapshot->'differences','snapshot',e.snapshot) order by e.signed_at,e.id),'[]') into v_receipts
 from app_private.techcheck_transfer_events e
 where e.actor_id=new.service_tech_id and e.kind='receipt' and timezone('America/Chicago',e.signed_at)::date=new.check_date
  and e.signed_at<=new.submitted_at;
 new.snapshot:=new.snapshot||jsonb_build_object('transfer_receipts',v_receipts);
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_daily_link_v1() from public,anon,authenticated,service_role;
create trigger techcheck_named_handoff_daily_link before insert on app_private.service_daily_reports for each row execute function app_private.techcheck_transfer_daily_link_v1();

-- Separate queue using the existing Google account and archive conventions.
grant usage on schema app_private to service_role;
create function app_private.techcheck_transfer_delivery_v1(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_queue app_private.techcheck_transfer_outbox%rowtype;v_event app_private.techcheck_transfer_events%rowtype;v_token uuid:=gen_random_uuid();v_photos jsonb;
begin
 if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server access required.' using errcode='42501';end if;
 if p_action='claim' then
  select o.* into v_queue from app_private.techcheck_transfer_outbox o join app_private.techcheck_transfer_events e on e.id=o.event_id join app_private.techcheck_transfers t on t.id=o.transfer_id
  where (p_id is null or o.event_id=p_id) and (p_actor is null or (exists(select 1 from public.profiles p where p.user_id=p_actor and p.active and p.archived_at is null)
    and (app_private.cos_verified_fleet_actor(p_actor) or t.service_actor=p_actor)))
   and o.status in ('queued','retry','blocked','processing') and o.next_attempt_at<=now() and (o.locked_until is null or o.locked_until<now())
  order by o.created_at,o.event_id limit 1 for update of o skip locked;
  if not found then return null;end if;
  update app_private.techcheck_transfer_outbox set status='processing',lease_token=v_token,locked_until=now()+interval '10 minutes',attempts=attempts+1 where event_id=v_queue.event_id returning * into v_queue;
  select * into strict v_event from app_private.techcheck_transfer_events where id=v_queue.event_id;
  select coalesce(jsonb_agg(p||jsonb_build_object('category',case when p->>'kind'='signature' then 'Technician signature' else p->>'equipment_key' end,'view',p->>'kind')),'[]') into v_photos from jsonb_array_elements(v_event.photos) p;
  return (to_jsonb(v_queue)-'event_id')||jsonb_build_object('id',v_queue.event_id,'actor_name',v_event.actor_name,'check_date',timezone('America/Chicago',v_event.signed_at)::date,
   'submitted_at',v_event.signed_at,'kind',v_event.kind,'snapshot',v_event.snapshot,'photos',v_photos);
 end if;
 select * into v_queue from app_private.techcheck_transfer_outbox where event_id=p_id and lease_token=p_lease and locked_until>now() for update;
 if not found then raise exception 'Delivery lease expired.';end if;
 if p_action='checkpoint' then
  if p_data ? 'email_state' and p_data->>'email_state' not in ('pending','sending','sent','review') then raise exception 'Invalid email state.';end if;
  update app_private.techcheck_transfer_outbox set drive_manifest=coalesce(p_data->'drive_manifest',drive_manifest),email_state=coalesce(p_data->>'email_state',email_state),email_id=coalesce(p_data->>'email_id',email_id) where event_id=p_id;
 elsif p_action='finish' then
  if p_data->>'status' not in ('sent','retry','blocked','review') then raise exception 'Invalid delivery result.';end if;
  if p_data->>'status'='sent' and (v_queue.email_state<>'sent' or v_queue.email_id is null or not coalesce((v_queue.drive_manifest->>'complete')::boolean,false)) then raise exception 'Archive and email confirmation required.';end if;
  update app_private.techcheck_transfer_outbox set status=p_data->>'status',last_error=left(p_data->>'error',240),locked_until=null,lease_token=null,
   next_attempt_at=now()+interval '5 minutes',delivered_at=case when p_data->>'status'='sent' then now() else null end where event_id=p_id;
 else raise exception 'Invalid queue action.';end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function app_private.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
create function public.techcheck_transfer_delivery_v1(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select app_private.techcheck_transfer_delivery_v1(p_action,p_id,p_actor,p_lease,p_data)$$;
revoke all on function public.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.techcheck_transfer_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
commit;
