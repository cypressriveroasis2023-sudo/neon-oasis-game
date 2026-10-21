-- REVIEW CANDIDATE. Requires explicit Owner approval of the privileged migration.
-- Install after named-handoffs-v1, transfer-rollout-v2 and transfer-integration-v3.
-- Both correction release gates remain FALSE. No existing submission is changed.
-- The original event, signature, answers, evidence and delivery manifest remain immutable.
begin;

create table app_private.techcheck_transfer_correction_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 reports_ready boolean not null default false
);
insert into app_private.techcheck_transfer_correction_settings values(true,false,false);

create table app_private.techcheck_transfer_corrections (
 id uuid primary key,
 transfer_id uuid not null references app_private.techcheck_transfers(id),
 original_event_id uuid not null references app_private.techcheck_transfer_events(id),
 base_revision integer not null check(base_revision>0),
 revision integer not null check(revision=base_revision+1),
 actor_id uuid not null references public.profiles(user_id),
 actor_name text not null,
 actor_role text not null,
 technician_id uuid not null references public.profiles(user_id),
 technician_name text not null,
 mode text not null check(mode in ('self','cited')),
 technician_confirmed_at timestamptz not null,
 reason text not null,
 before_manifest jsonb not null,
 after_manifest jsonb not null,
 photos jsonb not null,
 request jsonb not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 unique(transfer_id,revision)
);
create table app_private.techcheck_transfer_correction_audit (
 correction_id uuid primary key references app_private.techcheck_transfer_corrections(id),
 transfer_id uuid not null references app_private.techcheck_transfers(id),
 actor_id uuid not null references public.profiles(user_id),
 action text not null check(action='correction_applied'),
 provenance jsonb not null,
 created_at timestamptz not null default now()
);
create table app_private.techcheck_transfer_correction_outbox (
 correction_id uuid primary key references app_private.techcheck_transfer_corrections(id),
 transfer_id uuid not null references app_private.techcheck_transfers(id),
 status text not null default 'queued' check(status in ('queued','processing','retry','blocked','review','sent')),
 drive_manifest jsonb not null default '{}',
 email_state text not null default 'pending' check(email_state in ('pending','sending','sent','review')),
 email_id text,
 lease_token uuid,
 locked_until timestamptz,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_error text,
 created_at timestamptz not null default now(),
 delivered_at timestamptz
);
create index techcheck_correction_queue_pending on app_private.techcheck_transfer_correction_outbox(next_attempt_at,created_at)
 where status in ('queued','retry','blocked','processing');
alter table app_private.techcheck_transfer_correction_settings enable row level security;
alter table app_private.techcheck_transfer_corrections enable row level security;
alter table app_private.techcheck_transfer_correction_audit enable row level security;
alter table app_private.techcheck_transfer_correction_outbox enable row level security;
revoke all on app_private.techcheck_transfer_correction_settings,app_private.techcheck_transfer_corrections,
 app_private.techcheck_transfer_correction_audit,app_private.techcheck_transfer_correction_outbox
 from public,anon,authenticated,service_role;

create function app_private.techcheck_correction_immutable_v1() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Submitted correction revisions and their audit are immutable.';end
$$;
revoke all on function app_private.techcheck_correction_immutable_v1() from public,anon,authenticated,service_role;
create trigger techcheck_correction_immutable before update or delete on app_private.techcheck_transfer_corrections
 for each row execute function app_private.techcheck_correction_immutable_v1();
create trigger techcheck_correction_audit_immutable before update or delete on app_private.techcheck_transfer_correction_audit
 for each row execute function app_private.techcheck_correction_immutable_v1();

create function app_private.techcheck_correction_ready_v1() returns boolean
language sql stable security definer set search_path='' as $$
 select app_private.techcheck_transfer_ready_v1() and coalesce((select enabled and reports_ready
 from app_private.techcheck_transfer_correction_settings where singleton),false)
