-- PROPOSAL ONLY. Target: legacy Tech Check goqrnolcvqnirjmzaeyk, never native.
-- No migration runner references this file. Do not apply/enable until live schema,
-- exact mappings, authority, ACLs and existing trigger contract are reviewed.
-- One explicitly approved service_role-only public RPC; no other access is added.
-- No new credential, scheduler, remote request, notification or vendor write.
-- Private helpers remain invoker-only/revoked; public wrapper validates real SQL role.
-- No auth.uid override, invented Owner identity, or automatic activation.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

-- Fail atomically on unexpected deployment ownership; the service guard relies
-- on the reviewed existing postgres function-owner contract.
do $preflight$ begin
  if current_user<>'postgres' then raise exception 'MHELP_INTAKE_DEPLOYMENT_ROLE'; end if;
end $preflight$;

create schema cos_mhelp_intake;
revoke all on schema cos_mhelp_intake from public, anon, authenticated, service_role;

create table cos_mhelp_intake.portal_config (
  portal_id text primary key check (length(portal_id) between 1 and 128),
  enabled boolean not null default false,
  activated_at timestamptz,
  schema_contract text,
  schema_evidence text,
  reviewed_by uuid,
  review_actor text not null default 'owner' check (review_actor in ('owner','approved_service')),
  approval_reference text,
  reviewed_at timestamptz,
  check (not enabled or (activated_at is not null and schema_contract is not null
    and length(btrim(schema_contract)) > 0 and schema_evidence is not null and length(btrim(schema_evidence)) > 0
    and reviewed_at is not null and ((review_actor='owner' and reviewed_by is not null)
      or (review_actor='approved_service' and reviewed_by is null and approval_reference is not null and length(btrim(approval_reference))>0))))
);
create table cos_mhelp_intake.type_mappings (
  portal_id text not null references cos_mhelp_intake.portal_config(portal_id),
  type_id text not null check (length(type_id) between 1 and 128),
  work_type text not null check (work_type in ('service','delivery','swap','pickup')),
  enabled boolean not null default false,
  evidence text not null check (length(btrim(evidence)) between 1 and 1000),
  reviewed_by uuid,
  review_actor text not null default 'owner' check (review_actor in ('owner','approved_service')),
  approval_reference text,
  reviewed_at timestamptz not null,
  check ((review_actor='owner' and reviewed_by is not null)
    or (review_actor='approved_service' and reviewed_by is null and approval_reference is not null and length(btrim(approval_reference))>0)),
  primary key (portal_id,type_id)
);
create table cos_mhelp_intake.source_status_policies (
  portal_id text not null references cos_mhelp_intake.portal_config(portal_id),
  status_id text not null check (length(btrim(status_id)) between 1 and 128),
  -- Empty key means the source explicitly supplied JSON null, never a missing field.
  custom_status_id text not null default '' check (length(custom_status_id)<=128),
  classification text not null check(classification in ('open','terminal','review')),
  enabled boolean not null default false,
  evidence text not null check(length(btrim(evidence)) between 1 and 1000),
  reviewed_by uuid,
  review_actor text not null default 'owner' check(review_actor in ('owner','approved_service')),
  approval_reference text,
  reviewed_at timestamptz not null,
  check((review_actor='owner' and reviewed_by is not null)
    or (review_actor='approved_service' and reviewed_by is null and approval_reference is not null and length(btrim(approval_reference))>0)),
  primary key(portal_id,status_id,custom_status_id)
);
create table cos_mhelp_intake.identity_crosswalk (
  portal_id text not null references cos_mhelp_intake.portal_config(portal_id),
  source_identity text not null check (length(source_identity) between 1 and 128),
  legacy_user_id uuid not null,
  department text not null check (department in ('it','service')),
  enabled boolean not null default false,
  evidence text not null check (length(btrim(evidence)) between 1 and 1000),
  reviewed_by uuid,
  review_actor text not null default 'owner' check (review_actor in ('owner','approved_service')),
  approval_reference text,
  reviewed_at timestamptz not null,
  check ((review_actor='owner' and reviewed_by is not null)
    or (review_actor='approved_service' and reviewed_by is null and approval_reference is not null and length(btrim(approval_reference))>0)),
  primary key (portal_id,source_identity)
);
create table cos_mhelp_intake.receipts (
  portal_id text not null,
  ticket_id text not null,
  ticket_number text not null,
  source_created_at timestamptz not null,
  first_payload jsonb not null,
  state text not null check (state in ('review_needed','created')),
  reason_codes text[] not null default '{}',
  review_required boolean not null default false,
  assignment_ids uuid[] not null default '{}',
  received_by uuid,
  actor_kind text not null default 'service_role' check(actor_kind='service_role' and received_by is null),
  received_at timestamptz not null default now(),
  created_at timestamptz,
  primary key (portal_id,ticket_id),
  check ((state='created' and cardinality(assignment_ids)>0 and created_at is not null)
    or (state='review_needed' and cardinality(assignment_ids)=0 and created_at is null))
);
-- The legacy printed ticket has a global namespace. Multiple portals cannot
-- silently co-own that reference even if someone later removes an assignment.
create unique index receipts_created_ticket_number on cos_mhelp_intake.receipts(ticket_number) where state='created';
create index receipts_review_queue on cos_mhelp_intake.receipts(received_at) where review_required;
alter table cos_mhelp_intake.portal_config enable row level security;
alter table cos_mhelp_intake.type_mappings enable row level security;
alter table cos_mhelp_intake.identity_crosswalk enable row level security;
alter table cos_mhelp_intake.source_status_policies enable row level security;
alter table cos_mhelp_intake.receipts enable row level security;
revoke all on all tables in schema cos_mhelp_intake from public, anon, authenticated, service_role;


