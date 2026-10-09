-- Apply in BOTH projects before their source-precedence adapters. No data changes.
begin;
create function app_private.cos_source_precedence_assert(p_binding jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare p jsonb:=p_binding->'sourcePrecedence';k text;
begin
 if not (p_binding ? 'sourcePrecedence') then return;end if;
 if p_binding->>'schemaVersion' is distinct from '1' or p_binding->>'sourceSystem' is distinct from 'mhelpdesk_product_import'
  or p_binding->>'entityKind' is distinct from 'equipment_unit' or p_binding->>'eligibility' is distinct from 'FIELD'
  or jsonb_typeof(p) is distinct from 'object' then raise exception 'Invalid source precedence scope.' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p))<>11 or (p-array['contract','decisionId','reviewedSourceRevision','sourceRevision','unitKey','deviceIds','legacyAuditId','legacyAuditSha256','legacyAuditRowSha256','reviewedAt','reviewKind'])<>'{}'::jsonb
  or p->>'contract' is distinct from 'COS_REVIEWED_SOURCE_PRECEDENCE_V1' or p->>'reviewKind' is distinct from 'administrator_import_review'
  or p->>'sourceRevision' is distinct from p_binding->>'sourceRevision' or p->>'sourceRevision'=p->>'reviewedSourceRevision'
  or jsonb_typeof(p->'unitKey') is distinct from 'string' or length(p->>'unitKey') not between 1 and 250 or p->>'unitKey'<>btrim(p->>'unitKey') or p->>'unitKey'~'[[:cntrl:]]'
  or jsonb_typeof(p->'reviewedAt') is distinct from 'string' or p->>'reviewedAt'!~'^\d{4}-\d\d-\d\dT' then raise exception 'Invalid source precedence decision.' using errcode='22023';end if;
 perform (p->>'reviewedAt')::timestamptz;
 foreach k in array array['decisionId','reviewedSourceRevision','sourceRevision'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or p->>k!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'Invalid precedence revision.' using errcode='22023';end if;
 end loop;
 foreach k in array array['legacyAuditSha256','legacyAuditRowSha256'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or p->>k!~'^[a-f0-9]{64}$' then raise exception 'Invalid precedence digest.' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p->'legacyAuditId') is distinct from 'string' or p->>'legacyAuditId'!~'^[1-9][0-9]{0,18}$' or (p->>'legacyAuditId')::numeric>9223372036854775807
  or jsonb_typeof(p->'deviceIds') is distinct from 'array' then raise exception 'Invalid precedence audit identity.' using errcode='22023';end if;
 if jsonb_array_length(p->'deviceIds') not between 1 and 1000
  or exists(select 1 from jsonb_array_elements(p->'deviceIds') d where jsonb_typeof(d)<>'string' or d#>>'{}'!~'^[1-9][0-9]{0,18}$')
  or exists(select 1 from jsonb_array_elements_text(p->'deviceIds') d where d::numeric>9223372036854775807)
  or (select count(distinct d) from jsonb_array_elements_text(p->'deviceIds') d)<>jsonb_array_length(p->'deviceIds') then raise exception 'Invalid precedence device identity.' using errcode='22023';end if;
end $$;
revoke all on function app_private.cos_source_precedence_assert(jsonb) from public,anon,authenticated;
grant execute on function app_private.cos_source_precedence_assert(jsonb) to service_role;
commit;