$$;
revoke all on function app_private.techcheck_correction_ready_v1() from public,anon,authenticated,service_role;

-- The existing event and correction ledgers share a request-ID namespace.
-- This trigger adds no event and does not rewrite old signed events.
create function app_private.techcheck_correction_event_request_guard_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.id::text,1));
 if exists(select 1 from app_private.techcheck_transfer_corrections where id=new.id) then
  raise exception 'Request ID already used by a correction.';
 end if;
 return new;
end$$;
revoke all on function app_private.techcheck_correction_event_request_guard_v1() from public,anon,authenticated,service_role;
create trigger techcheck_correction_event_request_guard before insert on app_private.techcheck_transfer_events
 for each row execute function app_private.techcheck_correction_event_request_guard_v1();

-- Preserve the original bucket/ACLs. A saved correction closes the same draft
-- namespace, and only its named recipient or verified IT/Owner may read it.
-- There are still no Storage UPDATE or DELETE policies for either kind of evidence.
create or replace function app_private.techcheck_transfer_file(p_name text,p_write boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select app_private.techcheck_transfer_ready_v1() and app_private.techcheck_transfer_role() is not null
 and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$'
 and case when p_write then split_part(p_name,'/',1)=auth.uid()::text
  and not exists(select 1 from app_private.techcheck_transfer_events e where e.id::text=split_part(p_name,'/',2))
  and not exists(select 1 from app_private.techcheck_transfer_corrections c where c.id::text=split_part(p_name,'/',2))
 else split_part(p_name,'/',1)=auth.uid()::text
  or exists(select 1 from app_private.techcheck_transfer_events e join app_private.techcheck_transfers t on t.id=e.transfer_id
   where e.id::text=split_part(p_name,'/',2) and (app_private.techcheck_transfer_role()='it' or t.service_actor=auth.uid())
    and exists(select 1 from jsonb_array_elements(e.photos) p where p->>'path'=p_name))
  or exists(select 1 from app_private.techcheck_transfer_corrections c join app_private.techcheck_transfers t on t.id=c.transfer_id
   where c.id::text=split_part(p_name,'/',2) and (app_private.techcheck_transfer_role()='it' or t.service_actor=auth.uid())
    and exists(select 1 from jsonb_array_elements(c.photos) p where p->>'path'=p_name)) end
$$;
revoke all on function app_private.techcheck_transfer_file(text,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.techcheck_transfer_file(text,boolean) to authenticated;

create function app_private.techcheck_transfer_correction_context_v1(p_transfer_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_role text:=app_private.techcheck_transfer_role();v_actual_role text;
 v_base jsonb;v_transfers jsonb;v_equipment jsonb;v_gates jsonb;v_ready boolean:=app_private.techcheck_correction_ready_v1();
begin
 if v_actor is null or v_role is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 select case when role::text='owner' then 'owner' else v_role end into v_actual_role from public.profiles where user_id=v_actor;
 v_base:=public.techcheck_transfer_context_v1();
 select jsonb_build_object('enabled',enabled,'reports_ready',reports_ready) into v_gates
  from app_private.techcheck_transfer_correction_settings where singleton;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
  'original',jsonb_build_object('event_id',e.id,'actor_id',e.actor_id,'actor_name',e.actor_name,'snapshot',e.snapshot,
   'photos',e.photos,'signed_at',e.signed_at,
   'report_url',case when o.drive_manifest->'summary_pdf_v1'->>'done'='true' then 'https://drive.google.com/file/d/'||(o.drive_manifest->'summary_pdf_v1'->>'id')||'/view' end,
   'drive_folder_id',case when o.drive_manifest->'folder'->>'done'='true' then o.drive_manifest->'folder'->>'id' end),
  'corrections',(select coalesce(jsonb_agg(c.snapshot||jsonb_build_object('delivery',q.status,
    'report_url',case when q.drive_manifest->'summary_pdf_v1'->>'done'='true' then 'https://drive.google.com/file/d/'||(q.drive_manifest->'summary_pdf_v1'->>'id')||'/view' end,
    'drive_folder_id',case when q.drive_manifest->'folder'->>'done'='true' then q.drive_manifest->'folder'->>'id' end)
    order by c.revision),'[]') from app_private.techcheck_transfer_corrections c
    left join app_private.techcheck_transfer_correction_outbox q on q.correction_id=c.id where c.transfer_id=t.id),
  'can_correct_self',v_ready and v_role='it' and t.it_actor=v_actor and eligible.ok,
  'can_apply_cited',v_ready and v_role='it' and t.it_actor<>v_actor and eligible.ok,
  'correction_block_reason',case when not eligible.ok then 'Equipment has a receipt or custody change. Resolve it with IT before correcting.'
   when not v_ready then 'Corrections are awaiting release approval.'
   when v_role='service' then 'The submitting technician or an authorized Owner/IT user must record this correction.' end)
  order by t.created_at desc),'[]') into v_transfers
 from (select * from app_private.techcheck_transfers x where (v_role='it' or x.service_actor=v_actor)
  and (p_transfer_id is null or x.id=p_transfer_id) order by x.created_at desc limit 100) t
 left join lateral(select * from app_private.techcheck_transfer_events z where z.transfer_id=t.id and z.kind='checkout' order by z.signed_at,z.id limit 1) e on true
 left join app_private.techcheck_transfer_outbox o on o.event_id=e.id
 cross join lateral(select t.state='awaiting_service' and e.id is not null
  and not exists(select 1 from app_private.techcheck_transfer_events r where r.transfer_id=t.id and r.kind<>'checkout') as ok) eligible;
 select coalesce(jsonb_agg(e||jsonb_build_object('reservation_transfer_id',r.transfer_id)),'[]') into v_equipment
 from jsonb_array_elements(v_base->'equipment') e left join app_private.techcheck_transfer_reservations r on r.equipment_key=e->>'equipment_key';
 return jsonb_build_object('version',1,'actor_id',v_actor,'role',v_actual_role,'ready',v_ready,
  'gates',coalesce(v_gates,'{"enabled":false,"reports_ready":false}'::jsonb),'transfers',v_transfers,'equipment',v_equipment);
