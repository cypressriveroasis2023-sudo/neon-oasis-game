-- REVIEW ARTIFACT ONLY. No enrollment, source writes, new grants, or provider calls.
-- Replaces existing function bodies only after exact deployed-definition digests match.
-- Existing function identities/owners/ACLs/invoker modes are preserved by replacement.
-- The account table already grants service_role SELECT/UPDATE at table level.
-- No retry permission exists until a separate, privately reviewed one-row CAS enrollment.
begin;
do $preflight$
begin
 if not has_table_privilege('service_role','app_private.cos_geocodio_account_state','SELECT')
  or not has_table_privilege('service_role','app_private.cos_geocodio_account_state','UPDATE') then
  raise exception 'Existing service-role table privileges required; do not add grants.'; end if;
end $preflight$;
alter table app_private.cos_geocodio_account_state add column if not exists owner_one_census_v1 jsonb;
alter table app_private.cos_geocodio_account_state add column if not exists owner_census_preparation_v1 jsonb;
do $patch$
declare definition text:=pg_get_functiondef('public.cos_field_geocode_claim(uuid,text,text,text,text)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='29cc852e0646957d17abd80d6cc206fc326532db7f87cc233336b0f56b6d5947' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'f2f031a81b80c46f62e69e6da58793bbb2678ff71f014a1653b43fb0b8a7d3be' then
  raise exception 'Owner one-Census baseline drift: cos_field_geocode_claim.' using errcode='40001'; end if;
 definition:=replace(definition,$before$declare r app_private.cos_field_geocode_cache; v_now timestamptz;$before$,$after$declare r app_private.cos_field_geocode_cache; v_now timestamptz; policy jsonb; one_census boolean:=false;$after$);
 definition:=replace(definition,$before$ perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);$before$,$after$ -- Versioned request discriminator preserves the existing SQL signature. Ordinary claims cannot spend an allowance.
 if p_audit_id like 'owner_one_census_v1:%' then
  one_census:=true;p_audit_id:=substr(p_audit_id,length('owner_one_census_v1:')+1);
 end if;
 perform app_private.cos_geocode_assert_key(p_audit_id,p_unit_key,p_address,p_address_sha256);$after$);
 definition:=replace(definition,$before$ v_now:=clock_timestamp();$before$,$after$
 -- Serialize with enrollment and every fallback reservation, after source/cache locks.
 select owner_one_census_v1 into policy from app_private.cos_geocodio_account_state where singleton for update;
 -- A missing fallback account is not a new dependency for ordinary Census work.
 if policy#>>'{binding,organizationId}'=p_organization_id::text and policy#>>'{binding,addressSha256}'=p_address_sha256 then
  if not one_census or policy#>>'{binding,auditId}' is distinct from p_audit_id
   or policy#>>'{binding,unitKey}' is distinct from p_unit_key
   or policy#>>'{binding,address}' is distinct from p_address
   or policy->>'claimToken' is not null
   or (policy->>'enrolledAt')::timestamptz+interval '480 seconds'>clock_timestamp()
   or exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=p_organization_id
    and x.address_sha256=p_address_sha256 and x.status='pending')
   or exists(select 1 from app_private.cos_imported_census_requests x where x.organization_id=p_organization_id
    and x.address_sha256=p_address_sha256 and x.completed_at is null)
   or exists(select 1 from app_private.cos_geocodio_reservations x where x.organization_id=p_organization_id
    and x.address_sha256=p_address_sha256 and x.completed_at is null)
   or to_jsonb(r) is distinct from policy->'censusBefore'
   or not exists(select 1 from app_private.cos_geocode_current_audit(p_audit_id) a
    where encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=policy#>>'{binding,auditSha256}'
     and to_jsonb(a.device_ids)=policy#>'{binding,deviceIds}') then
   return jsonb_build_object('censusOnly',true,'censusOnlyGuard',jsonb_build_object('nativeUnitId',policy#>>'{binding,nativeUnitId}','nativeGuardSha256',policy#>>'{binding,nativeGuardSha256}'))||jsonb_build_object('claimed',false,'claimToken',null,'reason','owner_one_census_hold','record',app_private.cos_geocode_record(r)||jsonb_build_object('censusOnly',true,'censusOnlyGuard',jsonb_build_object('nativeUnitId',policy#>>'{binding,nativeUnitId}','nativeGuardSha256',policy#>>'{binding,nativeGuardSha256}'),'censusOnlyNotBefore',(policy->>'enrolledAt')::timestamptz+interval '480 seconds','censusOnlyState',case when policy->>'claimToken' is not null then 'consumed' when (policy->>'enrolledAt')::timestamptz+interval '480 seconds'>clock_timestamp() then 'draining' else 'ready' end)); end if;
  v_now:=clock_timestamp();
  update app_private.cos_field_geocode_cache set status='pending',attempts=attempts+1,claim_token=gen_random_uuid(),
   lease_until=v_now+interval '220 seconds',next_attempt_at=null,latitude=null,longitude=null,matched_address=null,geocoded_at=null,reason=null,updated_at=v_now
   where organization_id=p_organization_id and audit_id=p_audit_id returning * into r;
  update app_private.cos_geocodio_account_state set owner_one_census_v1=owner_one_census_v1||
   jsonb_build_object('claimToken',r.claim_token::text,'consumedAt',v_now) where singleton returning owner_one_census_v1 into policy;
  return jsonb_build_object('censusOnly',true,'censusOnlyGuard',jsonb_build_object('nativeUnitId',policy#>>'{binding,nativeUnitId}','nativeGuardSha256',policy#>>'{binding,nativeGuardSha256}'))||jsonb_build_object('claimed',true,'claimToken',r.claim_token,'record',app_private.cos_geocode_record(r)||jsonb_build_object('censusOnly',true,'censusOnlyGuard',jsonb_build_object('nativeUnitId',policy#>>'{binding,nativeUnitId}','nativeGuardSha256',policy#>>'{binding,nativeGuardSha256}'),'censusOnlyNotBefore',(policy->>'enrolledAt')::timestamptz+interval '480 seconds','censusOnlyState',case when policy->>'claimToken' is not null then 'consumed' when (policy->>'enrolledAt')::timestamptz+interval '480 seconds'>clock_timestamp() then 'draining' else 'ready' end));
 end if;
 if one_census then return jsonb_build_object('claimed',false,'claimToken',null,'reason','owner_one_census_not_enrolled','record',null); end if;
 v_now:=clock_timestamp();$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_field_geocode_finish(uuid,text,text,text,text,uuid,text,double precision,double precision,text,text)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='5c29bbc115ac83411c930e3e614ecd6d31078e2bf4e5b46ca476b9443be9bb6a' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'b4e7f481feb904ffd70eeba9ed8c535e8aaa1263a870f64599f7d83d6e62f4cc' then
  raise exception 'Owner one-Census baseline drift: cos_field_geocode_finish.' using errcode='40001'; end if;
 definition:=replace(definition,$before$declare r app_private.cos_field_geocode_cache; v_now timestamptz; v_reason text;$before$,$after$declare r app_private.cos_field_geocode_cache; v_now timestamptz; v_reason text; policy jsonb;$after$);
 definition:=replace(definition,$before$ v_now:=clock_timestamp();$before$,$after$
 select owner_one_census_v1 into policy from app_private.cos_geocodio_account_state where singleton for update;
 -- Ordinary completions remain independent of optional fallback account state.
 if policy#>>'{binding,organizationId}'=p_organization_id::text and policy#>>'{binding,addressSha256}'=p_address_sha256 then
  if policy#>>'{binding,auditId}' is distinct from p_audit_id or policy#>>'{binding,unitKey}' is distinct from p_unit_key
   or policy#>>'{binding,address}' is distinct from p_address or policy->>'claimToken' is distinct from p_claim_token::text
   or not exists(select 1 from app_private.cos_geocode_current_audit(p_audit_id) a
    where encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=policy#>>'{binding,auditSha256}'
     and to_jsonb(a.device_ids)=policy#>'{binding,deviceIds}') then
   return jsonb_build_object('accepted',false,'record',null); end if;
 end if;
 v_now:=clock_timestamp();$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_field_geocode_list_due(uuid,integer,text,text)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='9216960bd195f76057e4417ecf09c9c086285da5107c18248fa58248d5a28d33' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'772e325226040dd09f635f94089f5059b541b5f6b06c52eeea7cbae1c0663970' then
  raise exception 'Owner one-Census baseline drift: cos_field_geocode_list_due.' using errcode='40001'; end if;
 definition:=replace(definition,$before$declare v_result jsonb;$before$,$after$declare v_result jsonb; policy jsonb;$after$);
 definition:=replace(definition,$before$ select coalesce(jsonb_agg(app_private.cos_geocode_record(d)$before$,$after$
 select owner_one_census_v1 into policy from app_private.cos_geocodio_account_state where singleton;
 -- Exact targeted requests can inspect their consumed policy too, preventing HTTP fallback on replay.
 if p_audit_id is not null and policy#>>'{binding,organizationId}'=p_organization_id::text
  and policy#>>'{binding,auditId}'=p_audit_id and policy#>>'{binding,unitKey}'=p_unit_key then
  select coalesce(jsonb_agg(app_private.cos_geocode_record(c)||jsonb_build_object('censusOnly',true,
   'censusOnlyGuard',jsonb_build_object('nativeUnitId',policy#>>'{binding,nativeUnitId}','nativeGuardSha256',policy#>>'{binding,nativeGuardSha256}'),
   'censusOnlyNotBefore',(policy->>'enrolledAt')::timestamptz+interval '480 seconds','censusOnlyState',case when policy->>'claimToken' is not null then 'consumed' when (policy->>'enrolledAt')::timestamptz+interval '480 seconds'>clock_timestamp() then 'draining' else 'ready' end)),'[]') into v_result
  from app_private.cos_field_geocode_cache c where c.organization_id=p_organization_id and c.audit_id=p_audit_id
   and c.unit_key=p_unit_key and c.address=policy#>>'{binding,address}' and c.address_sha256=policy#>>'{binding,addressSha256}';
  return v_result;
 end if;
 select coalesce(jsonb_agg(app_private.cos_geocode_record(d)$after$);
 definition:=replace(definition,$before$   and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)$before$,$after$   and not coalesce(policy#>>'{binding,organizationId}'=p_organization_id::text
    and policy#>>'{binding,addressSha256}'=c.address_sha256,false)
   and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_field_geocode_fallback_list_due(uuid,integer,text,text)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='3f734a3732931870ec564128022b2f33c79c29a705daa4aea8afca3d24be1a26' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'823f04532ae3f08802a6fc14c06c9bb6a67f4c1828b3e0a85791dac57322b968' then
  raise exception 'Owner one-Census baseline drift: cos_field_geocode_fallback_list_due.' using errcode='40001'; end if;
 definition:=replace(definition,$before$   and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)$before$,$after$   and not exists(select 1 from app_private.cos_geocodio_account_state g where g.singleton
    and g.owner_one_census_v1#>>'{binding,organizationId}'=c.organization_id::text
    and g.owner_one_census_v1#>>'{binding,addressSha256}'=c.address_sha256)
   and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key)$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_field_geocode_fallback_reserve(uuid,text,text,text,text,uuid)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='d9668a962ebabafc93f1263b41b11404f399ee06d1bdc68989af23f14bc4f02e' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'db961fd831fd79442ee195fc14bb68d945f05be7ec4e75a13974325b8eb2d983' then
  raise exception 'Owner one-Census baseline drift: cos_field_geocode_fallback_reserve.' using errcode='40001'; end if;
 definition:=replace(definition,$before$ if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','configuration_unavailable','record',null); end if;$before$,$after$ if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','configuration_unavailable','record',null); end if;
 if account.owner_one_census_v1#>>'{binding,organizationId}'=p_organization_id::text
  and account.owner_one_census_v1#>>'{binding,addressSha256}'=p_address_sha256 then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','owner_one_census_hold','record',null); end if;$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_imported_geocode_reserve(uuid,jsonb,uuid)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='051dbd386f7ee267c2a9cfb2484a19deb310830e747dd0885643ee529b3ec468' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'c0b3b72bcf45f34f74994acfbdf15adf837ad6e38e5bccde7c60538b3d261274' then
  raise exception 'Owner one-Census baseline drift: cos_imported_geocode_reserve.' using errcode='40001'; end if;
 definition:=replace(definition,$before$ if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','configuration_unavailable','record',null); end if;$before$,$after$ if not found then return jsonb_build_object('reserved',false,'reservationToken',null,'reason','configuration_unavailable','record',null); end if;
 if account.owner_one_census_v1#>>'{binding,organizationId}'=p_organization_id::text
  and account.owner_one_census_v1#>>'{binding,addressSha256}'=p_address_sha256 then
  return jsonb_build_object('reserved',false,'reservationToken',null,'reason','owner_one_census_hold','record',null); end if;$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_imported_geocode_census_claim(uuid,jsonb,uuid)'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='f7d0af6ed07ef8c8735b20a5d0cac162e0d95220530e04c555f39b5248281a2f' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'9938334fbe49ed71644a8d1ba2212cd1009d971c945239c0e137ced74c2337cd' then
  raise exception 'Owner one-Census baseline drift: cos_imported_geocode_census_claim.' using errcode='40001'; end if;
 definition:=replace(definition,$before$ if not found then return jsonb_build_object('claimed',false,'claimToken',null,'reason','configuration_unavailable','record',null); end if;$before$,$after$ if not found then return jsonb_build_object('claimed',false,'claimToken',null,'reason','configuration_unavailable','record',null); end if;
 if exists(select 1 from app_private.cos_geocodio_account_state g where g.singleton
  and g.owner_one_census_v1#>>'{binding,organizationId}'=p_organization_id::text
  and g.owner_one_census_v1#>>'{binding,addressSha256}'=sha) then
  return jsonb_build_object('claimed',false,'claimToken',null,'reason','owner_one_census_hold','record',null); end if;$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('public.cos_field_geocode_read_many(uuid,text[])'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='e25ef2d4188f1aaa35289079bef2c793c900259006b5ec4b9931f07b1cd729be' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'2dbd7ba18e4614f2e49a1ec46f5eee2070c0946684c20f46434a793cef8f1797' then
  raise exception 'Owner one-Census baseline drift: cos_field_geocode_read_many.' using errcode='40001'; end if;
 definition:=replace(definition,$before$declare v_result jsonb;$before$,$after$declare v_result jsonb; policy jsonb; prep jsonb;$after$);
 definition:=replace(definition,$before$ select coalesce(jsonb_agg(app_private.cos_geocode_record(c) order by c.audit_id),'[]') into v_result$before$,$after$ select owner_one_census_v1,owner_census_preparation_v1 into policy,prep from app_private.cos_geocodio_account_state where singleton;
 select coalesce(jsonb_agg(app_private.cos_geocode_record(c)||case when
  policy#>>'{binding,organizationId}'=c.organization_id::text and policy#>>'{binding,auditId}'=c.audit_id
  and policy#>>'{binding,unitKey}'=c.unit_key and policy#>>'{binding,address}'=c.address
  and policy#>>'{binding,addressSha256}'=c.address_sha256
  and policy#>>'{binding,auditSha256}'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
  and policy#>'{binding,deviceIds}'=to_jsonb(a.device_ids)
 then jsonb_build_object('censusOnly',true,'censusOnlyNotBefore',(policy->>'enrolledAt')::timestamptz+interval '480 seconds','censusOnlyState',case when policy->>'claimToken' is not null then 'consumed' when (policy->>'enrolledAt')::timestamptz+interval '480 seconds'>clock_timestamp() then 'draining' else 'ready' end,
  'censusOnlySourceSha256',policy#>>'{binding,nativeSourceSha256}',
  'censusOnlyGuard',jsonb_build_object('nativeUnitId',policy#>>'{binding,nativeUnitId}','nativeGuardSha256',policy#>>'{binding,nativeGuardSha256}'))
 else '{}'::jsonb end||case when policy is null and coalesce(current_setting('role',true),'')<>'service_role' and session_user<>'service_role'
  and prep#>>'{binding,authorizingLegacyOwnerId}'=auth.uid()::text
  and exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role='owner' and p.active and p.archived_at is null)
  and prep#>>'{binding,organizationId}'=c.organization_id::text and prep#>>'{binding,auditId}'=c.audit_id
  and prep#>>'{binding,unitKey}'=c.unit_key and prep#>>'{binding,addressSha256}'=c.address_sha256
  and prep->>'auditSha256'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
  and prep->'deviceIds'=to_jsonb(a.device_ids) and prep->'censusBefore'=to_jsonb(c) and c.status='invalid_address'
  and not exists(select 1 from app_private.cos_field_geocode_cache x join lateral app_private.cos_geocode_current_audit(x.audit_id) ax on true
   where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256 and x.audit_id<>c.audit_id)
  and not exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256 and x.status='pending')
  and not exists(select 1 from app_private.cos_imported_geocode_jobs x where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256 and not x.invalidated)
  and not exists(select 1 from app_private.cos_imported_census_requests x where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256 and x.completed_at is null)
  and not exists(select 1 from app_private.cos_field_geocode_fallback_cache x where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256 and (x.status='success' or x.active_request_id is not null))
  and not exists(select 1 from app_private.cos_geocodio_reservations x where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256 and x.completed_at is null)
  and not exists(select 1 from app_private.cos_imported_postal_retry_jobs x where x.organization_id=c.organization_id and x.address_sha256=c.address_sha256)
  and not exists(select 1 from app_private.cos_geocodio_account_state g where g.singleton and g.diagnostic_recovery_v1#>array['jobs',c.address_sha256] is not null)
 then jsonb_build_object('censusPreparation',jsonb_build_object('nativeUnitId',prep#>>'{binding,nativeUnitId}')) else '{}'::jsonb end order by c.audit_id),'[]') into v_result$after$);
 definition:=replace(definition,$before$  and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key) and c.address=app_private.cos_geocode_normalize_address(a.after_state->>'street_address');$before$,$after$  and c.unit_key=app_private.cos_geocode_unit_key(a.unit_key) and c.address=app_private.cos_geocode_normalize_address(a.after_state->>'street_address')
  -- Never strip one-shot provenance and return a guarded success as an ordinary result.
  and (not coalesce(policy#>>'{binding,organizationId}'=c.organization_id::text and policy#>>'{binding,auditId}'=c.audit_id,false)
   or policy#>>'{binding,unitKey}'=c.unit_key and policy#>>'{binding,address}'=c.address
    and policy#>>'{binding,addressSha256}'=c.address_sha256
    and policy#>>'{binding,auditSha256}'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
    and policy#>'{binding,deviceIds}'=to_jsonb(a.device_ids));$after$);
 execute definition;
end $patch$;

do $patch$
declare definition text:=pg_get_functiondef('app_private.cos_diagnostic_recovery_immutable()'::regprocedure);
begin
 if encode(sha256(convert_to(definition,'UTF8')),'hex')='8f94c6a62e2e01ca4f4933d381cf25450ccb6e6ccf4ab1b1f9e4144c015d4512' then return; end if;
 if encode(sha256(convert_to(definition,'UTF8')),'hex')<>'807c04959b4e434c22edd92acc4dfb0146bffac09e59d0af549c85267a466ad3' then
  raise exception 'Owner one-Census baseline drift: cos_diagnostic_recovery_immutable.' using errcode='40001'; end if;
 definition:=replace(definition,$before$ f app_private.cos_field_geocode_fallback_cache; r jsonb;$before$,$after$ f app_private.cos_field_geocode_fallback_cache; r jsonb; one jsonb;$after$);
 definition:=replace(definition,$before$begin
$before$,$after$begin


 if new.owner_census_preparation_v1 is distinct from old.owner_census_preparation_v1 then
  if old.owner_census_preparation_v1 is not null or new.owner_one_census_v1 is not null then
   raise exception 'Owner Census preparation evidence is immutable.' using errcode='22023'; end if;
  one:=new.owner_census_preparation_v1;b:=one->'binding';
  if jsonb_typeof(one) is distinct from 'object' or (select count(*) from jsonb_object_keys(one))<>7
   or not(one ?& array['policyVersion','binding','auditSha256','deviceIds','censusBefore','approvalReference','preparedAt'])
   or one->>'policyVersion' is distinct from 'owner_census_preparation_v1'
   or jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>6
   or not(b ?& array['organizationId','auditId','unitKey','addressSha256','nativeUnitId','authorizingLegacyOwnerId'])
   or coalesce(b->>'nativeUnitId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(b->>'authorizingLegacyOwnerId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or coalesce(one->>'auditSha256','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(one->'deviceIds') is distinct from 'array' or jsonb_array_length(one->'deviceIds')=0
   or length(coalesce(one->>'approvalReference','')) not between 1 and 250 then
   raise exception 'Invalid Owner Census preparation.' using errcode='22023'; end if;
  perform app_private.cos_geocode_assert_service((b->>'organizationId')::uuid);
  perform app_private.cos_geocode_assert_key(b->>'auditId',b->>'unitKey',one#>>'{censusBefore,address}',b->>'addressSha256');
  if not exists(select 1 from public.profiles p where p.user_id=(b->>'authorizingLegacyOwnerId')::uuid and p.role='owner' and p.active and p.archived_at is null)
   or not exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=(b->>'organizationId')::uuid
    and x.audit_id=b->>'auditId' and x.unit_key=b->>'unitKey' and x.address_sha256=b->>'addressSha256'
    and x.status='invalid_address' and x.attempts between 1 and 2 and x.lease_until is null and to_jsonb(x)=one->'censusBefore')
   or not exists(select 1 from app_private.cos_geocode_current_audit(b->>'auditId') a
    where encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=one->>'auditSha256' and to_jsonb(a.device_ids)=one->'deviceIds') then
   raise exception 'Owner Census preparation requires exact active Owner and terminal evidence.' using errcode='40001'; end if;
  if exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and x.status='pending')
   or exists(select 1 from app_private.cos_field_geocode_cache x join lateral app_private.cos_geocode_current_audit(x.audit_id) a on true where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and x.audit_id<>b->>'auditId')
   or exists(select 1 from app_private.cos_imported_geocode_jobs x where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and not x.invalidated)
   or exists(select 1 from app_private.cos_imported_census_requests x where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and x.completed_at is null)
   or exists(select 1 from app_private.cos_field_geocode_fallback_cache x where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and (x.status='success' or x.active_request_id is not null))
   or exists(select 1 from app_private.cos_geocodio_reservations x where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and x.completed_at is null)
   or exists(select 1 from app_private.cos_imported_postal_retry_jobs x where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256')
   or new.diagnostic_recovery_v1#>array['jobs',b->>'addressSha256'] is not null then
   raise exception 'Owner Census preparation overlaps shared or active work.' using errcode='40001'; end if;
  new.owner_census_preparation_v1:=one||jsonb_build_object('preparedAt',clock_timestamp());
 end if;
 if new.owner_one_census_v1 is distinct from old.owner_one_census_v1 then
  one:=new.owner_one_census_v1;
  -- Server clock owns the drain anchor. A caller-supplied/backdated timestamp cannot shorten it.
  if old.owner_one_census_v1 is null and jsonb_typeof(one)='object' then
   one:=one||jsonb_build_object('enrolledAt',clock_timestamp());new.owner_one_census_v1:=one;
  end if;
  b:=one->'binding';
  if one is null or jsonb_typeof(one) is distinct from 'object'
   or (select count(*) from jsonb_object_keys(one))<>7
   or not(one ?& array['policyVersion','binding','approvalReference','enrolledAt','censusBefore','claimToken','consumedAt'])
   or one->>'policyVersion' is distinct from 'owner_one_census_v1'
   or jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>10
   or not(b ?& array['organizationId','auditId','unitKey','address','addressSha256','nativeUnitId','nativeGuardSha256','nativeSourceSha256','auditSha256','deviceIds'])
   or nullif(b->>'nativeUnitId','') is null or b->>'nativeUnitId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or b->>'nativeGuardSha256'!~'^[a-f0-9]{64}$' or b->>'nativeGuardSha256' is null
   or b->>'nativeSourceSha256'!~'^[a-f0-9]{64}$' or b->>'nativeSourceSha256' is null
   or b->>'auditSha256'!~'^[a-f0-9]{64}$' or b->>'auditSha256' is null
   or jsonb_typeof(b->'deviceIds') is distinct from 'array' or jsonb_array_length(b->'deviceIds')=0
   or length(coalesce(one->>'approvalReference','')) not between 1 and 250
   or one->>'enrolledAt' is null then raise exception 'Invalid Owner one-Census policy.' using errcode='22023'; end if;
  perform app_private.cos_geocode_assert_service((b->>'organizationId')::uuid);
  perform app_private.cos_geocode_assert_key(b->>'auditId',b->>'unitKey',b->>'address',b->>'addressSha256');
  if old.owner_one_census_v1 is not null then
   if one-array['claimToken','consumedAt'] is distinct from old.owner_one_census_v1-array['claimToken','consumedAt']
    or old.owner_one_census_v1->>'claimToken' is not null
    or one->>'claimToken' is null or one->>'consumedAt' is null
    or not exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=(b->>'organizationId')::uuid
     and x.audit_id=b->>'auditId' and x.unit_key=b->>'unitKey' and x.address=b->>'address' and x.address_sha256=b->>'addressSha256'
     and x.status='pending' and x.claim_token=(one->>'claimToken')::uuid and x.attempts=(one#>>'{censusBefore,attempts}')::int+1) then
    raise exception 'Owner one-Census evidence and spent allowance are immutable.' using errcode='22023'; end if;
  else
   if new.owner_census_preparation_v1 is not null and (
    (b-array['address','nativeGuardSha256','nativeSourceSha256','auditSha256','deviceIds']) is distinct from ((new.owner_census_preparation_v1->'binding')-'authorizingLegacyOwnerId')
    or b->>'auditSha256' is distinct from new.owner_census_preparation_v1->>'auditSha256'
    or b->'deviceIds' is distinct from new.owner_census_preparation_v1->'deviceIds'
    or one->'censusBefore' is distinct from new.owner_census_preparation_v1->'censusBefore') then
    raise exception 'Owner Census enrollment differs from immutable preparation.' using errcode='40001'; end if;
   if one->'claimToken' is distinct from 'null'::jsonb or one->'consumedAt' is distinct from 'null'::jsonb
    or not exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=(b->>'organizationId')::uuid
     and x.audit_id=b->>'auditId' and x.unit_key=b->>'unitKey' and x.address=b->>'address' and x.address_sha256=b->>'addressSha256'
     and x.status in ('invalid_address','no_match','provider_error') and x.attempts between 1 and 2 and x.lease_until is null
     and to_jsonb(x)=one->'censusBefore')
    or not exists(select 1 from app_private.cos_geocode_current_audit(b->>'auditId') a
     where encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=b->>'auditSha256' and to_jsonb(a.device_ids)=b->'deviceIds') then
    raise exception 'Owner one-Census enrollment requires exact current terminal evidence.' using errcode='40001'; end if;
   if exists(select 1 from app_private.cos_field_geocode_cache x where x.organization_id=(b->>'organizationId')::uuid
     and x.address_sha256=b->>'addressSha256' and x.status='pending')
    or exists(select 1 from app_private.cos_imported_census_requests x where x.organization_id=(b->>'organizationId')::uuid
     and x.address_sha256=b->>'addressSha256' and x.completed_at is null)
    or exists(select 1 from app_private.cos_field_geocode_cache x join lateral app_private.cos_geocode_current_audit(x.audit_id) a on true
     where x.organization_id=(b->>'organizationId')::uuid and x.address_sha256=b->>'addressSha256' and x.audit_id<>b->>'auditId')
    or exists(select 1 from app_private.cos_imported_geocode_jobs x where x.organization_id=(b->>'organizationId')::uuid
     and x.address_sha256=b->>'addressSha256' and not x.invalidated)
    or exists(select 1 from app_private.cos_field_geocode_fallback_cache x where x.organization_id=(b->>'organizationId')::uuid
     and x.address_sha256=b->>'addressSha256' and (x.status='success' or x.active_request_id is not null))
    or exists(select 1 from app_private.cos_geocodio_reservations x where x.organization_id=(b->>'organizationId')::uuid
     and x.address_sha256=b->>'addressSha256' and x.completed_at is null)
    or exists(select 1 from app_private.cos_imported_postal_retry_jobs x where x.organization_id=(b->>'organizationId')::uuid
     and x.address_sha256=b->>'addressSha256')
    or new.diagnostic_recovery_v1#>array['jobs',b->>'addressSha256'] is not null then
    raise exception 'Owner one-Census enrollment overlaps shared or active work.' using errcode='40001'; end if;
  end if;
 end if;
$after$);
 execute definition;
end $patch$;

create or replace trigger cos_diagnostic_recovery_immutable
 before update of diagnostic_recovery_v1,owner_one_census_v1,owner_census_preparation_v1 on app_private.cos_geocodio_account_state
 for each row execute function app_private.cos_diagnostic_recovery_immutable();
commit;
