-- Additive Owner equipment settings. Raw mHelp/Sheets records are not rewritten.
create schema if not exists cos_owner_equipment_private;
revoke all on schema cos_owner_equipment_private from public,anon,authenticated;
create table if not exists cos_owner_equipment_private.settings(
 product_id text primary key check(product_id ~ '^[1-9][0-9]{0,14}$'),
 id uuid not null unique default gen_random_uuid(),revision bigint not null,
 connection_revision bigint not null,active boolean not null default true,
 settings jsonb not null,source_at_save jsonb not null,
 updated_at timestamptz not null default now(),updated_by uuid not null,
 last_completed jsonb,last_attempt jsonb,lease_id uuid,lease_until timestamptz
);
create table if not exists cos_owner_equipment_private.audit(
 request_id uuid primary key,product_id text not null,actor_id uuid not null,
 expected_revision bigint not null,action text not null,payload jsonb not null,
 before_state jsonb,after_state jsonb not null,reason text not null,created_at timestamptz not null default now()
);
alter table cos_owner_equipment_private.settings enable row level security;
alter table cos_owner_equipment_private.audit enable row level security;
revoke all on all tables in schema cos_owner_equipment_private from public,anon,authenticated;
create or replace function cos_owner_equipment_private.project(s cos_owner_equipment_private.settings)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('contract','COS_OWNER_EQUIPMENT_V1','id',s.id,'productId',s.product_id,'revision',s.revision,'connectionRevision',s.connection_revision,'active',s.active,'settings',s.settings,'updatedAt',s.updated_at,'lastCompleted',s.last_completed,'lastAttempt',s.last_attempt,'syncState','cos_only','sourceLifecycle',s.source_at_save->>'lifecycle');
$$;
create or replace function public.cos_owner_equipment_list_v1()
returns jsonb language sql security definer stable set search_path='' as $$
 with b as materialized (select cos_mhelp_placement_private.upload_snapshot() value), records as (select r from b cross join lateral jsonb_array_elements(b.value->'records') r)
 select coalesce(jsonb_agg(cos_owner_equipment_private.project(s)||jsonb_build_object('currentSourcePresent',r is not null,'currentSourceLifecycle',r->>'lifecycle','currentSourceEligible',r is not null and r->>'lifecycle'='UNFLAGGED' and coalesce(r->>'category','')!~*'(stand|pole|skid)' and coalesce((b.value->'apiSync'->>'lastSuccessAt')::timestamptz,now()-interval '1 day') between now()-interval '45 minutes' and now()+interval '1 minute') order by product_id),'[]'::jsonb) from cos_owner_equipment_private.settings s cross join b left join records on r->>'productId'=s.product_id;
