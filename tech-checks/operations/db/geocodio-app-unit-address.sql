-- REVIEW ONLY. Legacy project after geocodio-source-precedence.sql and
-- legacy_owner_identity_epoch.sql. No provider call, camera/audit write or budget
-- change. Deploy readers/queue before enabling the default-off native writer.
begin;
do $$
declare signature text;definition text;
begin
 if to_regclass('app_private.cos_camera_identity_events') is null
  or to_regprocedure('app_private.cos_imported_precedence_guard(jsonb)') is null
  or to_regprocedure('app_private.cos_source_precedence_assert(jsonb)') is null then
  raise exception 'App address queue requires existing identity epochs and source precedence migrations.';end if;
 foreach signature in array array['app_private.cos_imported_lock_binding(uuid,jsonb)',
  'public.cos_imported_geocode_sync(uuid,uuid,text,jsonb,text)','public.cos_imported_geocode_list_due(uuid,integer)',
  'public.cos_imported_geocode_read_many(uuid,jsonb)','app_private.cos_postal_retry_current(app_private.cos_imported_postal_retry_jobs)',
  'public.cos_imported_geocode_postal_ordinary_list_due(uuid,integer)'] loop
  if to_regprocedure(signature) is null then raise exception 'App address queue prerequisite missing: %',signature;end if;
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  if position('app_private.cos_imported_precedence_guard(' in definition)=0 then raise exception 'App address queue guard prerequisite changed: %',signature;end if;
 end loop;
end $$;

