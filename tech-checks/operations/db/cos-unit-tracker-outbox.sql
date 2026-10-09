-- REVIEW ARTIFACT: native project only. Requires existing typed source V2
-- artifacts and existing appdeploy actor/role functions. No live apply.
-- Default OFF. A separate reviewed activation may enable pending requests only.
-- No source/fleet writes, no Google credentials/transport, no publisher, no new
-- role, account or schema USAGE. Every receipt is awaiting Sheets connection.
begin;
create table app_private.cos_unit_tracker_rollout (
 organization_id uuid primary key check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 queue_enabled boolean not null default false,
 workbook_id text not null default '1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA'
  check(workbook_id='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA')
);
insert into app_private.cos_unit_tracker_rollout(organization_id) values('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5');
create table app_private.cos_unit_tracker_requests (
 request_id uuid primary key,
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 workbook_id text not null check(workbook_id='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA'),
 kind text not null check(kind in ('add','update')),
 status text not null default 'awaiting_sheets_connection' check(status='awaiting_sheets_connection'),
 native_unit_id uuid, expected_source_revision uuid, source_record_id text,
 family text not null,full_variant text not null,unit_label text not null,
 request_payload jsonb not null,changes jsonb not null,before_value jsonb,proposed_value jsonb not null,
 actor_user_id uuid not null,actor_role text not null check(actor_role in ('owner','it')),
 created_at timestamptz not null default clock_timestamp(),
 check((kind='add' and native_unit_id is null and expected_source_revision is null and source_record_id is null and before_value is null)
  or(kind='update' and native_unit_id is not null and expected_source_revision is not null and source_record_id is not null and before_value is not null))
);
-- No ambiguous concurrent pending proposals for the same exact source row.
create unique index cos_unit_tracker_pending_unit on app_private.cos_unit_tracker_requests(organization_id,native_unit_id) where kind='update';
-- Case folding is duplicate rejection only, never a binding or source-row match.
create unique index cos_unit_tracker_pending_add on app_private.cos_unit_tracker_requests(organization_id,lower(full_variant),lower(unit_label)) where kind='add';
create index cos_unit_tracker_requests_recent on app_private.cos_unit_tracker_requests(organization_id,created_at desc,request_id);
alter table app_private.cos_unit_tracker_rollout enable row level security;
alter table app_private.cos_unit_tracker_requests enable row level security;
revoke all on app_private.cos_unit_tracker_rollout,app_private.cos_unit_tracker_requests from public,anon,authenticated,service_role;
create function app_private.cos_unit_tracker_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Pending tracker requests are immutable.' using errcode='42501';end $$;
create trigger cos_unit_tracker_requests_immutable before update or delete or truncate on app_private.cos_unit_tracker_requests
 for each statement execute function app_private.cos_unit_tracker_immutable();

