-- LOCAL DRAFT ONLY. Not a migration or a deployed-catalog compatibility claim.
-- Exercise only in the authorized synthetic in-memory PGlite harness.
-- Existing function owner/EXECUTE boundary is retained. No new roles, grants,
-- public protocol columns, lifecycle triggers, second generation or display policy.
-- All producers and old in-flight invocations must be quiesced/migrated before
-- release. Arbitrary raw service-role table writes are NOT blocked by this draft.
-- The exact captured legacy function body below remains the unrelated-profile path.
-- One-shot draft: it deliberately rejects existing private objects or a publisher
-- differing from the captured baseline. It is not an idempotent deployment migration.
begin;

do $preflight$
declare owner_name text; definition_hash text;
begin
 select pg_get_userbyid(proowner),encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') into owner_name,definition_hash
 from pg_proc where oid=to_regprocedure('public.publish_camera_connection_v1(bigint,bigint,inet,integer[],text,jsonb,text)');
 if owner_name is null or owner_name<>current_user then
  raise exception 'Local draft requires the existing publisher owner as current_user';
 end if;
 if definition_hash is distinct from 'ade4074d7fbbb2b0023a098c47cb7ff5a69ca08125d91208939615c408a2644a' then
  raise exception 'Local draft requires the exact captured publisher baseline';
 end if;
 if exists(select 1 from pg_namespace where nspname='camera_direct_health_private') then
  raise exception 'Local draft requires absent private protocol objects';
 end if;
end $preflight$;

create schema camera_direct_health_private;
revoke all on schema camera_direct_health_private from public;

create table camera_direct_health_private.attempt_state (
 camera_device_id bigint primary key,
 current_attempt_id uuid not null,
 current_sequence bigint not null check(current_sequence>0),
 binding jsonb not null,
 registered_at timestamptz not null,
 expires_at timestamptz not null,
 phase text not null check(phase in ('pending','completed')),
 validity text not null check(validity in ('pending','connected','refused','unverified')),
 observed_at timestamptz,
 streak_count integer not null default 0 check(streak_count between 0 and 3),
 first_failed_at timestamptz,
 seed_count integer not null default 0 check(seed_count between 0 and 3),
 seed_observed_at timestamptz,
 seed_first_failed_at timestamptz,
 last_definitive_at timestamptz
);

-- Retained request IDs are deduplication tombstones as well as receipts.
-- No cleanup is authorized; deleting IDs must never make a stale ticket reusable.
create table camera_direct_health_private.attempt_receipts (
 attempt_id uuid primary key,
 camera_device_id bigint not null,
 attempt_sequence bigint not null check(attempt_sequence>0),
 binding jsonb not null,
 begin_payload jsonb not null,
 registered_at timestamptz not null,
 expires_at timestamptz not null,
 registration_receipt jsonb not null,
 completion_payload bytea,
 completion_receipt jsonb,
 reported_completed_at text,
 valid_observed_at timestamptz,
 received_at timestamptz,
 unique(camera_device_id,attempt_sequence)
);

alter table camera_direct_health_private.attempt_state enable row level security;
alter table camera_direct_health_private.attempt_receipts enable row level security;
revoke all on all tables in schema camera_direct_health_private from public;
-- Narrowly remove any inherited default table/schema grants in the synthetic
-- harness. This is not evidence about deployed default ACLs or writer access.
do $private_acl$
declare role_name text;
begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on schema camera_direct_health_private from %I',role_name);
   execute format('revoke all on all tables in schema camera_direct_health_private from %I',role_name);
  end if;
 end loop;
end $private_acl$;

-- Fail closed on effective rights, including inherited/PUBLIC/default ACLs and
-- role assumptions. RLS does not protect TRUNCATE. No existing rights are changed
-- here: unexpected access aborts this transaction before publisher replacement.
do $effective_private_acl$
declare
 actor record; assumed record; target record; column_value record; privilege_name text;
 owner_oid oid:=current_user::regrole;
 assumption_privilege text:=case when current_setting('server_version_num')::integer>=160000 then 'SET' else 'MEMBER' end;
 builtin_name text;
