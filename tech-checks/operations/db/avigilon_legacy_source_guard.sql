-- REVIEW ONLY, legacy project. Installing seals direct source writes. NO GRANTS.
-- All commands execute and become permanently sealed in ONE legacy transaction.
-- A delayed request cannot reopen an old operation; there is no expiring permit.
begin;
create schema cos_avigilon_source_private;
revoke all on schema cos_avigilon_source_private from public,anon,authenticated,service_role;
create table cos_avigilon_source_private.control(singleton boolean primary key check(singleton),generation bigint not null default 0,operation_id uuid,writer_xid bigint);
insert into cos_avigilon_source_private.control(singleton) values(true);
create table cos_avigilon_source_private.receipts(id uuid primary key,ticket jsonb not null,receipt jsonb not null);
alter table cos_avigilon_source_private.control enable row level security;
alter table cos_avigilon_source_private.receipts enable row level security;
revoke all on all tables in schema cos_avigilon_source_private from public,anon,authenticated,service_role;
create function cos_avigilon_source_private.guard() returns trigger language plpgsql security definer set search_path='' as $$
declare writer bigint;
begin
 select writer_xid into writer from cos_avigilon_source_private.control where singleton for update;
 if writer is distinct from txid_current() then raise exception 'Source writes require a native-fenced legacy transaction' using errcode='42501';end if;
 return null;
end $$;
do $$declare target text;begin
 foreach target in array array['public.camera_devices','public.equipment_master','public.camera_inventory_audit'] loop
  if to_regclass(target) is null then raise exception 'Required legacy source missing: %',target;end if;
  execute format('create trigger avigilon_legacy_source_guard before insert or update or delete or truncate on %s for each statement execute function cos_avigilon_source_private.guard()',target::regclass);
 end loop;
end $$;
create function cos_avigilon_source_private.apply(p_ticket jsonb) returns jsonb language plpgsql set search_path='' as $$
declare prior cos_avigilon_source_private.receipts; gate cos_avigilon_source_private.control;
 command jsonb; row_data jsonb; target regclass; columns text; projections text; updates text; predicate text; conflict text; result jsonb; routine record; declarations text; named_args text; prior_claims text; prior_claim text; prior_sub text; prior_role text; actor_claims text; results jsonb:='[]'; receipt jsonb; key text;
