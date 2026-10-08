-- REVIEW ONLY: native project. Owner testimony, never fabricated native/provider proof.
begin;
create table app_private.cos_owner_identity_claims (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null check(organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 native_unit_id uuid not null unique, -- No FK: reservations must survive deletion.
 native_unit_label text not null check(length(native_unit_label) between 1 and 250 and native_unit_label=btrim(native_unit_label)),
 legacy_unit_key text not null check(length(legacy_unit_key) between 1 and 250 and legacy_unit_key=btrim(legacy_unit_key)),
 device_ids text[] not null check(cardinality(device_ids) between 1 and 1000),
 resource_epoch text not null check(resource_epoch~'^[a-f0-9]{64}$'),
 source_epoch text not null check(source_epoch~'^[a-f0-9]{64}$'),
 physical_digest text not null check(physical_digest~'^[a-f0-9]{64}$'),
 provenance text not null check(provenance='owner_confirmation'),
 confirmation_text text not null check(length(confirmation_text) between 1 and 4000),
 evidence_ref text not null check(length(evidence_ref) between 1 and 1000),
 product_association jsonb,
 confirmed_by uuid not null,
 confirmed_at timestamptz not null default clock_timestamp(),
 request_id uuid not null unique,
 request_payload jsonb not null
);
create unique index cos_owner_identity_key_reservation on app_private.cos_owner_identity_claims(upper(btrim(legacy_unit_key)));
create table app_private.cos_owner_identity_resources (
 device_id text primary key check(device_id~'^[1-9][0-9]{0,18}$' and device_id::numeric<=9223372036854775807),
 claim_id uuid not null references app_private.cos_owner_identity_claims(id),
 source text not null, device_type text not null, external_device_id text, device_serial text
);
create unique index cos_owner_identity_external_reservation on app_private.cos_owner_identity_resources(source,external_device_id) where external_device_id is not null;
create unique index cos_owner_identity_serial_reservation on app_private.cos_owner_identity_resources(source,device_serial) where device_serial is not null;
create unique index cos_owner_identity_product_reservation on app_private.cos_owner_identity_claims((product_association->>'productId')) where product_association is not null;
create table app_private.cos_owner_identity_revocations (
 claim_id uuid primary key references app_private.cos_owner_identity_claims(id),
 request_id uuid not null unique,
 revoked_by uuid,
 revoked_at timestamptz not null default clock_timestamp(),
 reason text not null check(length(reason) between 1 and 4000),
 cause text not null check(cause in ('owner_revocation','native_identity_changed'))
);
alter table app_private.cos_owner_identity_claims enable row level security;
alter table app_private.cos_owner_identity_resources enable row level security;
alter table app_private.cos_owner_identity_revocations enable row level security;
revoke all on app_private.cos_owner_identity_claims,app_private.cos_owner_identity_resources,app_private.cos_owner_identity_revocations from public,anon,authenticated,service_role;
create function app_private.cos_owner_identity_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Owner identity evidence and reservations are immutable.' using errcode='42501'; end $$;
revoke all on function app_private.cos_owner_identity_immutable() from public,anon,authenticated,service_role;
create trigger cos_owner_identity_claims_immutable before update or delete or truncate on app_private.cos_owner_identity_claims for each statement execute function app_private.cos_owner_identity_immutable();
create trigger cos_owner_identity_resources_immutable before update or delete or truncate on app_private.cos_owner_identity_resources for each statement execute function app_private.cos_owner_identity_immutable();
create trigger cos_owner_identity_revocations_immutable before update or delete or truncate on app_private.cos_owner_identity_revocations for each statement execute function app_private.cos_owner_identity_immutable();

-- Incarnations exist before a claim does. Late commits and change/revert cannot
-- disappear merely because an approval transaction could not yet see the claim.
create table app_private.cos_owner_identity_source_events (
 id bigint generated always as identity primary key,
 native_unit_id uuid, source text, external_device_id text, created_at timestamptz not null default clock_timestamp(),
 check(native_unit_id is not null or (source is not null and external_device_id is not null))
);
create index cos_owner_identity_source_native on app_private.cos_owner_identity_source_events(native_unit_id,id);
create index cos_owner_identity_source_external on app_private.cos_owner_identity_source_events(source,external_device_id,id);
alter table app_private.cos_owner_identity_source_events enable row level security;
revoke all on app_private.cos_owner_identity_source_events from public,anon,authenticated,service_role;
revoke all on sequence app_private.cos_owner_identity_source_events_id_seq from public,anon,authenticated,service_role;
create trigger cos_owner_identity_source_events_immutable before update or delete or truncate on app_private.cos_owner_identity_source_events for each statement execute function app_private.cos_owner_identity_immutable();
insert into app_private.cos_owner_identity_source_events(native_unit_id) select id from public.equipment_units;
create function app_private.cos_owner_identity_native_epoch(p_id uuid)
returns text language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array('COS_NATIVE_IDENTITY_EPOCH_V1',p_id,count(*),max(id)::text)::text,'UTF8')),'hex') from app_private.cos_owner_identity_source_events where native_unit_id=p_id
$$;
create function app_private.cos_owner_identity_source_epoch(p_id uuid,p_resources jsonb)
returns text language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_array('COS_NATIVE_SOURCE_EPOCH_V1',p_id,count(*),max(e.id)::text)::text,'UTF8')),'hex')
 from app_private.cos_owner_identity_source_events e where e.native_unit_id=p_id or exists(select 1 from jsonb_array_elements(p_resources) r where e.source=r->>'source' and e.external_device_id=r->>'externalId')