begin
 -- The exact existing owner and inherent superuser origins remain the admin
 -- boundary. Their ordinary members/assumers are NOT exempt.
 for actor in select oid,rolname,rolcanlogin from pg_roles where not rolsuper and oid<>owner_oid
  order by case when rolname in ('anon','authenticated','service_role') then 0 else 1 end,rolname loop
  for assumed in select oid,rolname from pg_roles where oid=actor.oid
   or pg_has_role(actor.oid,oid,assumption_privilege)
   or pg_has_role(actor.oid,oid,'MEMBER WITH ADMIN OPTION')
   order by case when oid=actor.oid then 0 else 1 end,rolname loop
   -- Predefined system roles have these inherent classes on every object, even
   -- with empty ACLs. Allow only those classes when that system role acts as
   -- itself; reject any added rights or ordinary caller inheriting/assuming it.
   builtin_name:=case when actor.oid=assumed.oid and actor.oid<16384 and not actor.rolcanlogin
    and actor.rolname in ('pg_read_all_data','pg_write_all_data','pg_maintain') then actor.rolname else '' end;
   for target in
    select n.oid,n.nspowner as owner,'n'::"char" as kind,format('%I',n.nspname) as object_name
     from pg_namespace n where n.nspname='camera_direct_health_private'
    union all
    select c.oid,c.relowner,'r'::"char",format('%I.%I',n.nspname,c.relname)
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='camera_direct_health_private' and c.relname in ('attempt_state','attempt_receipts')
    order by kind,object_name loop
    -- acldefault supplies the target server's complete privilege vocabulary,
    -- including MAINTAIN where supported, rather than a fixed legacy list.
    for privilege_name in select distinct privilege_type from aclexplode(acldefault(target.kind,target.owner)) order by privilege_type loop
     if (target.kind='n' and privilege_name='USAGE' and builtin_name in ('pg_read_all_data','pg_write_all_data'))
      or (target.kind='r' and ((builtin_name='pg_read_all_data' and privilege_name='SELECT')
       or (builtin_name='pg_write_all_data' and privilege_name in ('INSERT','UPDATE','DELETE'))
       or (builtin_name='pg_maintain' and privilege_name='MAINTAIN'))) then continue;end if;
     if (case when target.kind='n' then has_schema_privilege(assumed.oid,target.oid,privilege_name)
      else has_table_privilege(assumed.oid,target.oid,privilege_name) end) then
      raise exception 'Unexpected effective private-state access: actor=% assumed_role=% object=% privilege=%',
       quote_ident(actor.rolname),quote_ident(assumed.rolname),target.object_name,privilege_name using errcode='42501';
     end if;
    end loop;
    if target.kind='r' then
     for column_value in select attnum,attname from pg_attribute where attrelid=target.oid and attnum>0 and not attisdropped order by attnum loop
      foreach privilege_name in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
       if (builtin_name='pg_read_all_data' and privilege_name='SELECT')
        or (builtin_name='pg_write_all_data' and privilege_name in ('INSERT','UPDATE')) then continue;end if;
       if has_column_privilege(assumed.oid,target.oid,column_value.attnum,privilege_name) then
        raise exception 'Unexpected effective private-state access: actor=% assumed_role=% object=% privilege=%',
         quote_ident(actor.rolname),quote_ident(assumed.rolname),format('%s.%I',target.object_name,column_value.attname),privilege_name using errcode='42501';
       end if;
      end loop;
     end loop;
    end if;
   end loop;
  end loop;
 end loop;
end $effective_private_acl$;

