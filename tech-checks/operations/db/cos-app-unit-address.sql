-- REVIEW ARTIFACT: native project; apply AFTER tracker V2, inactive placement,
-- source precedence and all existing native source-read artifacts.
-- No admission, original source mutation, new account, role or schema USAGE.
-- OFF by default. Activation is a separate reviewed rollout after every named
-- consumer understands COS_APP_UNIT_ADDRESS_V1. Never enable on a mixed rollout.
begin;

create table app_private.cos_app_unit_address_rollout (
 organization_id uuid primary key check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 contract text not null check(contract='COS_APP_UNIT_ADDRESS_V1'),
 enabled boolean not null default false,
 native_ready boolean not null default true, bridge_ready boolean not null default false,
 worker_ready boolean not null default false, queue_ready boolean not null default false,
 readers_ready boolean not null default false, legacy_proof_ready boolean not null default false,
 check(not enabled or (native_ready and bridge_ready and worker_ready and queue_ready and readers_ready and legacy_proof_ready))
);
insert into app_private.cos_app_unit_address_rollout(organization_id,contract)
 values('ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5','COS_APP_UNIT_ADDRESS_V1');

-- Identity incarnations survive deletion and change/revert. Mutable tracker
-- placement/address changes advance only placement_revision; they cannot erase
-- an app decision. Competing native equipment invalidates identity permanently.
create table app_private.cos_app_unit_address_incarnations (
 native_unit_id uuid primary key, identity_revision uuid not null default gen_random_uuid(),
 placement_revision uuid not null default gen_random_uuid(), event_id bigint not null default 0
);
insert into app_private.cos_app_unit_address_incarnations(native_unit_id)
 select id from app_private.vision_tracker_locations
 where organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';

create table app_private.cos_app_unit_addresses (
 native_unit_id uuid primary key,
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 source_system text not null check(source_system in ('mhelpdesk_product_import','google_sheet_tracker')),
 product_id text, source_record_id text, unit_number text not null,
 source_revision uuid not null, stable_identity_sha256 text not null check(stable_identity_sha256~'^[a-f0-9]{64}$'),
 revision uuid not null unique, event_id bigint not null unique,
 placement text not null check(placement in ('FIELD','SHOP','INACTIVE')),
 installation jsonb, address_sha256 text, site_label text,
 source_file_sha256 text not null, source_row_sha256 text not null, native_guard_sha256 text not null,
 placement_proof jsonb not null,
 actor_user_id uuid not null, actor_role text not null check(actor_role in ('owner','it')),
 saved_at timestamptz not null default clock_timestamp(),
 check((source_system='mhelpdesk_product_import' and product_id is not null and source_record_id is null)
  or (source_system='google_sheet_tracker' and product_id is null and source_record_id is not null)),
 check((placement='FIELD' and installation is not null and address_sha256~'^[a-f0-9]{64}$')
  or (placement in ('SHOP','INACTIVE') and installation is null and address_sha256 is null))
);
create table app_private.cos_app_unit_address_history (
 revision uuid primary key, native_unit_id uuid not null,
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 event_id bigint not null unique, request_id uuid not null unique, request_payload jsonb not null,
 source_revision uuid not null, previous_revision uuid,
 actor_user_id uuid not null, actor_role text not null check(actor_role in ('owner','it')),
 saved_at timestamptz not null,
 before_value jsonb not null, after_value jsonb not null, placement_proof jsonb not null
);
create index cos_app_unit_address_history_unit on app_private.cos_app_unit_address_history(native_unit_id,event_id desc);
alter table app_private.cos_app_unit_address_rollout enable row level security;
alter table app_private.cos_app_unit_address_incarnations enable row level security;
alter table app_private.cos_app_unit_addresses enable row level security;
alter table app_private.cos_app_unit_address_history enable row level security;
revoke all on app_private.cos_app_unit_address_rollout,app_private.cos_app_unit_address_incarnations,
 app_private.cos_app_unit_addresses,app_private.cos_app_unit_address_history from public,anon,authenticated,service_role;

create function app_private.cos_app_unit_address_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'App address history is immutable.' using errcode='42501';end $$;
create trigger cos_app_unit_address_history_immutable before update or delete or truncate
 on app_private.cos_app_unit_address_history for each statement execute function app_private.cos_app_unit_address_immutable();

