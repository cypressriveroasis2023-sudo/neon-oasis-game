-- REVIEW ONLY, native project, after publication and native source fences. NO GRANTS.
begin;
create table cos_avigilon_checks_private.source_operations(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,generation bigint not null,
 commands jsonb not null,state text not null check(state in ('pending','admitted')),
 legacy_receipt jsonb,admission jsonb,created_at timestamptz not null default clock_timestamp()
);
create unique index avigilon_one_source_writer on cos_avigilon_checks_private.source_operations(tenant_id) where state='pending';
alter table cos_avigilon_checks_private.source_operations enable row level security;
revoke all on cos_avigilon_checks_private.source_operations from public,anon,authenticated,service_role;
alter function cos_avigilon_checks_private.admit(uuid,uuid,bigint,jsonb) rename to admit_verified_sources;
create function cos_avigilon_checks_private.admit(uuid,uuid,bigint,jsonb) returns void language plpgsql set search_path='' as $$
begin raise exception 'Sealed source operation and verified readback required';end $$;
create function cos_avigilon_checks_private.source_control(p_actor uuid,p_tenant uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a cos_avigilon_checks_private.authority; op cos_avigilon_checks_private.source_operations; receipt jsonb; result jsonb; epoch bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('avigilon-run:'||p_tenant::text,0));
 perform 1 from public.user_profiles where user_id=p_actor for share;
 perform 1 from public.user_roles where user_id=p_actor for share;
 perform 1 from public.roles r join public.user_roles ur on ur.role_id=r.id where ur.user_id=p_actor for share of r;
 perform cos_avigilon_checks_private.assert_actor(p_actor,p_tenant);
 select * into a from cos_avigilon_checks_private.authority where tenant_id=p_tenant for update;
 if p_action='state' then
  select * into op from cos_avigilon_checks_private.source_operations where tenant_id=p_tenant and state='pending';
  return jsonb_build_object('tenantId',p_tenant,'generation',coalesce(a.generation,0)::text,'admitted',coalesce(a.admitted,false),'rosterRevision',a.roster_revision,'pending',case when op.id is not null then jsonb_build_object('id',op.id,'actorId',op.actor_id,'generation',op.generation::text,'commands',op.commands) else null end);
 elsif p_action='begin' then
  if jsonb_typeof(p_payload->'commands') is distinct from 'array' or jsonb_array_length(p_payload->'commands')>100 or pg_column_size(p_payload)>1048576 then raise exception 'Invalid source commands';end if;
  select * into op from cos_avigilon_checks_private.source_operations where id=(p_payload->>'id')::uuid;
  if found then
   if op.tenant_id<>p_tenant or op.actor_id<>p_actor or op.commands is distinct from p_payload->'commands' then raise exception 'Source request reused';end if;
   return jsonb_build_object('id',op.id,'tenantId',p_tenant,'generation',op.generation::text,'commands',op.commands,'admission',op.admission,'legacyReceipt',op.legacy_receipt);
  end if;
  if exists(select 1 from cos_avigilon_checks_private.source_operations where tenant_id=p_tenant and state='pending') then raise exception 'Source writer pending; resume its exact operation';end if;
  insert into cos_avigilon_checks_private.authority(tenant_id,generation,admitted) values(p_tenant,1,false)
  on conflict(tenant_id) do update set generation=cos_avigilon_checks_private.authority.generation+1,admitted=false returning generation into epoch;
  delete from cos_avigilon_checks_private.heads where tenant_id=p_tenant;
  insert into cos_avigilon_checks_private.source_operations(id,tenant_id,actor_id,generation,commands,state) values((p_payload->>'id')::uuid,p_tenant,p_actor,epoch,p_payload->'commands','pending') returning * into op;
  return jsonb_build_object('id',op.id,'tenantId',p_tenant,'generation',epoch::text,'commands',op.commands,'admission',null);
 elsif p_action='finish' then
  select * into op from cos_avigilon_checks_private.source_operations where id=(p_payload->>'id')::uuid and tenant_id=p_tenant and actor_id=p_actor for update;
  if not found then raise exception 'Source operation unavailable';end if;
  if op.state='admitted' then return op.admission;end if;
  receipt:=p_payload->'legacyReceipt';
  if receipt->>'contract' is distinct from 'COS_AVIGILON_SOURCE_SEAL_V1' or receipt->>'id' is distinct from op.id::text or receipt->>'tenantId' is distinct from p_tenant::text or receipt->>'generation' is distinct from op.generation::text or receipt->'commands' is distinct from op.commands or receipt->'sealed' is distinct from 'true'::jsonb then raise exception 'Durable sealed source receipt required';end if;
  if a.admitted or a.generation::text is distinct from p_payload->>'generation' then raise exception 'Source generation changed during readback';end if;
  perform cos_avigilon_checks_private.admit_verified_sources(p_actor,p_tenant,a.generation,p_payload->'roster');
  result:=jsonb_build_object('id',op.id,'tenantId',p_tenant,'generation',a.generation::text,'rosterRevision',p_payload->'roster'->>'revision','admitted',true);
  update cos_avigilon_checks_private.source_operations set state='admitted',legacy_receipt=receipt,admission=result where id=op.id;
  return result;
 end if;
 raise exception 'Unsupported source operation';
end $$;
create function public.cos_avigilon_source_control(p_actor_user_id uuid,p_organization_id uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service transport required';end if;
 return cos_avigilon_checks_private.source_control(p_actor_user_id,p_organization_id,p_action,p_payload);
end $$;
revoke all on all functions in schema cos_avigilon_checks_private from public,anon,authenticated,service_role;
revoke all on function public.cos_avigilon_source_control(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
commit;
