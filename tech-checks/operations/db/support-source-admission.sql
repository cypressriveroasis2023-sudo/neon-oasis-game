-- REVIEW ARTIFACT, native database only. Apply separately from admission.
-- Existing postgres administrator, existing source importer, no API/role grants.
begin;

-- Permanent reservation and honest administrator provenance. No Owner actor.
-- A withdrawn reservation is retained even if its untouched new target is removed.
create table app_private.cos_support_admissions (
 organization_id uuid not null check (organization_id='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'),
 product_id text primary key,
 identity_key text not null unique,
 tracker_id uuid not null unique,
 request jsonb not null,
 target_snapshot jsonb not null,
 source_revision uuid not null,
 review_receipt jsonb not null,
 admitted_by text not null check (admitted_by='postgres'),
 admitted_at timestamptz not null default clock_timestamp(),
 withdrawn_at timestamptz,
 withdrawn_by text check (withdrawn_by='postgres')
);
alter table app_private.cos_support_admissions enable row level security;
revoke all on app_private.cos_support_admissions from public,anon,authenticated,service_role;

-- This intentionally broad parser is for DENIAL only, never identity binding.
-- All numbers in a typed label are considered, so ambiguous or incomplete
-- capacity/unit permutations fail closed. Different, explicit capacities remain
-- separate when their unit numbers differ. False positives require human review.
create function app_private.cos_support_label_concern(p_label text,p_family text,p_kind text,p_number text)
returns boolean language sql immutable set search_path='' as $$
 with normalized as (select regexp_replace(lower(coalesce(p_label,'')),'[^a-z0-9]','','g') label,
  regexp_replace(coalesce(p_label,''),'solar[ _-]*stands?','','gi') stand_label,
  regexp_replace(coalesce(p_family,''),'solar[ _-]*stands?','','gi') stand_family,
  coalesce(nullif(ltrim(p_number,'0'),''),'0') number)
 select coalesce((
  case when p_kind='stand' then
   (normalized.stand_label~*'(^|[^a-z])(st|stands?)([^a-z]|$)'
    or normalized.stand_family~*'(^|[^a-z])(st|stands?)([^a-z]|$)')
  when p_kind='solar_pole' then
   (coalesce(p_label,'')~*'solar[ _-]*poles?'
    or (coalesce(p_family,'')~*'solar[ _-]*poles?' and normalized.label!~'^(archived?|missing|donotuse)*solar(skids?|stands?)'))
  else false end
  and exists(select 1 from regexp_matches(coalesce(p_label,''),'[0-9]+','g') n
   where coalesce(nullif(ltrim(n[1],'0'),''),'0')=normalized.number
    or (p_kind='solar_pole' and n[1]~('^([1-9][0-9]{1,2})?0*'||normalized.number||'([1-9][0-9]{1,2})?$'))))
  -- Lost separators must not make the same identity appear absent in another
  -- table. Only deny; never use these collapsed forms to bind a target.
  or (p_kind='stand' and regexp_replace(lower(normalized.stand_label),'[^a-z0-9]','','g')
   ~('stands?0*'||normalized.number||'([^0-9]|$)|st0*'||normalized.number||'([^0-9]|$)')),false)
 from normalized
$$;
revoke all on function app_private.cos_support_label_concern(text,text,text,text) from public,anon,authenticated,service_role;