create function app_private.cos_app_unit_address_native_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_value jsonb;new_value jsonb;v_id uuid;identity_changed boolean;
begin
 if tg_op<>'INSERT' then old_value:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_value:=to_jsonb(new);end if;
 if tg_table_name='vision_tracker_locations' then
  identity_changed:=tg_op<>'UPDATE' or
   (old_value->'id',old_value->'organization_id',old_value->'unit_number',old_value->'family')
   is distinct from (new_value->'id',new_value->'organization_id',new_value->'unit_number',new_value->'family');
  if tg_op='UPDATE' and not identity_changed and
   (old_value-array['location_note'])=(new_value-array['location_note']) then return null;end if;
  for v_id in select distinct id from (values ((old_value->>'id')::uuid),((new_value->>'id')::uuid)) x(id) where id is not null loop
   insert into app_private.cos_app_unit_address_incarnations(native_unit_id,event_id)
    values(v_id,nextval('app_private.cos_geocode_source_event_id_seq'))
   on conflict(native_unit_id) do update set
    identity_revision=case when identity_changed then gen_random_uuid() else cos_app_unit_address_incarnations.identity_revision end,
    placement_revision=gen_random_uuid(),event_id=case when identity_changed then excluded.event_id else cos_app_unit_address_incarnations.event_id end;
  end loop;
  if identity_changed then
   for v_id in select s.native_unit_id from app_private.cos_geocode_sources s where s.entity_kind='tracker'
    and s.native_unit_id is distinct from (old_value->>'id')::uuid
    and s.native_unit_id is distinct from (new_value->>'id')::uuid
    and app_private.cos_source_label(s.unit_number) in
     (app_private.cos_source_label(old_value->>'unit_number'),app_private.cos_source_label(new_value->>'unit_number')) loop
    update app_private.cos_app_unit_address_incarnations set identity_revision=gen_random_uuid(),
     placement_revision=gen_random_uuid(),event_id=nextval('app_private.cos_geocode_source_event_id_seq') where native_unit_id=v_id;
   end loop;
  end if;
 else
  if tg_op='UPDATE' and (old_value->'id',old_value->'organization_id',old_value->'unit_number')
   is not distinct from (new_value->'id',new_value->'organization_id',new_value->'unit_number') then return null;end if;
  -- The broad label is a denial key only, never an identity lookup.
  for v_id in select s.native_unit_id from app_private.cos_geocode_sources s where s.entity_kind='tracker'
   and (s.native_unit_id in ((old_value->>'id')::uuid,(new_value->>'id')::uuid)
    or app_private.cos_source_label(s.unit_number) in
     (app_private.cos_source_label(old_value->>'unit_number'),app_private.cos_source_label(new_value->>'unit_number'))) loop
   insert into app_private.cos_app_unit_address_incarnations(native_unit_id,event_id)
    values(v_id,nextval('app_private.cos_geocode_source_event_id_seq'))
   on conflict(native_unit_id) do update set identity_revision=gen_random_uuid(),placement_revision=gen_random_uuid(),event_id=excluded.event_id;
  end loop;
 end if;
 return null;
end $$;
create trigger cos_app_unit_address_tracker_changed after insert or update or delete on app_private.vision_tracker_locations
 for each row execute function app_private.cos_app_unit_address_native_changed();
create trigger cos_app_unit_address_equipment_changed after insert or update or delete on public.equipment_units
 for each row execute function app_private.cos_app_unit_address_native_changed();

create function app_private.cos_app_unit_address_source_recreated()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_kind text;
begin
 if tg_op='DELETE' then v_id:=old.native_unit_id;v_kind:=old.entity_kind;
 else v_id:=new.native_unit_id;v_kind:=new.entity_kind;end if;
 if v_kind='tracker' then
  insert into app_private.cos_app_unit_address_incarnations(native_unit_id,event_id)
   values(v_id,nextval('app_private.cos_geocode_source_event_id_seq'))
  on conflict(native_unit_id) do update set identity_revision=gen_random_uuid(),placement_revision=gen_random_uuid(),event_id=excluded.event_id;
 end if;
 return null;
end $$;
create trigger cos_app_unit_address_source_recreated after insert or delete on app_private.cos_geocode_sources
 for each row execute function app_private.cos_app_unit_address_source_recreated();

-- Native/source truncation is a lifecycle event too. It cannot restore overlays
-- accidentally when an administrator later imports identical UUIDs/labels.
create function app_private.cos_app_unit_address_truncated()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 update app_private.cos_app_unit_address_incarnations set identity_revision=gen_random_uuid(),
  placement_revision=gen_random_uuid(),event_id=nextval('app_private.cos_geocode_source_event_id_seq');
 return null;
end $$;
create trigger cos_app_unit_address_tracker_truncated after truncate on app_private.vision_tracker_locations
 for each statement execute function app_private.cos_app_unit_address_truncated();
create trigger cos_app_unit_address_equipment_truncated after truncate on public.equipment_units
 for each statement execute function app_private.cos_app_unit_address_truncated();
create trigger cos_app_unit_address_source_truncated after truncate on app_private.cos_geocode_sources
 for each statement execute function app_private.cos_app_unit_address_truncated();

create function app_private.cos_app_unit_address_assert_service(p_org uuid)
returns void language plpgsql stable set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role'
  or p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'App address service access required.' using errcode='42501';end if;
end $$;
create function app_private.cos_app_unit_address_assert_actor(p_actor uuid,p_org uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
 perform app_private.cos_app_unit_address_assert_service(p_org);
 perform app_private.appdeploy_assume_actor(p_actor,p_org);
 if not app_private.has_permission(p_org,'equipment.view') then
  raise exception 'Existing equipment view permission required.' using errcode='42501';end if;
 select p.department into v_role from public.user_profiles p
 join public.user_roles ur on ur.user_id=p.user_id
 join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id
 where p.user_id=p_actor and p.organization_id=p_org and p.active
  and ((p_actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1'::uuid and p.department='owner' and r.code='owner')
   or (p_actor in ('d0757b64-9623-4adc-afff-21cc7853e88a'::uuid,'3caf7c00-627f-445f-bce4-ddeae574ee5c'::uuid)
    and p.department='it' and r.code='it_technician')) limit 1;
 if v_role is null then raise exception 'Existing Owner or verified IT account required.' using errcode='42501';end if;
 return v_role;
end $$;

create function app_private.cos_app_unit_address_stable_identity(p app_private.cos_geocode_sources)
returns text language plpgsql stable strict set search_path='' as $$
declare t app_private.vision_tracker_locations;e app_private.cos_app_unit_address_incarnations;
begin
 if p.entity_kind<>'tracker' or p.native_unit_id<>p.tracker_id then return null;end if;
 select * into t from app_private.vision_tracker_locations where id=p.tracker_id and organization_id=p.organization_id;
 if not found or t.unit_number is distinct from p.unit_number or t.unit_number is distinct from p.tracker_unit_number then return null;end if;
 select * into e from app_private.cos_app_unit_address_incarnations where native_unit_id=p.native_unit_id;
 if not found then return null;end if;
 if exists(select 1 from public.equipment_units u where u.id=p.native_unit_id or
   (u.organization_id=p.organization_id and app_private.cos_source_label(u.unit_number)=app_private.cos_source_label(p.unit_number)))
  or exists(select 1 from app_private.vision_tracker_locations x where x.organization_id=p.organization_id and x.id<>p.tracker_id
   and app_private.cos_source_label(x.unit_number)=app_private.cos_source_label(p.unit_number)) then return null;end if;
 return encode(sha256(convert_to(jsonb_build_array('COS_APP_UNIT_ADDRESS_IDENTITY_V1',p.organization_id,p.entity_kind,
  p.native_unit_id,p.tracker_id,p.source_system,p.product_id,p.source_record_id,p.unit_number,p.tracker_unit_number,
  p.family,p.variant,t.family,e.identity_revision)::text,'UTF8')),'hex');
end $$;

create function app_private.cos_app_unit_address_native_placement_revision(p app_private.cos_geocode_sources)
returns text language sql stable strict set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array('COS_APP_UNIT_ADDRESS_PLACEMENT_V1',p.native_unit_id,p.source_revision,
  p.source_placement,p.active,i.placement_revision,a.revision)::text,'UTF8')),'hex')
 from app_private.cos_app_unit_address_incarnations i
 left join app_private.cos_app_unit_addresses a on a.native_unit_id=i.native_unit_id where i.native_unit_id=p.native_unit_id