begin
 select * into gate from cos_avigilon_source_private.control where singleton for update;
 select * into prior from cos_avigilon_source_private.receipts where id=(p_ticket->>'id')::uuid;
 if found then if prior.ticket is distinct from p_ticket then raise exception 'Sealed operation replay changed';end if;return prior.receipt;end if;
 if p_ticket->>'tenantId' is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' or coalesce(p_ticket->>'generation','')!~'^[1-9][0-9]*$' or (p_ticket->>'generation')::bigint<=gate.generation or jsonb_typeof(p_ticket->'commands') is distinct from 'array' or jsonb_array_length(p_ticket->'commands')>100 or pg_column_size(p_ticket)>1048576 then raise exception 'Invalid or obsolete source ticket';end if;
 update cos_avigilon_source_private.control set generation=(p_ticket->>'generation')::bigint,operation_id=(p_ticket->>'id')::uuid,writer_xid=txid_current() where singleton;
 for command in select value from jsonb_array_elements(p_ticket->'commands') loop
  if command->>'action'='rpc' then
   if command->>'name'='cos_apply_recon_event_v1' then
    execute 'select public.cos_apply_recon_event_v1($1,$2,$3)' into result using (command->'args'->>'p_event_id')::bigint,command->'args'->>'p_event_key',command->'args'->'p_metadata_patch';
   elsif command->>'name'=any(array['set_camera_unit_connection_v2','owner_set_camera_unit_placement_v2','owner_add_camera_unit_v1','owner_remove_camera_unit_v1']) then
    if coalesce(command->>'legacyActorId','')='' then raise exception 'Verified legacy actor required';end if;
    select p.oid,p.proargnames,p.proargtypes into strict routine from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=command->>'name';
    if jsonb_typeof(command->'args') is distinct from 'object' or exists(select 1 from jsonb_object_keys(command->'args') k where not k=any(routine.proargnames)) then raise exception 'Invalid guarded RPC arguments';end if;
    select string_agg(format('%I %s',name,format_type(routine.proargtypes[n-1],null)),',' order by n),string_agg(format('%I=>x.%I',name,name),',' order by n) into declarations,named_args from unnest(routine.proargnames) with ordinality as args(name,n) where command->'args'?name;
    prior_claims:=current_setting('request.jwt.claims',true);
    prior_claim:=current_setting('request.jwt.claim',true);
    prior_sub:=current_setting('request.jwt.claim.sub',true);
    prior_role:=current_setting('request.jwt.claim.role',true);
    actor_claims:=jsonb_build_object('role','authenticated','sub',command->>'legacyActorId')::text;
    -- Deployed auth.uid() prefers the scalar sub; auth.jwt() also supports the
    -- older singular claim. Scope every supported form to the same actor.
    perform set_config('request.jwt.claims',actor_claims,true),set_config('request.jwt.claim',actor_claims,true),
     set_config('request.jwt.claim.sub',command->>'legacyActorId',true),set_config('request.jwt.claim.role','authenticated',true);
    execute format('select to_jsonb(public.%I(%s)) from jsonb_to_record($1) as x(%s)',command->>'name',named_args,declarations) into result using command->'args';
    perform set_config('request.jwt.claims',coalesce(prior_claims,''),true),set_config('request.jwt.claim',coalesce(prior_claim,''),true),
     set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true),set_config('request.jwt.claim.role',coalesce(prior_role,''),true);
    if result->'ok' is distinct from 'true'::jsonb then raise exception 'Guarded manual RPC did not confirm success';end if;
   else raise exception 'Unsupported guarded RPC';end if;
   results:=results||jsonb_build_array(result);continue;
  end if;
  if command->>'table' not in ('camera_devices','equipment_master','camera_inventory_audit') or coalesce(command->>'action','') not in ('update','insert','upsert','delete') then raise exception 'Unsupported source command';end if;
  target:=to_regclass('public.'||(command->>'table'));
  row_data:=coalesce(command->'values','{}');
  if jsonb_typeof(row_data)<>'object' or exists(select 1 from jsonb_object_keys(row_data) k where not exists(select 1 from pg_attribute where attrelid=target and attname=k and attnum>0 and not attisdropped and attgenerated='' and attidentity='')) then raise exception 'Invalid source columns';end if;
  -- Fixed column-name sets only; every value remains a bound JSON parameter.
  select string_agg(format('%I',k),',' order by k),string_agg(format('(jsonb_populate_record(null::%s,$1)).%I',target,k),',' order by k),string_agg(format('%I=(jsonb_populate_record(null::%s,$1)).%I',k,target,k),',' order by k) into columns,projections,updates from jsonb_object_keys(row_data) k;
  predicate:='true';
  if command->>'action' in ('update','delete') then
   if jsonb_typeof(command->'eq') is distinct from 'object' or command->'eq'='{}'::jsonb then raise exception 'Exact write filters required';end if;
   for key in select jsonb_object_keys(command->'eq') loop
    if not exists(select 1 from pg_attribute where attrelid=target and attname=key and attnum>0 and not attisdropped) then raise exception 'Invalid source filter';end if;
    predicate:=predicate||format(' and to_jsonb(t)->%L=$2->%L',key,key);
   end loop;
  end if;
  if command->>'action'='update' then
   if columns is null or row_data?'id' then raise exception 'Empty or identity-changing update';end if;
   execute format('with changed as (update %s t set %s where %s returning to_jsonb(t) row) select coalesce(jsonb_agg(row),''[]''::jsonb) from changed',target,updates,predicate) into result using row_data,command->'eq';
  elsif command->>'action'='delete' then
   execute format('with changed as (delete from %s t where %s returning to_jsonb(t) row) select coalesce(jsonb_agg(row),''[]''::jsonb) from changed',target,predicate) into result using row_data,command->'eq';
  else
   if columns is null then raise exception 'Empty source insert';end if;
   conflict:='';
   if command->>'action'='upsert' then
    if coalesce(command->>'onConflict','') not in ('id','device_serial','provider','canonical_family,unit_tag') then raise exception 'Unsupported conflict key';end if;
    select string_agg(format('%I',k),',') into conflict from unnest(string_to_array(command->>'onConflict',',')) k;
    conflict:=format(' on conflict (%s) do update set %s',conflict,updates);
   end if;
   execute format('with changed as (insert into %s as inserted (%s) select %s %s returning to_jsonb(inserted) row) select coalesce(jsonb_agg(row),''[]''::jsonb) from changed',target,columns,projections,conflict) into result using row_data;
  end if;
  results:=results||jsonb_build_array(result);
 end loop;
 update cos_avigilon_source_private.control set writer_xid=null where singleton;
 receipt:=jsonb_build_object('contract','COS_AVIGILON_SOURCE_SEAL_V1','tenantId',p_ticket->>'tenantId','id',p_ticket->>'id','generation',p_ticket->>'generation','commands',p_ticket->'commands','sealed',true,'results',results);
 insert into cos_avigilon_source_private.receipts values((p_ticket->>'id')::uuid,p_ticket,receipt);
 return receipt;
