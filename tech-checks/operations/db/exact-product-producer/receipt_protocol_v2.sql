-- REVIEW MIGRATION: legacy camera DB only. No runtime, schedule or public-user grants.
-- REMOTE SOURCE ATTESTATION IS NOT A DISTRIBUTED TRANSACTION. Consumers MUST
-- compare the immutable guard against a NEW complete protected source read.
-- No camera_health_current/history or camera_devices rows are changed.
begin;
create schema if not exists cos_product_tcp_private;
revoke all on schema cos_product_tcp_private from public,anon,authenticated;
grant usage on schema cos_product_tcp_private to service_role;
create table cos_product_tcp_private.receipts (
 receipt_key text primary key check(receipt_key ~ '^[a-f0-9]{64}$'),
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 product_id text not null check(product_id ~ '^[1-9][0-9]{0,14}$'),
 authority_guard text not null check(authority_guard ~ '^[a-f0-9]{64}$'),
 payload jsonb not null,
 checked_at timestamptz not null,
 state text not null check(state in ('pending','accepted','rejected')),
 created_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 unique(receipt_key,payload_sha256)
);
create index receipts_product_guard_time on cos_product_tcp_private.receipts(product_id,authority_guard,checked_at desc,created_at desc) where state='accepted';
alter table cos_product_tcp_private.receipts enable row level security;
revoke all on cos_product_tcp_private.receipts from public,anon,authenticated;
grant select,insert,update on cos_product_tcp_private.receipts to service_role;

-- The immutable payload survives retries and uncertain acknowledgements.
create function cos_product_tcp_private.immutable_receipt() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['state','accepted_at']) is distinct from (to_jsonb(old)-array['state','accepted_at'])
  or old.state<>'pending' or new.state not in ('accepted','rejected')
  or new.state='accepted' and new.accepted_at is null then raise exception 'Immutable receipt';end if;
 return new;
end $$;
revoke all on function cos_product_tcp_private.immutable_receipt() from public,anon,authenticated;
create trigger immutable_product_tcp_receipt before update or delete on cos_product_tcp_private.receipts
for each row execute function cos_product_tcp_private.immutable_receipt();

-- Does not grant authority; checks the complete local physical/configuration
-- tuple supplied by the protected reviewed-identity adapter. SHARE prevents a
-- new competing endpoint appearing while checking the IP membership predicate.
create function cos_product_tcp_private.local_current(p jsonb) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='2s' as $$
declare d public.camera_devices%rowtype; e jsonb; expected jsonb; ip inet; ids bigint[]; ps integer[]; member_count integer;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 if jsonb_typeof(p->'devices') is distinct from 'array' or jsonb_array_length(p->'devices') not between 1 and 16 then return false;end if;
 if p->>'family' is null or p->>'family' not in ('Spotter','Solar Spotter','Ranger') then return false;end if;
 select array_agg((x->>'id')::bigint order by (x->>'id')::bigint) into ids from jsonb_array_elements(p->'devices') x;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then return false;end if;
 ip:=(p->'devices'->0->>'ip')::inet;
 if family(ip)<>4 or masklen(ip)<>32 or ip << '0.0.0.0/8'::inet or ip << '10.0.0.0/8'::inet or ip << '127.0.0.0/8'::inet
  or ip << '100.64.0.0/10'::inet or ip << '169.254.0.0/16'::inet or ip << '172.16.0.0/12'::inet or ip << '192.168.0.0/16'::inet
  or ip << '192.0.0.0/24'::inet or ip << '192.0.2.0/24'::inet or ip << '198.18.0.0/15'::inet or ip << '198.51.100.0/24'::inet
  or ip << '203.0.113.0/24'::inet or ip >= '224.0.0.0'::inet then return false;end if;
 lock table public.camera_devices in share mode;
 select count(*) into member_count from public.camera_devices where public_ip=ip;
 if member_count<>cardinality(ids) then return false;end if;
 for e in select value from jsonb_array_elements(p->'devices') loop
  select * into d from public.camera_devices where id=(e->>'id')::bigint;
  if not found or d.public_ip is distinct from ip or d.monitoring_enabled is distinct from true or d.activation_state not in ('active','deactivated')
   or d.source is distinct from 'vigilant_control_center'
   or d.monitoring_profile is distinct from (case p->>'family' when 'Spotter' then 'spotter' when 'Solar Spotter' then 'solar_spotter' when 'Ranger' then 'ranger' end)
   or concat_ws(' ',d.activation_state,d.unit_key,d.device_name,d.organization) ~* '(^|\W)(RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)($|\W)' then return false;end if;
  expected:=jsonb_build_object('id',d.id::text,'revision',d.connection_revision::text,'ip',host(d.public_ip),'ports',to_jsonb(d.expected_ports),
   'profile',d.monitoring_profile,'source',d.source,'enabled',d.monitoring_enabled,'activation',d.activation_state,'unitKey',d.unit_key,
   'name',d.device_name,'organization',d.organization,'externalId',d.external_device_id,'serial',d.device_serial,'type',d.device_type);
  if e is distinct from expected or d.connection_revision<0 or cardinality(d.expected_ports) not between 1 and 32
   or exists(select 1 from unnest(d.expected_ports) x where x is null or x not between 1 and 65535)
   or cardinality(d.expected_ports)<>(select count(distinct x) from unnest(d.expected_ports) x) then return false;end if;
  if ps is null then select array_agg(x order by x) into ps from unnest(d.expected_ports) x;
  elsif ps is distinct from (select array_agg(x order by x) from unnest(d.expected_ports) x) then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function cos_product_tcp_private.local_current(jsonb) from public,anon,authenticated;
