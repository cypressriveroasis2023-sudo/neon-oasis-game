-- LOCAL FORWARD-UPGRADE PROPOSAL ONLY. Target: legacy Tech Check, never native.
-- Apply AFTER the original base/scheduler definitions, with intake disabled and
-- no live lease. Do not rerun the original CREATE TABLE script on an installed DB.
-- This creates no policy/person/configuration rows and changes no public grants.
-- The current production source-adapter registry remains empty.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $preflight$ begin
  if current_user<>'postgres' then raise exception 'MHELP_INTAKE_DEPLOYMENT_ROLE'; end if;
  if to_regprocedure('cos_mhelp_intake.accept_ticket_v1(jsonb)') is null
    or to_regprocedure('public.camera_mhelp_ticket_intake_v1(jsonb)') is null then
    raise exception 'MHELP_INTAKE_BASE_REQUIRED'; end if;
  if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid='cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure and r.rolname='postgres' and not p.prosecdef)
    then raise exception 'MHELP_INTAKE_DEPLOYMENT_ROLE'; end if;
  -- Refuse to overwrite a newer or unexpectedly edited acceptance contract.
  -- Hash is the exact original base function body (prosrc), not pretty-printed DDL.
  if (select md5(prosrc) from pg_proc where oid='cos_mhelp_intake.accept_ticket_v1(jsonb)'::regprocedure)
    is distinct from 'a82b4b83d707b22665c7593c4b5812fe' then raise exception 'MHELP_INTAKE_BASE_DRIFT'; end if;
  -- Freeze activation while checking and installing the new private contract.
  lock table cos_mhelp_intake.portal_config in share mode;
  if exists(select 1 from cos_mhelp_intake.portal_config where enabled) then
    raise exception 'MHELP_INTAKE_DISABLE_BEFORE_UPGRADE'; end if;
  if to_regclass('cos_mhelp_intake.scheduler_state') is not null then
    lock table cos_mhelp_intake.scheduler_state in share mode;
    if exists(select 1 from cos_mhelp_intake.scheduler_state where lease_until>clock_timestamp()) then
      raise exception 'MHELP_INTAKE_LIVE_LEASE'; end if;
  end if;
end $preflight$;

-- One policy per portal makes multiple enabled local selections impossible.
-- Profile existence, active/unarchived state, exact IT role, and Owner reviewer
-- authority are rechecked under row locks at every first-creation boundary.
create table cos_mhelp_intake.ticket_lead_policies (
  portal_id text primary key references cos_mhelp_intake.portal_config(portal_id),
  policy text not null default 'reviewed_local_unassigned_v1'
    check (policy='reviewed_local_unassigned_v1'),
  legacy_user_id uuid not null,
  enabled boolean not null default false,
  evidence text not null check (length(btrim(evidence)) between 1 and 1000 and evidence !~ '[[:cntrl:]]'),
  reviewed_by uuid,
  review_actor text not null default 'owner' check (review_actor in ('owner','approved_service')),
  approval_reference text check (length(btrim(approval_reference)) between 1 and 1000 and approval_reference !~ '[[:cntrl:]]'),
  reviewed_at timestamptz not null check (isfinite(reviewed_at)),
  check ((review_actor='owner' and reviewed_by is not null)
    or (review_actor='approved_service' and reviewed_by is null and approval_reference is not null))
);
alter table cos_mhelp_intake.ticket_lead_policies enable row level security;
revoke all on cos_mhelp_intake.ticket_lead_policies from public,anon,authenticated,service_role;

-- Nullable for historical and held receipts: never invent a past selection.
alter table cos_mhelp_intake.receipts add column ticket_lead_resolution jsonb
  check (ticket_lead_resolution is null or jsonb_typeof(ticket_lead_resolution)='object');