$$;
revoke all on function app_private.cos_owner_identity_native_epoch(uuid),app_private.cos_owner_identity_source_epoch(uuid,jsonb) from public,anon,authenticated,service_role;

create function app_private.cos_owner_identity_assert_actor(p_actor uuid,p_org uuid,p_write boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform app_private.appdeploy_assume_actor(p_actor,p_org);
 if p_org is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid
  or not app_private.has_permission(p_org,'equipment.view') then raise exception 'Existing equipment access required.' using errcode='42501'; end if;
 if not exists(select 1 from public.user_profiles p join public.user_roles ur on ur.user_id=p.user_id join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id where p.user_id=p_actor and p.organization_id=p_org and p.active and ((p.department='owner' and r.code='owner') or (not p_write and p.department='it' and r.code='it_technician'))) then raise exception 'Existing Owner or verified IT fleet access required.' using errcode='42501'; end if;
 if p_write and not app_private.has_permission(p_org,'equipment.manage') then raise exception 'Equipment management permission required.' using errcode='42501'; end if;
 if p_write and not exists(select 1 from public.user_profiles p join public.user_roles ur on ur.user_id=p.user_id
  join public.roles r on r.id=ur.role_id and r.organization_id=p.organization_id
  where p.user_id=p_actor and p.organization_id=p_org and p.active and p.department='owner' and r.code='owner') then
  raise exception 'An active existing Owner is required for identity approval.' using errcode='42501'; end if;
end $$;
revoke all on function app_private.cos_owner_identity_assert_actor(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function app_private.cos_owner_identity_snapshot_value(p_org uuid)
returns jsonb language sql stable set search_path='' as $$
 with state as(select c.*, (r.claim_id is not null or c.source_epoch is distinct from app_private.cos_owner_identity_source_epoch(c.native_unit_id,
  coalesce((select jsonb_agg(jsonb_build_object('source',x.source,'externalId',x.external_device_id)) from app_private.cos_owner_identity_resources x where x.claim_id=c.id),'[]'))) as revoked
  from app_private.cos_owner_identity_claims c left join app_private.cos_owner_identity_revocations r on r.claim_id=c.id where c.organization_id=p_org),
 rows as(select id,organization_id,native_unit_id,native_unit_label,legacy_unit_key,device_ids,resource_epoch,physical_digest,provenance,product_association,
  case when revoked then 'revoked' else 'active' end as status,case when revoked then '2' else '1' end as revision from state),
 snapshot as(select coalesce(jsonb_agg(to_jsonb(rows) order by id),'[]'::jsonb) claims from rows),
 events as(select count(*) as n,max(id)::text as last from app_private.cos_owner_identity_source_events),
 native as(select coalesce(jsonb_agg(jsonb_build_object('unitId',u.id,'epoch',app_private.cos_owner_identity_native_epoch(u.id)) order by u.id),'[]'::jsonb) epochs from public.equipment_units u where u.organization_id=p_org)
 select jsonb_build_object('revision',encode(sha256(convert_to(jsonb_build_array(claims,n,last)::text,'UTF8')),'hex'),'claims',claims,'nativeEpochs',epochs) from snapshot,events,native
$$;
revoke all on function app_private.cos_owner_identity_snapshot_value(uuid) from public,anon,authenticated,service_role;
create function public.cos_owner_identity_snapshot(p_actor_user_id uuid,p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,false);
 return app_private.cos_owner_identity_snapshot_value(p_organization_id);
end $$;

create function public.cos_owner_identity_confirm(p_actor_user_id uuid,p_organization_id uuid,p_expected_revision text,p_request_id uuid,p_claim jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u record; c app_private.cos_owner_identity_claims; ids text[]; payload jsonb; product jsonb; captured_source_epoch text;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 if p_request_id is null or p_expected_revision is null or p_expected_revision!~'^[a-f0-9]{64}$' or jsonb_typeof(p_claim) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_claim) k where k not in ('unitId','unitNumber','unitKey','deviceIds','resourceEpoch','nativeEpoch','physicalDigest','physicalResources','provenance','confirmationText','evidenceRef','productAssociation')) then raise exception 'Invalid identity confirmation.' using errcode='22023'; end if;
 if p_claim->>'provenance' is distinct from 'owner_confirmation' or coalesce(p_claim->>'resourceEpoch','')!~'^[a-f0-9]{64}$'
  or coalesce(p_claim->>'physicalDigest','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_claim->'deviceIds') is distinct from 'array'
  or jsonb_array_length(p_claim->'deviceIds') not between 1 and 1000 then raise exception 'Complete Owner confirmation evidence required.' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_claim->'deviceIds') d where jsonb_typeof(d)<>'string' or d#>>'{}'!~'^[1-9][0-9]{0,18}$') then raise exception 'Invalid resource IDs.' using errcode='22023'; end if;
 select array_agg(d order by d::bigint) into ids from jsonb_array_elements_text(p_claim->'deviceIds') d;
 if cardinality(ids)<>(select count(distinct d) from unnest(ids) d) then raise exception 'Duplicate resources.' using errcode='22023'; end if;
 product:=p_claim->'productAssociation';
 if product='null'::jsonb then product:=null; end if;
 if product is not null and (jsonb_typeof(product)<>'object' or (select count(*) from jsonb_object_keys(product))<>3
  or coalesce(product->>'productId','')!~'^[1-9][0-9]{0,18}$' or coalesce(product->>'sourceFileSha256','')!~'^[a-f0-9]{64}$' or coalesce(product->>'sourceRowSha256','')!~'^[a-f0-9]{64}$') then raise exception 'Invalid immutable import evidence.' using errcode='22023'; end if;
 if jsonb_typeof(p_claim->'physicalResources') is distinct from 'array' or jsonb_array_length(p_claim->'physicalResources')<>cardinality(ids)
  or exists(select 1 from jsonb_array_elements(p_claim->'physicalResources') x where jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>5 or not (x ?& array['id','source','type','externalId','serial'])
    or jsonb_typeof(x->'id')<>'string' or not ((x->>'id')=any(ids)) or jsonb_typeof(x->'source')<>'string' or jsonb_typeof(x->'type')<>'string' or coalesce(length(x->>'source'),0) not between 1 and 100 or coalesce(length(x->>'type'),0) not between 1 and 100
    or jsonb_typeof(x->'externalId') not in ('string','null') or jsonb_typeof(x->'serial') not in ('string','null'))
  or (select count(distinct x->>'id') from jsonb_array_elements(p_claim->'physicalResources') x)<>cardinality(ids) then raise exception 'Complete private physical evidence required.' using errcode='22023'; end if;
 if coalesce(p_claim->>'nativeEpoch','')!~'^[a-f0-9]{64}$' then raise exception 'Native identity incarnation required.' using errcode='22023'; end if;
 payload:=jsonb_build_object('expectedRevision',p_expected_revision,'claim',p_claim);
 -- Native row lock precedes all reservations. No global identity clock lock.
 select id,unit_number,organization_id,status into u from public.equipment_units where id=(p_claim->>'unitId')::uuid for update;
 if not found or u.status in ('retired','deleted') or u.organization_id<>p_organization_id or u.unit_number is distinct from p_claim->>'unitNumber' or app_private.cos_owner_identity_native_epoch(u.id) is distinct from p_claim->>'nativeEpoch' then raise exception 'Native identity changed.' using errcode='40001'; end if;
 select * into c from app_private.cos_owner_identity_claims where request_id=p_request_id;
 if found then
  if c.confirmed_by<>p_actor_user_id or c.request_payload is distinct from payload then raise exception 'Request identity was reused.' using errcode='40001'; end if;
  return jsonb_build_object('claimId',c.id,'revision',(select x->>'revision' from jsonb_array_elements(app_private.cos_owner_identity_snapshot_value(p_organization_id)->'claims') x where x->>'id'=c.id::text),'replayed',true);
 end if;
 -- Capture before registry CAS, never adopt a later provider event as the baseline.
 captured_source_epoch:=app_private.cos_owner_identity_source_epoch(u.id,p_claim->'physicalResources');
 if app_private.cos_owner_identity_snapshot_value(p_organization_id)->>'revision' is distinct from p_expected_revision then raise exception 'Identity review changed. Reload.' using errcode='40001'; end if;
 if exists(select 1 from public.vision_vigilant_unit_matches m where m.organization_id=p_organization_id and m.equipment_unit_id=u.id) then raise exception 'An existing provider association requires separate review.' using errcode='40001'; end if;
 if exists(select 1 from public.vision_vigilant_unit_matches m join public.vision_vigilant_devices p on p.id=m.vigilant_device_id
  join jsonb_array_elements(p_claim->'physicalResources') x on p.source=x->>'source' and p.external_device_id=x->>'externalId'
  where m.organization_id=p_organization_id) then raise exception 'A provider association already claims these physical resources.' using errcode='40001'; end if;
 -- Permanent UNIQUE reservations also serialize competing concurrent confirmations.
 insert into app_private.cos_owner_identity_claims(organization_id,native_unit_id,native_unit_label,legacy_unit_key,device_ids,resource_epoch,source_epoch,physical_digest,provenance,confirmation_text,evidence_ref,product_association,confirmed_by,request_id,request_payload)
 values(p_organization_id,u.id,u.unit_number,p_claim->>'unitKey',ids,p_claim->>'resourceEpoch',captured_source_epoch,p_claim->>'physicalDigest','owner_confirmation',p_claim->>'confirmationText',p_claim->>'evidenceRef',product,p_actor_user_id,p_request_id,payload) returning * into c;
 insert into app_private.cos_owner_identity_resources(device_id,claim_id,source,device_type,external_device_id,device_serial)
 select x->>'id',c.id,x->>'source',x->>'type',x->>'externalId',x->>'serial' from jsonb_array_elements(p_claim->'physicalResources') x;
 return jsonb_build_object('claimId',c.id,'revision','1','replayed',false);
end $$;

create function public.cos_owner_identity_revoke(p_actor_user_id uuid,p_organization_id uuid,p_claim_id uuid,p_expected_revision text,p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c app_private.cos_owner_identity_claims; r app_private.cos_owner_identity_revocations;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor_user_id,p_organization_id,true);
 if p_request_id is null or length(btrim(coalesce(p_reason,''))) not between 1 and 4000 or p_expected_revision is distinct from '1' then raise exception 'Current revision and revocation reason required.' using errcode='22023'; end if;
 select * into c from app_private.cos_owner_identity_claims where id=p_claim_id and organization_id=p_organization_id for update;
 if not found then raise exception 'Identity confirmation unavailable.' using errcode='40001'; end if;
 select * into r from app_private.cos_owner_identity_revocations where claim_id=c.id;
 if found then
  if r.request_id=p_request_id and r.revoked_by=p_actor_user_id and r.reason=p_reason then return jsonb_build_object('claimId',c.id,'revision','2','replayed',true); end if;
  raise exception 'This identity was already revoked.' using errcode='40001';
 end if;
 if (select x->>'revision' from jsonb_array_elements(app_private.cos_owner_identity_snapshot_value(p_organization_id)->'claims') x where x->>'id'=c.id::text) is distinct from p_expected_revision then raise exception 'This identity was already revoked by a source change.' using errcode='40001';end if;
 insert into app_private.cos_owner_identity_revocations(claim_id,request_id,revoked_by,reason,cause) values(c.id,p_request_id,p_actor_user_id,p_reason,'owner_revocation');
 return jsonb_build_object('claimId',c.id,'revision','2','replayed',false);
end $$;

create function app_private.cos_owner_identity_native_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then insert into app_private.cos_owner_identity_source_events(native_unit_id) values(new.id);return new;end if;
 if tg_op='UPDATE' and not (new.status in ('retired','deleted') and old.status is distinct from new.status) and row(old.id,old.organization_id,old.unit_number,to_jsonb(old)->'model_id',to_jsonb(old)->'serial_number')
  is not distinct from row(new.id,new.organization_id,new.unit_number,to_jsonb(new)->'model_id',to_jsonb(new)->'serial_number') then return new; end if;
 insert into app_private.cos_owner_identity_source_events(native_unit_id) values(old.id);
 if tg_op='UPDATE' and new.id is distinct from old.id then insert into app_private.cos_owner_identity_source_events(native_unit_id) values(new.id);end if;
 insert into app_private.cos_owner_identity_revocations(claim_id,request_id,reason,cause)
 select id,gen_random_uuid(),'Native physical identity changed or disappeared. Prior commitments remain reserved.','native_identity_changed'
 from app_private.cos_owner_identity_claims where native_unit_id=old.id on conflict(claim_id) do nothing;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.cos_owner_identity_native_changed() from public,anon,authenticated,service_role;
create trigger cos_owner_identity_native_changed after insert or update or delete on public.equipment_units for each row execute function app_private.cos_owner_identity_native_changed();
-- Future native-provider claims are a different provenance and require review.
-- Their addition/removal cannot revive the earlier Owner-confirmed pin.
create function app_private.cos_owner_identity_provider_match_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected jsonb;
begin
 if tg_op='INSERT' then affected:=jsonb_build_array(to_jsonb(new));
 elsif tg_op='DELETE' then affected:=jsonb_build_array(to_jsonb(old));
 else
  if row(old.equipment_unit_id,old.vigilant_device_id,old.organization_id) is not distinct from row(new.equipment_unit_id,new.vigilant_device_id,new.organization_id) then return new; end if;
  affected:=jsonb_build_array(to_jsonb(old),to_jsonb(new));
 end if;
 insert into app_private.cos_owner_identity_source_events(native_unit_id) select distinct (a->>'equipment_unit_id')::uuid from jsonb_array_elements(affected) a where a->>'equipment_unit_id' is not null;
 insert into app_private.cos_owner_identity_source_events(source,external_device_id) select distinct p.source,p.external_device_id from public.vision_vigilant_devices p join jsonb_array_elements(affected) a on p.id::text=a->>'vigilant_device_id' where p.source is not null and p.external_device_id is not null;
 insert into app_private.cos_owner_identity_revocations(claim_id,request_id,reason,cause)
 select distinct c.id,gen_random_uuid(),'A native provider association changed. Review the competing identity provenance.','native_identity_changed'
 from app_private.cos_owner_identity_claims c where exists(select 1 from jsonb_array_elements(affected) a
  where a->>'equipment_unit_id'=c.native_unit_id::text or exists(select 1 from app_private.cos_owner_identity_resources r join public.vision_vigilant_devices p
   on p.source=r.source and p.external_device_id=r.external_device_id where r.claim_id=c.id and p.id::text=a->>'vigilant_device_id')) on conflict(claim_id) do nothing;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
revoke all on function app_private.cos_owner_identity_provider_match_changed() from public,anon,authenticated,service_role;
create trigger cos_owner_identity_provider_match_changed after insert or update or delete on public.vision_vigilant_unit_matches for each row execute function app_private.cos_owner_identity_provider_match_changed();
create function app_private.cos_owner_identity_provider_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and row(old.id,old.source,old.external_device_id,old.device_type) is not distinct from row(new.id,new.source,new.external_device_id,new.device_type) then return new; end if;
 if old.source is not null and old.external_device_id is not null then insert into app_private.cos_owner_identity_source_events(source,external_device_id) values(old.source,old.external_device_id);end if;
 if tg_op='UPDATE' and new.source is not null and new.external_device_id is not null then insert into app_private.cos_owner_identity_source_events(source,external_device_id) values(new.source,new.external_device_id);end if;
 insert into app_private.cos_owner_identity_revocations(claim_id,request_id,reason,cause)
 select distinct r.claim_id,gen_random_uuid(),'A competing provider physical identity changed. Review its provenance.','native_identity_changed'
 from app_private.cos_owner_identity_resources r where ((r.source=old.source and r.external_device_id=old.external_device_id) or (tg_op='UPDATE' and r.source=new.source and r.external_device_id=new.external_device_id))
  and exists(select 1 from public.vision_vigilant_unit_matches m where m.vigilant_device_id=old.id) on conflict(claim_id) do nothing;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.cos_owner_identity_provider_changed() from public,anon,authenticated,service_role;
create trigger cos_owner_identity_provider_changed before update or delete on public.vision_vigilant_devices for each row execute function app_private.cos_owner_identity_provider_changed();
create function app_private.cos_owner_identity_native_truncated()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into app_private.cos_owner_identity_source_events(native_unit_id) select id from public.equipment_units;
 insert into app_private.cos_owner_identity_revocations(claim_id,request_id,reason,cause)
 select id,gen_random_uuid(),'Native inventory was removed. Prior commitments remain reserved.','native_identity_changed'
 from app_private.cos_owner_identity_claims on conflict(claim_id) do nothing;
 return null;
end $$;
revoke all on function app_private.cos_owner_identity_native_truncated() from public,anon,authenticated,service_role;
create trigger cos_owner_identity_native_truncated before truncate on public.equipment_units for each statement execute function app_private.cos_owner_identity_native_truncated();
revoke all on function public.cos_owner_identity_snapshot(uuid,uuid),public.cos_owner_identity_confirm(uuid,uuid,text,uuid,jsonb),public.cos_owner_identity_revoke(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.cos_owner_identity_snapshot(uuid,uuid),public.cos_owner_identity_confirm(uuid,uuid,text,uuid,jsonb),public.cos_owner_identity_revoke(uuid,uuid,uuid,text,uuid,text) to service_role;
commit;