grant execute on function cos_product_tcp_private.local_current(jsonb) to service_role;

create function public.cos_product_tcp_stage_v2(p_receipt_key text,p_payload_text text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='2s' as $$
declare p jsonb; proof jsonb; h text; old cos_product_tcp_private.receipts%rowtype; at_time timestamptz; verified timestamptz; port text; outcome jsonb; n integer;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 if octet_length(p_payload_text)>65536 or p_receipt_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid payload';end if;
 p:=p_payload_text::jsonb;
 if p->>'runId' is null or (p->>'runId') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or p_receipt_key is distinct from encode(sha256(convert_to('COS_PRODUCT_TCP_RECEIPT_V2|'||(p->>'runId')||'|'||(p->'proof'->>'productId'),'UTF8')),'hex') then raise exception 'Invalid receipt identity';end if;
 h:=encode(sha256(convert_to(p_payload_text,'UTF8')),'hex');proof:=p->'proof';
 -- Serialize same-key replay without a source/configuration lock across network IO.
 perform pg_advisory_xact_lock(hashtextextended(p_receipt_key,0));
 select * into old from cos_product_tcp_private.receipts where receipt_key=p_receipt_key;
 if found then
  if old.payload_sha256<>h then return jsonb_build_object('ok',false,'reason','receipt_payload_conflict');end if;
  return jsonb_build_object('ok',true,'receiptKey',old.receipt_key,'payloadSha256',h,'state',old.state);
 end if;
 if p->>'contract' is distinct from 'COS_PRODUCT_TCP_RECEIPT_V2' or proof->>'contract' is distinct from 'COS_PRODUCT_TCP_RECEIPT_V2'
  or (proof->>'productId') is null or (proof->>'nativeUnitId') is null or (proof->>'productId') !~ '^[1-9][0-9]{0,14}$' or (proof->>'nativeUnitId') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  or not(proof ?& array['productId','nativeUnitId','authorityGuard','identityGuard','bindingGuard','sourceSha256','trackerSha256','epochGuard','crosswalkRevision','verifiedAt'])
  or exists(select 1 from unnest(array['authorityGuard','identityGuard','bindingGuard','sourceSha256','trackerSha256','epochGuard']) k where (proof->>k) is null or (proof->>k) !~ '^[a-f0-9]{64}$') then raise exception 'Invalid proof';end if;
 at_time:=(p->>'checkedAt')::timestamptz;verified:=(proof->>'verifiedAt')::timestamptz;
 if at_time is null or verified is null or at_time>clock_timestamp() or at_time<clock_timestamp()-interval '60 seconds'
  or verified<at_time or verified>clock_timestamp() or verified<clock_timestamp()-interval '30 seconds' then return jsonb_build_object('ok',false,'reason','expired_observation');end if;
 if not cos_product_tcp_private.local_current(proof) then return jsonb_build_object('ok',false,'reason','local_source_or_config_changed');end if;
 if jsonb_typeof(p->'ports') is distinct from 'object' then raise exception 'Incomplete ports';end if;
 select count(*) into n from jsonb_object_keys(p->'ports');
 if n<>jsonb_array_length(proof->'devices'->0->'ports') then raise exception 'Incomplete ports';end if;
 for port in select value::text from jsonb_array_elements(proof->'devices'->0->'ports') loop
  outcome:=p->'ports'->port;
  if outcome is null or outcome->'attempted' is distinct from 'true'::jsonb or jsonb_typeof(outcome->'online') is distinct from 'boolean'
   or not(outcome?'latency_ms') or not(outcome->'latency_ms'='null'::jsonb or jsonb_typeof(outcome->'latency_ms')='number' and (outcome->>'latency_ms')::numeric>=0)
   or outcome ?| array['technicalError','errorCode','error_code']
   or (outcome->>'online')::boolean and outcome->>'error' is not null
   or not (outcome->>'online')::boolean and coalesce(outcome->>'error','') not in ('','timeout','Connection refused (os error 111)','Connection timed out (os error 110)') then raise exception 'Incomplete probe';end if;
 end loop;
 insert into cos_product_tcp_private.receipts(receipt_key,payload_sha256,product_id,authority_guard,payload,state,checked_at)
 values(p_receipt_key,h,proof->>'productId',proof->>'authorityGuard',p,'pending',at_time);
 return jsonb_build_object('ok',true,'receiptKey',p_receipt_key,'payloadSha256',h,'state','pending');
end $$;
revoke all on function public.cos_product_tcp_stage_v2(text,text) from public,anon,authenticated;
grant execute on function public.cos_product_tcp_stage_v2(text,text) to service_role;

-- CAS of immutable source/identity attestation + CURRENT local configuration.
-- p_authority_guard is from a NEW full remote read after staging. It is never
-- described as a lock on remote mHelp/native/Sheets data.
create function public.cos_product_tcp_accept_v2(p_receipt_key text,p_payload_sha256 text,p_authority_guard text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='2s' as $$
declare r cos_product_tcp_private.receipts%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 select * into r from cos_product_tcp_private.receipts where receipt_key=p_receipt_key for update;
 if not found or r.payload_sha256 is distinct from p_payload_sha256 or r.authority_guard is distinct from p_authority_guard or r.state='rejected' then return jsonb_build_object('ok',false,'reason','receipt_or_authority_changed');end if;
 if r.state='accepted' then return jsonb_build_object('ok',true,'receiptKey',r.receipt_key,'payloadSha256',r.payload_sha256,'state',r.state);end if;
 if r.created_at<clock_timestamp()-interval '30 seconds' or (r.payload->>'checkedAt')::timestamptz<clock_timestamp()-interval '60 seconds'
  or not cos_product_tcp_private.local_current(r.payload->'proof') then return jsonb_build_object('ok',false,'reason','expired_or_local_changed');end if;
 update cos_product_tcp_private.receipts set state='accepted',accepted_at=clock_timestamp() where receipt_key=r.receipt_key;
 return jsonb_build_object('ok',true,'receiptKey',r.receipt_key,'payloadSha256',r.payload_sha256,'state','accepted');
end $$;
revoke all on function public.cos_product_tcp_accept_v2(text,text,text) from public,anon,authenticated;
grant execute on function public.cos_product_tcp_accept_v2(text,text,text) to service_role;

create function public.cos_product_tcp_read_v2(p_product_id text,p_authority_guard text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public set lock_timeout='2s' as $$
declare r cos_product_tcp_private.receipts%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 select * into r from cos_product_tcp_private.receipts where product_id=p_product_id and authority_guard=p_authority_guard and state='accepted'
  and checked_at>clock_timestamp()-interval '20 minutes' order by checked_at desc,created_at desc limit 1;
 if not found or not cos_product_tcp_private.local_current(r.payload->'proof') then return null;end if;
 return jsonb_build_object('receiptKey',r.receipt_key,'payloadSha256',r.payload_sha256,'state',r.state,'payload',r.payload);
end $$;
revoke all on function public.cos_product_tcp_read_v2(text,text) from public,anon,authenticated;
grant execute on function public.cos_product_tcp_read_v2(text,text) to service_role;
-- Reconcile uncertain responses without retrying probes or publishing again.
create function public.cos_product_tcp_receipt_v2(p_receipt_key text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r cos_product_tcp_private.receipts%rowtype;
begin
 if current_user<>'service_role' then raise exception 'Service principal required' using errcode='42501';end if;
 select * into r from cos_product_tcp_private.receipts where receipt_key=p_receipt_key;
 if not found then return null;end if;
 return jsonb_build_object('ok',true,'receiptKey',r.receipt_key,'payloadSha256',r.payload_sha256,'state',r.state);
end $$;
revoke all on function public.cos_product_tcp_receipt_v2(text) from public,anon,authenticated;
grant execute on function public.cos_product_tcp_receipt_v2(text) to service_role;
commit;
