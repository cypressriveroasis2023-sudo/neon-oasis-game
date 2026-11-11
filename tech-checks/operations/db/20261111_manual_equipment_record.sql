-- Manual equipment record, keyed by mHelp Product ID.
--
-- A person (Owner or IT) records what they know about a piece of equipment:
-- its name, whether it is in the Field or at the Shop, its customer, site and
-- address, and which camera device it is. Every save is an append-only row
-- holding who made it, when, why, and the record before and after. Nothing
-- here is written by automation, and nothing here changes mHelp data or the
-- accepted mHelp inventory. Applying these records to counts is a separate,
-- later step.
--
-- A stale save is an application conflict (PT409), never SQLSTATE 40001:
-- PostgREST retries 40001 without limit and each retry holds an API connection.
begin;
do $$begin if to_regclass('app_private.cos_manual_equipment_edits') is not null or to_regprocedure('public.cos_manual_equipment_v1(uuid,uuid,text,text,uuid,text,jsonb,jsonb)') is not null then raise exception 'Manual equipment objects already exist; review before replacing';end if;end $$;
do $$begin if to_regprocedure('app_private.cos_fleet_shop_actor(uuid,uuid)') is null then raise exception 'Owner/IT actor check is missing; install the Fleet shop action first';end if;end $$;

create table app_private.cos_manual_equipment_edits (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 product_id text not null check (product_id ~ '^[1-9][0-9]{0,17}$'),
 revision integer not null check (revision >= 1),
 actor_id uuid not null references auth.users(id),
 reason text not null check (length(reason) between 1 and 1000),
 changes jsonb not null check (jsonb_typeof(changes) = 'object'),
 record_before jsonb not null check (jsonb_typeof(record_before) = 'object'),
 record_after jsonb not null check (jsonb_typeof(record_after) = 'object'),
 expected jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique (organization_id, product_id, revision)
);
create index cos_manual_equipment_edits_latest on app_private.cos_manual_equipment_edits(organization_id, product_id, revision desc);
alter table app_private.cos_manual_equipment_edits enable row level security;
revoke all on app_private.cos_manual_equipment_edits from public, anon, authenticated;

-- The paper trail cannot be edited or removed, by anyone, through SQL.
create function app_private.cos_manual_equipment_edits_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Manual equipment history cannot be changed' using errcode = '42501'; end $$;
create trigger cos_manual_equipment_edits_no_change before update or delete on app_private.cos_manual_equipment_edits
 for each row execute function app_private.cos_manual_equipment_edits_immutable();
create trigger cos_manual_equipment_edits_no_truncate before truncate on app_private.cos_manual_equipment_edits
 for each statement execute function app_private.cos_manual_equipment_edits_immutable();