-- Preserve human attribution requirements. Only the approved service marker can
-- omit an auth.users parent; its name is truthful and immutable after creation.
alter table public.job_assignments alter column assigned_by drop not null;
alter table public.job_assignments add constraint job_assignments_mhelp_actor_required
  check (assigned_by is not null or (created_from is not distinct from 'mhelpdesk_service_intake'
    and assigned_by_name is not distinct from 'mHelpDesk automatic intake'));
create function cos_mhelp_intake.guard_service_actor_v1()
returns trigger language plpgsql security invoker set search_path='' as $guard$
begin
  if tg_op='UPDATE' then
    if old.created_from='mhelpdesk_service_intake'
      and (new.created_from is distinct from old.created_from or new.assigned_by is distinct from old.assigned_by
        or new.assigned_by_name is distinct from old.assigned_by_name) then
      raise exception 'MHELP_INTAKE_ACTOR_IMMUTABLE' using errcode='42501';
    end if;
    if new.created_from is not distinct from old.created_from and new.assigned_by is not distinct from old.assigned_by
      and new.assigned_by_name is not distinct from old.assigned_by_name then return new; end if;
  end if;
  if new.created_from='mhelpdesk_service_intake' then
    -- A direct service_role table write runs as service_role, not postgres. Only
    -- the postgres-owned restricted definer wrapper has both of these roles.
    if current_user<>'postgres' or coalesce(current_setting('role',true),'')<>'service_role'
      or auth.uid() is not null or new.assigned_by is not null
      or new.assigned_by_name is distinct from 'mHelpDesk automatic intake' then
      raise exception 'MHELP_INTAKE_SERVICE_CONTEXT_REQUIRED' using errcode='42501';
    end if;
  end if;
  return new;
end;
$guard$;
revoke all on function cos_mhelp_intake.guard_service_actor_v1() from public,anon,authenticated,service_role;
create trigger guard_mhelp_intake_service_actor_v1
  before insert or update of created_from,assigned_by,assigned_by_name on public.job_assignments
  for each row execute function cos_mhelp_intake.guard_service_actor_v1();