CREATE OR REPLACE FUNCTION public.publish_camera_connection_v1(p_device_id bigint, p_revision bigint, p_public_ip inet, p_expected_ports integer[], p_monitoring_profile text, p_health jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $direct_local$
declare
 a_d public.camera_devices%rowtype;
 a_h public.camera_health_current%rowtype;
 a_state camera_direct_health_private.attempt_state%rowtype;
 a_ticket camera_direct_health_private.attempt_receipts%rowtype;
 a_received timestamptz:=clock_timestamp();
 a_decided timestamptz;
 a_registered timestamptz;
 a_expires timestamptz;
 a_observed timestamptz;
 a_previous_health_at timestamptz;
 a_first timestamptz;
 a_da jsonb;
 a_identity jsonb;
 a_master jsonb;
 a_request jsonb;
 a_binding jsonb;
 a_result jsonb;
 a_record jsonb;
 a_ports jsonb:='{}'::jsonb;
 a_response jsonb;
 a_payload bytea;
 a_op text;
 a_id uuid;
 a_id_text text;
 a_seq bigint;
 a_seed integer:=0;
 a_seed_observed timestamptz;
 a_seed_first timestamptz;
 a_last_definitive timestamptz;
 a_validity text:='unverified';
 a_status text:='unknown';
 a_reason text:='probe_unverified';
 a_reported text;
 a_normalized_key text;
 a_expected_key text;
 a_port integer;
 a_seen integer[]:='{}'::integer[];
 a_connected boolean:=false;
 a_all_refused boolean:=true;
 a_invalid boolean:=false;
 a_time_valid boolean:=false;
 a_current boolean:=false;
 a_device_matches boolean:=false;
 a_identity_valid boolean:=false;
 a_scope boolean:=false;
 a_count integer:=0;
 a_state_exists boolean:=false;
 a_ticket_exists boolean:=false;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
 select * into a_d from public.camera_devices where id=p_device_id for update;
 a_scope:=coalesce(found and a_d.source='2026_unit_tracker' and a_d.monitoring_profile in ('sniper','camv'),false);

 if a_scope or (jsonb_typeof(p_health)='object' and p_health?'direct_attempt')
  or (lower(a_d.monitoring_profile) in ('sniper','camv') and exists(select 1 from camera_direct_health_private.attempt_state where camera_device_id=p_device_id)) then
  if jsonb_typeof(p_health) is distinct from 'object' or not(p_health?'direct_attempt') then
   return jsonb_build_object('ok',false,'reason','direct_attempt_required');
  end if;
  a_da:=p_health->'direct_attempt';
  if jsonb_typeof(a_da) is distinct from 'object' then return jsonb_build_object('ok',false,'reason','invalid_direct_attempt');end if;
  a_op:=a_da->>'op';a_id_text:=a_da->>'attempt_id';
  if a_op is null or a_op not in ('begin','complete','read') or jsonb_typeof(a_da->'attempt_id') is distinct from 'string'
    or a_id_text!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
   return jsonb_build_object('ok',false,'reason','invalid_direct_attempt');
  end if;
  a_id:=a_id_text::uuid;a_identity:=a_da->'binding';a_master:=a_identity->'master';
  a_request:=jsonb_build_object('device_id',p_device_id::text,'revision',p_revision::text,'public_ip',p_public_ip::text,
   'expected_ports',to_jsonb(p_expected_ports),'monitoring_profile',p_monitoring_profile,'source',p_source,'identity',a_identity);
  -- Check-source labels are immutable per request, but manual/scheduled checks
  -- of the same endpoint must share one confirmation chain.
  a_binding:=(a_request-'source')||jsonb_build_object('device',jsonb_build_object('id',a_d.id::text,'revision',a_d.connection_revision::text,
   'public_ip',a_d.public_ip::text,'expected_ports',to_jsonb(a_d.expected_ports),'monitoring_profile',a_d.monitoring_profile,
   'unit_key',a_d.unit_key,'source',a_d.source,'device_name',a_d.device_name,'organization',a_d.organization,
   'activation_state',a_d.activation_state,'monitoring_enabled',a_d.monitoring_enabled));
  a_device_matches:=a_scope and a_d.connection_revision is not distinct from p_revision and a_d.public_ip is not distinct from p_public_ip
   and a_d.expected_ports is not distinct from p_expected_ports and a_d.monitoring_profile is not distinct from p_monitoring_profile
   and a_d.monitoring_enabled and a_d.activation_state in ('active','deactivated');

  if jsonb_typeof(a_identity)='object' and jsonb_typeof(a_master)='object' then
   a_identity_valid:=not exists(select 1 from jsonb_object_keys(a_identity) k where k not in ('unit_key','source','device_name','organization','activation_state','master'))
    and (select count(*) from jsonb_object_keys(a_identity))=6
    and not exists(select 1 from jsonb_object_keys(a_master) k where k not in ('canonical_family','unit_tag','source_label','tracker_state'))
    and (select count(*) from jsonb_object_keys(a_master))=4
    and a_identity=jsonb_build_object('unit_key',a_d.unit_key,'source',a_d.source,'device_name',a_d.device_name,'organization',a_d.organization,'activation_state',a_d.activation_state,'master',a_master)
    and a_master->>'canonical_family' in ('CAMV','Sniper','Sniper 2','Sniper 4')
    and jsonb_typeof(a_master->'unit_tag')='string' and a_master->>'unit_tag'~'^[0-9]{1,6}$'
    and a_master->>'unit_tag'!~'^0+$' and jsonb_typeof(a_master->'source_label')='string'
    and a_master->>'tracker_state' in ('shop','field_or_unknown')
    and a_d.monitoring_profile=case when a_master->>'canonical_family'='CAMV' then 'camv' else 'sniper' end;
   a_normalized_key:=regexp_replace(regexp_replace(upper(btrim(a_d.unit_key)),'\s+',' ','g'),'^CAM V ','CAMV ');
   a_expected_key:=upper((a_master->>'canonical_family')||' '||(a_master->>'unit_tag'));
   a_identity_valid:=a_identity_valid and a_normalized_key=a_expected_key
    and regexp_replace(regexp_replace(upper(btrim(a_master->>'source_label')),'\s+',' ','g'),'^CAM V ','CAMV ')=a_expected_key
    and not exists(select 1 from unnest(array[a_d.unit_key,a_d.device_name,a_d.organization,a_d.activation_state,a_master->>'source_label']) v
      where coalesce(v,'')~*'(^|[^[:alnum:]_])(RETIRED|DECOMMISSIONED|STOLEN|DNU|DO[[:space:]]+NOT[[:space:]]+USE|NOT[[:space:]]+IN[[:space:]]+USE)($|[^[:alnum:]_])');
  end if;
  a_identity_valid:=coalesce(a_identity_valid,false);
  a_device_matches:=coalesce(a_device_matches,false) and a_identity_valid
   and p_revision>=0 and p_source in ('manual_tcp_check','automatic_tcp_sweep')
   and cardinality(p_expected_ports) between 1 and 32 and array_ndims(p_expected_ports)=1 and array_lower(p_expected_ports,1)=1
   and not exists(select 1 from unnest(p_expected_ports) p where p is null or p<1 or p>65535)
   and (select count(distinct p) from unnest(p_expected_ports) p)=cardinality(p_expected_ports)
   and family(p_public_ip)=4 and masklen(p_public_ip)=32
   and not(p_public_ip <<= any(array['0.0.0.0/8','10.0.0.0/8','127.0.0.0/8','224.0.0.0/3','100.64.0.0/10','169.254.0.0/16','172.16.0.0/12',
    '192.168.0.0/16','192.0.0.0/24','192.0.2.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24']::inet[]));
  a_device_matches:=coalesce(a_device_matches,false);

  -- Existing device lock serializes first-state creation. Receipt locks follow
  -- state locks; there is no database transaction across network transport.
  select * into a_state from camera_direct_health_private.attempt_state where camera_device_id=p_device_id for update;
  a_state_exists:=found;
  select * into a_ticket from camera_direct_health_private.attempt_receipts where attempt_id=a_id for update;
  a_ticket_exists:=found;
  a_current:=a_ticket_exists and a_state_exists and a_state.current_attempt_id=a_id
   and a_state.current_sequence=a_ticket.attempt_sequence and a_ticket.binding=a_binding and a_device_matches;

  if a_op in ('begin','read') then
   if jsonb_typeof(p_health) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_health))<>1
     or a_da->'version' is distinct from '1'::jsonb
     or exists(select 1 from jsonb_object_keys(a_da) k where k not in ('version','op','attempt_id','sequence','binding'))
     or a_da?'result' then return jsonb_build_object('ok',false,'reason','invalid_direct_attempt');end if;
   if a_ticket_exists then
    if a_ticket.camera_device_id<>p_device_id or a_ticket.begin_payload is distinct from a_request
     or (a_da?'sequence' and (jsonb_typeof(a_da->'sequence') is distinct from 'string' or a_da->>'sequence'<>a_ticket.attempt_sequence::text)) then
     return jsonb_build_object('ok',false,'reason','attempt_conflict');
    end if;
    -- An expired pending replay never re-authorizes sockets. Completed immutable
    -- receipts remain readable/idempotent after the registration lifetime.
    return coalesce(a_ticket.completion_receipt,a_ticket.registration_receipt)||jsonb_build_object('is_current',
     a_current and (a_ticket.completion_receipt is not null or clock_timestamp()<=a_ticket.expires_at));
   end if;
   if a_op='read' then return jsonb_build_object('ok',false,'reason','attempt_not_found');end if;
   if a_da?'sequence' then return jsonb_build_object('ok',false,'reason','invalid_direct_attempt');end if;
   if not a_scope then return jsonb_build_object('ok',false,'reason','unsupported_direct_scope');end if;
   if not a_device_matches then return jsonb_build_object('ok',false,'reason','connection_changed');end if;
   a_seq:=case when a_state_exists then a_state.current_sequence+1 else 1 end;
   if a_state_exists and a_state.binding=a_binding then
    a_last_definitive:=a_state.last_definitive_at;
    if a_state.phase='completed' and a_state.validity='refused' and a_state.streak_count>0 then
     a_seed:=a_state.streak_count;a_seed_observed:=a_state.observed_at;a_seed_first:=a_state.first_failed_at;
    end if;
   end if;
   a_registered:=clock_timestamp();a_expires:=a_registered+interval '5 minutes';
   a_response:=jsonb_build_object('ok',true,'attempt_id',a_id::text,'sequence',a_seq::text,'phase','pending','binding',a_identity,
    'registered_at',a_registered,'expires_at',a_expires,'validity','pending','status','unknown','consecutive_failures',0,
    'health_published',false,'reason',null,'checked_at',null,'completed_at',null);
   insert into camera_direct_health_private.attempt_receipts(attempt_id,camera_device_id,attempt_sequence,binding,begin_payload,registered_at,expires_at,registration_receipt)
    values(a_id,p_device_id,a_seq,a_binding,a_request,a_registered,a_expires,a_response) on conflict(attempt_id) do nothing;
   if not found then return jsonb_build_object('ok',false,'reason','attempt_conflict');end if;
   insert into camera_direct_health_private.attempt_state(camera_device_id,current_attempt_id,current_sequence,binding,registered_at,expires_at,phase,validity,
    streak_count,seed_count,seed_observed_at,seed_first_failed_at,last_definitive_at)
    values(p_device_id,a_id,a_seq,a_binding,a_registered,a_expires,'pending','pending',0,a_seed,a_seed_observed,a_seed_first,a_last_definitive)
   on conflict(camera_device_id) do update set current_attempt_id=excluded.current_attempt_id,current_sequence=excluded.current_sequence,binding=excluded.binding,
    registered_at=excluded.registered_at,expires_at=excluded.expires_at,phase='pending',validity='pending',observed_at=null,streak_count=0,first_failed_at=null,
    seed_count=excluded.seed_count,seed_observed_at=excluded.seed_observed_at,seed_first_failed_at=excluded.seed_first_failed_at,last_definitive_at=excluded.last_definitive_at;
   return a_response||jsonb_build_object('is_current',true);
  end if;

  if not a_ticket_exists then return jsonb_build_object('ok',false,'reason','attempt_not_found');end if;
  if a_ticket.camera_device_id<>p_device_id or a_ticket.begin_payload is distinct from a_request
   or jsonb_typeof(a_da->'sequence') is distinct from 'string' or a_da->>'sequence'<>a_ticket.attempt_sequence::text then
   return jsonb_build_object('ok',false,'reason','attempt_conflict');
  end if;
  -- Native digest of canonical JSONB freezes retry equality without retaining
  -- arbitrary malformed fields/error text, even in private receipt storage.
  a_payload:=sha256(convert_to(p_health::text,'UTF8'));
  if a_ticket.completion_receipt is not null then
   if a_ticket.completion_payload is distinct from a_payload then return jsonb_build_object('ok',false,'reason','attempt_conflict');end if;
   return a_ticket.completion_receipt||jsonb_build_object('is_current',a_current);
  end if;
  -- Preserve a bounded reported completion separately even for a superseded or
  -- binding-changed ticket; its receipt cannot become a current observation.
  a_result:=a_da->'result';
  if jsonb_typeof(a_result)='object' and jsonb_typeof(a_result->'completed_at')='string' then
   a_reported:=a_result->>'completed_at';
   if length(a_reported)<=40 and a_reported~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
    begin a_observed:=a_reported::timestamptz;
    exception when data_exception then a_observed:=null;end;
   end if;
  end if;
  a_decided:=clock_timestamp();
  a_time_valid:=a_observed is not null and a_observed<=a_received and a_observed>=a_received-interval '5 minutes'
   and a_observed>=date_trunc('milliseconds',a_ticket.registered_at)
   and a_received<=a_ticket.expires_at and a_decided<=a_ticket.expires_at;
  if not a_state_exists or a_state.current_attempt_id<>a_id or a_state.current_sequence<>a_ticket.attempt_sequence then
   a_response:=a_ticket.registration_receipt||jsonb_build_object('phase','completed','validity','unverified','status','unknown','consecutive_failures',0,
    'health_published',false,'reason','superseded','checked_at',null,'completed_at',case when a_time_valid then to_jsonb(a_observed) else 'null'::jsonb end);
   update camera_direct_health_private.attempt_receipts set completion_payload=a_payload,completion_receipt=a_response,
    reported_completed_at=case when a_observed is not null then a_reported else null end,
    valid_observed_at=case when a_time_valid then a_observed else null end,received_at=a_received where attempt_id=a_id;
   return a_response||jsonb_build_object('is_current',false);
  end if;
  if not a_current then
   a_response:=a_ticket.registration_receipt||jsonb_build_object('phase','completed','validity','unverified','status','unknown','consecutive_failures',0,
    'health_published',false,'reason','binding_changed','checked_at',null,'completed_at',case when a_time_valid then to_jsonb(a_observed) else 'null'::jsonb end);
   update camera_direct_health_private.attempt_receipts set completion_payload=a_payload,completion_receipt=a_response,
    reported_completed_at=case when a_observed is not null then a_reported else null end,
    valid_observed_at=case when a_time_valid then a_observed else null end,received_at=a_received where attempt_id=a_id;
   return a_response||jsonb_build_object('is_current',false);
  end if;

  a_invalid:=a_da->'version' is distinct from '1'::jsonb or (select count(*) from jsonb_object_keys(p_health))<>1
   or exists(select 1 from jsonb_object_keys(a_da) k where k not in ('version','op','attempt_id','sequence','binding','result'));
  a_result:=a_da->'result';
  if jsonb_typeof(a_result) is distinct from 'object' then a_invalid:=true;
  else
   if exists(select 1 from jsonb_object_keys(a_result) k where k not in ('completed_at','ports')) or not(a_result?'completed_at') then a_invalid:=true;end if;
   if jsonb_typeof(a_result->'ports')='array' then
    if jsonb_array_length(a_result->'ports')<>cardinality(p_expected_ports) then a_invalid:=true;end if;
    for a_record in select value from jsonb_array_elements(a_result->'ports') loop
     if jsonb_typeof(a_record) is distinct from 'object' then a_invalid:=true;continue;end if;
     if (select count(*) from jsonb_object_keys(a_record))<>4
      or exists(select 1 from jsonb_object_keys(a_record) k where k not in ('port','state','latency_ms','reason'))
      or jsonb_typeof(a_record->'port') is distinct from 'number' or a_record->>'port'!~'^[1-9][0-9]{0,4}$' then a_invalid:=true;continue;end if;
     a_port:=(a_record->>'port')::integer;
     if not(a_port=any(p_expected_ports)) or a_port=any(a_seen) then a_invalid:=true;end if;
     a_seen:=array_append(a_seen,a_port);
     if a_record->>'state'='connected' and a_record->'reason'='null'::jsonb
      and (a_record->'latency_ms'='null'::jsonb or (jsonb_typeof(a_record->'latency_ms')='number' and (a_record->>'latency_ms')::numeric>=0)) then
      a_connected:=true;a_all_refused:=false;
      a_ports:=a_ports||jsonb_build_object(a_port::text,jsonb_build_object('online',true,'latency_ms',a_record->'latency_ms'));
     elsif a_record->>'state'='refused' and a_record->>'reason'='connection_refused' and a_record->'latency_ms'='null'::jsonb then
      a_ports:=a_ports||jsonb_build_object(a_port::text,jsonb_build_object('online',false,'latency_ms',null,'error','connection_refused','failure_kind','endpoint'));
     elsif a_record->>'state'='unverified' and a_record->>'reason' in ('probe_unverified','not_attempted') and a_record->'latency_ms'='null'::jsonb then
      a_all_refused:=false;
      a_ports:=a_ports||jsonb_build_object(a_port::text,jsonb_build_object('online',false,'latency_ms',null,'error','probe_unverified','failure_kind','unverified','reason',a_record->>'reason'));
     else a_invalid:=true;end if;
    end loop;
    if cardinality(a_seen)<>cardinality(p_expected_ports) or (select count(distinct p) from unnest(a_seen) p)<>cardinality(p_expected_ports) then a_invalid:=true;end if;
   elsif not(a_result?'ports') or a_result->'ports'='null'::jsonb then
    a_all_refused:=false;
   else a_invalid:=true;end if;
  end if;

  a_decided:=clock_timestamp();
  a_time_valid:=a_observed is not null and a_observed<=a_received and a_observed>=a_received-interval '5 minutes'
   and a_observed>=date_trunc('milliseconds',a_ticket.registered_at)
   and a_received<=a_ticket.expires_at and a_decided<=a_ticket.expires_at;
  if a_invalid then a_reason:='invalid_result';
  elsif not a_time_valid then a_reason:=case when a_received>a_ticket.expires_at or a_decided>a_ticket.expires_at then 'attempt_expired' else 'invalid_observation_time' end;
  elsif a_state.last_definitive_at is not null and a_observed<a_state.last_definitive_at then a_reason:='older_observation';
  elsif a_connected then a_validity:='connected';a_status:='online';a_reason:=null;
  elsif a_all_refused and cardinality(a_seen)=cardinality(p_expected_ports) then
   a_validity:='refused';a_count:=1;a_first:=a_observed;a_reason:=null;
   if a_state.seed_count>0 and a_state.seed_observed_at<a_observed and a_observed-a_state.seed_observed_at<=interval '20 minutes' then
    a_count:=least(3,a_state.seed_count+1);a_first:=a_state.seed_first_failed_at;
   end if;
   a_status:=case when a_count>=3 then 'offline' else 'verifying' end;
  end if;

  if a_validity in ('connected','refused') then
   select * into a_h from public.camera_health_current where camera_device_id=p_device_id for update;
   -- The final health-row lock can itself wait. Recheck the bounded ticket
   -- after that wait, before any definitive health/device/history mutation.
   a_decided:=clock_timestamp();
   if a_decided>a_ticket.expires_at then
    a_validity:='unverified';a_status:='unknown';a_count:=0;a_first:=null;a_reason:='attempt_expired';a_time_valid:=false;
   end if;
   begin
    if jsonb_typeof(a_h.port_status->'_connection'->'checkedAt')='string' then a_previous_health_at:=(a_h.port_status->'_connection'->>'checkedAt')::timestamptz;end if;
   exception when data_exception then a_previous_health_at:=null;end;
   if a_validity in ('connected','refused') and a_previous_health_at>a_observed then a_validity:='unverified';a_status:='unknown';a_count:=0;a_first:=null;a_reason:='older_observation';end if;
  end if;

  if a_validity in ('connected','refused') then
   a_ports:=a_ports||jsonb_build_object('_connection',jsonb_build_object('revision',a_d.connection_revision::text,'checkedAt',to_jsonb(a_observed),
    'ip',host(a_d.public_ip),'status',a_status,'reachable',a_validity='connected','confirmedOutage',a_count>=3,'consecutiveFailures',a_count));
   insert into public.camera_health_current(camera_device_id,overall_status,ip_reachable,port_status,checked_at,consecutive_failures,detail,
    confirmed_outage,confirmation_reason,first_failed_at,last_recovered_at,acknowledged_at,acknowledged_by)
   values(p_device_id,a_status,a_validity='connected',a_ports,a_observed,a_count,
    case when a_validity='connected' then 'Saved Avigilon service port responded; individual camera health is unverified.' else 'Configured service connection refused on every configured port; individual camera health is unverified.' end,
    a_count>=3,case when a_count>=3 then '3 consecutive refused checks of the saved service endpoint' else null end,
    a_first,case when a_validity='connected' and a_h.overall_status is not null and a_h.overall_status<>'online' then a_observed else a_h.last_recovered_at end,
    case when a_validity='connected' or a_count=1 then null else a_h.acknowledged_at end,
    case when a_validity='connected' or a_count=1 then null else a_h.acknowledged_by end)
   on conflict(camera_device_id) do update set overall_status=excluded.overall_status,ip_reachable=excluded.ip_reachable,port_status=excluded.port_status,
    checked_at=excluded.checked_at,consecutive_failures=excluded.consecutive_failures,detail=excluded.detail,confirmed_outage=excluded.confirmed_outage,
    confirmation_reason=excluded.confirmation_reason,first_failed_at=excluded.first_failed_at,last_recovered_at=excluded.last_recovered_at,
    acknowledged_at=excluded.acknowledged_at,acknowledged_by=excluded.acknowledged_by;
   -- Inherited timestamp compatibility signal only; not an authority boundary.
   perform set_config('cos.connection_publish_device',a_d.id::text,true);
   update public.camera_devices set last_health_checked_at=a_observed,
    last_probe_online_at=case when a_validity='connected' then a_observed else last_probe_online_at end where id=a_d.id;
   perform set_config('cos.connection_publish_device','',true);
   if a_h.overall_status is distinct from a_status then
    insert into public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
    values(a_d.id,a_status,p_source,a_observed,jsonb_build_object('previous_status',a_h.overall_status,'ports',a_ports,'public_ip_used',host(a_d.public_ip),'connection_revision',a_d.connection_revision));
   end if;
  end if;

  a_response:=a_ticket.registration_receipt||jsonb_build_object('phase','completed','validity',a_validity,'status',a_status,
   'consecutive_failures',a_count,'health_published',a_validity in ('connected','refused'),'reason',a_reason,
   'checked_at',case when a_validity in ('connected','refused') then to_jsonb(a_observed) else 'null'::jsonb end,
   'completed_at',case when a_time_valid then to_jsonb(a_observed) else 'null'::jsonb end);
  update camera_direct_health_private.attempt_receipts set completion_payload=a_payload,completion_receipt=a_response,
   reported_completed_at=case when a_observed is not null then a_reported else null end,
   valid_observed_at=case when a_time_valid then a_observed else null end,received_at=a_received where attempt_id=a_id;
  update camera_direct_health_private.attempt_state set phase='completed',validity=a_validity,
   observed_at=case when a_time_valid then a_observed else null end,streak_count=a_count,first_failed_at=a_first,
   seed_count=0,seed_observed_at=null,seed_first_failed_at=null,
   last_definitive_at=case when a_validity in ('connected','refused') then a_observed else last_definitive_at end where camera_device_id=p_device_id;
  return a_response||jsonb_build_object('is_current',true);
 end if;

 -- BEGIN EXACT CAPTURED LEGACY BODY (unrelated profiles only)