-- One validated field. Text is trimmed; null clears the manual value so the
-- field falls back to whatever mHelp says.
create function app_private.cos_manual_equipment_field(p_key text, p_value jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare t text; lim integer;
begin
 if p_value is null or jsonb_typeof(p_value) = 'null' then return 'null'::jsonb; end if;
 if jsonb_typeof(p_value) <> 'string' then raise exception 'Enter text for %', p_key using errcode = '22023'; end if;
 t := btrim(regexp_replace(p_value #>> '{}', '[[:cntrl:]]+', ' ', 'g'));
 if t = '' then return 'null'::jsonb; end if;
 if p_key = 'placement' then
  if t not in ('FIELD', 'SHOP') then raise exception 'Placement must be FIELD or SHOP' using errcode = '22023'; end if;
  return to_jsonb(t);
 end if;
 lim := case p_key when 'displayName' then 120 when 'customer' then 200 when 'siteName' then 200 when 'address' then 400 when 'deviceLink' then 200 when 'note' then 1000 end;
 if lim is null then raise exception 'Unknown field %', p_key using errcode = '22023'; end if;
 if length(t) > lim then raise exception '% is too long', p_key using errcode = '22023'; end if;
 return to_jsonb(t);
end $$;
revoke all on function app_private.cos_manual_equipment_field(text, jsonb) from public, anon, authenticated;

-- The person's display name for the paper trail (null if the profile is gone).
create function app_private.cos_manual_equipment_actor_name(p_actor uuid, p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
 select left(up.display_name, 200) from public.user_profiles up where up.user_id = p_actor and up.organization_id = p_org limit 1 $$;
revoke all on function app_private.cos_manual_equipment_actor_name(uuid, uuid) from public, anon, authenticated;

create function public.cos_manual_equipment_v1(
 p_actor_user_id uuid, p_organization_id uuid, p_product_id text, p_action text default 'read',
 p_request_id uuid default null, p_reason text default null, p_expected jsonb default null, p_changes jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
 latest app_private.cos_manual_equipment_edits; prior app_private.cos_manual_equipment_edits;
 rec jsonb; next_rec jsonb; applied jsonb := '{}'::jsonb; k text; v jsonb; result jsonb; proof text;
 blank constant jsonb := '{"displayName":null,"placement":null,"customer":null,"siteName":null,"address":null,"deviceLink":null,"note":null}'::jsonb;
begin
 perform app_private.cos_fleet_shop_actor(p_actor_user_id, p_organization_id);
 if p_action not in ('read', 'save', 'history') then raise exception 'Invalid manual equipment operation' using errcode = '22023'; end if;
 if p_product_id is null or p_product_id !~ '^[1-9][0-9]{0,17}$' then raise exception 'Choose an mHelp Product ID' using errcode = '22023'; end if;

 if p_action = 'history' then
  return jsonb_build_object('contract', 'COS_MANUAL_EQUIPMENT_HISTORY_V1', 'productId', p_product_id, 'items', coalesce((
   select jsonb_agg(jsonb_build_object('auditId', e.id, 'revision', e.revision, 'actorId', e.actor_id, 'actorName', app_private.cos_manual_equipment_actor_name(e.actor_id, e.organization_id), 'recordedAt', e.created_at,
    'reason', e.reason, 'changes', e.changes, 'before', e.record_before, 'after', e.record_after) order by e.revision desc)
   from (select * from app_private.cos_manual_equipment_edits where organization_id = p_organization_id and product_id = p_product_id order by revision desc limit 200) e), '[]'::jsonb));
 end if;

 if p_action = 'save' then
  if p_request_id is null or length(btrim(coalesce(p_reason, ''))) not between 1 and 1000
   or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_changes) is distinct from 'object'
   or p_changes = '{}'::jsonb then
   raise exception 'Reviewed record, a change and a reason are required' using errcode = '22023';
  end if;
  -- One writer per Product ID, and one outcome per request.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || '|' || p_product_id, 20261111));
  select * into prior from app_private.cos_manual_equipment_edits where id = p_request_id;
  if found and (prior.actor_id <> p_actor_user_id or prior.organization_id <> p_organization_id or prior.product_id <> p_product_id
   or prior.reason <> btrim(p_reason) or prior.expected is distinct from p_expected or prior.changes is distinct from p_changes) then
   raise exception 'Save request was reused with different details' using errcode = 'PT409';
  end if;
 end if;

 select * into latest from app_private.cos_manual_equipment_edits
  where organization_id = p_organization_id and product_id = p_product_id order by revision desc limit 1;
 rec := coalesce(latest.record_after, blank);
 proof := encode(sha256(convert_to(jsonb_build_array(p_organization_id, p_product_id, coalesce(latest.revision, 0), latest.id, rec)::text, 'UTF8')), 'hex');
 result := jsonb_build_object('contract', 'COS_MANUAL_EQUIPMENT_V1', 'productId', p_product_id, 'revision', coalesce(latest.revision, 0),
  'auditId', latest.id, 'recordedAt', latest.created_at, 'recordedBy', latest.actor_id, 'recordedByName', app_private.cos_manual_equipment_actor_name(latest.actor_id, p_organization_id), 'record', rec, 'proof', proof);
 if p_action = 'read' then return result; end if;

 if prior.id is not null then
  -- The same request again: report what it saved, whatever has happened since.
  return jsonb_build_object('contract', 'COS_MANUAL_EQUIPMENT_V1', 'productId', p_product_id, 'revision', prior.revision, 'auditId', prior.id,
   'recordedAt', prior.created_at, 'recordedBy', prior.actor_id, 'recordedByName', app_private.cos_manual_equipment_actor_name(prior.actor_id, p_organization_id), 'record', prior.record_after,
   'proof', encode(sha256(convert_to(jsonb_build_array(p_organization_id, p_product_id, prior.revision, prior.id, prior.record_after)::text, 'UTF8')), 'hex'),
   'saved', true, 'requestId', prior.id, 'replayed', true, 'current', prior.id = latest.id);
 end if;

 if p_expected is distinct from jsonb_build_object('productId', p_product_id, 'revision', coalesce(latest.revision, 0), 'auditId', latest.id, 'proof', proof) then
  raise exception 'This record was changed by someone else. Reload it and try again.' using errcode = 'PT409';
 end if;

 next_rec := rec;
 for k, v in select key, value from jsonb_each(p_changes) loop
  if not (blank ? k) then raise exception 'Unknown field %', k using errcode = '22023'; end if;
  v := app_private.cos_manual_equipment_field(k, v);
  if v is distinct from (rec -> k) then applied := applied || jsonb_build_object(k, v); next_rec := next_rec || jsonb_build_object(k, v); end if;
 end loop;
 if applied = '{}'::jsonb then raise exception 'Nothing would change' using errcode = '22023'; end if;

 insert into app_private.cos_manual_equipment_edits(id, organization_id, product_id, revision, actor_id, reason, changes, record_before, record_after, expected)
 values (p_request_id, p_organization_id, p_product_id, coalesce(latest.revision, 0) + 1, p_actor_user_id, btrim(p_reason), p_changes, rec, next_rec, p_expected)
 returning * into latest;
 return jsonb_build_object('contract', 'COS_MANUAL_EQUIPMENT_V1', 'productId', p_product_id, 'revision', latest.revision, 'auditId', latest.id,
  'recordedAt', latest.created_at, 'recordedBy', latest.actor_id, 'recordedByName', app_private.cos_manual_equipment_actor_name(latest.actor_id, p_organization_id), 'record', latest.record_after,
  'proof', encode(sha256(convert_to(jsonb_build_array(p_organization_id, p_product_id, latest.revision, latest.id, latest.record_after)::text, 'UTF8')), 'hex'),
  'saved', true, 'requestId', latest.id, 'replayed', false, 'current', true, 'applied', applied);
end $$;
revoke all on function public.cos_manual_equipment_v1(uuid, uuid, text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cos_manual_equipment_v1(uuid, uuid, text, text, uuid, text, jsonb, jsonb) to service_role;
commit;