create or replace function cos_mhelp_intake.accept_ticket_v1(p_ticket jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_profile public.profiles%rowtype;
  v_lead public.profiles%rowtype;
  v_config cos_mhelp_intake.portal_config%rowtype;
  v_receipt cos_mhelp_intake.receipts%rowtype;
  v_mapping cos_mhelp_intake.type_mappings%rowtype;
  v_status cos_mhelp_intake.source_status_policies%rowtype;
  v_crosswalk cos_mhelp_intake.identity_crosswalk%rowtype;
  v_lead_policy cos_mhelp_intake.ticket_lead_policies%rowtype;
  v_lead_resolution jsonb;
  v_source jsonb := p_ticket->'source';
  -- JSON null denotes an incomplete projection, not an untrusted scalar body.
  -- Normalize only this validation view; retain p_ticket unchanged in receipts.
  v_request jsonb := nullif(p_ticket->'request','null'::jsonb);
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
      or exists(select 1 from jsonb_object_keys(p_ticket->'ticketLead') k where k<>all(array['sourceIdentity','evidence','policy']))
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
    -- Local policy selection is one fixed marker, never a caller-selected UUID,
    -- source identity, or fabricated source evidence. Mixed modes reject before retention.
    if (p_ticket->'ticketLead') ? 'policy' and p_ticket->'ticketLead' is distinct from
      jsonb_build_object('policy','reviewed_local_unassigned_v1') then raise exception 'invalid local lead policy marker'; end if;
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
    -- Once a never-created source changed, even the old envelope must remain
    -- held until explicit reconciliation. Mapping repair alone is insufficient.
    if v_receipt.state='review_needed' and 'source_changed_review_required'=any(v_receipt.reason_codes) then
      return jsonb_build_object('state','review_needed','reasonCodes',v_receipt.reason_codes,
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

  -- A local lead policy is deliberate business ownership, not a vendor identity.
  -- It may only cover explicitly unassigned work; source-explicit lead selection
  -- retains the exact same-person crosswalk path. No fallback between these modes.
  if p_ticket#>>'{ticketLead,policy}'='reviewed_local_unassigned_v1' then
    if v_source#>>'{assignment,state}' is distinct from 'unassigned'
      or v_source#>'{assignment,identities}' is distinct from '[]'::jsonb
      or exists(select 1 from jsonb_array_elements(p_ticket->'departmentAssignments') d
        where d->>'state' is distinct from 'unassigned' or d->'identities' is distinct from '[]'::jsonb) then
      v_reasons:=array_append(v_reasons,'ticket_lead_policy_conflict');
    end if;
    select * into v_lead_policy from cos_mhelp_intake.ticket_lead_policies
      where portal_id=v_portal and enabled for share;
    if not found or v_lead_policy.reviewed_at>clock_timestamp() then
      v_reasons:=array_append(v_reasons,'ticket_lead_unverified');
    else
      select * into v_lead from public.profiles where user_id=v_lead_policy.legacy_user_id
        and active and archived_at is null and role::text='it' for share;
      if not found then v_reasons:=array_append(v_reasons,'ticket_lead_inactive_or_unverified'); end if;
      if v_lead_policy.review_actor='owner' then
        perform 1 from public.profiles where user_id=v_lead_policy.reviewed_by
          and active and archived_at is null and role::text='owner' for share;
        if not found then v_reasons:=array_append(v_reasons,'ticket_lead_inactive_or_unverified'); end if;
      end if;
      -- Private immutable creation provenance. It is never sent to the native
      -- source reader or backfilled for receipts created before this upgrade.
      v_lead_resolution:=jsonb_build_object('mode','reviewed_local_unassigned_v1',
        'legacy_user_id',v_lead_policy.legacy_user_id,'evidence',v_lead_policy.evidence,
        'review_actor',v_lead_policy.review_actor,'reviewed_by',v_lead_policy.reviewed_by,
        'approval_reference',v_lead_policy.approval_reference,'reviewed_at',v_lead_policy.reviewed_at);
    end if;
  else
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
      v_lead_resolution:=jsonb_build_object('mode','source_crosswalk','legacy_user_id',v_crosswalk.legacy_user_id,
        'source_identity',v_crosswalk.source_identity,'source_evidence',p_ticket#>>'{ticketLead,evidence}',
        'evidence',v_crosswalk.evidence,'review_actor',v_crosswalk.review_actor,'reviewed_by',v_crosswalk.reviewed_by,
        'approval_reference',v_crosswalk.approval_reference,'reviewed_at',v_crosswalk.reviewed_at);
    end if;
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
  insert into cos_mhelp_intake.receipts(portal_id,ticket_id,ticket_number,source_created_at,first_payload,state,assignment_ids,received_by,created_at,ticket_lead_resolution)
    values(v_portal,v_ticket,v_number,v_created,p_ticket,'created',v_ids,null,now(),v_lead_resolution)
    on conflict(portal_id,ticket_id) do update set state='created',reason_codes='{}',review_required=false,assignment_ids=excluded.assignment_ids,created_at=excluded.created_at,ticket_lead_resolution=excluded.ticket_lead_resolution;
  return jsonb_build_object('state','created','assignmentIds',v_ids,'notifications',false);
end;
$function$;
revoke all on function cos_mhelp_intake.accept_ticket_v1(jsonb) from public, anon, authenticated, service_role;

commit;
