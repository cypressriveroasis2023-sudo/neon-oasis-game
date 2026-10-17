-- REVIEW CANDIDATE. No key material is included or installed here.
-- Requires separately approved matching native Edge secret + private legacy key.
begin;
do $$begin if to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then raise exception 'Reviewed pgcrypto HMAC dependency is required.';end if;end$$;
create table app_private.techcheck_location_keys_v7(key_id text primary key check(key_id='v1'),secret bytea not null check(octet_length(secret)=32),active boolean not null default false);
create table app_private.techcheck_location_receipts_v7(request_id uuid primary key,actor_id uuid not null,purpose text not null check(purpose in ('checkout','inventory_release')),payload jsonb not null,payload_text text not null,proof_sha256 text not null,verified_at timestamptz not null default clock_timestamp());
alter table app_private.techcheck_location_keys_v7 enable row level security;
alter table app_private.techcheck_location_receipts_v7 enable row level security;
revoke all on app_private.techcheck_location_keys_v7,app_private.techcheck_location_receipts_v7 from public,anon,authenticated,service_role;
create trigger techcheck_location_receipt_immutable_v7 before update or delete on app_private.techcheck_location_receipts_v7 for each row execute function app_private.techcheck_release_immutable_v6();
create function app_private.techcheck_consume_location_v7(p_request_id uuid,p_purpose text,p_items jsonb,p_proof jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare secret bytea;payload jsonb;proof_items jsonb;expected jsonb;item jsonb;seconds numeric:=extract(epoch from clock_timestamp());
begin
 if jsonb_typeof(p_proof) is distinct from 'object' or jsonb_typeof(p_proof->'payload') is distinct from 'string' or length(p_proof->>'payload')>30000 or (p_proof->>'signature') is null or (p_proof->>'signature')!~'^[a-f0-9]{64}$' then raise exception 'Current server Shop verification required.';end if;
 select k.secret into secret from app_private.techcheck_location_keys_v7 k where key_id='v1' and active;
 if secret is null or extensions.hmac(convert_to(p_proof->>'payload','UTF8'),secret,'sha256')<>decode(p_proof->>'signature','hex') then raise exception 'Current server Shop verification required.';end if;
 payload:=(p_proof->>'payload')::jsonb;
 if payload->>'version' is distinct from '7' or payload->>'key_id' is distinct from 'v1' or payload->>'organization_id' is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'
 or payload->>'actor_id' is distinct from auth.uid()::text or payload->>'request_id' is distinct from p_request_id::text or payload->>'purpose' is distinct from p_purpose
 or jsonb_typeof(payload->'issued_at') is distinct from 'number' or jsonb_typeof(payload->'expires_at') is distinct from 'number'
 or (payload->>'issued_at')::numeric>seconds+2 or (payload->>'expires_at')::numeric<seconds or (payload->>'expires_at')::numeric>(payload->>'issued_at')::numeric+30
 or (payload->>'expires_at')::numeric<=(payload->>'issued_at')::numeric then raise exception 'Shop verification expired or belongs to a different action. Reload and retry.';end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 20 then raise exception 'Invalid Shop equipment proof.';end if;
 select jsonb_agg(jsonb_build_object('equipment_key',x->'equipment_key','family',x->'family','unit_tag',x->'unit_tag') order by x->>'equipment_key') into expected from jsonb_array_elements(p_items) x;
 select jsonb_agg(jsonb_build_object('equipment_key',x->'equipment_key','family',x->'family','unit_tag',x->'unit_tag') order by x->>'equipment_key') into proof_items from jsonb_array_elements(payload->'items') x;
 if proof_items is distinct from expected then raise exception 'Shop verification does not match the exact equipment.';end if;
 for item in select value from jsonb_array_elements(payload->'items') loop
  if not exists(select 1 from public.equipment_master e where e.equipment_key=item->>'equipment_key' and e.canonical_family=item->>'family' and e.unit_tag=item->>'unit_tag' and e.tracker_state='shop' and e.updated_at=(item->>'legacy_updated_at')::timestamptz) then raise exception 'Saved equipment identity or placement changed. Reload and verify Shop again.';end if;
  if (item->>'authority_sha256') is null or (item->>'authority_sha256')!~'^[a-f0-9]{64}$' or (item->>'native_id') is null or (item->>'tracker_id') is null then raise exception 'Guarded placement identity required.';end if;
 end loop;
 insert into app_private.techcheck_location_receipts_v7(request_id,actor_id,purpose,payload,payload_text,proof_sha256) values(p_request_id,auth.uid(),p_purpose,payload,p_proof->>'payload',encode(sha256(convert_to(p_proof->>'payload','UTF8')),'hex'));
end$$;
revoke all on function app_private.techcheck_consume_location_v7(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Older clients cannot create a fresh checkout without the server observation.
-- Existing receipts, returns, cancellations and identical successful retries keep
-- their original validated behavior.
create or replace function public.submit_techcheck_transfer_v1(p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is null then raise exception 'Active Owner, verified IT or Service account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 if p_kind='checkout' and not exists(select 1 from app_private.techcheck_transfer_events where id=p_request_id) then raise exception 'Reopen this handoff to verify current Shop placement.';end if;
 return app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
end$$;
create function public.submit_techcheck_transfer_v7(p_request_id uuid,p_transfer_id uuid,p_kind text,p_expected_revision integer,p_service_actor uuid,p_items jsonb,p_checks jsonb,p_signature jsonb,p_photos jsonb,p_notes text,p_location_proof jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if app_private.techcheck_transfer_role() is distinct from 'it' or p_kind is distinct from 'checkout' then raise exception 'Verified IT checkout required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 if not exists(select 1 from app_private.techcheck_transfer_events where id=p_request_id) then perform app_private.techcheck_consume_location_v7(p_request_id,'checkout',p_items,p_location_proof);end if;
 return app_private.submit_techcheck_transfer_core_v1(p_request_id,p_transfer_id,p_kind,p_expected_revision,p_service_actor,p_items,p_checks,p_signature,p_photos,p_notes);
end$$;
revoke all on function public.submit_techcheck_transfer_v7(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb) from public,anon,service_role;
grant execute on function public.submit_techcheck_transfer_v7(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb) to authenticated;

alter function public.owner_release_techcheck_return_v6(uuid,uuid,text,uuid,boolean,text) set schema app_private;
revoke all on function app_private.owner_release_techcheck_return_v6(uuid,uuid,text,uuid,boolean,text) from public,anon,authenticated,service_role;
create function public.owner_release_techcheck_return_v7(p_request_id uuid,p_transfer_id uuid,p_equipment_key text,p_return_event_id uuid,p_inventory_confirmed boolean,p_notes text,p_location_proof jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare items jsonb;
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and role::text='owner' and active and archived_at is null) then raise exception 'Active Owner account required.' using errcode='42501';end if;
 if not app_private.techcheck_transfer_ready_v1() then raise exception 'Named handoffs are held for release review.';end if;
 perform pg_advisory_xact_lock(hashtextextended('techcheck-shared-custody-v6',6));
 if not exists(select 1 from app_private.techcheck_inventory_releases_v6 where id=p_request_id) then
  select jsonb_build_array(jsonb_build_object('equipment_key',equipment_key,'family',canonical_family,'unit_tag',unit_tag)) into items from public.equipment_master where equipment_key=p_equipment_key;
  perform app_private.techcheck_consume_location_v7(p_request_id,'inventory_release',items,p_location_proof);
 end if;
 return app_private.owner_release_techcheck_return_v6(p_request_id,p_transfer_id,p_equipment_key,p_return_event_id,p_inventory_confirmed,p_notes);
end$$;
revoke all on function public.owner_release_techcheck_return_v7(uuid,uuid,text,uuid,boolean,text,jsonb) from public,anon,service_role;
grant execute on function public.owner_release_techcheck_return_v7(uuid,uuid,text,uuid,boolean,text,jsonb) to authenticated;

-- Capture the original checkout observation into each exact immutable report.
create function app_private.techcheck_transfer_location_delivery_v7() returns trigger language plpgsql security definer set search_path='' as $$
declare receipt jsonb;
begin
 select jsonb_build_object('proof_sha256',proof_sha256,'verified_at',verified_at,'observation',payload) into receipt from app_private.techcheck_location_receipts_v7 where request_id=new.transfer_id and purpose='checkout';
 if receipt is null then raise exception 'Original checkout Shop verification is missing.';end if;
 new.delivery_snapshot:=new.delivery_snapshot||jsonb_build_object('location_verification',receipt);
 new.snapshot_text:=new.delivery_snapshot::text;new.snapshot_sha256:=encode(sha256(convert_to(new.snapshot_text,'UTF8')),'hex');return new;
end$$;
revoke all on function app_private.techcheck_transfer_location_delivery_v7() from public,anon,authenticated,service_role;
create trigger techcheck_transfer_capture_location_v7 before insert on app_private.techcheck_transfer_outbox for each row execute function app_private.techcheck_transfer_location_delivery_v7();

-- Key availability is a dependency, not activation. All four release flags still
-- must be explicitly approved separately, and all 16 custody triggers must exist.
create or replace function app_private.techcheck_transfer_ready_v1() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and reports_ready and receipt_link_ready and custody_ready from app_private.techcheck_transfer_settings where singleton),false)
 and to_regprocedure('public.techcheck_transfer_context_v1()') is not null
 and to_regprocedure('public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)') is not null
 and exists(select 1 from storage.buckets where id='techcheck-transfer-evidence' and public=false and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg']::text[])
 and exists(select 1 from app_private.techcheck_location_keys_v7 where key_id='v1' and active)
 and to_regprocedure('public.submit_techcheck_transfer_v7(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb)') is not null
 and (select count(*)=16 from pg_trigger where tgname in ('aaa_techcheck_custody_gate_v6','aaa_techcheck_custody_row_v6') and not tgisinternal and tgenabled='O' and tgrelid in ('public.equipment_master'::regclass,'public.unit_registry'::regclass,'public.prep_items'::regclass,'public.prep_tickets'::regclass,'public.unit_returns'::regclass,'public.asset_inventory'::regclass,'public.service_truck_units'::regclass,'public.service_truck_restock_requests'::regclass))
$$;
revoke all on function app_private.techcheck_transfer_ready_v1() from public,anon,authenticated,service_role;
-- Recompile this SQL-bound dependency; PL/pgSQL public probes resolve by name.
create or replace function app_private.techcheck_transfer_file(p_name text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select app_private.techcheck_transfer_ready_v1() and app_private.techcheck_transfer_role() is not null
 and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.jpg$'
 and case when p_write then split_part(p_name,'/',1)=auth.uid()::text and not exists(select 1 from app_private.techcheck_transfer_events e where e.id::text=split_part(p_name,'/',2))
 else split_part(p_name,'/',1)=auth.uid()::text or exists(select 1 from app_private.techcheck_transfer_events e join app_private.techcheck_transfers t on t.id=e.transfer_id where e.id::text=split_part(p_name,'/',2) and (app_private.techcheck_transfer_role()='it' or t.service_actor=auth.uid()) and exists(select 1 from jsonb_array_elements(e.photos) p where p->>'path'=p_name)) end
$$;
-- Close inherited public-schema default grants explicitly. Production defaults
-- grant service_role execution on new public functions; only the delivery
-- wrapper is a server API. Browser entry points retain their own actor gates.
revoke all on function
 public.techcheck_transfer_readiness_v1(),
 public.techcheck_transfer_context_v1(),
 public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text),
 public.submit_techcheck_transfer_v7(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb),
 public.owner_techcheck_return_reviews_v6(),
 public.owner_release_techcheck_return_v7(uuid,uuid,text,uuid,boolean,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function
 public.techcheck_transfer_readiness_v1(),
 public.techcheck_transfer_context_v1(),
 public.submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text),
 public.submit_techcheck_transfer_v7(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb),
 public.owner_techcheck_return_reviews_v6(),
 public.owner_release_techcheck_return_v7(uuid,uuid,text,uuid,boolean,text,jsonb)
to authenticated;
commit;