create function app_private.cos_unit_tracker_assert_actor(p_actor uuid,p_org uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
 if current_setting('role',true) is distinct from 'service_role'
  or p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Tracker service access required.' using errcode='42501';end if;
 perform app_private.appdeploy_assume_actor(p_actor,p_org);
 if app_private.has_permission(p_org,'equipment.view') is distinct from true then raise exception 'Existing equipment view permission required.' using errcode='42501';end if;
 select p.department into v_role from public.user_profiles p
 join public.user_roles ur on ur.user_id=p.user_id join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id
 where p.user_id=p_actor and p.organization_id=p_org and p.active
 and ((p_actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1'::uuid and p.department='owner' and r.code='owner')
  or(p_actor in ('d0757b64-9623-4adc-afff-21cc7853e88a'::uuid,'3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid) and p.department='it' and r.code='it_technician')) limit 1;
 if v_role is null then raise exception 'Existing Owner or verified IT account required.' using errcode='42501';end if;
 return v_role;
end $$;
create function app_private.cos_unit_tracker_text(p_text text,p_max integer)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(length(p_text) between 1 and p_max and p_text=btrim(p_text)
  and p_text!~'[[:cntrl:]<>@=]' and p_text!~'^[+-]'
  and p_text!~*'https?:|password|passwd|passcode|lockbox|\mpwd\M|\mpin\M|token|secret|credential|\m(call|phone|mobile|email|contact|tel)\M|gate[[:space:]-]*code|access[[:space:]-]*code|\m[0-9]{1,3}(\.[0-9]{1,3}){3}\M|\m[0-9]{3}[ .-]?[0-9]{3}[ .-]?[0-9]{4}\M',false)
$$;
create function app_private.cos_unit_tracker_fields(p_fields jsonb,p_full boolean default false)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;m integer;
begin
 if jsonb_typeof(p_fields) is distinct from 'object' or p_fields='{}'::jsonb
  or (p_fields-array['placement','street','city','state','zip','siteLabel','customerLabel'])<>'{}'::jsonb then return false;end if;
 if p_full and not(p_fields ?& array['placement','street','city','state','zip','siteLabel','customerLabel']) then return false;end if;
 for k,v in select key,value from jsonb_each(p_fields) loop
  if k='placement' then if v not in ('"FIELD"','"SHOP"','"INACTIVE"') then return false;end if;
  elsif v<>'null'::jsonb then
   m:=case k when 'street' then 300 when 'city' then 120 when 'state' then 2 when 'zip' then 10 else 250 end;
   if jsonb_typeof(v)<>'string' or not app_private.cos_unit_tracker_text(p_fields->>k,m)
    or(k='state' and (p_fields->>k)!~'^[A-Z]{2}$') or(k='zip' and (p_fields->>k)!~'^[0-9]{5}(-[0-9]{4})?$') then return false;end if;
  end if;
 end loop;return true;
end $$;
create function app_private.cos_unit_tracker_identity(p_identity jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_identity)='object' and(p_identity-array['family','fullVariant','unitLabel'])='{}'::jsonb
  and p_identity ?& array['family','fullVariant','unitLabel']
  and jsonb_typeof(p_identity->'family')='string' and jsonb_typeof(p_identity->'fullVariant')='string' and jsonb_typeof(p_identity->'unitLabel')='string'
  and app_private.cos_unit_tracker_text(p_identity->>'family',160) and app_private.cos_unit_tracker_text(p_identity->>'fullVariant',160)
  and(p_identity->>'family')~'^[A-Za-z][A-Za-z0-9 ._&/-]{0,159}$' and(p_identity->>'fullVariant')~'^[A-Za-z][A-Za-z0-9 ._-]{0,159}$'
  and app_private.cos_unit_tracker_text(p_identity->>'unitLabel',40) and(p_identity->>'unitLabel')~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$',false)
$$;
create function app_private.cos_unit_tracker_source_value(p app_private.cos_geocode_sources)
returns jsonb language plpgsql stable set search_path='' as $$
declare t app_private.vision_tracker_locations;i jsonb;f jsonb;full_id text;
begin
 if p.organization_id<>'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid or p.source_system<>'google_sheet_tracker'
  or p.entity_kind<>'tracker' or not p.active or p.native_unit_id<>p.tracker_id
  or p.source_provenance->>'sheetId' is distinct from '1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA'
  or p.native_guard_sha256 is distinct from app_private.cos_source_native_guard(p.entity_kind,p.native_unit_id,p.tracker_id,p.unit_number,p.tracker_unit_number) then return null;end if;
 select * into t from app_private.vision_tracker_locations where id=p.tracker_id and organization_id=p.organization_id;
 if not found then return null;end if;
 full_id:=p.source_provenance->>'fullIdentity';
 if p.source_record_id is distinct from concat('google_sheet:',p.source_provenance->>'sheetId',':',p.source_provenance->>'tabId',':',full_id)
  or p.family is distinct from split_part(full_id,'|',1) or p.unit_number is distinct from replace(full_id,'|',' ')
  or (p.variant is not null and p.variant is distinct from split_part(full_id,'|',1)) then return null;end if;
 i:=jsonb_build_object('family',t.family,'fullVariant',split_part(full_id,'|',1),'unitLabel',split_part(full_id,'|',2));
 f:=jsonb_build_object('placement',p.source_placement,'street',p.street,'city',p.city,'state',p.state,'zip',p.zip,'siteLabel',p.site_label,'customerLabel',p.source_customer_label);
 -- Unsafe or incomplete source cells cannot be reclassified as blank editable cells.
 if not app_private.cos_unit_tracker_identity(i) or not app_private.cos_unit_tracker_fields(f,true) then return null;end if;
 return i||jsonb_build_object('unitId',p.native_unit_id,'sourceRevision',p.source_revision,
  'sourceIdentity',jsonb_build_object('sourceSystem','google_sheet_tracker','sourceRecordId',p.source_record_id),'fields',f,
  'pendingRequestId',(select r.request_id from app_private.cos_unit_tracker_requests r
   where r.organization_id=p.organization_id and r.native_unit_id=p.native_unit_id and r.kind='update'));
end $$;
create function app_private.cos_unit_tracker_receipt(p app_private.cos_unit_tracker_requests)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('requestId',p.request_id,'kind',p.kind,'status',p.status,'createdAt',p.created_at,
 'identity',jsonb_build_object('unitId',p.native_unit_id,'family',p.family,'fullVariant',p.full_variant,'unitLabel',p.unit_label,'sourceRecordId',p.source_record_id),
 'expectedSourceRevision',p.expected_source_revision,'changes',p.changes,'before',p.before_value,'proposed',p.proposed_value)
$$;
create function app_private.cos_unit_tracker_capability(p_org uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('contract','COS_UNIT_TRACKER_OUTBOX_V1','workbookId','1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',
  'queueEnabled',coalesce((select queue_enabled from app_private.cos_unit_tracker_rollout where organization_id=p_org),false),
  'connector',jsonb_build_object('enabled',false,'state','awaiting_sheets_connection'))
$$;
create function public.cos_unit_tracker_snapshot(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sources jsonb;requests jsonb;source_count bigint;request_count bigint;
begin
 perform app_private.cos_unit_tracker_assert_actor(p_actor_user_id,p_organization_id);
 select coalesce(jsonb_agg(x.value order by x.id) filter(where x.n<=2000),'[]'),count(*) into sources,source_count from
  (select s.native_unit_id id,app_private.cos_unit_tracker_source_value(s) value,row_number() over(order by s.native_unit_id) n
   from app_private.cos_geocode_sources s where s.organization_id=p_organization_id and s.source_system='google_sheet_tracker'
    and s.source_provenance->>'sheetId'='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA' and s.active) x;
 -- Rejected source cells are explicitly counted, never presented as empty editable data.
 select coalesce(jsonb_agg(x.value order by x.created_at desc,x.request_id) filter(where x.n<=100),'[]'),count(*) into requests,request_count from
  (select r.created_at,r.request_id,app_private.cos_unit_tracker_receipt(r) value,row_number() over(order by r.created_at desc,r.request_id) n
   from app_private.cos_unit_tracker_requests r where r.organization_id=p_organization_id) x;
 return app_private.cos_unit_tracker_capability(p_organization_id)||jsonb_build_object('sources',
  (select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(sources) where value<>'null'::jsonb),
  'requests',requests,'sourcesTruncated',source_count>2000,'requestsTruncated',request_count>100,
  'sourcesHeld',(select count(*) from jsonb_array_elements(sources) where value='null'::jsonb));
end $$;
create function public.cos_unit_tracker_read(p_actor_user_id uuid,p_organization_id uuid,p_native_unit_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 perform app_private.cos_unit_tracker_assert_actor(p_actor_user_id,p_organization_id);
 select app_private.cos_unit_tracker_source_value(s) into v from app_private.cos_geocode_sources s
  where s.native_unit_id=p_native_unit_id and s.organization_id=p_organization_id;
 if v is null then raise exception 'Exact current-workbook source is unavailable or needs review.' using errcode='40001';end if;
 -- Selected-row history is resolved independently of the bounded recent list.
 return app_private.cos_unit_tracker_capability(p_organization_id)||v||jsonb_build_object('pendingRequest',
  (select app_private.cos_unit_tracker_receipt(r) from app_private.cos_unit_tracker_requests r
   where r.organization_id=p_organization_id and r.native_unit_id=p_native_unit_id and r.kind='update'));
end $$;
create function public.cos_unit_tracker_request_read(p_actor_user_id uuid,p_organization_id uuid,p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.cos_unit_tracker_requests;
begin
 perform app_private.cos_unit_tracker_assert_actor(p_actor_user_id,p_organization_id);
 if p_request_id is null then raise exception 'Exact request identifier required.' using errcode='22023';end if;
 select * into r from app_private.cos_unit_tracker_requests where request_id=p_request_id and organization_id=p_organization_id;
 return jsonb_build_object('request',case when r.request_id is null then null else app_private.cos_unit_tracker_receipt(r) end,
  'ownedByCurrentActor',coalesce(r.actor_user_id=p_actor_user_id,false),'connector',jsonb_build_object('enabled',false,'state','awaiting_sheets_connection'));
end $$;
create function public.cos_unit_tracker_enqueue(p_actor_user_id uuid,p_organization_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text;request_id_value uuid;unit_id uuid;s app_private.cos_geocode_sources;r app_private.cos_unit_tracker_requests;
 i jsonb;v jsonb;before_fields jsonb;proposed jsonb;changes_value jsonb;enabled boolean;
begin
 if current_setting('transaction_isolation') is distinct from 'read committed' then raise exception 'Tracker saves require a fresh read-committed snapshot.' using errcode='40001';end if;
 role_name:=app_private.cos_unit_tracker_assert_actor(p_actor_user_id,p_organization_id);
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>8192
  or coalesce(p_request->>'requestId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or coalesce(p_request->>'kind','') not in ('add','update') or not app_private.cos_unit_tracker_fields(p_request->'changes') then
  raise exception 'Invalid bounded tracker request.' using errcode='22023';end if;
 request_id_value:=(p_request->>'requestId')::uuid;changes_value:=p_request->'changes';
 if p_request->>'kind'='add' then
  if(p_request-array['requestId','kind','identity','changes'])<>'{}'::jsonb or not app_private.cos_unit_tracker_identity(p_request->'identity')
   or not(changes_value?'placement') then raise exception 'Exact add identity and placement required.' using errcode='22023';end if;
  i:=p_request->'identity';
 else
  if(p_request-array['requestId','kind','unitId','expectedSourceRevision','changes'])<>'{}'::jsonb
   or coalesce(p_request->>'unitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(p_request->>'expectedSourceRevision','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   raise exception 'Exact unit and source revision required.' using errcode='22023';end if;
  unit_id:=(p_request->>'unitId')::uuid;
 end if;
 -- Idempotence lock first; original source rows are never used as a queue.
 perform pg_advisory_xact_lock(hashtextextended(request_id_value::text,271009));
 -- Pin existing authorization and rollout after waiting; a revoked actor cannot
 -- create a request merely because it passed an earlier check.
 perform p.user_id from public.user_profiles p join public.user_roles ur on ur.user_id=p.user_id
  join public.roles rr on rr.id=ur.role_id and rr.organization_id=p.organization_id
  where p.user_id=p_actor_user_id and p.organization_id=p_organization_id for share of p,ur,rr nowait;
 select queue_enabled into enabled from app_private.cos_unit_tracker_rollout where organization_id=p_organization_id for share nowait;
 role_name:=app_private.cos_unit_tracker_assert_actor(p_actor_user_id,p_organization_id);
 -- A retry returns its original immutable receipt, even if source changed or the
 -- queue was subsequently disabled. It never creates another request.
 select * into r from app_private.cos_unit_tracker_requests where request_id=request_id_value;
 if found then
  if r.actor_user_id<>p_actor_user_id or r.organization_id<>p_organization_id or r.request_payload is distinct from p_request then
   raise exception 'Tracker request identifier was reused with a different payload or actor.' using errcode='40001';end if;
  return jsonb_build_object('created',false,'request',app_private.cos_unit_tracker_receipt(r),'ownedByCurrentActor',true,'connector',jsonb_build_object('enabled',false,'state','awaiting_sheets_connection'));
 end if;
 if enabled is distinct from true then raise exception 'Pending tracker requests are not enabled. Sheets connection required.' using errcode='55000';end if;
 -- Fail fast rather than reverse the source/native writer lock graph. SHARE
 -- blocks native identity creation/edits while we verify exact source provenance.
 lock table public.equipment_units,app_private.vision_tracker_locations,app_private.cos_geocode_sources in share mode nowait;
 if p_request->>'kind'='update' then
  select * into s from app_private.cos_geocode_sources where native_unit_id=unit_id and organization_id=p_organization_id for share nowait;
  if not found or s.source_revision is distinct from(p_request->>'expectedSourceRevision')::uuid then
   raise exception 'Tracker source revision changed. Reload before saving.' using errcode='40001';end if;
  v:=app_private.cos_unit_tracker_source_value(s);
  if v is null then raise exception 'Exact current-workbook source is unavailable or needs review.' using errcode='40001';end if;
  i:=jsonb_build_object('family',v->'family','fullVariant',v->'fullVariant','unitLabel',v->'unitLabel');before_fields:=v->'fields';
  if exists(select 1 from app_private.cos_unit_tracker_requests where organization_id=p_organization_id and native_unit_id=unit_id) then
   raise exception 'This exact unit already has a pending request. Review it before another change.' using errcode='40001';end if;
 else
  -- Broad family + complete variant + label are recorded independently. A bare
  -- number or IP never resolves a row. Exact full identity collision is denied.
  if exists(select 1 from app_private.cos_geocode_sources x where x.organization_id=p_organization_id
   and x.source_system='google_sheet_tracker' and x.source_provenance->>'sheetId'='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA'
   and lower(x.source_provenance->>'fullIdentity')=lower((i->>'fullVariant')||'|'||(i->>'unitLabel')))
   or exists(select 1 from app_private.cos_unit_tracker_requests x where x.organization_id=p_organization_id and x.kind='add'
    and lower(x.full_variant)=lower(i->>'fullVariant') and lower(x.unit_label)=lower(i->>'unitLabel')) then
   raise exception 'This full tracker identity already exists or has a pending add.' using errcode='40001';end if;
 end if;
 proposed:=coalesce(before_fields,jsonb_build_object('placement',null,'street',null,'city',null,'state',null,'zip',null,'siteLabel',null,'customerLabel',null))||changes_value;
 if not app_private.cos_unit_tracker_fields(proposed,true) or(proposed->>'placement'='FIELD'
  and(proposed->>'street' is null or proposed->>'state' is null or(proposed->>'city' is null and proposed->>'zip' is null))) then
  raise exception 'A field unit needs a street, state, and city or ZIP.' using errcode='22023';end if;
 if p_request->>'kind'='add' and proposed->>'placement' in ('SHOP','INACTIVE') and exists(select 1 from jsonb_each(proposed) x where x.key in ('street','city','state','zip') and x.value<>'null'::jsonb) then raise exception 'New Shop or Inactive units must not include a field installation address.' using errcode='22023';end if;
 -- Only supplied keys replace values. A placement-only request never silently
 -- clears address cells. Cell formulas cannot be written: no publisher exists.
 if p_request->>'kind'='update' and proposed=before_fields then raise exception 'No tracker fields changed.' using errcode='22023';end if;
 insert into app_private.cos_unit_tracker_requests(request_id,organization_id,workbook_id,kind,native_unit_id,expected_source_revision,
  source_record_id,family,full_variant,unit_label,request_payload,changes,before_value,proposed_value,actor_user_id,actor_role)
 values(request_id_value,p_organization_id,'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',p_request->>'kind',unit_id,
  case when unit_id is not null then s.source_revision end,case when unit_id is not null then s.source_record_id end,
  i->>'family',i->>'fullVariant',i->>'unitLabel',p_request,changes_value,before_fields,proposed,p_actor_user_id,role_name) returning * into r;
 return jsonb_build_object('created',true,'request',app_private.cos_unit_tracker_receipt(r),'ownedByCurrentActor',true,'connector',jsonb_build_object('enabled',false,'state','awaiting_sheets_connection'));
end $$;
revoke all on function app_private.cos_unit_tracker_immutable(),app_private.cos_unit_tracker_assert_actor(uuid,uuid),
 app_private.cos_unit_tracker_text(text,integer),app_private.cos_unit_tracker_fields(jsonb,boolean),app_private.cos_unit_tracker_identity(jsonb),
 app_private.cos_unit_tracker_source_value(app_private.cos_geocode_sources),app_private.cos_unit_tracker_receipt(app_private.cos_unit_tracker_requests),
 app_private.cos_unit_tracker_capability(uuid) from public,anon,authenticated,service_role;
revoke all on function public.cos_unit_tracker_snapshot(uuid,uuid),public.cos_unit_tracker_read(uuid,uuid,uuid),
 public.cos_unit_tracker_enqueue(uuid,uuid,jsonb),public.cos_unit_tracker_request_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cos_unit_tracker_snapshot(uuid,uuid),public.cos_unit_tracker_read(uuid,uuid,uuid),
 public.cos_unit_tracker_enqueue(uuid,uuid,jsonb),public.cos_unit_tracker_request_read(uuid,uuid,uuid) to service_role;
commit;