-- Native negative evidence is checked in full, including retired/tombstoned rows,
-- former labels in audit history, provider records and revoked Owner reservations.
-- No label match ever adopts an existing target.
create function app_private.cos_support_assert_absent(p_org uuid,p_record jsonb,p_own_target uuid default null)
returns void language plpgsql security invoker set search_path='' as $$
declare k text:=p_record->>'kind'; n text:=p_record->>'number'; pid text:=p_record->>'productId';
begin
 if current_user is distinct from 'postgres' then raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 if exists(select 1 from public.equipment_units u left join public.equipment_models m on m.id=u.model_id where u.organization_id=p_org and
   (app_private.cos_support_label_concern(u.unit_number,m.name,k,n)
    or app_private.cos_source_label(u.unit_number) in (app_private.cos_source_label(p_record->>'sourceLabel'),app_private.cos_source_label(case when k='stand' then 'ST '||n else 'Solar Pole 72 '||n end))
    or pid in (u.metadata->>'productId',u.metadata->>'product_id',u.metadata->>'sourceProductId')))
 or exists(select 1 from app_private.vision_tracker_locations t where t.organization_id=p_org and t.id is distinct from p_own_target
   and app_private.cos_support_label_concern(t.unit_number,t.family,k,n))
 or exists(select 1 from public.vision_vigilant_devices d where d.organization_id=p_org
   and (app_private.cos_support_label_concern(d.device_name,d.device_type,k,n)
    or app_private.cos_source_label(d.device_name) in (app_private.cos_source_label(p_record->>'sourceLabel'),app_private.cos_source_label(case when k='stand' then 'ST '||n else 'Solar Pole 72 '||n end))))
 or exists(select 1 from public.vision_vigilant_unit_matches m where m.organization_id=p_org
   and (m.equipment_unit_id=p_own_target or app_private.cos_support_label_concern(m.camera_key,null,k,n)))
 or exists(select 1 from public.vision_cameras c where c.organization_id=p_org and
   (c.equipment_unit_id=p_own_target or app_private.cos_support_label_concern(c.camera_key,null,k,n)
    or app_private.cos_support_label_concern(c.internal_name,null,k,n)
    or app_private.cos_support_label_concern(c.customer_label,null,k,n)))
 or exists(select 1 from app_private.cos_geocode_sources s where s.organization_id=p_org and s.native_unit_id is distinct from p_own_target
   and (s.product_id=pid or app_private.cos_support_label_concern(s.unit_number,s.family,k,n)
    or app_private.cos_support_label_concern(s.tracker_unit_number,s.family,k,n)))
 or exists(select 1 from app_private.cos_geocode_source_events e where e.organization_id=p_org and e.native_unit_id is distinct from p_own_target and e.product_id=pid)
 or exists(select 1 from app_private.cos_owner_identity_claims c where c.organization_id=p_org and
   (c.native_unit_id=p_own_target or c.product_association->>'productId'=pid
    or app_private.cos_support_label_concern(c.native_unit_label,null,k,n)
    or app_private.cos_support_label_concern(c.legacy_unit_key,null,k,n)))
 or exists(select 1 from public.audit_events a where a.organization_id=p_org and
   (a.entity_id=p_own_target or exists(select 1 from jsonb_array_elements(jsonb_build_array(a.previous_value,a.new_value)) v
    where exists(select 1 from (values(v->>'unit_number'),(v->>'unitNumber'),(v->>'unit_label'),(v->>'sourceFullLabel'),(v->>'product_model')) label(value)
      cross join (values(v->>'family'),(v->>'unit_family')) family(value)
      where app_private.cos_support_label_concern(label.value,family.value,k,n))
      or pid in (v->>'productId',v->>'product_id',v->>'sourceProductId'))))
 or exists(select 1 from public.equipment_unit_location_history h where h.organization_id=p_org and h.equipment_unit_id=p_own_target)
 or exists(select 1 from app_private.vision_source_inventory_v1 s where s.organization_id=p_org and
   (s.tracker_id=p_own_target or s.registered_unit_id=p_own_target
    or app_private.cos_support_label_concern(s.unit_label,s.unit_family,k,n)
    or s.source_record_id in (pid,'mhelpdesk:'||pid,'mhelp:'||pid)
    or pid in (s.source_payload->>'productId',s.source_payload->>'sourceProductId',s.source_payload->>'product_id')))
 or exists(select 1 from public.mhelpdesk_equipment_catalog c where c.organization_id=p_org and
   (c.product_id::text=pid or app_private.cos_support_label_concern(c.product_model,c.normalized_family,k,n)))
 then raise exception 'Existing identity, provider, Owner, source or historical evidence requires review.' using errcode='40001';end if;