end$$;
revoke all on function app_private.techcheck_transfer_correction_context_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.techcheck_transfer_correction_context_v1(uuid) to authenticated;
create function public.techcheck_transfer_correction_context_v1(p_transfer_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select app_private.techcheck_transfer_correction_context_v1(p_transfer_id)$$;
revoke all on function public.techcheck_transfer_correction_context_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.techcheck_transfer_correction_context_v1(uuid) to authenticated;

create function app_private.submit_techcheck_transfer_correction_v1(
 p_request_id uuid,p_transfer_id uuid,p_expected_revision integer,p_items jsonb,p_photos jsonb,p_reason text,p_confirmation jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid();v_actor_name text;v_actor_role text;v_role text:=app_private.techcheck_transfer_role();
 v_prior app_private.techcheck_transfer_corrections%rowtype;v_t app_private.techcheck_transfers%rowtype;
 v_original app_private.techcheck_transfer_events%rowtype;v_equipment public.equipment_master%rowtype;
 v_request jsonb:=jsonb_build_object('transfer_id',p_transfer_id,'expected_revision',p_expected_revision,
  'items',p_items,'photos',p_photos,'reason',p_reason,'confirmation',p_confirmation);
 v_items jsonb;v_item jsonb;v_photo jsonb;v_photos jsonb;v_snapshot jsonb;v_confirmation jsonb;
 v_mode text;v_confirmed_at timestamptz;v_reply text;v_reference text;v_hold text;v_key text;
 v_before_keys text[];v_after_keys text[];v_reserved_keys text[];v_changed_keys text[];v_now timestamptz:=now();
begin
 if v_actor is null or v_role is distinct from 'it' then raise exception 'Active Owner or verified IT account required.' using errcode='42501';end if;
 if p_request_id is null or p_transfer_id is null then raise exception 'Correction and handoff IDs are required.';end if;
 -- Match the legacy wrapper's lock order. This serializes against receipts,
 -- legacy custody writes and a competing correction before changing reservations.
 lock table public.prep_items,public.prep_tickets,public.service_truck_units,public.unit_returns,public.unit_registry in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,1));
 select * into v_prior from app_private.techcheck_transfer_corrections where id=p_request_id;
 if found then
  if v_prior.actor_id<>v_actor or v_prior.request is distinct from v_request then raise exception 'Request ID already used with different details.';end if;
  return v_prior.snapshot||jsonb_build_object('replayed',true,'delivery',(select status from app_private.techcheck_transfer_correction_outbox where correction_id=p_request_id));
 end if;
 if not app_private.techcheck_correction_ready_v1() then raise exception 'Corrections are awaiting release approval.';end if;
 if exists(select 1 from app_private.techcheck_transfer_events where id=p_request_id) then raise exception 'Request ID already used by a signed handoff event.';end if;
 select * into v_t from app_private.techcheck_transfers where id=p_transfer_id for update;
 if not found then raise exception 'Handoff unavailable for your account.' using errcode='42501';end if;
 if p_expected_revision is distinct from v_t.revision then raise exception 'Handoff changed. Reload before correcting.';end if;
 if v_t.state<>'awaiting_service' or exists(select 1 from app_private.techcheck_transfer_events where transfer_id=v_t.id and kind<>'checkout') then
  raise exception 'Equipment has a receipt or custody change. Resolve it with IT before correcting.';
 end if;
 select * into v_original from app_private.techcheck_transfer_events where transfer_id=v_t.id and kind='checkout' order by signed_at,id limit 1;
 if not found or v_original.actor_id<>v_t.it_actor then raise exception 'Original signed handoff is unavailable. Owner review required.';end if;
 if p_reason is null or length(btrim(p_reason)) not between 5 and 2000 then raise exception 'Explain the correction in 5 to 2000 characters.';end if;
 if jsonb_typeof(p_confirmation) is distinct from 'object' or p_confirmation->'confirmed' is distinct from 'true'::jsonb
  or p_confirmation->>'technician_id' is distinct from v_t.it_actor::text then raise exception 'Confirm the original submitting technician and corrected details.';end if;
 if exists(select 1 from jsonb_object_keys(p_confirmation) k where k not in ('mode','confirmed','technician_id','technician_confirmed_at','technician_reply','evidence_reference')) then raise exception 'Unexpected confirmation field.';end if;
 v_mode:=p_confirmation->>'mode';
 if v_mode='self' then
  if v_actor<>v_t.it_actor then raise exception 'Only the original submitting technician can personally confirm this correction.' using errcode='42501';end if;
  if p_confirmation ?| array['technician_confirmed_at','technician_reply','evidence_reference'] then raise exception 'Personal confirmation uses your authenticated account and server time.';end if;
  v_confirmed_at:=v_now;
 elsif v_mode='cited' then
  if v_actor=v_t.it_actor then raise exception 'Use personal confirmation when correcting your own handoff.';end if;
  v_reply:=btrim(p_confirmation->>'technician_reply');v_reference:=btrim(p_confirmation->>'evidence_reference');
  if v_reply is null or length(v_reply) not between 5 and 5000 then raise exception 'Record the technician reply that confirms these corrected details.';end if;
  if v_reference is null or length(v_reference)>2000 or v_reference !~ '^https://(drive\.google\.com|docs\.google\.com|mail\.google\.com)/[^[:space:]<>]+$' then
   raise exception 'Cite the technician reply with a Google Drive, Docs or Gmail HTTPS link.';
  end if;
  if coalesce(p_confirmation->>'technician_confirmed_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Record the technician confirmation time with its timezone.';end if;
  v_confirmed_at:=(p_confirmation->>'technician_confirmed_at')::timestamptz;
  if v_confirmed_at<v_original.signed_at or v_confirmed_at>v_now then raise exception 'Technician confirmation time must follow the original submission and cannot be in the future.';end if;
 else raise exception 'Choose personal confirmation or cited technician evidence.';
 end if;
 select coalesce(nullif(btrim(full_name),''),username),role::text into v_actor_name,v_actor_role from public.profiles where user_id=v_actor;
 v_items:=app_private.techcheck_transfer_manifest(p_items,false);
 if v_items is not distinct from v_t.manifest then raise exception 'No changed equipment details to save.';end if;
 select array_agg(value->>'equipment_key' order by value->>'equipment_key') into v_before_keys from jsonb_array_elements(v_t.manifest);
 select array_agg(value->>'equipment_key' order by value->>'equipment_key') into v_after_keys from jsonb_array_elements(v_items);
 select coalesce(array_agg(equipment_key order by equipment_key),array[]::text[]) into v_reserved_keys
  from app_private.techcheck_transfer_reservations where transfer_id=v_t.id;
 if v_reserved_keys is distinct from v_before_keys then raise exception 'Handoff reservations changed. Owner custody review required.';end if;
 for v_key in select distinct k from unnest(v_before_keys||v_after_keys) k order by k loop
  perform pg_advisory_xact_lock(hashtextextended(v_key,2));
  perform 1 from public.equipment_master where equipment_key=v_key for update;
 end loop;
 for v_item in select value from jsonb_array_elements(v_items) order by value->>'equipment_key' loop
  select * into v_equipment from public.equipment_master where equipment_key=v_item->>'equipment_key';
  if not found or v_equipment.tracker_state is distinct from 'shop' then raise exception 'Equipment is not recorded in Shop. Verify placement first.';end if;
  if v_item->>'family' is distinct from v_equipment.canonical_family or v_item->>'unit_tag' is distinct from v_equipment.unit_tag then
   raise exception 'Equipment identity changed. Reload and check the exact unit.';
  end if;
  if (select count(*) from public.equipment_master where canonical_family=v_equipment.canonical_family and unit_tag=v_equipment.unit_tag)<>1 then
   raise exception 'Equipment identity is ambiguous. Owner identity review required.';
  end if;
  if not exists(select 1 from app_private.techcheck_transfer_rules where workflow_type=v_equipment.workflow_type and workflow_type=v_equipment.canonical_family) then raise exception 'No approved check-only rule mapping exists for this equipment.';end if;
  if exists(select 1 from app_private.techcheck_transfer_reservations where equipment_key=v_equipment.equipment_key and transfer_id<>v_t.id) then
   raise exception 'Equipment already has another unresolved handoff or return.';
  end if;
  v_hold:=app_private.techcheck_transfer_custody_hold_v1(v_equipment.equipment_key);
  if v_hold is not null then raise exception 'Equipment unavailable: %.',v_hold;end if;
 end loop;
 select coalesce(array_agg(i->>'equipment_key'),array[]::text[]) into v_changed_keys from jsonb_array_elements(v_items) i
  where not exists(select 1 from jsonb_array_elements(v_t.manifest) b where b=i);
 -- A removal-only correction still needs a current legible photo of retained equipment.
 if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos) not between 2 and 40 then raise exception 'Add a matching unit and legible tag photo for the correction.';end if;
 if exists(select 1 from jsonb_array_elements(p_photos) group by value->>'equipment_key',value->>'kind' having count(*)>1) then raise exception 'Duplicate correction evidence slot.';end if;
 if exists(select 1 from jsonb_array_elements(p_photos) group by value->>'path' having count(distinct value->>'equipment_key')>1) then
  raise exception 'A correction photo cannot identify more than one equipment unit.';
 end if;
 for v_photo in select value from jsonb_array_elements(p_photos) loop
  if jsonb_typeof(v_photo) is distinct from 'object' or coalesce(v_photo->>'kind','') not in ('unit','tag')
   or coalesce(v_photo->>'path','') !~ ('^'||v_actor::text||'/'||p_request_id::text||'/[a-f0-9]{64}\.jpg$') then raise exception 'Invalid correction evidence identity.';end if;
  if not (coalesce(v_photo->>'equipment_key','')=any(v_after_keys)) then raise exception 'Correction photo must match an exact corrected equipment identity.';end if;
  if not exists(select 1 from storage.objects where bucket_id='techcheck-transfer-evidence' and name=v_photo->>'path'
   and metadata->>'mimetype'='image/jpeg' and (metadata->>'size')::bigint between 1 and 5242880) then raise exception 'Upload every correction evidence photo first.';end if;
 end loop;
 foreach v_key in array v_changed_keys loop
  if not exists(select 1 from jsonb_array_elements(p_photos) where value->>'equipment_key'=v_key and value->>'kind'='unit')
   or not exists(select 1 from jsonb_array_elements(p_photos) where value->>'equipment_key'=v_key and value->>'kind'='tag') then raise exception 'Add a matching unit and legible tag photo for each changed equipment item.';end if;
 end loop;
 if cardinality(v_changed_keys)=0 and not exists(select 1 from jsonb_array_elements(p_photos) p
  group by p->>'equipment_key' having count(distinct p->>'kind')=2) then
  raise exception 'Add a matching unit and legible tag photo for a retained equipment item.';
 end if;
 select jsonb_agg(jsonb_build_object('equipment_key',p->>'equipment_key','kind',p->>'kind','path',p->>'path',
  'sha256',split_part(split_part(p->>'path','/',3),'.',1)) order by p->>'equipment_key',p->>'kind',p->>'path') into v_photos from jsonb_array_elements(p_photos) p;
 v_confirmation:=jsonb_build_object('mode',v_mode,'technician_id',v_t.it_actor,'technician_name',v_t.it_name,
  'confirmed_at',v_confirmed_at,'recorded_by',v_actor,'recorded_at',v_now,'technician_reply',v_reply,'evidence_reference',v_reference,
  'statement',case when v_mode='self' then 'I personally verified the corrected unit identity and matching photo. These details describe the equipment I handed over; this is not an additional checkout or a Service acceptance.'
   else 'I reviewed the cited reply and matching photo from the original submitting technician. I am applying their confirmed correction under my own account; I am not signing or accepting equipment for either technician.' end);
 v_snapshot:=jsonb_build_object('version',1,'correction_id',p_request_id,'transfer_id',v_t.id,'original_event_id',v_original.id,
  'base_revision',v_t.revision,'revision',v_t.revision+1,'state','awaiting_service','before',v_t.manifest,'after',v_items,
  'reason',btrim(p_reason),'mode',v_mode,'applied_by',jsonb_build_object('id',v_actor,'name',v_actor_name,'role',v_actor_role),
  'original_technician',jsonb_build_object('id',v_t.it_actor,'name',v_t.it_name),
  'service_recipient',jsonb_build_object('id',v_t.service_actor,'name',v_t.service_name),
  'confirmed_by',jsonb_build_object('id',v_t.it_actor,'name',v_t.it_name,'mode',v_mode,'confirmed_at',v_confirmed_at),
  'confirmation_recorded_by',v_actor,'confirmation',v_confirmation,'technician_reply',v_reply,'evidence_reference',v_reference,
  'photos',v_photos,'created_at',v_now,'original_snapshot',v_original.snapshot,'original_submitted_at',v_original.signed_at,
  'original_check_date',timezone('America/Chicago',v_original.signed_at)::date);
 insert into app_private.techcheck_transfer_corrections(id,transfer_id,original_event_id,base_revision,revision,actor_id,actor_name,actor_role,
  technician_id,technician_name,mode,technician_confirmed_at,reason,before_manifest,after_manifest,photos,request,snapshot)
 values(p_request_id,v_t.id,v_original.id,v_t.revision,v_t.revision+1,v_actor,v_actor_name,v_actor_role,v_t.it_actor,v_t.it_name,v_mode,
  v_confirmed_at,btrim(p_reason),v_t.manifest,v_items,v_photos,v_request,v_snapshot);
 insert into app_private.techcheck_transfer_correction_audit(correction_id,transfer_id,actor_id,action,provenance)
 values(p_request_id,v_t.id,v_actor,'correction_applied',jsonb_build_object('original_event_id',v_original.id,
  'base_revision',v_t.revision,'revision',v_t.revision+1,'confirmation',v_confirmation,'applied_by',v_snapshot->'applied_by'));
 delete from app_private.techcheck_transfer_reservations where transfer_id=v_t.id and not equipment_key=any(v_after_keys);
 insert into app_private.techcheck_transfer_reservations(equipment_key,transfer_id)
  select k,v_t.id from unnest(v_after_keys) k where not k=any(v_before_keys);
 update app_private.techcheck_transfers set manifest=v_items,revision=revision+1,updated_at=v_now where id=v_t.id;
 insert into app_private.techcheck_transfer_correction_outbox(correction_id,transfer_id) values(p_request_id,v_t.id);
 return v_snapshot||jsonb_build_object('replayed',false,'delivery','queued');