$$;
create or replace function public.cos_owner_equipment_record_v1(p_product_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;r jsonb;saved jsonb;
begin
 b:=cos_mhelp_placement_private.upload_snapshot();
 if b->>'complete' is distinct from 'true' then raise exception 'Current mHelp inventory is unavailable.' using errcode='55000';end if;
 select x into r from jsonb_array_elements(b->'records') x where x->>'productId'=p_product_id;
 if r is null then raise exception 'This Product ID is not in current mHelp inventory.' using errcode='P0002';end if;
 select cos_owner_equipment_private.project(s) into saved from cos_owner_equipment_private.settings s where product_id=p_product_id;
 return jsonb_build_object('contract','COS_OWNER_EQUIPMENT_RECORD_V1','source',jsonb_build_object('productId',p_product_id,'unitNumber',r->>'unitNumber','category',r->>'category','placement',r->>'placement','customer',r->>'customer','address',r->'sourceAddress','lifecycle',r->>'lifecycle','sourceSha256',b->>'sourceSha256','observedAt',b->'apiSync'->>'lastSuccessAt'),'saved',saved);
end $$;
create or replace function public.cos_owner_equipment_save_v1(p_actor uuid,p_product_id text,p_expected bigint,p_request uuid,p_action text,p_settings jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare existing cos_owner_equipment_private.settings;prior cos_owner_equipment_private.audit;nextrow cos_owner_equipment_private.settings;source jsonb;beforej jsonb;ip inet;ports integer[];rev bigint;original_payload jsonb:=p_settings;
begin
 perform app_private.cos_owner_identity_assert_actor(p_actor,'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',true);
 if p_request is null or p_expected is null or p_expected<0 or p_product_id is null or p_action is null or p_product_id!~'^[1-9][0-9]{0,14}$' or p_action not in ('save','release') or p_reason is null or length(trim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Choose the exact product and record a correction reason.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('COS_OWNER_EQUIPMENT_V1'));
 select * into prior from cos_owner_equipment_private.audit where request_id=p_request;
 if found then
  if prior.product_id is distinct from p_product_id or prior.actor_id is distinct from p_actor or prior.payload is distinct from p_settings or prior.action is distinct from p_action or prior.expected_revision is distinct from p_expected or prior.reason is distinct from trim(p_reason) then raise exception 'Request identifier already used for different settings.' using errcode='40001';end if;
  return prior.after_state||jsonb_build_object('replayed',true);
 end if;
 source:=(public.cos_owner_equipment_record_v1(p_product_id))->'source';
 select * into existing from cos_owner_equipment_private.settings where product_id=p_product_id for update;
 if coalesce(existing.revision,0)<>p_expected then raise exception 'This equipment was edited elsewhere. Reload its saved settings.' using errcode='40001';end if;
 beforej:=case when existing.product_id is not null then cos_owner_equipment_private.project(existing) else null end;
 if p_action='release' then
  if existing.product_id is null then raise exception 'No Owner settings exist for this product.' using errcode='22023';end if;
  update cos_owner_equipment_private.settings set active=false,revision=revision+1,connection_revision=connection_revision+1,updated_at=now(),updated_by=p_actor,lease_id=null,lease_until=null where product_id=p_product_id returning * into nextrow;
 else
  if jsonb_typeof(p_settings) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_settings) k) is distinct from array['address','customer','latitude','longitude','monitoringEnabled','placement','ports','publicIp','site']::text[] then raise exception 'Unsupported equipment settings.' using errcode='22023';end if;
  if jsonb_typeof(p_settings->'placement') is distinct from 'string' or p_settings->>'placement' not in ('FIELD','SHOP') or jsonb_typeof(p_settings->'monitoringEnabled') is distinct from 'boolean' then raise exception 'Invalid placement or monitoring setting.' using errcode='22023';end if;
  if exists(select 1 from unnest(array['address','customer','site','publicIp']) k where jsonb_typeof(p_settings->k) is distinct from 'string' or length(p_settings->>k)>case when k='address' then 600 else 250 end or p_settings->>k<>trim(p_settings->>k) or p_settings->>k ~ '[[:cntrl:]<>]') then raise exception 'Use plain text equipment fields.' using errcode='22023';end if;
  if p_settings->>'placement'='FIELD' and (p_settings->>'customer'='' or p_settings->>'address'='') then raise exception 'Field equipment requires customer and address; GPS is optional.' using errcode='22023';end if;
  if jsonb_typeof(p_settings->'ports') is distinct from 'array' or jsonb_array_length(p_settings->'ports')>32 or exists(select 1 from jsonb_array_elements(p_settings->'ports') x where jsonb_typeof(x)<>'number' or x::text!~'^[1-9][0-9]{0,4}$') then raise exception 'Invalid service ports.' using errcode='22023';end if;
  select coalesce(array_agg(x::text::integer order by x::text::integer),'{}'::integer[]) into ports from jsonb_array_elements(p_settings->'ports') x;
  if exists(select 1 from unnest(ports) p where p>65535) or cardinality(ports)<>(select count(distinct x) from unnest(ports) x) then raise exception 'Use distinct service ports from 1 to 65535.' using errcode='22023';end if;
  if (p_settings->>'monitoringEnabled')::boolean and source->>'lifecycle' is distinct from 'UNFLAGGED' then raise exception 'Reactivate this equipment in the source before enabling camera monitoring.' using errcode='22023';end if;
  if p_settings->>'publicIp'<>'' then
   if p_settings->>'publicIp'!~'^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then raise exception 'Public IPv4 address required.' using errcode='22023';end if;
   ip:=(p_settings->>'publicIp')::inet;
   if family(ip)<>4 or host(ip)<>(p_settings->>'publicIp') or ip <<= any(array['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','192.0.0.0/24','192.0.2.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4']::inet[]) then raise exception 'Public IPv4 address required.' using errcode='22023';end if;
   if exists(select 1 from cos_owner_equipment_private.settings s where s.active and s.product_id<>p_product_id and s.settings->>'publicIp'=host(ip)) then raise exception 'This IP is already saved against another Product ID.' using errcode='23505';end if;
  end if;
  if (p_settings->>'monitoringEnabled')::boolean and (ip is null or cardinality(ports)=0) then raise exception 'Monitoring requires an IP and ports.' using errcode='22023';end if;
  if (p_settings->'latitude'='null'::jsonb) is distinct from (p_settings->'longitude'='null'::jsonb) or p_settings->'latitude'<>'null'::jsonb and (jsonb_typeof(p_settings->'latitude')<>'number' or jsonb_typeof(p_settings->'longitude')<>'number' or abs((p_settings->>'latitude')::numeric)>90 or abs((p_settings->>'longitude')::numeric)>180) then raise exception 'Invalid optional map coordinates.' using errcode='22023';end if;
  p_settings:=jsonb_set(p_settings,'{ports}',to_jsonb(ports));
  rev:=coalesce(existing.connection_revision,0)+case when existing.product_id is null or not existing.active or existing.settings->'publicIp' is distinct from p_settings->'publicIp' or existing.settings->'ports' is distinct from p_settings->'ports' or existing.settings->'monitoringEnabled' is distinct from p_settings->'monitoringEnabled' then 1 else 0 end;
  insert into cos_owner_equipment_private.settings(product_id,revision,connection_revision,active,settings,source_at_save,updated_by) values(p_product_id,p_expected+1,rev,true,p_settings,source,p_actor)
  on conflict(product_id) do update set revision=excluded.revision,connection_revision=excluded.connection_revision,active=true,settings=excluded.settings,source_at_save=excluded.source_at_save,updated_at=now(),updated_by=p_actor,lease_id=null,lease_until=null returning * into nextrow;
 end if;
 insert into cos_owner_equipment_private.audit(request_id,product_id,actor_id,expected_revision,action,payload,before_state,after_state,reason) values(p_request,p_product_id,p_actor,p_expected,p_action,original_payload,beforej,cos_owner_equipment_private.project(nextrow),trim(p_reason));
 return cos_owner_equipment_private.project(nextrow)||jsonb_build_object('requestId',p_request,'saved',true);