end $$;
revoke all on function app_private.cos_support_assert_absent(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

-- Both admission and withdrawal use this lock order. Table locks also exclude
-- writers that do not know about the import advisory lock. No provider calls.
create function app_private.cos_support_lock_inventory()
returns void language plpgsql security invoker set search_path='' as $$
begin
 if current_user is distinct from 'postgres' then raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 if current_setting('transaction_isolation') is distinct from 'read committed' then
  raise exception 'Fresh READ COMMITTED inventory required.' using errcode='25001';end if;
 if not pg_try_advisory_xact_lock(701117,1) then raise exception 'Another support import is active.' using errcode='55P03';end if;
 lock table public.audit_events,app_private.cos_geocode_source_events,app_private.cos_geocode_sources,
  app_private.cos_owner_identity_claims,app_private.cos_support_admissions,
  public.equipment_models,public.equipment_unit_location_history,public.equipment_units,public.mhelpdesk_equipment_catalog,
  public.vision_cameras,app_private.vision_source_inventory_v1,app_private.vision_tracker_locations,
  public.vision_vigilant_devices,public.vision_vigilant_unit_matches in share row exclusive mode nowait;
end $$;
revoke all on function app_private.cos_support_lock_inventory() from public,anon,authenticated,service_role;

create function app_private.cos_support_admit_reviewed(p_organization_id uuid,p_records jsonb,p_review jsonb,p_apply boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; ext jsonb; a app_private.cos_support_admissions; s app_private.cos_geocode_sources;
 v_id uuid; v_label text; v_family text; v_key text; v_guard text; v_address text; v_result jsonb:='[]'; v_source jsonb;
 v_original jsonb; v_installation jsonb; v_split text[]; v_review_at timestamptz;
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 if p_apply is null or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 100 then
  raise exception 'Invalid bounded support batch.' using errcode='22023';end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='app_private.cos_geocode_sources_admin_import_reviewed(uuid,jsonb)'::regprocedure)
   is distinct from '45a4071388d9823fc9d4442c66012458f8eff56f78957674f27a8625fcbc405d' then
  raise exception 'Reviewed source importer changed.' using errcode='40001';end if;
 -- External projects and files cannot participate in this database transaction.
 -- Require fresh complete review evidence; keep the receipt for independent audit.
 if jsonb_typeof(p_review) is distinct from 'object'
  or (p_review-array['reviewedAt','manifestSha256','sourceFileSha256','classifierVerified','inventories'])<>'{}'::jsonb
  or p_review->>'manifestSha256' !~ '^[a-f0-9]{64}$' or p_review->>'manifestSha256' is null
  or p_review->>'sourceFileSha256' !~ '^[a-f0-9]{64}$' or p_review->>'sourceFileSha256' is null
  or p_review->'classifierVerified' is distinct from 'true'::jsonb
  or jsonb_typeof(p_review->'inventories') is distinct from 'array' or jsonb_array_length(p_review->'inventories')<>4 then
  raise exception 'Complete independent source review and deployed support classifier required.' using errcode='22023';end if;
 v_review_at:=(p_review->>'reviewedAt')::timestamptz;
 if v_review_at is null or v_review_at>clock_timestamp() or v_review_at<clock_timestamp()-interval '10 minutes' then
  raise exception 'External review is stale.' using errcode='40001';end if;
 if (select count(distinct x->>'kind') from jsonb_array_elements(p_review->'inventories') x)<>4 then
  raise exception 'Duplicate external inventory.' using errcode='22023';end if;
 for ext in select value from jsonb_array_elements(p_review->'inventories') loop
  if jsonb_typeof(ext) is distinct from 'object' or (ext-array['kind','sha256','readAt','rowCount','complete','conflicts'])<>'{}'::jsonb
   or coalesce(ext->>'kind','') not in ('mhelp','tracker','archive','legacy')
   or coalesce(ext->>'sha256','')!~'^[a-f0-9]{64}$' or ext->'complete' is distinct from 'true'::jsonb
   or ext->'conflicts' is distinct from '[]'::jsonb or coalesce(ext->>'rowCount','')!~'^(0|[1-9][0-9]{0,8})$'
   or (ext->>'readAt')::timestamptz is null or (ext->>'readAt')::timestamptz>v_review_at
   or (ext->>'readAt')::timestamptz<clock_timestamp()-interval '10 minutes' then
   raise exception 'Incomplete, conflicting or stale external inventory.' using errcode='40001';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_records) x group by x->>'productId' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'kind',x->>'number' having count(*)>1) then
  raise exception 'Duplicate or ambiguous support identity.' using errcode='22023';end if;
 perform app_private.cos_support_lock_inventory();
 for r in select value from jsonb_array_elements(p_records) order by value->>'productId' loop
  if jsonb_typeof(r) is distinct from 'object'
   or (r-array['productId','sourceLabel','kind','number','capacity','sourceCategory','sourceFileSha256','sourceRowSha256','sourceObservedAt','installation','originalInstallation','normalization','customer','siteLabel'])<>'{}'::jsonb
   or exists(select 1 from unnest(array['productId','sourceLabel','kind','number','sourceCategory','sourceFileSha256','sourceRowSha256','sourceObservedAt','normalization']) key
    where jsonb_typeof(r->key) is distinct from 'string')
   or coalesce(r->>'productId','')!~'^[1-9][0-9]{0,18}$' or (r->>'productId')::numeric>9223372036854775807
   or coalesce(r->>'number','')!~'^[0-9]{3}$' or r->>'number'='000'
   or coalesce(r->>'sourceRowSha256','')!~'^[a-f0-9]{64}$'
   or r->>'sourceFileSha256' is distinct from p_review->>'sourceFileSha256'
   or coalesce(r->>'sourceObservedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   or (r->>'sourceObservedAt')::timestamptz is null or not isfinite((r->>'sourceObservedAt')::timestamptz)
   or (r->>'sourceObservedAt')::timestamptz>v_review_at then
   raise exception 'Invalid source-backed support record.' using errcode='22023';end if;
  if r->>'kind'='stand' and r->>'sourceCategory'='Stand' and r->'capacity'='null'::jsonb
   and r->>'sourceLabel' ~ ('^(ST|Stand) '||(r->>'number')||'$') then
   v_label:='ST '||(r->>'number');v_family:='STANDS';v_key:='Stand|'||(r->>'number');
  elsif r->>'kind'='solar_pole' and r->>'sourceCategory'='Solar Pole 72' and r->'capacity'='72'::jsonb
   and r->>'sourceLabel' ~* ('^Solar Pole ('||(r->>'number')||' 72|72 '||(r->>'number')||')( \(Hybrid Solar Stand\))?$') then
   v_label:='Solar Pole 72 '||(r->>'number');v_family:='SOLAR POLES & SKIDS';v_key:='Solar Pole 72|'||(r->>'number');
  else raise exception 'Unsupported or inconsistent complete support identity.' using errcode='22023';end if;
  if coalesce(jsonb_typeof(r->'customer'),'null') not in ('string','null')
   or coalesce(jsonb_typeof(r->'siteLabel'),'null') not in ('string','null') then
   raise exception 'Invalid support display text.' using errcode='22023';end if;
  foreach v_address in array array[r->>'customer',r->>'siteLabel'] loop
   if v_address is not null and (length(v_address) not between 1 and 250 or v_address<>btrim(v_address)
    or v_address~'[[:cntrl:]<>@=]' or v_address~*'https?:|password|passwd|pwd|token|secret|credential|gate[[:space:]-]*code|access[[:space:]-]*code') then
    raise exception 'Unsafe support display text.' using errcode='22023';end if;
  end loop;
  v_installation:=r->'installation';v_original:=r->'originalInstallation';
  if jsonb_typeof(v_installation) is distinct from 'object' or jsonb_typeof(v_original) is distinct from 'object'
   or (v_installation-array['street','city','state','zip'])<>'{}'::jsonb or (v_original-array['street','city','state','zip'])<>'{}'::jsonb then
   raise exception 'Invalid address components.' using errcode='22023';end if;
  if r->>'normalization'='none' then
   if v_original is distinct from v_installation then raise exception 'Unreviewed address change.' using errcode='22023';end if;
  elsif r->>'normalization'='street_in_city_literal_split' then
   -- One road suffix, no invented text, identical supplied state/postcode.
   v_split:=regexp_match(v_original->>'city','^([0-9]{1,8}[A-Za-z]? [A-Za-z0-9 .''-]+ (?:Rd|Road|St|Street|Dr|Drive|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pkwy|Parkway)) ([A-Za-z][A-Za-z .''-]*)$');
   if coalesce(v_original->>'street','')<>'' or v_split is null
    or (select count(*) from regexp_matches(v_original->>'city','\m(Rd|Road|St|Street|Dr|Drive|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pkwy|Parkway)\M','g'))<>1
    or v_installation is distinct from jsonb_build_object('street',v_split[1],'city',v_split[2],'state',v_original->>'state','zip',v_original->>'zip') then
    raise exception 'Unreviewed or ambiguous address split.' using errcode='22023';end if;
  else raise exception 'Unknown address normalization.' using errcode='22023';end if;
  if coalesce(v_installation->>'street','')!~'^[0-9]{1,8}[A-Za-z]? +[A-Za-z0-9 .''-]+$'
   or coalesce(v_installation->>'city','')!~'^[A-Za-z][A-Za-z .''-]*$'
   or coalesce(v_installation->>'state','')<>all(string_to_array('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP',' '))
   or coalesce(v_installation->>'zip','')!~'^[0-9]{5}(-[0-9]{4})?$'
   or v_installation->>'street'<>btrim(v_installation->>'street') or v_installation->>'city'<>btrim(v_installation->>'city')
   or length(v_installation->>'street')>250 or length(v_installation->>'city')>100
   or v_installation::text~'\\u00[0-1][0-9a-f]'
   or (v_installation->>'street')~'[0-9]{3}[ .)-]+[0-9]{3}[ .-]+[0-9]{4}'
   or concat_ws(' ',v_installation->>'street',v_installation->>'city')~*'\m(gate|password|passcode|access[[:space:]]*code|combination|lockbox|login|https?|phone|telephone|tel|contact|notes?|call|email|apt|apartment|suite|ste|unit|floor|bldg|building|customer|username|passwd|pwd|token|secret|credential|code)\M'
   or concat_ws(' ',v_installation->>'street',v_installation->>'city')~*'(password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox)[[:alnum:]_-]*|(gate|access)[[:space:]-]*code[[:alnum:]_-]*' then
   raise exception 'Unsafe or incomplete installation address.' using errcode='22023';end if;
  select * into a from app_private.cos_support_admissions where product_id=r->>'productId';
  if found then
   if a.organization_id<>p_organization_id or a.identity_key<>v_key or a.request is distinct from r or a.withdrawn_at is not null then
    raise exception 'Support reservation cannot be changed or reactivated.' using errcode='40001';end if;
   v_id:=a.tracker_id;
   if a.target_snapshot is distinct from (select to_jsonb(t) from app_private.vision_tracker_locations t where t.id=v_id) then
    raise exception 'Created target has changed.' using errcode='40001';end if;
   select * into s from app_private.cos_geocode_sources where native_unit_id=v_id;
   if not found or not s.active or s.eligibility<>'FIELD' or s.source_revision<>a.source_revision or s.product_id<>a.product_id
    or s.native_guard_sha256 is distinct from app_private.cos_source_native_guard('tracker',v_id,v_id,v_label,v_label) then
    raise exception 'Admitted source has changed.' using errcode='40001';end if;
   perform app_private.cos_support_assert_absent(p_organization_id,r,v_id);
   v_result:=v_result||jsonb_build_array(jsonb_build_object('productId',a.product_id,'trackerId',v_id,'sourceRevision',a.source_revision,'status','already_admitted'));
   continue;
  end if;
  if exists(select 1 from app_private.cos_support_admissions where identity_key=v_key) then
   raise exception 'Support identity is already reserved.' using errcode='40001';end if;
  perform app_private.cos_support_assert_absent(p_organization_id,r);
  if not p_apply then
   v_result:=v_result||jsonb_build_array(jsonb_build_object('productId',r->>'productId','identityKey',v_key,'status','would_admit'));
   continue;
  end if;
  v_address:=app_private.cos_source_address(v_installation->>'street',v_installation->>'city',v_installation->>'state',v_installation->>'zip');
  insert into app_private.vision_tracker_locations(organization_id,unit_number,family,placement,customer,site,address,source_name,source_verified_at)
   values(p_organization_id,v_label,v_family,'FIELD',r->>'customer',r->>'siteLabel',
    concat_ws(', ',v_installation->>'street',v_installation->>'city',concat_ws(' ',v_installation->>'state',v_installation->>'zip')),
    'mHelpDesk product import',(r->>'sourceObservedAt')::timestamptz) returning id into v_id;
  v_guard:=app_private.cos_source_native_guard('tracker',v_id,v_id,v_label,v_label);
  if v_guard is null then raise exception 'Created target is not eligible.' using errcode='40001';end if;
  v_source:=app_private.cos_geocode_sources_admin_import_reviewed(p_organization_id,jsonb_build_array(jsonb_build_object(
   'entityKind','tracker','nativeUnitId',v_id,'trackerId',v_id,'productId',r->>'productId','unitNumber',v_label,'trackerUnitNumber',v_label,
   'family',v_family,'variant',null,'sourceFileSha256',r->>'sourceFileSha256','sourceRowSha256',r->>'sourceRowSha256',
   'installation',v_installation,'addressSha256',encode(sha256(convert_to(v_address,'UTF8')),'hex'),'nativeGuardSha256',v_guard,
   'previousSourceRevision',null,'placement','FIELD','siteLabel',r->>'siteLabel')));
  insert into app_private.cos_support_admissions(organization_id,product_id,identity_key,tracker_id,request,target_snapshot,source_revision,review_receipt,admitted_by)
   select p_organization_id,r->>'productId',v_key,v_id,r,to_jsonb(t),(v_source#>>'{0,sourceRevision}')::uuid,p_review,current_user
   from app_private.vision_tracker_locations t where t.id=v_id;
  v_result:=v_result||jsonb_build_array(jsonb_build_object('productId',r->>'productId','trackerId',v_id,'sourceRevision',v_source#>>'{0,sourceRevision}','status','admitted'));
 end loop;
 return jsonb_build_object('applied',p_apply,'records',v_result);
end $$;
revoke all on function app_private.cos_support_admit_reviewed(uuid,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;

-- Separately authorized withdrawal of ONLY unchanged targets created by this path.
-- This deletes new targets; it is not an in-product restore flow. Original
-- records, source tombstones/events and administrator provenance are retained.
-- Owner/GPS/provider/history/source changes make withdrawal fail closed.
create function app_private.cos_support_withdraw_reviewed(p_organization_id uuid,p_records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; a app_private.cos_support_admissions; s app_private.cos_geocode_sources; result jsonb:='[]'; v_id uuid;
begin
 if current_user is distinct from 'postgres' or p_organization_id is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then
  raise exception 'Existing SQL administrator required.' using errcode='42501';end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) not between 1 and 100
  or exists(select 1 from jsonb_array_elements(p_records) x group by x->>'productId' having count(*)>1) then
  raise exception 'Invalid support withdrawal batch.' using errcode='22023';end if;
 -- Existing source writers take the native-ID advisory lock before table/row
 -- locks. Acquire the same IDs first without waiting, avoiding lock inversion.
 for v_id in select (value->>'trackerId')::uuid from jsonb_array_elements(p_records) order by 1 loop
  if v_id is null then raise exception 'Withdrawal target required.' using errcode='22023';end if;
  if not pg_try_advisory_xact_lock(hashtextextended(v_id::text,701006)) then
   raise exception 'Source target is busy.' using errcode='55P03';end if;
 end loop;
 perform app_private.cos_support_lock_inventory();
 for r in select value from jsonb_array_elements(p_records) order by value->>'productId' loop
  if jsonb_typeof(r) is distinct from 'object' or (r-array['productId','trackerId','sourceRevision'])<>'{}'::jsonb then
   raise exception 'Invalid withdrawal identity.' using errcode='22023';end if;
  select * into a from app_private.cos_support_admissions where product_id=r->>'productId';
  if not found or a.organization_id<>p_organization_id or a.tracker_id is distinct from (r->>'trackerId')::uuid
   or a.source_revision is distinct from (r->>'sourceRevision')::uuid then
   raise exception 'Withdrawal reservation changed.' using errcode='40001';end if;
  if a.withdrawn_at is not null then
   if exists(select 1 from app_private.vision_tracker_locations where id=a.tracker_id)
    or exists(select 1 from app_private.cos_geocode_sources where native_unit_id=a.tracker_id and (active or eligibility<>'tombstone')) then
    raise exception 'Withdrawn identity has changed.' using errcode='40001';end if;
   result:=result||jsonb_build_array(jsonb_build_object('productId',a.product_id,'status','already_withdrawn'));continue;
  end if;
  if a.target_snapshot is distinct from (select to_jsonb(t) from app_private.vision_tracker_locations t where t.id=a.tracker_id) then
   raise exception 'Created target has changed.' using errcode='40001';end if;
  perform app_private.cos_support_assert_absent(p_organization_id,a.request,a.tracker_id);
  select * into s from app_private.cos_geocode_sources where native_unit_id=a.tracker_id;
  if not found or not s.active or s.eligibility<>'FIELD' or s.source_revision<>a.source_revision
   or s.native_guard_sha256 is distinct from app_private.cos_source_native_guard('tracker',a.tracker_id,a.tracker_id,s.unit_number,s.tracker_unit_number) then
   raise exception 'Admitted source has changed.' using errcode='40001';end if;
  perform app_private.cos_geocode_sources_admin_revoke_reviewed(p_organization_id,jsonb_build_array(jsonb_build_object(
   'entityKind','tracker','nativeUnitId',a.tracker_id,'productId',a.product_id,'sourceRevision',a.source_revision)));
  delete from app_private.vision_tracker_locations where id=a.tracker_id;
  update app_private.cos_support_admissions set withdrawn_at=clock_timestamp(),withdrawn_by=current_user where product_id=a.product_id;
  result:=result||jsonb_build_array(jsonb_build_object('productId',a.product_id,'status','withdrawn'));
 end loop;
 return result;
end $$;
revoke all on function app_private.cos_support_withdraw_reviewed(uuid,jsonb) from public,anon,authenticated,service_role;
commit;