$$;

create function public.cos_app_unit_address_capability(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r app_private.cos_app_unit_address_rollout;
begin
 perform app_private.cos_app_unit_address_assert_actor(p_actor_user_id,p_organization_id);
 select * into r from app_private.cos_app_unit_address_rollout where organization_id=p_organization_id;
 return jsonb_build_object('contract','COS_APP_UNIT_ADDRESS_V1','enabled',coalesce(r.enabled and r.native_ready and r.bridge_ready
  and r.worker_ready and r.queue_ready and r.readers_ready and r.legacy_proof_ready,false),
  'readiness',jsonb_build_object('native',coalesce(r.native_ready,false),'bridge',coalesce(r.bridge_ready,false),
   'worker',coalesce(r.worker_ready,false),'queue',coalesce(r.queue_ready,false),'readers',coalesce(r.readers_ready,false),
   'legacyProof',coalesce(r.legacy_proof_ready,false)));
end $$;

create function app_private.cos_app_unit_address_read_value(p app_private.cos_geocode_sources,p_enabled boolean)
returns jsonb language plpgsql stable strict set search_path='' as $$
declare a app_private.cos_app_unit_addresses;v_stable text;v_history jsonb;v_valid boolean;
begin
 select * into a from app_private.cos_app_unit_addresses where native_unit_id=p.native_unit_id;
 v_stable:=app_private.cos_app_unit_address_stable_identity(p);
 v_valid:=v_stable is not null and (a.native_unit_id is null or a.stable_identity_sha256=v_stable);
 select coalesce(jsonb_agg(v order by event_id desc),'[]') into v_history from
  (select h.event_id,jsonb_build_object('revision',h.revision,'actorUserId',h.actor_user_id,'actorRole',h.actor_role,
   'savedAt',h.saved_at,'placement',h.after_value->'placement','installation',h.after_value->'installation',
   'siteLabel',h.after_value->'siteLabel') v from app_private.cos_app_unit_address_history h
   where h.native_unit_id=p.native_unit_id and h.organization_id=p.organization_id order by h.event_id desc limit 20) rows;
 return jsonb_build_object('contract','COS_APP_UNIT_ADDRESS_V1','unitId',p.native_unit_id,'unitNumber',p.unit_number,
  'sourceIdentity',jsonb_build_object('sourceSystem',p.source_system)||case when p.source_system='mhelpdesk_product_import'
   then jsonb_build_object('productId',p.product_id) else jsonb_build_object('sourceRecordId',p.source_record_id) end,
  'sourceRevision',p.source_revision,'revision',a.revision,'stableIdentitySha256',v_stable,
  'addressAuthority',case when a.native_unit_id is not null then a.placement_proof||jsonb_build_object('revision',a.revision) else null end,
  'placementRevision',app_private.cos_app_unit_address_native_placement_revision(p),
  'placement',case when a.native_unit_id is not null then a.placement else p.source_placement end,
  'installation',case when a.native_unit_id is not null then a.installation when p.source_placement='FIELD'
   then jsonb_build_object('street',p.street,'city',p.city,'state',p.state,'zip',p.zip) else null end,
  'siteLabel',case when a.native_unit_id is not null then a.site_label else p.site_label end,
  'sourceConflict',a.native_unit_id is not null and (a.source_revision is distinct from p.source_revision or not v_valid),
  'history',v_history,'editable',p_enabled and v_valid and (a.native_unit_id is not null or p.active));
end $$;

create function public.cos_app_unit_address_read(p_actor_user_id uuid,p_organization_id uuid,p_native_unit_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s app_private.cos_geocode_sources;c jsonb;
begin
 c:=public.cos_app_unit_address_capability(p_actor_user_id,p_organization_id);
 select * into s from app_private.cos_geocode_sources where organization_id=p_organization_id
  and entity_kind='tracker' and native_unit_id=p_native_unit_id;
 if not found then raise exception 'Imported tracker address unavailable.' using errcode='P0002';end if;
 return app_private.cos_app_unit_address_read_value(s,(c->>'enabled')::boolean);
end $$;

create function public.cos_app_unit_address_save(p_actor_user_id uuid,p_organization_id uuid,p_native_unit_id uuid,
 p_expected_source_revision uuid,p_expected_overlay_revision uuid,p_expected_stable_identity_sha256 text,
 p_expected_placement_revision text,p_placement_proof jsonb,p_request_id uuid,p_placement text,p_installation jsonb,p_site_label text,p_effective_before jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s app_private.cos_geocode_sources;a app_private.cos_app_unit_addresses;h app_private.cos_app_unit_address_history;
 v_role text;v_capability jsonb;v_stable text;v_before jsonb;v_after jsonb;v_installation jsonb;v_site text;
 v_street text;v_city text;v_state text;v_zip text;v_address text;v_payload jsonb;v_revision uuid;v_event bigint;v_saved timestamptz;
begin
 if current_setting('transaction_isolation') is distinct from 'read committed' then
  raise exception 'App address saves require a fresh READ COMMITTED transaction.' using errcode='40001';end if;
 v_role:=app_private.cos_app_unit_address_assert_actor(p_actor_user_id,p_organization_id);
 v_capability:=public.cos_app_unit_address_capability(p_actor_user_id,p_organization_id);
 if (v_capability->>'enabled')::boolean is distinct from true then raise exception 'App address rollout is not ready.' using errcode='55000';end if;
 if p_native_unit_id is null or p_expected_source_revision is null or p_request_id is null
  or coalesce(p_expected_stable_identity_sha256,'')!~'^[a-f0-9]{64}$'
  or coalesce(p_expected_placement_revision,'')!~'^[a-f0-9]{64}$' or coalesce(p_placement,'') not in ('FIELD','SHOP','INACTIVE') then
  raise exception 'Complete current app address identity required.' using errcode='22023';end if;
 if jsonb_typeof(p_placement_proof) is distinct from 'object'
  or (p_placement_proof-array['contract','legacyUnitKey','legacyIdentitySha256','legacyPlacementSha256'])<>'{}'::jsonb
  or not p_placement_proof ?& array['contract','legacyUnitKey','legacyIdentitySha256','legacyPlacementSha256']
  or p_placement_proof->>'contract' is distinct from 'COS_APP_UNIT_ADDRESS_V1'
  or jsonb_typeof(p_placement_proof->'legacyUnitKey') not in ('string','null')
  or (p_placement_proof->>'legacyUnitKey' is not null and
   (length(p_placement_proof->>'legacyUnitKey') not between 1 and 160 or p_placement_proof->>'legacyUnitKey' is distinct from btrim(p_placement_proof->>'legacyUnitKey')
    or p_placement_proof->>'legacyUnitKey'~'[[:cntrl:]<>]'))
  or coalesce(p_placement_proof->>'legacyIdentitySha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_placement_proof->>'legacyPlacementSha256','')!~'^[a-f0-9]{64}$' then
  raise exception 'Verified current legacy placement proof required.' using errcode='22023';end if;
 -- This is derived by the authenticated bridge after checking current legacy
 -- proof. Native SQL cannot read the other project in this transaction. Only
 -- this narrow address value is accepted, never a caller/actor/audit payload.
 if jsonb_typeof(p_effective_before) is distinct from 'object'
  or (p_effective_before-array['placement','installation','siteLabel'])<>'{}'::jsonb
  or not p_effective_before ?& array['placement','installation','siteLabel']
  or coalesce(p_effective_before->>'placement','') not in ('FIELD','SHOP','INACTIVE')
  or jsonb_typeof(p_effective_before->'siteLabel') not in ('string','null')
  or length(p_effective_before->>'siteLabel')>250
  or (p_effective_before->>'siteLabel')~'[[:cntrl:]<>]'
  or (p_effective_before->'installation'<>'null'::jsonb and
   (jsonb_typeof(p_effective_before->'installation') is distinct from 'object'
    or ((p_effective_before->'installation')-array['street','city','state','zip'])<>'{}'::jsonb
    or exists(select 1 from jsonb_each(p_effective_before->'installation') x where jsonb_typeof(x.value) not in ('string','null')
     or length(x.value#>>'{}')>case when x.key='street' then 600 else 100 end or (x.value#>>'{}')~'[[:cntrl:]<>]')))
  or (p_effective_before->>'placement' in ('SHOP','INACTIVE') and p_effective_before->'installation'<>'null'::jsonb) then
  raise exception 'Verified effective address before-value required.' using errcode='22023';end if;
 v_site:=nullif(btrim(p_site_label),'');
 if v_site is not null and (length(v_site)>250 or v_site~'[[:cntrl:]<>@=]'
  or v_site~*'https?:|password|passwd|pwd|token|secret|credential|gate[[:space:]-]*code|access[[:space:]-]*code') then
  raise exception 'Invalid site label.' using errcode='22023';end if;
 if p_placement='FIELD' then
  if jsonb_typeof(p_installation) is distinct from 'object' or (p_installation-array['street','city','state','zip'])<>'{}'::jsonb
   or exists(select 1 from jsonb_each(p_installation) x where jsonb_typeof(x.value) not in ('string','null')) then
   raise exception 'Invalid installation address.' using errcode='22023';end if;
  v_street:=nullif(btrim(regexp_replace(p_installation->>'street','[ ]+',' ','g')),'');
  v_city:=nullif(btrim(regexp_replace(p_installation->>'city','[ ]+',' ','g')),'');
  v_state:=upper(nullif(btrim(p_installation->>'state'),''));v_zip:=nullif(btrim(p_installation->>'zip'),'');
  if v_street is null or length(v_street)>300 or v_street!~'^[0-9]{1,8}[A-Za-z]? +[A-Za-z0-9 .''-]+$'
   or (v_city is not null and (length(v_city)>100 or v_city!~'^[A-Za-z][A-Za-z .''-]*$'))
   or v_state is null or not(v_state=any(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP',' ')))
   or (v_zip is not null and v_zip!~'^[0-9]{5}(-[0-9]{4})?$') or (v_city is null and v_zip is null)
   or concat_ws(' ',v_street,v_city)~'[0-9]{3}[ .)-]+[0-9]{3}[ .-]+[0-9]{4}'
   or concat_ws(' ',v_street,v_city)~*'\m(gate|password|passcode|access[[:space:]]*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|customer|username|passwd|pwd|token|secret|credential|code|pin|apt|apartment|suite|ste|unit|floor|bldg|building)\M'
   or concat_ws(' ',v_street,v_city)~*'(password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox)[[:alnum:]_-]*|(gate|access)[[:space:]-]*code[[:alnum:]_-]*' then
   raise exception 'A safe street, state and city or ZIP are required.' using errcode='22023';end if;
  v_installation:=jsonb_build_object('street',v_street,'city',v_city,'state',v_state,'zip',v_zip);
  v_address:=encode(sha256(convert_to(app_private.cos_source_address(v_street,v_city,v_state,v_zip),'UTF8')),'hex');
 elsif p_installation is not null and p_installation<>'null'::jsonb then
  raise exception 'Shop and Inactive have no installation address.' using errcode='22023';
 end if;
 -- Serialize with admission, then fail fast instead of acquiring the native
 -- writer lock graph backwards. Table SHARE excludes competing label inserts;
 -- row-only locks cannot protect the absence of a competing equipment identity.
 perform pg_advisory_xact_lock(hashtextextended(p_native_unit_id::text,701006));
 lock table public.equipment_units,app_private.vision_tracker_locations in share mode nowait;
 select * into s from app_private.cos_geocode_sources where native_unit_id=p_native_unit_id
  and organization_id=p_organization_id and entity_kind='tracker' for update nowait;
 if not found then raise exception 'Imported tracker address unavailable.' using errcode='40001';end if;
 select * into a from app_private.cos_app_unit_addresses where native_unit_id=p_native_unit_id for update nowait;
 -- Authorization may have changed while waiting for any lock above. Pin the
 -- current profile, memberships, role definitions and rollout row through the
 -- write, then repeat both checks with a fresh READ COMMITTED snapshot. Taking
 -- these locks before the advisory wait would unnecessarily delay revocation.
 perform p.user_id from public.user_profiles p join public.user_roles ur on ur.user_id=p.user_id
  join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id
  where p.user_id=p_actor_user_id and p.organization_id=p_organization_id for share of p,ur,r nowait;
 perform 1 from app_private.cos_app_unit_address_rollout where organization_id=p_organization_id for share nowait;
 v_role:=app_private.cos_app_unit_address_assert_actor(p_actor_user_id,p_organization_id);
 v_capability:=public.cos_app_unit_address_capability(p_actor_user_id,p_organization_id);
 if (v_capability->>'enabled')::boolean is distinct from true then raise exception 'App address rollout is not ready.' using errcode='55000';end if;
 v_payload:=jsonb_build_object('unitId',p_native_unit_id,'sourceRevision',p_expected_source_revision,'revision',p_expected_overlay_revision,
  'stableIdentitySha256',p_expected_stable_identity_sha256,'placementRevision',p_expected_placement_revision,
  'placementProof',p_placement_proof,'placement',p_placement,'installation',v_installation,'siteLabel',v_site,'effectiveBefore',p_effective_before);
 select * into h from app_private.cos_app_unit_address_history where request_id=p_request_id;
 if found then
  if h.actor_user_id<>p_actor_user_id or h.native_unit_id<>p_native_unit_id or h.request_payload is distinct from v_payload
   or a.revision is distinct from h.revision then raise exception 'App address request was reused or superseded.' using errcode='40001';end if;
  return jsonb_build_object('changed',false,'record',app_private.cos_app_unit_address_read_value(s,true));
 end if;
 v_stable:=app_private.cos_app_unit_address_stable_identity(s);
 if v_stable is null or v_stable is distinct from p_expected_stable_identity_sha256
  or (a.native_unit_id is not null and a.stable_identity_sha256 is distinct from v_stable)
  or s.source_revision is distinct from p_expected_source_revision or a.revision is distinct from p_expected_overlay_revision
  or app_private.cos_app_unit_address_native_placement_revision(s) is distinct from p_expected_placement_revision
  or (a.native_unit_id is null and not s.active) then raise exception 'Source, native identity or placement changed. Reload.' using errcode='40001';end if;
 v_before:=app_private.cos_app_unit_address_read_value(s,true);
 -- Same normalized address/placement/site is a true no-op: no revision, audit,
 -- event or geocoding work. Cancel never calls this function.
 if p_effective_before->>'placement'=p_placement and nullif(btrim(p_effective_before->>'siteLabel'),'') is not distinct from v_site
  and (case when p_effective_before->>'placement'='FIELD' then encode(sha256(convert_to(app_private.cos_source_address(
   p_effective_before#>>'{installation,street}',p_effective_before#>>'{installation,city}',p_effective_before#>>'{installation,state}',p_effective_before#>>'{installation,zip}'),'UTF8')),'hex') else null end)
   is not distinct from v_address then return jsonb_build_object('changed',false,'record',v_before);end if;
 v_revision:=gen_random_uuid();v_event:=nextval('app_private.cos_geocode_source_event_id_seq');v_saved:=clock_timestamp();
 insert into app_private.cos_app_unit_addresses(native_unit_id,organization_id,source_system,product_id,source_record_id,unit_number,
  source_revision,stable_identity_sha256,revision,event_id,placement,installation,address_sha256,site_label,
  source_file_sha256,source_row_sha256,native_guard_sha256,placement_proof,actor_user_id,actor_role,saved_at)
 values(s.native_unit_id,s.organization_id,s.source_system,s.product_id,s.source_record_id,s.unit_number,s.source_revision,v_stable,
  v_revision,v_event,p_placement,v_installation,v_address,v_site,s.source_file_sha256,s.source_row_sha256,s.native_guard_sha256,
  p_placement_proof,p_actor_user_id,v_role,v_saved)
 on conflict(native_unit_id) do update set source_revision=excluded.source_revision,revision=excluded.revision,event_id=excluded.event_id,
  placement=excluded.placement,installation=excluded.installation,address_sha256=excluded.address_sha256,site_label=excluded.site_label,
  source_file_sha256=excluded.source_file_sha256,source_row_sha256=excluded.source_row_sha256,native_guard_sha256=excluded.native_guard_sha256,
  placement_proof=excluded.placement_proof,actor_user_id=excluded.actor_user_id,actor_role=excluded.actor_role,saved_at=excluded.saved_at;
 v_after:=jsonb_build_object('placement',p_placement,'installation',v_installation,'siteLabel',v_site);
 insert into app_private.cos_app_unit_address_history(revision,native_unit_id,organization_id,event_id,request_id,request_payload,
  source_revision,previous_revision,actor_user_id,actor_role,saved_at,before_value,after_value,placement_proof)
 values(v_revision,s.native_unit_id,s.organization_id,v_event,p_request_id,v_payload,s.source_revision,a.revision,p_actor_user_id,v_role,v_saved,
  p_effective_before,v_after,p_placement_proof);
 return jsonb_build_object('changed',true,'record',app_private.cos_app_unit_address_read_value(s,true));
end $$;

-- Keep the original serializer and precedence contract available for untouched
-- rows; do not rewrite or alter the source-owned record. App source evidence is
-- frozen at save so later imports cannot change bytes under an overlay revision.
create function app_private.cos_app_unit_address_effective_source(p app_private.cos_geocode_sources)
returns jsonb language plpgsql stable strict set search_path='' as $$
declare a app_private.cos_app_unit_addresses;i app_private.cos_app_unit_address_incarnations;v_valid boolean;v_base jsonb;
begin
 select * into a from app_private.cos_app_unit_addresses where native_unit_id=p.native_unit_id;
 if not found then return app_private.cos_source_record(p);end if;
 select * into i from app_private.cos_app_unit_address_incarnations where native_unit_id=p.native_unit_id;
 v_valid:=a.stable_identity_sha256 is not distinct from app_private.cos_app_unit_address_stable_identity(p);
 v_base:=jsonb_build_object('schemaVersion',case when a.source_system='mhelpdesk_product_import' then 1 else 2 end,
  'organizationId',p.organization_id,'sourceSystem',a.source_system,'entityKind','tracker','nativeUnitId',p.native_unit_id,
  'sourceRevision',case when v_valid then a.revision else i.identity_revision end,
  'eventId',(case when v_valid then a.event_id else greatest(a.event_id,coalesce(i.event_id,0)) end)::text,
  'eligibility',case when v_valid and a.placement='FIELD' then 'FIELD' else 'tombstone' end)
  ||case when a.source_system='mhelpdesk_product_import' then jsonb_build_object('productId',a.product_id)
   else jsonb_build_object('sourceRecordId',a.source_record_id) end
  ||jsonb_build_object('addressAuthority',a.placement_proof||jsonb_build_object('revision',case when v_valid then a.revision else i.identity_revision end));
 if v_valid and a.placement='FIELD' then
  return v_base||jsonb_build_object('unitNumber',p.unit_number,'family',p.family,'variant',p.variant,
   'sourceFileSha256',a.source_file_sha256,'sourceRowSha256',a.source_row_sha256,'nativeGuardSha256',a.native_guard_sha256,
   'addressSha256',a.address_sha256,'installation',a.installation,
   'suppliedComponents',jsonb_build_object('street',true,'city',a.installation->>'city' is not null,'state',true,'zip',a.installation->>'zip' is not null));
 end if;
 return v_base;
end $$;

create function app_private.cos_app_unit_address_source_current(p app_private.cos_geocode_sources)
returns boolean language sql stable strict set search_path='' as $$
 select case when exists(select 1 from app_private.cos_app_unit_addresses a where a.native_unit_id=p.native_unit_id)
 then true else p.eligibility='tombstone' or p.native_guard_sha256=app_private.cos_source_native_guard(p.entity_kind,p.native_unit_id,p.tracker_id,p.unit_number,p.tracker_unit_number) end
$$;

create function app_private.cos_app_unit_address_orphan_source(a app_private.cos_app_unit_addresses)
returns jsonb language sql stable strict set search_path='' as $$
 select jsonb_build_object('schemaVersion',case when a.source_system='mhelpdesk_product_import' then 1 else 2 end,
  'organizationId',a.organization_id,'sourceSystem',a.source_system,'entityKind','tracker','nativeUnitId',a.native_unit_id,
  'sourceRevision',i.identity_revision,'eventId',greatest(a.event_id,i.event_id)::text,'eligibility','tombstone')
  ||case when a.source_system='mhelpdesk_product_import' then jsonb_build_object('productId',a.product_id)
   else jsonb_build_object('sourceRecordId',a.source_record_id) end
  ||jsonb_build_object('addressAuthority',a.placement_proof||jsonb_build_object('revision',i.identity_revision))
 from app_private.cos_app_unit_address_incarnations i where i.native_unit_id=a.native_unit_id
$$;

create function app_private.cos_app_unit_address_effective_sources(p_org uuid,p_current boolean)
returns setof jsonb language sql stable set search_path='' as $$
 select app_private.cos_app_unit_address_effective_source(s) from app_private.cos_geocode_sources s
  where s.organization_id=p_org and (not p_current or app_private.cos_app_unit_address_source_current(s))
 union all
 select app_private.cos_app_unit_address_orphan_source(a) from app_private.cos_app_unit_addresses a
  where a.organization_id=p_org and not exists(select 1 from app_private.cos_geocode_sources s where s.native_unit_id=a.native_unit_id)
$$;

create or replace function public.cos_geocode_sources_list_changes(p_organization_id uuid,p_after_event_id text,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;last_id text;
begin
 perform app_private.cos_app_unit_address_assert_service(p_organization_id);
 if p_after_event_id is null or p_after_event_id!~'^(0|[1-9][0-9]{0,18})$' or p_after_event_id::numeric>9223372036854775807
  or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid bounded source cursor.' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('eventId',v->>'eventId','entityKind',v->>'entityKind','nativeUnitId',v->>'nativeUnitId',
  'sourceRevision',v->>'sourceRevision','kind',case when v->>'eligibility'='FIELD' then 'upsert' else 'tombstone' end)
  ||case when v->>'sourceSystem'='mhelpdesk_product_import' then jsonb_build_object('productId',v->>'productId')
   else jsonb_build_object('sourceSystem',v->>'sourceSystem','sourceRecordId',v->>'sourceRecordId') end order by (v->>'eventId')::bigint),'[]'),
  max((v->>'eventId')::bigint)::text into result,last_id from
  (select x v from app_private.cos_app_unit_address_effective_sources(p_organization_id,false) x
   where (x->>'eventId')::bigint>p_after_event_id::bigint order by (x->>'eventId')::bigint limit p_limit) q;
 return jsonb_build_object('events',result,'nextEventId',coalesce(last_id,p_after_event_id));
end $$;

create or replace function public.cos_geocode_sources_read_current(p_organization_id uuid,p_entity_kind text,p_native_unit_id uuid,p_product_id text,p_source_revision uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform app_private.cos_app_unit_address_assert_service(p_organization_id);
 select v into result from app_private.cos_app_unit_address_effective_sources(p_organization_id,true) v
  where v->>'entityKind'=p_entity_kind and v->>'nativeUnitId'=p_native_unit_id::text
   and v->>'productId'=p_product_id and v->>'sourceRevision'=p_source_revision::text;
 return jsonb_build_object('source',result);
end $$;

create or replace function public.cos_geocode_sources_read_current_batch(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i jsonb;v jsonb;result jsonb:='[]';
begin
 perform app_private.cos_app_unit_address_assert_service(p_organization_id);
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 100 then raise exception 'Invalid source batch.' using errcode='22023';end if;
 for i in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(i) is distinct from 'object' or (i-array['entityKind','nativeUnitId','productId','sourceRevision','sourceSystem','sourceRecordId'])<>'{}'::jsonb
   or coalesce(i->>'entityKind','') not in ('equipment_unit','tracker')
   or not coalesce((i->>'sourceSystem'='google_sheet_tracker' and i->>'entityKind'='tracker' and not(i?'productId') and app_private.cos_tracker_source_record_id_valid(i->>'sourceRecordId'))
    or (coalesce(i->>'sourceSystem','mhelpdesk_product_import')='mhelpdesk_product_import' and not(i?'sourceRecordId') and coalesce(i->>'productId','')~'^[1-9][0-9]{0,18}$'),false)
   or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(i->>'sourceRevision','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Invalid source identity.' using errcode='22023';end if;
  select x into v from app_private.cos_app_unit_address_effective_sources(p_organization_id,true) x
   where x->>'entityKind'=i->>'entityKind' and x->>'nativeUnitId'=i->>'nativeUnitId'
    and x->>'sourceSystem'=coalesce(i->>'sourceSystem','mhelpdesk_product_import')
    and x->>'productId' is not distinct from i->>'productId' and x->>'sourceRecordId' is not distinct from i->>'sourceRecordId'
    and x->>'sourceRevision'=i->>'sourceRevision';
  result:=result||jsonb_build_array(v);
 end loop;
 return jsonb_build_object('sources',result);
end $$;

create or replace function public.cos_geocode_sources_read_many(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform app_private.cos_app_unit_address_assert_service(p_organization_id);
 if jsonb_typeof(p_identities) is distinct from 'array' or jsonb_array_length(p_identities)>250
  or exists(select 1 from jsonb_array_elements(p_identities) i where jsonb_typeof(i) is distinct from 'object'
   or coalesce(i->>'entityKind','') not in ('equipment_unit','tracker') or (i-array['entityKind','nativeUnitId'])<>'{}'::jsonb
   or coalesce(i->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then raise exception 'Invalid source identities.' using errcode='22023';end if;
 select coalesce(jsonb_agg(v order by v->>'nativeUnitId'),'[]') into result from
  (select app_private.cos_app_unit_address_effective_source(s) v from app_private.cos_geocode_sources s where s.organization_id=p_organization_id
   and exists(select 1 from jsonb_array_elements(p_identities) i where i->>'entityKind'=s.entity_kind and (i->>'nativeUnitId')::uuid=s.native_unit_id)
   and app_private.cos_app_unit_address_source_current(s)) q where v->>'eligibility'='FIELD';
 return result;
end $$;

create or replace function public.cos_geocode_sources_map_projection(p_organization_id uuid,p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s app_private.cos_geocode_sources;a app_private.cos_app_unit_addresses;v jsonb;result jsonb:='[]';
begin
 perform public.cos_geocode_sources_read_many(p_organization_id,p_identities);
 for s in select * from app_private.cos_geocode_sources src where src.organization_id=p_organization_id
  and exists(select 1 from jsonb_array_elements(p_identities) ident where ident->>'entityKind'=src.entity_kind and (ident->>'nativeUnitId')::uuid=src.native_unit_id)
  order by src.native_unit_id loop
  select * into a from app_private.cos_app_unit_addresses where native_unit_id=s.native_unit_id;
  v:=app_private.cos_app_unit_address_effective_source(s);
  if a.native_unit_id is not null then
   if a.stable_identity_sha256 is distinct from app_private.cos_app_unit_address_stable_identity(s) then
    -- A first map load also needs a denial marker. Omitting this row could
    -- reveal the stale original tracker address or pin through fallback.
    result:=result||jsonb_build_array(v||jsonb_build_object('unitNumber',s.unit_number,'placement','UNKNOWN','siteLabel',null,
     'sourceFileSha256',a.source_file_sha256,'sourceRowSha256',a.source_row_sha256,'nativeGuardSha256',a.native_guard_sha256,
     'installation',null,'addressSha256',null,'suppliedComponents',null,'nativeSourceIdentity',null));
    continue;
   end if;
   result:=result||jsonb_build_array(v||jsonb_build_object('unitNumber',s.unit_number,'placement',a.placement,'siteLabel',a.site_label,
    'sourceFileSha256',a.source_file_sha256,'sourceRowSha256',a.source_row_sha256,'nativeGuardSha256',a.native_guard_sha256,
    'installation',a.installation,'addressSha256',a.address_sha256,'nativeSourceIdentity',null,
    'suppliedComponents',case when a.placement='FIELD' then jsonb_build_object('street',true,'city',a.installation->>'city' is not null,
     'state',true,'zip',a.installation->>'zip' is not null) else null end)
    ||jsonb_build_object('customerLabel',case when s.source_system='google_sheet_tracker' then s.source_customer_label else s.site_label end));
  elsif s.active and s.native_guard_sha256=app_private.cos_source_native_guard(s.entity_kind,s.native_unit_id,s.tracker_id,s.unit_number,s.tracker_unit_number) then
   result:=result||jsonb_build_array(v||jsonb_build_object('entityKind',s.entity_kind,'nativeUnitId',s.native_unit_id,
    'sourceRevision',s.source_revision,'eventId',s.event_id::text,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,
    'nativeGuardSha256',s.native_guard_sha256,'unitNumber',s.unit_number,'placement',s.source_placement,'siteLabel',s.site_label,
    'nativeSourceIdentity',case when s.entity_kind='equipment_unit' then jsonb_build_object('contract','COS_IMPORTED_NATIVE_SOURCE_IDENTITY_V1',
     'nativeUnitId',s.native_unit_id,'productId',s.product_id,'unitNumber',s.unit_number,'trackerId',s.tracker_id,'trackerUnitNumber',s.tracker_unit_number,
     'sourceRevision',s.source_revision,'sourceFileSha256',s.source_file_sha256,'sourceRowSha256',s.source_row_sha256,'nativeGuardSha256',s.native_guard_sha256) else null end,
    'installation',case when s.source_placement='FIELD' then jsonb_build_object('street',s.street,'city',s.city,'state',s.state,'zip',s.zip) else null end,
    'addressSha256',case when s.source_placement='FIELD' then s.address_sha256 else null end,
    'suppliedComponents',case when s.source_placement='FIELD' then jsonb_build_object('street',true,'city',s.city is not null,'state',true,'zip',s.zip is not null) else null end)
    ||case when s.source_system='google_sheet_tracker' then jsonb_build_object('customerLabel',s.source_customer_label) else '{}'::jsonb end);
  end if;
 end loop;
 for a in select * from app_private.cos_app_unit_addresses a0 where a0.organization_id=p_organization_id
  and not exists(select 1 from app_private.cos_geocode_sources src where src.native_unit_id=a0.native_unit_id)
  and exists(select 1 from jsonb_array_elements(p_identities) ident where ident->>'entityKind'='tracker' and (ident->>'nativeUnitId')::uuid=a0.native_unit_id)
  order by a0.native_unit_id loop
  result:=result||jsonb_build_array(app_private.cos_app_unit_address_orphan_source(a)||jsonb_build_object(
   'unitNumber',a.unit_number,'placement','UNKNOWN','siteLabel',null,'sourceFileSha256',a.source_file_sha256,
   'sourceRowSha256',a.source_row_sha256,'nativeGuardSha256',a.native_guard_sha256,'installation',null,'addressSha256',null,
   'suppliedComponents',null,'nativeSourceIdentity',null));
 end loop;
 return result;
end $$;

-- No schema USAGE or table access is granted. Every new callable entry is an
-- existing service-role SECURITY DEFINER wrapper with an explicit caller guard.
revoke all on function app_private.cos_app_unit_address_immutable(),app_private.cos_app_unit_address_native_changed(),
 app_private.cos_app_unit_address_source_recreated(),
 app_private.cos_app_unit_address_truncated(),app_private.cos_app_unit_address_assert_service(uuid),
 app_private.cos_app_unit_address_assert_actor(uuid,uuid),app_private.cos_app_unit_address_stable_identity(app_private.cos_geocode_sources),
 app_private.cos_app_unit_address_native_placement_revision(app_private.cos_geocode_sources),
 app_private.cos_app_unit_address_read_value(app_private.cos_geocode_sources,boolean),
 app_private.cos_app_unit_address_effective_source(app_private.cos_geocode_sources),app_private.cos_app_unit_address_source_current(app_private.cos_geocode_sources)
 ,app_private.cos_app_unit_address_orphan_source(app_private.cos_app_unit_addresses),app_private.cos_app_unit_address_effective_sources(uuid,boolean)
 from public,anon,authenticated,service_role;
revoke all on function public.cos_app_unit_address_capability(uuid,uuid),public.cos_app_unit_address_read(uuid,uuid,uuid),
 public.cos_app_unit_address_save(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cos_app_unit_address_capability(uuid,uuid),public.cos_app_unit_address_read(uuid,uuid,uuid),
 public.cos_app_unit_address_save(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,jsonb,text,jsonb) to service_role;
commit;