-- An append-only placement epoch prevents edit/revert or insert/delete from
-- reviving an older app authority. Only IDs and membership are retained here;
-- the original camera audit rows and their own private history stay untouched.
create table app_private.cos_app_unit_address_placement_events (
 id bigint generated always as identity primary key,
 unit_key text, device_ids bigint[] not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
create index cos_app_unit_address_placement_events_key on app_private.cos_app_unit_address_placement_events(unit_key,id);
alter table app_private.cos_app_unit_address_placement_events enable row level security;
revoke all on app_private.cos_app_unit_address_placement_events from public,anon,authenticated,service_role;
revoke all on sequence app_private.cos_app_unit_address_placement_events_id_seq from public,anon,authenticated,service_role;
create function app_private.cos_app_unit_address_placement_event_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'App address placement epochs are append-only.' using errcode='42501';end $$;
create trigger cos_app_unit_address_placement_event_immutable before update or delete or truncate
 on app_private.cos_app_unit_address_placement_events for each statement execute function app_private.cos_app_unit_address_placement_event_immutable();
create function app_private.cos_app_unit_address_placement_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return null;end if;
 if tg_op in ('UPDATE','DELETE') then
  insert into app_private.cos_app_unit_address_placement_events(unit_key,device_ids) values(old.unit_key,coalesce(old.device_ids,'{}'));
 end if;
 if tg_op='INSERT' or tg_op='UPDATE' and row(new.unit_key,new.device_ids) is distinct from row(old.unit_key,old.device_ids) then
  insert into app_private.cos_app_unit_address_placement_events(unit_key,device_ids) values(new.unit_key,coalesce(new.device_ids,'{}'));
 end if;
 return null;
end $$;
create trigger cos_app_unit_address_placement_changed after insert or update or delete on public.camera_inventory_audit
 for each row execute function app_private.cos_app_unit_address_placement_changed();
create function app_private.cos_app_unit_address_placement_truncated()
returns trigger language plpgsql security definer set search_path='' as $$
begin insert into app_private.cos_app_unit_address_placement_events(unit_key) values(null);return null;end $$;
create trigger cos_app_unit_address_placement_truncated after truncate on public.camera_inventory_audit
 for each statement execute function app_private.cos_app_unit_address_placement_truncated();
revoke all on function app_private.cos_app_unit_address_placement_event_immutable(),app_private.cos_app_unit_address_placement_changed(),app_private.cos_app_unit_address_placement_truncated() from public,anon,authenticated,service_role;

-- Exact typed identity for positive proof. The broader concern key below is
-- exclusively for denial; it never associates camera resources to native units.
create function app_private.cos_app_unit_address_match_key(p_label text)
returns text language plpgsql immutable strict set search_path='' as $$
declare m text[];family text;parts text[];
begin
 m:=regexp_match(btrim(p_label),'^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$','i');
 if m is null then m:=regexp_match(btrim(p_label),'^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$','i');end if;
 if m is null then
  -- Stable admitted non-camera labels (for example 110V stands) still need an
  -- absence proof. Keep the entire label; never use a number/IP as identity.
  if p_label!~'[A-Za-z]' or p_label!~'^[A-Za-z0-9][A-Za-z0-9 .#_-]{0,159}$' then return null;end if;
  return 'full:'||upper(regexp_replace(btrim(p_label),'[[:space:]]+',' ','g'));
 end if;
 family:=regexp_replace(upper(m[1]),'\s','','g');
 family:=case family when 'RI' then 'RECON' when 'RII' then 'RECON2' when 'RECONII' then 'RECON2' else family end;
 parts:=string_to_array(m[2],'.');if parts[1]::integer=0 then return null;end if;
 return 'typed:'||family||'|'||(parts[1]::integer)::text||case when cardinality(parts)>1 then '.'||parts[2] else '' end||case when m[3] is not null then '|'||upper(m[3]) else '' end;
end $$;
create function app_private.cos_app_unit_address_concern_key(p_label text)
returns text language sql immutable strict set search_path='' as $$
 select case when k like 'full:%' then k when k is not null then
  case when split_part(k,'|',1) in ('typed:SPOTTER','typed:SOLARSPOTTER','typed:AXISSPOTTER','typed:AXISSOLARSPOTTER') then 'typed:SPOTTER'
   when split_part(k,'|',1) in ('typed:SNIPER','typed:SNIPER2','typed:SNIPER4') then 'typed:SNIPER'
   when split_part(k,'|',1) in ('typed:RECON','typed:RECON2') then 'typed:RECON'
   else split_part(k,'|',1) end||'|'||split_part(k,'|',2) end
 from (select app_private.cos_app_unit_address_match_key(p_label) k) exact_key
$$;

-- Internal proof reads the complete, locked legacy set. Native duplicates and
-- provider/Owner identity conflicts must independently pass native/HTTP guards.
-- Epoch evidence survives a roster delete/reinsert or relabel-away-and-back.
-- Physical identifiers contribute only to a digest; IP/telemetry are not identity.
create function app_private.cos_app_unit_address_legacy_proof(p_unit_number text,p_legacy_unit_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;concern text;ids bigint[];devices jsonb;audits jsonb;latest public.camera_inventory_audit;events jsonb;placement_events jsonb;
begin
 if p_unit_number is null or length(p_unit_number) not between 1 and 160 or p_unit_number<>btrim(p_unit_number) or p_unit_number~'[[:cntrl:]<>]'
  or p_legacy_unit_key is not null and (length(p_legacy_unit_key) not between 1 and 160 or p_legacy_unit_key<>btrim(p_legacy_unit_key) or p_legacy_unit_key~'[[:cntrl:]<>]') then return null;end if;
 k:=app_private.cos_app_unit_address_match_key(p_unit_number);concern:=app_private.cos_app_unit_address_concern_key(p_unit_number);
 if k is null or not app_private.cos_imported_try_lock_legacy() then return null;end if;
 -- Unknown model labels are absence-only. No camera association is inferred.
 if k like 'full:%' and p_legacy_unit_key is not null then return null;end if;
 select array_agg(d.id order by d.id),coalesce(jsonb_agg(jsonb_build_array(d.id::text,d.unit_key,to_jsonb(d)->>'source',to_jsonb(d)->>'device_type',to_jsonb(d)->>'external_device_id',to_jsonb(d)->>'device_serial') order by d.id),'[]')
 into ids,devices from public.camera_devices d where app_private.cos_app_unit_address_concern_key(d.unit_key)=concern;
 if p_legacy_unit_key is null then
  if cardinality(ids)>0 then return null;end if;
 else
  if app_private.cos_app_unit_address_match_key(p_legacy_unit_key) is distinct from k or coalesce(cardinality(ids),0) not between 1 and 1000
   or exists(select 1 from public.camera_devices d where d.id=any(ids) and d.unit_key is distinct from p_legacy_unit_key) then return null;end if;
  -- A duplicated physical identifier cannot be assigned by the address editor.
  if exists(select 1 from public.camera_devices d join public.camera_devices other on other.id<>d.id
   and to_jsonb(other)->>'source'=to_jsonb(d)->>'source'
   and (nullif(to_jsonb(d)->>'external_device_id','') is not null and to_jsonb(other)->>'external_device_id'=to_jsonb(d)->>'external_device_id'
    or nullif(to_jsonb(d)->>'device_serial','') is not null and to_jsonb(other)->>'device_serial'=to_jsonb(d)->>'device_serial')
   where d.id=any(ids)) then return null;end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into audits from public.camera_inventory_audit a
 where app_private.cos_app_unit_address_concern_key(a.unit_key)=concern or a.device_ids&&coalesce(ids,'{}'::bigint[]);
 if p_legacy_unit_key is null then
  if jsonb_array_length(audits)>0 then return null;end if;
 else
  -- Even an unmarked audit on another key cannot silently migrate this group.
  if exists(select 1 from jsonb_array_elements(audits) a where a->>'unit_key' is distinct from p_legacy_unit_key) then return null;end if;
  select * into latest from public.camera_inventory_audit a
  where app_private.cos_app_unit_address_concern_key(a.unit_key)=concern or a.device_ids&&ids order by a.id desc limit 1;
  if found and (latest.device_ids is null or cardinality(latest.device_ids)<>cardinality(ids)
   or array(select d from unnest(latest.device_ids) d order by d) is distinct from ids) then return null;end if;
 end if;
 select jsonb_build_array(count(*)::text,max(e.id)::text) into events from app_private.cos_camera_identity_events e
 where app_private.cos_app_unit_address_concern_key(e.unit_key)=concern or e.camera_device_id=any(coalesce(ids,'{}'::bigint[]));
 select jsonb_build_array(count(*)::text,max(e.id)::text) into placement_events from app_private.cos_app_unit_address_placement_events e
 where e.unit_key is null or app_private.cos_app_unit_address_concern_key(e.unit_key)=concern or e.device_ids&&coalesce(ids,'{}'::bigint[]);
 return jsonb_build_object('contract','COS_APP_UNIT_ADDRESS_V1','legacyUnitKey',p_legacy_unit_key,
  'legacyIdentitySha256',encode(sha256(convert_to(jsonb_build_array('COS_APP_UNIT_ADDRESS_IDENTITY_V1',p_unit_number,p_legacy_unit_key,devices,events)::text,'UTF8')),'hex'),
  'legacyPlacementSha256',encode(sha256(convert_to(jsonb_build_array('COS_APP_UNIT_ADDRESS_PLACEMENT_V1',p_unit_number,p_legacy_unit_key,audits,placement_events)::text,'UTF8')),'hex'));
end $$;

create function app_private.cos_app_unit_address_assert(p_binding jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare a jsonb:=p_binding->'addressAuthority';
begin
 if not(p_binding ? 'addressAuthority') then return;end if;
 if jsonb_typeof(a) is distinct from 'object' or p_binding->>'entityKind' is distinct from 'tracker' then raise exception 'Invalid app address authority.' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(a))<>5
  or exists(select 1 from jsonb_object_keys(a) k where k not in ('contract','revision','legacyUnitKey','legacyIdentitySha256','legacyPlacementSha256'))
  or a->>'contract' is distinct from 'COS_APP_UNIT_ADDRESS_V1' or p_binding ? 'sourcePrecedence'
  or jsonb_typeof(a->'revision') is distinct from 'string' or a->>'revision' is distinct from p_binding->>'sourceRevision'
  or coalesce(a->>'revision','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or not coalesce(a->'legacyUnitKey'='null'::jsonb or jsonb_typeof(a->'legacyUnitKey')='string' and length(a->>'legacyUnitKey') between 1 and 160
   and a->>'legacyUnitKey'=btrim(a->>'legacyUnitKey') and a->>'legacyUnitKey'!~'[[:cntrl:]<>]',false)
  or jsonb_typeof(a->'legacyIdentitySha256') is distinct from 'string' or coalesce(a->>'legacyIdentitySha256','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(a->'legacyPlacementSha256') is distinct from 'string' or coalesce(a->>'legacyPlacementSha256','')!~'^[a-f0-9]{64}$' then
  raise exception 'Invalid app address authority.' using errcode='22023';end if;
end $$;

-- Same active Owner/allowlisted IT read admission as placement evidence. Queue
-- readers use their existing service identity; no new credential or role exists.
create function public.cos_app_unit_address_legacy_proof(p_organization_id uuid,p_unit_number text,p_legacy_unit_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501';end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' and not app_private.cos_verified_fleet_actor(auth.uid()) then
  raise exception 'Verified fleet account required.' using errcode='42501';end if;
 return app_private.cos_app_unit_address_legacy_proof(p_unit_number,p_legacy_unit_key);
end $$;
create function public.cos_app_unit_address_legacy_capability(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'Organization mismatch.' using errcode='42501';end if;
 if coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role' and not app_private.cos_verified_fleet_actor(auth.uid()) then
  raise exception 'Verified fleet account required.' using errcode='42501';end if;
 return jsonb_build_object('contract','COS_APP_UNIT_ADDRESS_V1','proof',true,'queue',true);
end $$;
create function public.cos_app_unit_address_legacy_proof_many(p_organization_id uuid,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;result jsonb:='[]';
begin
 perform public.cos_app_unit_address_legacy_capability(p_organization_id);
 if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 100 then raise exception 'Invalid bounded address proof batch.' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_sources) loop
  if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['unitNumber','legacyUnitKey']) or (item-array['unitNumber','legacyUnitKey'])<>'{}'::jsonb
   or jsonb_typeof(item->'unitNumber') is distinct from 'string' or jsonb_typeof(item->'legacyUnitKey') not in ('string','null') then raise exception 'Invalid address proof identity.' using errcode='22023';end if;
  result:=result||jsonb_build_array(app_private.cos_app_unit_address_legacy_proof(item->>'unitNumber',item->>'legacyUnitKey'));
 end loop;
 return jsonb_build_object('proofs',result);
end $$;
revoke all on function app_private.cos_app_unit_address_match_key(text),app_private.cos_app_unit_address_concern_key(text),app_private.cos_app_unit_address_legacy_proof(text,text),app_private.cos_app_unit_address_assert(jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.cos_app_unit_address_match_key(text),app_private.cos_app_unit_address_concern_key(text),app_private.cos_app_unit_address_legacy_proof(text,text),app_private.cos_app_unit_address_assert(jsonb) to service_role;
revoke all on function public.cos_app_unit_address_legacy_proof(uuid,text,text),public.cos_app_unit_address_legacy_proof_many(uuid,jsonb),public.cos_app_unit_address_legacy_capability(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cos_app_unit_address_legacy_proof(uuid,text,text),public.cos_app_unit_address_legacy_proof_many(uuid,jsonb),public.cos_app_unit_address_legacy_capability(uuid) to authenticated,service_role;

-- Existing binding validator and central placement guard follow. Their signatures
-- and ACLs are preserved. All six sync/read/claim/finish/postal call sites already
-- use this central guard, so both provider lanes recheck the same proof.
create or replace function app_private.cos_imported_assert_binding(p_organization_id uuid,p_binding jsonb)
returns void language plpgsql set search_path='' as $$
declare k text; address text;
begin
 if p_binding is null or jsonb_typeof(p_binding) is distinct from 'object'
  or not coalesce((p_binding->'schemaVersion'='1'::jsonb and p_binding->>'sourceSystem'='mhelpdesk_product_import' or p_binding->'schemaVersion'='2'::jsonb and p_binding->>'sourceSystem'='google_sheet_tracker'),false) or p_binding->>'organizationId' is distinct from p_organization_id::text
  or p_binding->>'eligibility' is distinct from 'FIELD'
  or p_binding->>'entityKind' is null or p_binding->>'entityKind' not in ('equipment_unit','tracker')
  or (select count(*) from jsonb_object_keys(p_binding-'sourcePrecedence'-'addressAuthority'))<>18
  or exists(select 1 from jsonb_object_keys(p_binding) x where x not in ('schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','sourceRecordId','unitNumber','family','variant','sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','installation','suppliedComponents','eligibility','eventId','sourcePrecedence','addressAuthority')) then
  raise exception 'Invalid imported source binding.' using errcode='22023'; end if;
 perform app_private.cos_source_precedence_assert(p_binding);
 perform app_private.cos_app_unit_address_assert(p_binding);
 perform app_private.cos_imported_source_identity(p_binding);
 foreach k in array array['nativeUnitId','sourceRevision','unitNumber','family','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','eventId'] loop
  if jsonb_typeof(p_binding->k) is distinct from 'string' then raise exception 'Invalid imported source field.' using errcode='22023'; end if;
 end loop;
 if p_binding->>'nativeUnitId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or p_binding->>'sourceRevision'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_binding->>'eventId'!~'^[1-9][0-9]{0,18}$'
 or (p_binding->>'eventId')::numeric>9223372036854775807
  or length(p_binding->>'unitNumber') not between 1 and 160 or length(p_binding->>'family') not between 1 and 160
  or p_binding->>'unitNumber'~'[[:cntrl:]]' or p_binding->>'family'~'[[:cntrl:]]'
  or not (p_binding->'variant'='null'::jsonb or jsonb_typeof(p_binding->'variant')='string' and length(p_binding->>'variant') between 1 and 160 and p_binding->>'variant'!~'[[:cntrl:]]')
  or p_binding->>'sourceFileSha256'!~'^[a-f0-9]{64}$' or p_binding->>'sourceRowSha256'!~'^[a-f0-9]{64}$'
  or p_binding->>'addressSha256'!~'^[a-f0-9]{64}$' or p_binding->>'nativeGuardSha256'!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_binding->'installation') is distinct from 'object' then raise exception 'Invalid imported source fields.' using errcode='22023'; end if;
 if (select count(*) from jsonb_object_keys(p_binding->'installation'))<>4
  or jsonb_typeof(p_binding->'suppliedComponents') is distinct from 'object' then raise exception 'Invalid installation address.' using errcode='22023'; end if;
 foreach k in array array['street','state'] loop
  if jsonb_typeof(p_binding->'installation'->k) is distinct from 'string' or p_binding->'installation'->>k~'[[:cntrl:]]' then raise exception 'Invalid installation component.' using errcode='22023'; end if;
 end loop;
 foreach k in array array['city','zip'] loop
  if p_binding->'installation'->k is null or (p_binding->'installation'->k<>'null'::jsonb and jsonb_typeof(p_binding->'installation'->k) is distinct from 'string')
   or p_binding->'installation'->>k~'[[:cntrl:]]' then raise exception 'Invalid optional installation component.' using errcode='22023'; end if;
 end loop;
 if p_binding#>>'{installation,city}' is null and p_binding#>>'{installation,zip}' is null
  or length(p_binding#>>'{installation,street}') not between 1 and 250
  or p_binding#>>'{installation,city}' is not null and length(p_binding#>>'{installation,city}') not between 1 and 100
  or p_binding#>>'{installation,state}'!~'^[A-Z]{2}$'
  or p_binding#>>'{installation,zip}' is not null and p_binding#>>'{installation,zip}'!~'^[0-9]{5}(-[0-9]{4})?$'
  or p_binding->'suppliedComponents' is distinct from jsonb_build_object('street',true,'state',true,
   'city',p_binding#>>'{installation,city}' is not null,'zip',p_binding#>>'{installation,zip}' is not null) then
  raise exception 'Invalid installation address or supplied component flags.' using errcode='22023'; end if;
 address:=app_private.cos_imported_address(p_binding);
 if address is null or length(address) not between 1 and 600 or p_binding->>'addressSha256' is distinct from encode(sha256(convert_to(address,'UTF8')),'hex') then
  raise exception 'Imported address hash mismatch.' using errcode='22023'; end if;
end $$;


create or replace function app_private.cos_imported_precedence_guard(p_binding jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare g jsonb;proof jsonb;
begin
 if p_binding ? 'addressAuthority' then
  perform app_private.cos_app_unit_address_assert(p_binding);
  if not app_private.cos_imported_try_lock_legacy() then return jsonb_build_object('allowed',false,'busy',true,'sha256',null);end if;
  proof:=app_private.cos_app_unit_address_legacy_proof(p_binding->>'unitNumber',p_binding#>>'{addressAuthority,legacyUnitKey}');
  return jsonb_build_object('allowed',proof is not null and proof is not distinct from ((p_binding->'addressAuthority')-'revision'),
   'sha256',encode(sha256(convert_to(coalesce(proof,'null'::jsonb)::text,'UTF8')),'hex'));
 end if;
 g:=app_private.cos_imported_legacy_guard(p_binding->>'unitNumber');
 if not (p_binding ? 'sourcePrecedence') then return g;end if;
 -- Even an otherwise allowed record with a decision needs the current exact
 -- registered review. Disappearing/relabelled evidence never falls through.
 if g->>'busy'='true' then return g;end if;
 if exists(select 1 from app_private.cos_imported_precedence_reviews r where r.decision_id=(p_binding#>>'{sourcePrecedence,decisionId}')::uuid and r.binding=p_binding)
  and app_private.cos_imported_precedence_matches(p_binding) then return g||jsonb_build_object('allowed',true);end if;
 return g||jsonb_build_object('allowed',false);
end $$;


commit;