end $$;
create or replace function public.cos_owner_equipment_check_v1(p_product text,p_action text,p_ticket uuid default null,p_revision bigint default null,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' as $$
declare s cos_owner_equipment_private.settings;source jsonb;ticket uuid;result jsonb;
begin
 select * into s from cos_owner_equipment_private.settings where product_id=p_product for update;
 if not found or not s.active then raise exception 'Save this equipment setup before checking it.' using errcode='22023';end if;
 if p_action='begin' then
  source:=(public.cos_owner_equipment_record_v1(p_product))->'source';
  if source->>'lifecycle' is distinct from 'UNFLAGGED' or source->>'category' ~* '(stand|pole|skid)' or coalesce((source->>'observedAt')::timestamptz,now()-interval '1 day') not between now()-interval '45 minutes' and now()+interval '1 minute' then raise exception 'Inactive, support or source-stale equipment is not an eligible camera target.' using errcode='22023';end if;
  if s.settings->>'monitoringEnabled'<>'true' or s.settings->>'publicIp'='' or jsonb_array_length(s.settings->'ports')=0 then raise exception 'Enable monitoring and save IP/ports first.' using errcode='22023';end if;
  if s.lease_until>now() then return jsonb_build_object('state','already_running');end if;
  ticket:=gen_random_uuid();update cos_owner_equipment_private.settings set lease_id=ticket,lease_until=now()+interval '90 seconds',last_attempt=jsonb_build_object('at',now(),'state','running') where product_id=p_product;
  return jsonb_build_object('state','ready','ticket',ticket,'connectionRevision',s.connection_revision,'settings',s.settings,'source',source);
 elsif p_action='finish' then
  if p_ticket is null or p_revision is null or s.lease_until is null or s.lease_id is distinct from p_ticket or s.connection_revision is distinct from p_revision or s.lease_until<now() then return jsonb_build_object('saved',false,'reason','configuration_changed');end if;
  source:=(public.cos_owner_equipment_record_v1(p_product))->'source';
  if source->>'lifecycle' is distinct from 'UNFLAGGED' or source->>'category' ~* '(stand|pole|skid)' then p_result:=jsonb_build_object('status','unknown','reason','Source eligibility changed during check.');end if;
  if p_result->>'status' in ('online','offline') then
   if p_result->>'checkedAt' is null or jsonb_typeof(p_result->'outcomes') is distinct from 'array' then raise exception 'Completed evidence requires an observation time and all port outcomes.' using errcode='22023';end if;
   if p_result->>'publicIp' is distinct from s.settings->>'publicIp' or p_result->'ports' is distinct from s.settings->'ports' or (p_result->>'checkedAt')::timestamptz>now()+interval '5 seconds' or (p_result->>'checkedAt')::timestamptz<now()-interval '90 seconds' or jsonb_array_length(p_result->'outcomes')<>jsonb_array_length(s.settings->'ports') then raise exception 'Completed check evidence does not match saved settings.' using errcode='22023';end if;
   if exists(select 1 from jsonb_array_elements(p_result->'outcomes') o where o->>'outcome' is null or o->>'port' is null or o->>'outcome' not in ('responded','no_response') or not s.settings->'ports' @> jsonb_build_array((o->>'port')::integer)) or (select count(distinct o->>'port') from jsonb_array_elements(p_result->'outcomes') o)<>jsonb_array_length(s.settings->'ports') or ((p_result->>'status'='online') is distinct from exists(select 1 from jsonb_array_elements(p_result->'outcomes') o where o->>'outcome'='responded')) then raise exception 'Incomplete port observations.' using errcode='22023';end if;
   result:=p_result||jsonb_build_object('connectionRevision',s.connection_revision);
  end if;
  update cos_owner_equipment_private.settings set lease_id=null,lease_until=null,last_attempt=jsonb_build_object('at',now(),'state',case when result is null then 'failed' else 'completed' end,'reason',left(coalesce(p_result->>'reason',''),500)),last_completed=coalesce(result,last_completed) where product_id=p_product returning * into s;
  return cos_owner_equipment_private.project(s)||jsonb_build_object('checkSaved',result is not null);
 end if;
 raise exception 'Unsupported check operation.' using errcode='22023';
end $$;
revoke all on function public.cos_owner_equipment_list_v1() from public,anon,authenticated;
revoke all on function public.cos_owner_equipment_record_v1(text) from public,anon,authenticated;
revoke all on function public.cos_owner_equipment_save_v1(uuid,text,bigint,uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.cos_owner_equipment_check_v1(text,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.cos_owner_equipment_list_v1(),public.cos_owner_equipment_record_v1(text),public.cos_owner_equipment_save_v1(uuid,text,bigint,uuid,text,jsonb,text),public.cos_owner_equipment_check_v1(text,text,uuid,bigint,jsonb) to service_role;
create table if not exists cos_owner_equipment_private.cron_control(singleton boolean primary key default true check(singleton),secret text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''));
alter table cos_owner_equipment_private.cron_control enable row level security;
revoke all on cos_owner_equipment_private.cron_control from public,anon,authenticated;
insert into cos_owner_equipment_private.cron_control(singleton) values(true) on conflict do nothing;
create or replace function public.cos_owner_equipment_cron_authorized_v1(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$select coalesce(length(p_secret)=64 and p_secret=(select secret from cos_owner_equipment_private.cron_control where singleton),false);$$;
revoke all on function public.cos_owner_equipment_cron_authorized_v1(text) from public,anon,authenticated;
grant execute on function public.cos_owner_equipment_cron_authorized_v1(text) to service_role;
revoke all on all functions in schema cos_owner_equipment_private from public,anon,authenticated;