end$$;
revoke all on function app_private.submit_techcheck_transfer_correction_v1(uuid,uuid,integer,jsonb,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.submit_techcheck_transfer_correction_v1(uuid,uuid,integer,jsonb,jsonb,text,jsonb) to authenticated;
create function public.submit_techcheck_transfer_correction_v1(
 p_request_id uuid,p_transfer_id uuid,p_expected_revision integer,p_items jsonb,p_photos jsonb,p_reason text,p_confirmation jsonb
) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.submit_techcheck_transfer_correction_v1(p_request_id,p_transfer_id,p_expected_revision,p_items,p_photos,p_reason,p_confirmation)
$$;
revoke all on function public.submit_techcheck_transfer_correction_v1(uuid,uuid,integer,jsonb,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.submit_techcheck_transfer_correction_v1(uuid,uuid,integer,jsonb,jsonb,text,jsonb) to authenticated;

-- Separate delivery state never replaces an original signed report or its folder.
create function app_private.techcheck_correction_delivery_v1(
 p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_queue app_private.techcheck_transfer_correction_outbox%rowtype;v_c app_private.techcheck_transfer_corrections%rowtype;
 v_original app_private.techcheck_transfer_events%rowtype;v_original_manifest jsonb;v_token uuid:=gen_random_uuid();
begin
 if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Server access required.' using errcode='42501';end if;
 if p_action='claim' then
  if not app_private.techcheck_correction_ready_v1() then return null;end if;
  select q.* into v_queue from app_private.techcheck_transfer_correction_outbox q
   join app_private.techcheck_transfer_corrections c on c.id=q.correction_id
   join app_private.techcheck_transfer_outbox o on o.event_id=c.original_event_id
  where (p_id is null or q.correction_id=p_id)
   and (p_actor is null or app_private.cos_verified_fleet_actor(p_actor))
   and o.drive_manifest->>'complete'='true' and o.drive_manifest->'folder'->>'done'='true'
   and length(coalesce(o.drive_manifest->'folder'->>'id',''))>0
   and o.drive_manifest->'summary_pdf_v1'->>'done'='true' and length(coalesce(o.drive_manifest->'summary_pdf_v1'->>'id',''))>0
   and q.status in ('queued','retry','blocked','processing') and q.next_attempt_at<=now()
   and (q.locked_until is null or q.locked_until<now())
  order by q.created_at,q.correction_id limit 1 for update of q skip locked;
  if not found then return null;end if;
  update app_private.techcheck_transfer_correction_outbox set status='processing',lease_token=v_token,
   locked_until=now()+interval '10 minutes',attempts=attempts+1 where correction_id=v_queue.correction_id returning * into v_queue;
  select * into strict v_c from app_private.techcheck_transfer_corrections where id=v_queue.correction_id;
  select * into strict v_original from app_private.techcheck_transfer_events where id=v_c.original_event_id;
  select drive_manifest into strict v_original_manifest from app_private.techcheck_transfer_outbox where event_id=v_c.original_event_id;
  return to_jsonb(v_queue)||v_c.snapshot||jsonb_build_object('id',v_c.id,'correction_id',v_c.id,
   'actor_id',v_c.actor_id,'actor_name',v_c.actor_name,'actor_role',v_c.actor_role,
   'technician_id',v_c.technician_id,'technician_name',v_c.technician_name,
   'submitted_at',v_c.created_at,'check_date',timezone('America/Chicago',v_c.created_at)::date,
   'snapshot',v_c.snapshot,'original_drive_manifest',v_original_manifest,
   'original_submitted_at',v_original.signed_at,'original_check_date',timezone('America/Chicago',v_original.signed_at)::date);
 end if;
 select * into v_queue from app_private.techcheck_transfer_correction_outbox
  where correction_id=p_id and lease_token=p_lease and locked_until>now() for update;
 if not found then raise exception 'Correction delivery lease expired.';end if;
 if p_action='checkpoint' then
  if p_data ? 'email_state' and coalesce(p_data->>'email_state','') not in ('pending','sending','sent','review') then raise exception 'Invalid email state.';end if;
  if p_data ? 'drive_manifest' and jsonb_typeof(p_data->'drive_manifest') is distinct from 'object' then raise exception 'Invalid archive checkpoint.';end if;
  if v_queue.email_state='sent' and ((p_data ? 'email_state' and p_data->>'email_state' is distinct from 'sent')
   or (p_data ? 'email_id' and p_data->>'email_id' is distinct from v_queue.email_id)) then raise exception 'Confirmed email delivery cannot be changed.';end if;
  update app_private.techcheck_transfer_correction_outbox set drive_manifest=coalesce(p_data->'drive_manifest',drive_manifest),
   email_state=coalesce(p_data->>'email_state',email_state),email_id=coalesce(p_data->>'email_id',email_id) where correction_id=p_id;
 elsif p_action='finish' then
  if coalesce(p_data->>'status','') not in ('sent','retry','blocked','review') then raise exception 'Invalid correction delivery result.';end if;
  if p_data->>'status'='sent' and (v_queue.email_state<>'sent' or length(coalesce(v_queue.email_id,''))=0
   or v_queue.drive_manifest->>'complete' is distinct from 'true'
   or v_queue.drive_manifest->'folder'->>'done' is distinct from 'true' or length(coalesce(v_queue.drive_manifest->'folder'->>'id',''))=0
   or v_queue.drive_manifest->'summary_pdf_v1'->>'done' is distinct from 'true' or length(coalesce(v_queue.drive_manifest->'summary_pdf_v1'->>'id',''))=0)
   then raise exception 'Correction archive and email confirmation required.';end if;
  update app_private.techcheck_transfer_correction_outbox set status=p_data->>'status',last_error=left(p_data->>'error',240),
   locked_until=null,lease_token=null,next_attempt_at=now()+interval '5 minutes',
   delivered_at=case when p_data->>'status'='sent' then now() else null end where correction_id=p_id;
 else raise exception 'Invalid correction queue action.';end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function app_private.techcheck_correction_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.techcheck_correction_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
create function public.techcheck_correction_delivery_v1(
 p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}'
) returns jsonb language sql security invoker set search_path='' as $$
 select app_private.techcheck_correction_delivery_v1(p_action,p_id,p_actor,p_lease,p_data)
$$;
revoke all on function public.techcheck_correction_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.techcheck_correction_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
commit;