end $$;
create function public.cos_avigilon_source_apply(p_ticket jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service transport required';end if;
 return cos_avigilon_source_private.apply(p_ticket);
end $$;
create function public.cos_avigilon_source_seal() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service transport required';end if;
 select r.receipt into result from cos_avigilon_source_private.control c join cos_avigilon_source_private.receipts r on r.id=c.operation_id where c.singleton and c.writer_xid is null;
 if result is null then raise exception 'Legacy source has no durable seal';end if;
 return result;
end $$;
revoke all on all functions in schema cos_avigilon_source_private from public,anon,authenticated,service_role;
revoke all on function public.cos_avigilon_source_apply(jsonb),public.cos_avigilon_source_seal() from public,anon,authenticated,service_role;
-- Legacy/manual health publication must not remain a second authoritative path.
create function cos_avigilon_source_private.reject_managed_health() returns trigger language plpgsql security definer set search_path='' as $$
declare device jsonb; candidate jsonb:=to_jsonb(new); writer bigint;
begin
 select to_jsonb(d) into device from public.camera_devices d where id=new.camera_device_id and monitoring_profile in ('sniper','camv');
 if device is not null then
  select writer_xid into writer from cos_avigilon_source_private.control where singleton;
  -- The installed camera_connection_invalidate_v1 trigger must still invalidate
  -- a saved endpoint inside its sealed source transaction. This exception can
  -- only clear health to unknown; it cannot publish observations or edit links.
  if writer=txid_current() and pg_trigger_depth()=2 then
   if tg_table_name='camera_health_history' and tg_op='INSERT'
    and candidate->>'status'='unknown' and candidate->>'check_source'='saved_connection_changed'
    and candidate->'detail'->'previous_revision'=device->'connection_revision'
    and candidate->'detail'->>'new_revision'=((device->>'connection_revision')::bigint+1)::text
    and candidate->'detail'->>'previous_ip' is not distinct from host((device->>'public_ip')::inet)
    and candidate->'detail'->'previous_ports'=device->'expected_ports'
   then return new;end if;
   if tg_table_name='camera_health_current' and tg_op='UPDATE'
    and candidate->>'overall_status'='unknown' and candidate->'checked_at'='null'::jsonb
    and candidate->'ip_reachable'='null'::jsonb and candidate->'port_status'='{}'::jsonb
    and candidate->'consecutive_failures'='0'::jsonb and candidate->'confirmed_outage'='false'::jsonb
    and candidate->'confirmation_reason'='null'::jsonb
    and candidate->>'detail'='Saved connection changed; awaiting a check of the new endpoint.'
    and candidate-array['overall_status','checked_at','ip_reachable','port_status','consecutive_failures','confirmed_outage','confirmation_reason','detail']
     =to_jsonb(old)-array['overall_status','checked_at','ip_reachable','port_status','consecutive_failures','confirmed_outage','confirmation_reason','detail']
   then return new;end if;
  end if;
  raise exception 'Managed Avigilon checks require native publication receipts';
 end if;
 return new;
end $$;
do $$declare target text;begin
 foreach target in array array['public.camera_health_current','public.camera_health_history'] loop
  if to_regclass(target) is null then raise exception 'Required legacy health source missing: %',target;end if;
  execute format('create trigger avigilon_reject_managed_health before insert or update on %s for each row execute function cos_avigilon_source_private.reject_managed_health()',target::regclass);
 end loop;
end $$;
revoke all on function cos_avigilon_source_private.reject_managed_health() from public,anon,authenticated,service_role;
create function public.cos_avigilon_source_cancel(p_ticket jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate cos_avigilon_source_private.control; prior cos_avigilon_source_private.receipts; receipt jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service transport required';end if;
 select * into gate from cos_avigilon_source_private.control where singleton for update;
 select * into prior from cos_avigilon_source_private.receipts where id=(p_ticket->>'id')::uuid;
 if found then if prior.ticket is distinct from p_ticket then raise exception 'Sealed operation replay changed';end if;return prior.receipt;end if;
 if p_ticket->>'tenantId' is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5' or (p_ticket->>'generation')::bigint<=gate.generation then raise exception 'Obsolete cancellation';end if;
 receipt:=jsonb_build_object('contract','COS_AVIGILON_SOURCE_SEAL_V1','tenantId',p_ticket->>'tenantId','id',p_ticket->>'id','generation',p_ticket->>'generation','commands',p_ticket->'commands','sealed',true,'cancelled',true,'results','[]'::jsonb);
 update cos_avigilon_source_private.control set generation=(p_ticket->>'generation')::bigint,operation_id=(p_ticket->>'id')::uuid,writer_xid=null where singleton;
 insert into cos_avigilon_source_private.receipts values((p_ticket->>'id')::uuid,p_ticket,receipt);
 return receipt;
end $$;
revoke all on function public.cos_avigilon_source_cancel(jsonb) from public,anon,authenticated,service_role;
commit;
