-- LOCAL REVIEW ARTIFACT. Legacy typed V3 validation only; no queue admissions.
-- Apply before native V3 admission, after V3 bridge/map/queue readers.
-- Source precedence, Owner guards, quota/cache/leases and permissions are unchanged.
begin;
alter table app_private.cos_imported_geocode_jobs drop constraint cos_imported_typed_identity;
alter table app_private.cos_imported_geocode_jobs add constraint cos_imported_typed_identity check(
 (source_system='mhelpdesk_product_import' and product_id is not null and source_record_id is null)
 or (source_system='google_sheet_tracker' and entity_kind in ('tracker','equipment_unit') and product_id is null and source_record_id is not null));

CREATE OR REPLACE FUNCTION app_private.cos_imported_source_identity(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'Invalid typed source identity.' using errcode='22023';end if;
 if p->>'sourceSystem'='google_sheet_tracker' then
  if coalesce(p->>'entityKind','') not in ('tracker','equipment_unit') or p ? 'productId' or jsonb_typeof(p->'sourceRecordId') is distinct from 'string'
   or length(p->>'sourceRecordId')>400 or p->>'sourceRecordId'!~'^google_sheet:[A-Za-z0-9_-]{10,128}:(0|[1-9][0-9]{0,18}):[A-Za-z][A-Za-z0-9 ._-]{0,159}\|[A-Za-z0-9._-]{1,40}$'
   then raise exception 'Invalid tracker source identity.' using errcode='22023';end if;
  return jsonb_build_object('sourceSystem','google_sheet_tracker','sourceRecordId',p->>'sourceRecordId');
 end if;
 if coalesce(p->>'sourceSystem','mhelpdesk_product_import')<>'mhelpdesk_product_import' or p ? 'sourceRecordId'
  or jsonb_typeof(p->'productId') is distinct from 'string' or p->>'productId'!~'^[1-9][0-9]{0,18}$'
  or (p->>'productId')::numeric>9223372036854775807 then raise exception 'Invalid product source identity.' using errcode='22023';end if;
 return jsonb_build_object('sourceSystem','mhelpdesk_product_import','sourceRecordId',p->>'productId');
end $function$;

CREATE OR REPLACE FUNCTION app_private.cos_imported_assert_binding(p_organization_id uuid, p_binding jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare k text; address text;
begin
 if p_binding is null or jsonb_typeof(p_binding) is distinct from 'object'
  or not coalesce((p_binding->'schemaVersion'='1'::jsonb and p_binding->>'sourceSystem'='mhelpdesk_product_import' or p_binding->'schemaVersion'='2'::jsonb and p_binding->>'sourceSystem'='google_sheet_tracker' and p_binding->>'entityKind'='tracker'
   or p_binding->'schemaVersion'='3'::jsonb and p_binding->>'sourceSystem'='google_sheet_tracker' and p_binding->>'entityKind'='equipment_unit'),false) or p_binding->>'organizationId' is distinct from p_organization_id::text
  or p_binding->>'eligibility' is distinct from 'FIELD'
  or p_binding->>'entityKind' is null or p_binding->>'entityKind' not in ('equipment_unit','tracker')
  or (select count(*) from jsonb_object_keys(p_binding-'sourcePrecedence'))<>18
  or exists(select 1 from jsonb_object_keys(p_binding) x where x not in ('schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','sourceRecordId','unitNumber','family','variant','sourceRevision','sourceFileSha256','sourceRowSha256','addressSha256','nativeGuardSha256','installation','suppliedComponents','eligibility','eventId','sourcePrecedence')) then
  raise exception 'Invalid imported source binding.' using errcode='22023'; end if;
 if p_binding->'schemaVersion'='3'::jsonb and (p_binding->>'unitNumber' is distinct from replace(split_part(p_binding->>'sourceRecordId',':',4),'|',' ')
  or p_binding->>'family' is distinct from split_part(split_part(p_binding->>'sourceRecordId',':',4),'|',1)
  or p_binding->'variant' is distinct from 'null'::jsonb) then raise exception 'Exact V3 source identity required.' using errcode='22023';end if;
 perform app_private.cos_source_precedence_assert(p_binding);
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
end $function$;
commit;