create function cos_mhelp_intake.accept_ticket_v1(p_ticket jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_profile public.profiles%rowtype;
  v_lead public.profiles%rowtype;
  v_config cos_mhelp_intake.portal_config%rowtype;
  v_receipt cos_mhelp_intake.receipts%rowtype;
  v_mapping cos_mhelp_intake.type_mappings%rowtype;
  v_status cos_mhelp_intake.source_status_policies%rowtype;
  v_crosswalk cos_mhelp_intake.identity_crosswalk%rowtype;
  v_source jsonb := p_ticket->'source';
  v_request jsonb := p_ticket->'request';
  v_portal text := p_ticket#>>'{source,portalId}';
  v_ticket text := p_ticket#>>'{source,ticketId}';
  v_number text := p_ticket#>>'{source,ticketNumber}';
  v_created timestamptz;
  v_work text;
  v_roles text[];
  v_reasons text[] := '{}';
  v_target jsonb;
  v_resolved_targets jsonb := '[]'::jsonb;
  v_fact jsonb;
  v_item jsonb;
  v_key text;
  v_role text;
  v_source_identity text;
  v_assignee uuid;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_requires boolean;
  v_has_prep boolean := false;
  v_units integer := 0;
  v_labels text[] := '{}';
  v_seen_source_identities text[] := '{}';
  v_n integer := 0;
begin
  if current_user<>'postgres' or coalesce(current_setting('role',true),'')<>'service_role' or auth.uid() is not null then
    raise exception 'MHELP_INTAKE_SERVICE_CONTEXT_REQUIRED' using errcode='42501'; end if;

  -- Invalid identity cannot produce a durable review key. Reject, never guess.
  if jsonb_typeof(p_ticket) is distinct from 'object' or octet_length(p_ticket::text)>100000
    or p_ticket->>'contract' is distinct from 'cos-mhelp-legacy-intake-v1'
    or jsonb_typeof(v_source) is distinct from 'object'
    or jsonb_typeof(v_source->'portalId') is distinct from 'string'
    or jsonb_typeof(v_source->'ticketId') is distinct from 'string'
    or jsonb_typeof(v_source->'ticketNumber') is distinct from 'string'
    or v_portal is null or v_ticket is null or v_number is null
    or length(v_portal) not between 1 and 128 or length(v_ticket) not between 1 and 128
    or v_number !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$'
    or v_portal<>btrim(v_portal) or v_ticket<>btrim(v_ticket) or v_number<>btrim(v_number)
    or v_portal ~ '[[:cntrl:]]' or v_ticket ~ '[[:cntrl:]]' or v_number ~ '[[:cntrl:]]'
    or coalesce(v_source->>'createdAt','') !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?Z$'
  then raise exception 'MHELP_INTAKE_INVALID_SOURCE'; end if;
  begin v_created := (v_source->>'createdAt')::timestamptz;
  exception when others then raise exception 'MHELP_INTAKE_INVALID_SOURCE'; end;

  -- Persist only this bounded normalized envelope, never raw provider bodies or
  -- caller-added fields (credentials, contacts, billing and arbitrary metadata).
  begin
    if exists(select 1 from jsonb_object_keys(p_ticket) k where k<>all(array['contract','schemaContract','source','departmentAssignments','ticketLead','sourceEvidence','request']))
      or exists(select 1 from jsonb_object_keys(v_source) k where k<>all(array['portalId','ticketId','ticketNumber','typeId','statusId','customStatusId','deleted','assignment','createdAt']))
      or exists(select 1 from jsonb_object_keys(v_request) k where k<>all(array['ticket_no','site','work_type','targets','requested_unit_count','unit_summary','job_description','notes','equipment_manifest','scheduled_for','scheduled_time','solar_panel_qty','battery_replacement_qty','camera_replacement_qty','sim_replacement_qty','micro_sd_qty']))
      or exists(select 1 from jsonb_object_keys(p_ticket->'ticketLead') k where k<>all(array['sourceIdentity','evidence']))
      or exists(select 1 from jsonb_object_keys(p_ticket->'sourceEvidence') k where k<>all(array['equipment','parts','site','description','schedule','complete']))
      or exists(select 1 from jsonb_object_keys(v_source->'assignment') k where k<>all(array['state','identities','evidence']))
    then raise exception 'unsupported envelope'; end if;
    -- Object/array values in scalar fields are rejected before either a created
    -- or a review receipt can retain the envelope. Bad primitive operational
    -- facts may still be held for review; raw nested provider data may not.
    if exists(select 1 from jsonb_each(p_ticket) e where e.key in ('contract','schemaContract') and jsonb_typeof(e.value) in ('object','array'))
      or exists(select 1 from jsonb_each(v_source) e where e.key<>'assignment' and jsonb_typeof(e.value) in ('object','array'))
      or exists(select 1 from jsonb_each(v_request) e where e.key not in ('targets','equipment_manifest') and jsonb_typeof(e.value) in ('object','array'))
      or exists(select 1 from jsonb_each(p_ticket->'ticketLead') e where jsonb_typeof(e.value) in ('object','array'))
      or exists(select 1 from jsonb_each(p_ticket->'sourceEvidence') e where jsonb_typeof(e.value) in ('object','array'))
      or exists(select 1 from jsonb_each(v_source->'assignment') e where e.key<>'identities' and jsonb_typeof(e.value) in ('object','array'))
      or exists(select 1 from jsonb_array_elements(v_source#>'{assignment,identities}') e where jsonb_typeof(e) is distinct from 'string')
    then raise exception 'non-scalar normalized fact'; end if;
    foreach v_key in array array['typeId','statusId'] loop
      if v_source ? v_key and jsonb_typeof(v_source->v_key) is distinct from 'string' then raise exception 'non-string source identity'; end if;
    end loop;
    if p_ticket#>'{ticketLead,evidence}' is not null and (jsonb_typeof(p_ticket#>'{ticketLead,evidence}') is distinct from 'string'
      or length(btrim(p_ticket#>>'{ticketLead,evidence}')) not between 1 and 1000) then raise exception 'invalid lead evidence'; end if;
    if v_source#>'{assignment,evidence}' is not null and (jsonb_typeof(v_source#>'{assignment,evidence}') is distinct from 'string'
      or length(btrim(v_source#>>'{assignment,evidence}')) not between 1 and 1000) then raise exception 'invalid assignment evidence'; end if;
    foreach v_key in array array['equipment','parts','site','description','schedule'] loop
      if (p_ticket->'sourceEvidence') ? v_key and (jsonb_typeof(p_ticket->'sourceEvidence'->v_key) is distinct from 'string'
        or length(btrim(p_ticket->'sourceEvidence'->>v_key)) not between 1 and 1000) then raise exception 'invalid source evidence'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(p_ticket->'departmentAssignments') loop
      if exists(select 1 from jsonb_object_keys(v_item) k where k<>all(array['department','state','identities','evidence'])) then raise exception 'unsupported fact'; end if;
      if exists(select 1 from jsonb_each(v_item) e where e.key<>'identities' and jsonb_typeof(e.value) in ('object','array'))
        or exists(select 1 from jsonb_array_elements(v_item->'identities') e where jsonb_typeof(e) is distinct from 'string')
        or (v_item ? 'evidence' and (jsonb_typeof(v_item->'evidence') is distinct from 'string'
          or length(btrim(v_item->>'evidence')) not between 1 and 1000)) then raise exception 'invalid department fact'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(v_request->'targets') loop
      if exists(select 1 from jsonb_object_keys(v_item) k where k<>all(array['role','assignee_user_id','requires_it_handoff'])) then raise exception 'unsupported target'; end if;
      if exists(select 1 from jsonb_each(v_item) e where jsonb_typeof(e.value) in ('object','array')) then raise exception 'non-scalar target'; end if;
    end loop;
    for v_item in select value from jsonb_array_elements(v_request->'equipment_manifest') loop
      if exists(select 1 from jsonb_object_keys(v_item) k where k<>all(array['category','label','qty'])) then raise exception 'unsupported equipment'; end if;
      if exists(select 1 from jsonb_each(v_item) e where jsonb_typeof(e.value) in ('object','array')) then raise exception 'non-scalar equipment'; end if;
    end loop;
  exception when others then raise exception 'MHELP_INTAKE_INVALID_SOURCE'; end;

  -- Immutable source identity lock, then the same printed-ticket lock used by
  -- owner_assign_job_bundle_v1. All first-stage rows + receipt commit together.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('mhelpdesk',v_portal,v_ticket)::text,0));
  select * into v_receipt from cos_mhelp_intake.receipts
    where portal_id=v_portal and ticket_id=v_ticket for update;
  if found then
    if v_receipt.first_payload is distinct from p_ticket then
      update cos_mhelp_intake.receipts set reason_codes=array['source_changed_review_required'],review_required=true
        where portal_id=v_portal and ticket_id=v_ticket;
      return jsonb_build_object('state','review_needed','reasonCodes',array['source_changed_review_required'],
        'assignmentIds',v_receipt.assignment_ids,'notifications',false);
    end if;
    if v_receipt.state='created' then
      -- No lookup by current assignee/status; never recreate claimed, completed,
      -- cancelled, manually edited, or even missing local work on replay.
      return jsonb_build_object('state','existing','assignmentIds',v_receipt.assignment_ids,'reviewRequired',v_receipt.review_required,'reasonCodes',v_receipt.reason_codes,'notifications',false);
    end if;
  end if;

  select * into v_config from cos_mhelp_intake.portal_config where portal_id=v_portal for share;
  if not found or not v_config.enabled then
    return jsonb_build_object('state','disabled','reasonCodes',array['intake_disabled'],'notifications',false);
  end if;
  if v_created < v_config.activated_at then
    return jsonb_build_object('state','excluded','reasonCodes',array['before_activation'],'notifications',false);
  end if;
  if v_created>clock_timestamp() then v_reasons:=array_append(v_reasons,'source_creation_in_future'); end if;
  if p_ticket->>'schemaContract' is distinct from v_config.schema_contract then
    v_reasons:=array_append(v_reasons,'source_schema_unverified'); end if;
  if v_config.review_actor='owner' and not exists(select 1 from public.profiles where user_id=v_config.reviewed_by and active and archived_at is null and role::text='owner') then
    v_reasons:=array_append(v_reasons,'configuration_reviewer_inactive'); end if;
  if v_source->'deleted' is distinct from 'false'::jsonb or nullif(btrim(v_source->>'statusId'),'') is null
    or jsonb_typeof(v_source->'statusId') is distinct from 'string' or length(v_source->>'statusId')>128
    or not(v_source ? 'customStatusId')
    or (v_source->'customStatusId'<>'null'::jsonb and (jsonb_typeof(v_source->'customStatusId') is distinct from 'string'
      or length(btrim(v_source->>'customStatusId')) not between 1 and 128)) then v_reasons:=array_append(v_reasons,'source_status_incomplete_or_deleted'); end if;

  select * into v_status from cos_mhelp_intake.source_status_policies
    where portal_id=v_portal and status_id=v_source->>'statusId'
      and custom_status_id=coalesce(v_source->>'customStatusId','') and enabled for share;
  if not found then v_reasons:=array_append(v_reasons,'source_status_unreviewed');
  elsif v_status.review_actor='owner' and not exists(select 1 from public.profiles where user_id=v_status.reviewed_by and active and archived_at is null and role::text='owner') then
    v_reasons:=array_append(v_reasons,'source_status_reviewer_inactive');
  elsif v_status.classification='terminal' then v_reasons:=array_append(v_reasons,'source_status_terminal');
  elsif v_status.classification<>'open' then v_reasons:=array_append(v_reasons,'source_status_review_required');
  end if;

  select * into v_mapping from cos_mhelp_intake.type_mappings
    where portal_id=v_portal and type_id=v_source->>'typeId' and enabled for share;
  if not found then v_reasons:=array_append(v_reasons,'type_mapping_unverified');
  else
    v_work:=v_mapping.work_type;
    if v_mapping.review_actor='owner' and not exists(select 1 from public.profiles where user_id=v_mapping.reviewed_by and active and archived_at is null and role::text='owner') then
      v_reasons:=array_append(v_reasons,'type_mapping_reviewer_inactive'); end if;
  end if;

  -- Repeat the planner's write-boundary checks. Complete zero scope must be
  -- explicit; absent quantities/manifest are never interpreted as no equipment.
  begin
    if jsonb_typeof(v_request) is distinct from 'object' or v_request->>'ticket_no' is distinct from v_number
      or v_request->>'work_type' is distinct from v_work
      or jsonb_typeof(v_request->'equipment_manifest') is distinct from 'array'
      or jsonb_array_length(v_request->'equipment_manifest')>100
      or jsonb_typeof(v_request->'targets') is distinct from 'array'
      or jsonb_typeof(p_ticket->'departmentAssignments') is distinct from 'array'
      or jsonb_array_length(p_ticket->'departmentAssignments')>2
      or jsonb_typeof(v_request->'site') is distinct from 'string'
      or jsonb_typeof(v_request->'job_description') is distinct from 'string'
      or length(btrim(coalesce(v_request->>'site',''))) not between 1 and 500
      or length(btrim(coalesce(v_request->>'job_description',''))) not between 1 and 10000
      or jsonb_typeof(v_request->'notes') is distinct from 'string' or length(v_request->>'notes')>10000
      or jsonb_typeof(v_request->'unit_summary') is distinct from 'string' or length(v_request->>'unit_summary')>2000
      or coalesce(v_request->>'scheduled_for','') !~ '^\d{4}-\d{2}-\d{2}$'
      or not(v_request ? 'scheduled_time')
      or (v_request->'scheduled_time'<>'null'::jsonb and coalesce(v_request->>'scheduled_time','') !~ '^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$')
    then raise exception 'invalid request'; end if;
    perform (v_request->>'scheduled_for')::date;
    if p_ticket#>'{sourceEvidence,complete}' is distinct from 'true'::jsonb then raise exception 'incomplete source scope'; end if;
    foreach v_key in array array['equipment','parts','site','description','schedule'] loop
      if jsonb_typeof(p_ticket->'sourceEvidence'->v_key) is distinct from 'string'
        or length(btrim(p_ticket->'sourceEvidence'->>v_key)) not between 1 and 1000 then raise exception 'missing source evidence'; end if;
    end loop;
    foreach v_key in array array['solar_panel_qty','battery_replacement_qty','camera_replacement_qty','sim_replacement_qty','micro_sd_qty'] loop
      if jsonb_typeof(v_request->v_key) is distinct from 'number' or (v_request->>v_key) !~ '^\d+$'
        or (v_request->>v_key)::numeric>1000000 then raise exception 'invalid quantity'; end if;
      v_has_prep:=v_has_prep or (v_request->>v_key)::integer>0;
    end loop;
    for v_item in select value from jsonb_array_elements(v_request->'equipment_manifest') loop
      if jsonb_typeof(v_item) is distinct from 'object' or jsonb_typeof(v_item->'qty') is distinct from 'number'
        or (v_item->>'qty') !~ '^[1-9]\d*$' or (v_item->>'qty')::numeric>1000000
        or (v_item->>'label')=any(v_labels)
        or not ((v_item->>'category'='device' and v_item->>'label' in ('Sniper','Ranger','Helios','Solar Spotter','Spotter','Recon 2'))
          or (v_item->>'category'='stand' and v_item->>'label' in ('110V Stand','Solar Stand','Pole')))
        or v_item->>'label' is null or v_item->>'category' is null
      then raise exception 'invalid equipment'; end if;
      v_labels:=array_append(v_labels,v_item->>'label');
      if v_item->>'category'='device' then v_units:=v_units+(v_item->>'qty')::integer; end if;
      v_has_prep:=true;
    end loop;
    if v_request->'requested_unit_count' is distinct from to_jsonb(v_units)
      or (v_work<>'service' and cardinality(v_labels)=0)
      or (v_work='delivery' and 'Solar Spotter'=any(v_labels) and 'Solar Stand'=any(v_labels))
    then raise exception 'invalid equipment scope'; end if;
    v_roles:=case when v_work='pickup' then array['service','it']
      when v_work in ('delivery','swap') or (v_work='service' and v_has_prep) then array['it','service']
      else array['service'] end;
    if jsonb_array_length(v_request->'targets')<>cardinality(v_roles) then raise exception 'invalid route'; end if;
    for v_target in select value from jsonb_array_elements(v_request->'targets') loop
      v_n:=v_n+1; v_role:=v_roles[v_n];
      v_requires:=(v_role='service' and v_roles[1]='it');
      if v_target->>'role' is distinct from v_role
        or v_target->'requires_it_handoff' is distinct from to_jsonb(v_requires)
        or not(v_target ? 'assignee_user_id')
      then raise exception 'invalid target'; end if;
    end loop;
  exception when others then v_reasons:=array_append(v_reasons,'source_scope_or_route_invalid'); end;

  -- The lead is deliberate, exact, reviewed, and current. All categories require
  -- one so that imported tickets actually appear in the IT MHelp lead view.
  select * into v_crosswalk from cos_mhelp_intake.identity_crosswalk
    where portal_id=v_portal and source_identity=p_ticket#>>'{ticketLead,sourceIdentity}'
      and department='it' and enabled for share;
  if not found or length(btrim(coalesce(p_ticket#>>'{ticketLead,evidence}','')))=0 then
    v_reasons:=array_append(v_reasons,'ticket_lead_unverified');
  else
    select * into v_lead from public.profiles where user_id=v_crosswalk.legacy_user_id
      and active and archived_at is null and role::text='it' for share;
    if not found or (v_crosswalk.review_actor='owner' and not exists(select 1 from public.profiles where user_id=v_crosswalk.reviewed_by and active and archived_at is null and role::text='owner')) then
      v_reasons:=array_append(v_reasons,'ticket_lead_inactive_or_unverified'); end if;
  end if;

  -- Validate assignment facts globally and per routed department. A missing field
  -- is unknown. An explicit empty source assignment is the only queue authority.
  begin
    v_fact:=v_source->'assignment';
    if jsonb_typeof(v_fact) is distinct from 'object'
      or coalesce(v_fact->>'state','') not in ('assigned','unassigned')
      or jsonb_typeof(v_fact->'identities') is distinct from 'array'
      or jsonb_array_length(v_fact->'identities')<>(case when v_fact->>'state'='assigned' then 1 else 0 end)
      or length(btrim(coalesce(v_fact->>'evidence','')))=0 then raise exception 'unknown source assignment'; end if;
    for v_item in select value from jsonb_array_elements(p_ticket->'departmentAssignments') loop
      if coalesce(v_item->>'department','')<>all(v_roles) then raise exception 'unrouted department'; end if;
    end loop;
    for v_target in select value from jsonb_array_elements(v_request->'targets') loop
      v_role:=v_target->>'role';
      select count(*) into v_n from jsonb_array_elements(p_ticket->'departmentAssignments') d where d->>'department'=v_role;
      if v_n>1 then raise exception 'ambiguous department'; end if;
      if v_n=1 then select value into v_fact from jsonb_array_elements(p_ticket->'departmentAssignments') where value->>'department'=v_role;
      else v_fact:=v_source->'assignment'; end if;
      if coalesce(v_fact->>'state','') not in ('assigned','unassigned')
        or jsonb_typeof(v_fact->'identities') is distinct from 'array'
        or jsonb_array_length(v_fact->'identities')<>(case when v_fact->>'state'='assigned' then 1 else 0 end)
        or length(btrim(coalesce(v_fact->>'evidence','')))=0
        or (v_source#>>'{assignment,state}'='unassigned' and v_fact->>'state'='assigned')
      then raise exception 'unknown department assignment'; end if;
      v_assignee:=null;
      if v_fact->>'state'='unassigned' then
        if v_target->'assignee_user_id' is distinct from 'null'::jsonb then raise exception 'invented assignee'; end if;
      else
        v_source_identity:=v_fact#>>'{identities,0}';
        select * into v_crosswalk from cos_mhelp_intake.identity_crosswalk
          where portal_id=v_portal and source_identity=v_source_identity and department=v_role and enabled for share;
        -- Null is an unresolved projection ONLY for an explicit assigned fact.
        -- A supplied UUID is still an assertion and must match the private map.
        if not found or not(v_target ? 'assignee_user_id')
          or (v_target->'assignee_user_id'<>'null'::jsonb and (jsonb_typeof(v_target->'assignee_user_id') is distinct from 'string'
            or v_crosswalk.legacy_user_id is distinct from (v_target->>'assignee_user_id')::uuid))
          or (v_crosswalk.review_actor='owner' and not exists(select 1 from public.profiles where user_id=v_crosswalk.reviewed_by and active and archived_at is null and role::text='owner'))
        then raise exception 'unverified crosswalk'; end if;
        select * into v_profile from public.profiles where user_id=v_crosswalk.legacy_user_id
          and active and archived_at is null and role::text=v_role for share;
        if not found then raise exception 'inactive or wrong-role assignee'; end if;
        v_assignee:=v_crosswalk.legacy_user_id;
        v_seen_source_identities:=array_append(v_seen_source_identities,v_source_identity);
      end if;
      -- Inserts consume this separately verified projection, never caller IDs.
      v_resolved_targets:=v_resolved_targets||jsonb_build_array(jsonb_build_object(
        'role',v_role,'assignee_user_id',v_assignee,'requires_it_handoff',v_target->'requires_it_handoff'));
    end loop;
    if v_source#>>'{assignment,state}'='assigned' and not coalesce((v_source#>>'{assignment,identities,0}')=any(v_seen_source_identities),false) then
      raise exception 'global source assignee unrouted'; end if;
  exception when others then v_reasons:=array_append(v_reasons,'assignment_identity_unverified'); end;

  perform pg_advisory_xact_lock(hashtextextended('owner-assignment:'||v_number,0));
  -- Legacy direct v6/v8 callers do not all take the bundle advisory lock. This
  -- short table lock closes the otherwise-unprotected history-check/insert race.
  -- Existing workflows acquire these tables in other orders. NOWAIT ensures an
  -- occupied table aborts this intake (55P03), never waits in a lock-order cycle.
  -- Retry the whole source-key transaction after backoff; do not retry fragments.
  lock table public.job_assignments, public.prep_tickets, public.unit_returns in share row exclusive mode nowait;
  -- Includes every current/previous assignee and every status. Existing work is
  -- held for reconciliation, never silently adopted or overwritten.
  if exists(select 1 from public.job_assignments where btrim(ticket_no)=v_number)
    or exists(select 1 from public.prep_tickets where btrim(ticket_no)=v_number)
    or exists(select 1 from public.unit_returns where btrim(ticket_no)=v_number)
    or exists(select 1 from cos_mhelp_intake.receipts where ticket_number=v_number and state='created') then
    v_reasons:=array_append(v_reasons,'existing_ticket_requires_reconciliation');
  end if;
  if cardinality(v_reasons)>0 then
    insert into cos_mhelp_intake.receipts(portal_id,ticket_id,ticket_number,source_created_at,first_payload,state,reason_codes,review_required,received_by)
      values(v_portal,v_ticket,v_number,v_created,p_ticket,'review_needed',v_reasons,true,null)
      on conflict(portal_id,ticket_id) do update set reason_codes=excluded.reason_codes,review_required=true;
    return jsonb_build_object('state','review_needed','reasonCodes',v_reasons,'assignmentIds','[]'::jsonb,'notifications',false);
  end if;

  -- Do not call v6/v8/bundle: their notification side effects are not authorized.
  -- Direct inserts mirror verified column/default semantics. Existing triggers
  -- remain enabled. There is no UPDATE of any assignment, claim, prep, or return.
  for v_target in select value from jsonb_array_elements(v_resolved_targets) loop
    v_role:=v_target->>'role'; v_assignee:=(v_target->>'assignee_user_id')::uuid;
    if v_assignee is not null then select * into strict v_profile from public.profiles where user_id=v_assignee; end if;
    insert into public.job_assignments(
      ticket_no,site,assigned_role,assignee_user_id,assignee_name,assignment_scope,
      requested_unit_count,unit_summary,job_description,notes,assigned_by,assigned_by_name,
      solar_panel_qty,battery_replacement_qty,camera_replacement_qty,sim_replacement_qty,micro_sd_qty,
      equipment_manifest,requires_it_handoff,scheduled_for,scheduled_time,work_type,
      job_lead_user_id,job_lead_name,job_lead_role,created_from
    ) values (
      v_number,btrim(v_request->>'site'),v_role,v_assignee,
      case when v_assignee is null then case when v_role='it' then 'IT Department' else 'Service Department' end
        else coalesce(v_profile.full_name,v_profile.username,'Technician') end,
      case when v_assignee is null then 'department' else 'technician' end,
      v_units,nullif(btrim(v_request->>'unit_summary'),''),btrim(v_request->>'job_description'),nullif(btrim(v_request->>'notes'),''),
      null,'mHelpDesk automatic intake',
      (v_request->>'solar_panel_qty')::integer,(v_request->>'battery_replacement_qty')::integer,
      (v_request->>'camera_replacement_qty')::integer,(v_request->>'sim_replacement_qty')::integer,(v_request->>'micro_sd_qty')::integer,
      v_request->'equipment_manifest',(v_target->>'requires_it_handoff')::boolean,
      (v_request->>'scheduled_for')::date,(v_request->>'scheduled_time')::time,v_work,
      v_lead.user_id,coalesce(v_lead.full_name,v_lead.username,'Technician'),'it','mhelpdesk_service_intake'
    ) returning id into v_id;
    v_ids:=array_append(v_ids,v_id);
  end loop;
  insert into cos_mhelp_intake.receipts(portal_id,ticket_id,ticket_number,source_created_at,first_payload,state,assignment_ids,received_by,created_at)
    values(v_portal,v_ticket,v_number,v_created,p_ticket,'created',v_ids,null,now())
    on conflict(portal_id,ticket_id) do update set state='created',reason_codes='{}',review_required=false,assignment_ids=excluded.assignment_ids,created_at=excluded.created_at;
  return jsonb_build_object('state','created','assignmentIds',v_ids,'notifications',false);
end;
$function$;
revoke all on function cos_mhelp_intake.accept_ticket_v1(jsonb) from public, anon, authenticated, service_role;


create function cos_mhelp_intake.read_intake_policy_v1()
returns jsonb language plpgsql security invoker set search_path='' as $policy$
declare c cos_mhelp_intake.portal_config%rowtype; n integer; types_ok boolean; identities_ok boolean; statuses_ok boolean;
begin
  select count(*) into n from cos_mhelp_intake.portal_config where enabled;
  if n=0 then return jsonb_build_object('state','disabled'); end if;
  if n<>1 then raise exception 'MHELP_INTAKE_CONFIGURATION'; end if;
  select * into c from cos_mhelp_intake.portal_config where enabled;
  if c.review_actor='owner' and not exists(select 1 from public.profiles where user_id=c.reviewed_by and active and archived_at is null and role::text='owner') then
    return jsonb_build_object('state','review_needed'); end if;
  select count(distinct m.work_type)=4 and bool_and(m.review_actor='approved_service' or exists(
    select 1 from public.profiles p where p.user_id=m.reviewed_by and p.active and p.archived_at is null and p.role::text='owner'))
    into types_ok from cos_mhelp_intake.type_mappings m where m.portal_id=c.portal_id and m.enabled;
  select count(*)>0 and bool_or(m.department='it') and bool_and(exists(
    select 1 from public.profiles p where p.user_id=m.legacy_user_id and p.active and p.archived_at is null and p.role::text=m.department)
    and (m.review_actor='approved_service' or exists(select 1 from public.profiles p
      where p.user_id=m.reviewed_by and p.active and p.archived_at is null and p.role::text='owner')))
    into identities_ok from cos_mhelp_intake.identity_crosswalk m where m.portal_id=c.portal_id and m.enabled;
  select count(*)>0 and bool_or(m.classification='open') and bool_and(m.review_actor='approved_service' or exists(
    select 1 from public.profiles p where p.user_id=m.reviewed_by and p.active and p.archived_at is null and p.role::text='owner'))
    into statuses_ok from cos_mhelp_intake.source_status_policies m where m.portal_id=c.portal_id and m.enabled;
  return jsonb_build_object('state','ready','portalId',c.portal_id,
    'activationFloor',to_char(c.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'schemaContract',c.schema_contract,'schemaEvidence',c.schema_evidence,
    'typeMappingsVerified',coalesce(types_ok,false),'identityMappingsVerified',coalesce(identities_ok,false),'statusPoliciesVerified',coalesce(statuses_ok,false));
end;
$policy$;
revoke all on function cos_mhelp_intake.read_intake_policy_v1() from public,anon,authenticated,service_role;


-- Bounded aggregate projection for the existing authenticated Owner application.
-- Service transport must enforce the Owner gate before returning this DTO.
create function cos_mhelp_intake.read_review_status_v1()
returns jsonb language plpgsql security invoker set search_path='' as $review$
declare pending integer; created integer; held jsonb; s record;
begin
  select count(*) filter(where review_required)::integer,count(*) filter(where state='created')::integer
    into pending,created from cos_mhelp_intake.receipts;
  select coalesce(jsonb_agg(jsonb_build_object('ticketNumber',r.ticket_number,'reasonCodes',to_jsonb(r.reason_codes))
    order by r.received_at,r.ticket_id,r.portal_id),'[]'::jsonb) into held
    from (select ticket_number,reason_codes,received_at,ticket_id,portal_id from cos_mhelp_intake.receipts
      where review_required order by received_at,ticket_id,portal_id limit 25) r;
  select null::timestamptz as last_attempt_at,null::timestamptz as last_success_at,0::integer as failure_count,
    null::timestamptz as retry_after,null::text as last_error_code into s;
  if to_regclass('cos_mhelp_intake.scheduler_state') is not null then
    select last_attempt_at,last_success_at,failure_count,retry_after,last_error_code into s
      from cos_mhelp_intake.scheduler_state order by last_attempt_at desc nulls last,portal_id limit 1;
  end if;
  return jsonb_build_object('contract','cos-mhelp-intake-review-v1',
    'enabled',exists(select 1 from cos_mhelp_intake.portal_config where enabled),
    'activationAt',(select to_char(activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from cos_mhelp_intake.portal_config order by enabled desc,portal_id limit 1),
    'pendingReviewCount',pending,'createdCount',created,'held',held,'heldTruncated',pending>25,
    'lastAttemptAt',to_char(s.last_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastSuccessAt',to_char(s.last_success_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'failureCount',coalesce(s.failure_count,0),
    'retryAfter',to_char(s.retry_after at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastErrorCode',s.last_error_code);
end;
$review$;
revoke all on function cos_mhelp_intake.read_review_status_v1() from public,anon,authenticated,service_role;

-- This is the only exposed addition authorized by the service-access approval.
-- Scheduler helpers are installed from the separate scheduler proposal before use.
create function public.camera_mhelp_ticket_intake_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='2s' as $rpc$
declare v_action text:=p_request->>'action'; v_window jsonb; v_created timestamptz;
begin
  if coalesce(current_setting('role',true),'')<>'service_role' or auth.uid() is not null then
    raise exception 'MHELP_INTAKE_SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>120000 then
    raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
  if v_action='review_status' then
    if p_request<>jsonb_build_object('action','review_status') then raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
    return cos_mhelp_intake.read_review_status_v1();
  elsif v_action='policy' then
    if p_request<>jsonb_build_object('action','policy') then raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
    return cos_mhelp_intake.read_intake_policy_v1();
  elsif v_action='begin' then
    if p_request<>jsonb_build_object('action','begin') then raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
    return cos_mhelp_intake.begin_intake_v1();
  elsif v_action='record' then
    if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['action','leaseId','ticket']))
      or nullif(p_request->>'leaseId','') is null then raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
    v_window:=cos_mhelp_intake.validate_intake_lease_v1((p_request->>'leaseId')::uuid);
    if coalesce(p_request#>>'{ticket,source,createdAt}','') !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?Z$' then
      raise exception 'MHELP_INTAKE_INVALID_SOURCE'; end if;
    begin v_created:=(p_request#>>'{ticket,source,createdAt}')::timestamptz;
    exception when others then raise exception 'MHELP_INTAKE_INVALID_SOURCE'; end;
    if jsonb_typeof(v_window) is distinct from 'object' or v_window->>'portalId' is null
      or v_window->>'createdAfter' is null or v_window->>'createdBefore' is null
      or p_request#>>'{ticket,source,portalId}' is distinct from v_window->>'portalId'
      or v_created is null or v_created<=(v_window->>'createdAfter')::timestamptz
      or v_created>=(v_window->>'createdBefore')::timestamptz then raise exception 'MHELP_INTAKE_OUTSIDE_LEASE'; end if;
    return cos_mhelp_intake.accept_ticket_v1(p_request->'ticket');
  elsif v_action='finish' then
    if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['action','leaseId','expectedTicketIds','total'])) then
      raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
    return cos_mhelp_intake.finish_intake_v1((p_request->>'leaseId')::uuid,p_request->'expectedTicketIds',(p_request->>'total')::integer);
  elsif v_action='fail' then
    if exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array['action','leaseId','code','retryable'])) then
      raise exception 'MHELP_INTAKE_INVALID_REQUEST'; end if;
    return cos_mhelp_intake.fail_intake_v1((p_request->>'leaseId')::uuid,p_request->>'code',(p_request->>'retryable')::boolean);
  end if;
  raise exception 'MHELP_INTAKE_INVALID_REQUEST';
end;
$rpc$;
revoke all on function public.camera_mhelp_ticket_intake_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.camera_mhelp_ticket_intake_v1(jsonb) to service_role;

commit;