declare d public.camera_devices%rowtype; h public.camera_health_current%rowtype; at_time timestamptz; ports jsonb; status_value text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required';end if;
 select * into d from public.camera_devices where id=p_device_id for update;
 if not found or d.connection_revision is distinct from p_revision or d.public_ip is distinct from p_public_ip
   or d.expected_ports is distinct from p_expected_ports or d.monitoring_profile is distinct from p_monitoring_profile
   or not d.monitoring_enabled then return jsonb_build_object('ok',false,'reason','connection_changed');end if;
 if p_source not in ('manual_tcp_check','automatic_tcp_sweep') then raise exception 'Invalid check source';end if;
 at_time:=(p_health->>'checked_at')::timestamptz;
 if at_time is null or at_time>clock_timestamp()+interval '30 seconds' or at_time<clock_timestamp()-interval '5 minutes' then raise exception 'Invalid observation time';end if;
 ports:=p_health->'port_status';status_value:=p_health->>'overall_status';
 if jsonb_typeof(ports)<>'object' or ports='{}'::jsonb or status_value not in ('online','offline','unknown','verifying') then raise exception 'Invalid connection observation';end if;
 if exists(select 1 from jsonb_each(ports) e where e.key!~'^[0-9]{1,5}$' or (case when e.key~'^[0-9]{1,5}$' then e.key::int not between 1 and 65535 else true end) or jsonb_typeof(e.value->'online') is distinct from 'boolean') then raise exception 'Invalid port results';end if;
 select * into h from public.camera_health_current where camera_device_id=d.id for update;
 if (h.port_status->'_connection'->>'checkedAt')::timestamptz>at_time then return jsonb_build_object('ok',false,'reason','newer_observation');end if;
 ports:=ports||jsonb_build_object('_connection',jsonb_build_object('revision',d.connection_revision::text,'checkedAt',to_jsonb(at_time),'ip',host(d.public_ip),'status',status_value,'reachable',(p_health->>'ip_reachable')::boolean,'confirmedOutage',coalesce((p_health->>'confirmed_outage')::boolean,false),'consecutiveFailures',least(3,greatest(0,coalesce((p_health->>'consecutive_failures')::int,0)))));
 insert into public.camera_health_current(camera_device_id,overall_status,ip_reachable,port_status,checked_at,consecutive_failures,detail,confirmed_outage,confirmation_reason,first_failed_at,last_recovered_at,acknowledged_at,acknowledged_by)
 values(d.id,case when lower(d.monitoring_profile) in ('sniper','camv') then status_value else coalesce(d.source_status,'unknown') end,
 (p_health->>'ip_reachable')::boolean,ports,case when lower(d.monitoring_profile) in ('sniper','camv') then at_time else d.source_last_seen_at end,
 case when lower(d.monitoring_profile) in ('sniper','camv') then least(3,greatest(0,coalesce((p_health->>'consecutive_failures')::int,0))) else 0 end,case when lower(d.monitoring_profile) in ('sniper','camv') then left(p_health->>'detail',300) else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then coalesce((p_health->>'confirmed_outage')::boolean,false) else false end,case when lower(d.monitoring_profile) in ('sniper','camv') then left(p_health->>'confirmation_reason',200) else null end,
 case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'first_failed_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'last_recovered_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'acknowledged_at')::timestamptz else null end,case when lower(d.monitoring_profile) in ('sniper','camv') then (p_health->>'acknowledged_by')::uuid else null end)
 on conflict(camera_device_id) do update set
 overall_status=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.overall_status else camera_health_current.overall_status end,
 ip_reachable=excluded.ip_reachable,port_status=excluded.port_status,
 checked_at=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.checked_at else camera_health_current.checked_at end,
 consecutive_failures=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.consecutive_failures else camera_health_current.consecutive_failures end,
 detail=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.detail else camera_health_current.detail end,
 confirmed_outage=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.confirmed_outage else camera_health_current.confirmed_outage end,
 confirmation_reason=case when lower(d.monitoring_profile) in ('sniper','camv') then excluded.confirmation_reason else camera_health_current.confirmation_reason end,
 first_failed_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'first_failed_at' then excluded.first_failed_at else camera_health_current.first_failed_at end,
 last_recovered_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'last_recovered_at' then excluded.last_recovered_at else camera_health_current.last_recovered_at end,
 acknowledged_at=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'acknowledged_at' then excluded.acknowledged_at else camera_health_current.acknowledged_at end,
 acknowledged_by=case when lower(d.monitoring_profile) in ('sniper','camv') and p_health?'acknowledged_by' then excluded.acknowledged_by else camera_health_current.acknowledged_by end;
 perform set_config('cos.connection_publish_device',d.id::text,true);
 update public.camera_devices set last_health_checked_at=case when lower(d.monitoring_profile) in ('sniper','camv') then at_time else last_health_checked_at end,last_probe_online_at=case when (p_health->>'ip_reachable')::boolean then at_time else last_probe_online_at end where id=d.id;
 perform set_config('cos.connection_publish_device','',true);
 if lower(d.monitoring_profile) in ('sniper','camv') and h.overall_status is distinct from status_value then
 insert into public.camera_health_history(camera_device_id,status,check_source,observed_at,detail)
 values(d.id,status_value,p_source,at_time,jsonb_build_object('previous_status',h.overall_status,'ports',ports,'public_ip_used',host(d.public_ip),'connection_revision',d.connection_revision));end if;
 return jsonb_build_object('ok',true,'checked_at',at_time,'revision',d.connection_revision);
end;
 -- END EXACT CAPTURED LEGACY BODY
end $direct_local$;

-- CREATE OR REPLACE preserves the existing function owner and EXECUTE ACL.
-- No role creation, ALTER OWNER or new EXECUTE/schema/table grant is performed.
commit;
