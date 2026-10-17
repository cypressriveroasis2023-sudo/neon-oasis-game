-- REVIEW CANDIDATE. Install held; no provider calls, events or activation here.
begin;
alter table app_private.techcheck_transfer_outbox
 add column delivery_snapshot jsonb,
 add column snapshot_text text,
 add column snapshot_sha256 text,
 add column attempts integer not null default 0 check(attempts between 0 and 8),
 add column next_attempt_at timestamptz not null default now(),
 add column lease_token uuid,
 add column locked_until timestamptz,
 add column drive_manifest jsonb not null default '{"parts":{}}',
 add column email_state text not null default 'pending' check(email_state in ('pending','sending','sent','review')),
 add column email_id text,
 add column delivered_at timestamptz,
 add column last_error text;
-- Existing queued rows require deliberate reconciliation; do not reconstruct
-- old evidence using mutable current transfer state or send historic mail.
update app_private.techcheck_transfer_outbox set status='review',last_error='Historical handoff requires delivery reconciliation.';
alter table app_private.techcheck_transfer_outbox alter column status set default 'queued';
alter table app_private.techcheck_transfer_outbox add constraint techcheck_transfer_delivery_status check(status in ('queued','processing','retry','blocked','review','sent'));
create index techcheck_transfer_delivery_pending on app_private.techcheck_transfer_outbox(next_attempt_at,created_at) where status in ('queued','processing','retry','blocked');

create function app_private.techcheck_transfer_capture_delivery_v3() returns trigger
language plpgsql security definer set search_path='' as $$
declare e app_private.techcheck_transfer_events%rowtype;t app_private.techcheck_transfers%rowtype;linked jsonb;receipt uuid;
begin
 select * into strict e from app_private.techcheck_transfer_events where id=new.event_id and transfer_id=new.transfer_id;
 select * into strict t from app_private.techcheck_transfers where id=e.transfer_id;
 if e.kind='return' then
  select id into receipt from app_private.techcheck_transfer_events where transfer_id=t.id and kind='receipt' and snapshot->>'state'='accepted' and (snapshot->>'revision')::integer<(e.snapshot->>'revision')::integer order by (snapshot->>'revision')::integer desc limit 1;
  if receipt is null then raise exception 'Accepted Service receipt required for return delivery.';end if;
 end if;
 select jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'actor_id',x.actor_id,'actor_name',x.actor_name,'signed_at',x.signed_at,'snapshot',x.snapshot,'photos',x.photos) order by (x.snapshot->>'revision')::integer) into linked
 from app_private.techcheck_transfer_events x where x.transfer_id=t.id and x.id in (t.id,e.id,receipt);
 new.delivery_snapshot:=jsonb_build_object('version',1,'event_id',e.id,'transfer_id',t.id,'revision',e.snapshot->'revision','kind',e.kind,'it_actor',t.it_actor,'service_actor',t.service_actor,'it_name',t.it_name,'service_name',t.service_name,'events',linked);
 new.snapshot_text:=new.delivery_snapshot::text;
 new.snapshot_sha256:=encode(sha256(convert_to(new.snapshot_text,'UTF8')),'hex');
 new.status:='queued';
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_capture_delivery_v3() from public,anon,authenticated,service_role;
create trigger techcheck_transfer_capture_delivery before insert on app_private.techcheck_transfer_outbox for each row execute function app_private.techcheck_transfer_capture_delivery_v3();

create function app_private.techcheck_transfer_delivery_immutable_v3() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.event_id is distinct from old.event_id or new.transfer_id is distinct from old.transfer_id or new.delivery_snapshot is distinct from old.delivery_snapshot or new.snapshot_text is distinct from old.snapshot_text or new.snapshot_sha256 is distinct from old.snapshot_sha256 or new.created_at is distinct from old.created_at then raise exception 'Accepted handoff delivery snapshot is immutable.';end if;
 return new;
end$$;
revoke all on function app_private.techcheck_transfer_delivery_immutable_v3() from public,anon,authenticated,service_role;
create trigger techcheck_transfer_delivery_immutable before update on app_private.techcheck_transfer_outbox for each row execute function app_private.techcheck_transfer_delivery_immutable_v3();

create function app_private.techcheck_transfer_delivery_v3(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare q app_private.techcheck_transfer_outbox%rowtype;token uuid:=gen_random_uuid();m jsonb;k text;v jsonb;n integer;result text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server access required.' using errcode='42501';end if;
 if p_action='claim' then
  if not app_private.techcheck_transfer_ready_v1() then return null;end if;
  -- A worker could disappear after Gmail accepted a message. An expired lease
  -- with an in-flight send is held, never automatically sent a second time.
  update app_private.techcheck_transfer_outbox set status='review',email_state='review',lease_token=null,locked_until=null,last_error='Verify ambiguous email delivery before reconciliation.' where status='processing' and locked_until<=now() and email_state in ('sending','review');
  update app_private.techcheck_transfer_outbox set status='review',lease_token=null,locked_until=null,last_error='Delivery attempt limit reached; reconcile before retrying.' where status in ('queued','retry','blocked','processing') and attempts>=8 and (locked_until is null or locked_until<=now());
  select o.* into q from app_private.techcheck_transfer_outbox o join app_private.techcheck_transfers t on t.id=o.transfer_id
   where (p_id is null or o.event_id=p_id) and (p_actor is null or exists(select 1 from public.profiles p where p.user_id=p_actor and p.active and p.archived_at is null and (app_private.cos_verified_fleet_actor(p_actor) or p.role::text='service' and t.service_actor=p_actor)))
   and o.status in ('queued','retry','blocked','processing') and o.delivery_snapshot is not null and o.attempts<8 and o.next_attempt_at<=now() and (o.locked_until is null or o.locked_until<=now())
   order by o.created_at,o.event_id limit 1 for update of o skip locked;
  if not found then return null;end if;
  update app_private.techcheck_transfer_outbox set status='processing',lease_token=token,locked_until=now()+interval '10 minutes',attempts=attempts+1 where event_id=q.event_id returning * into q;
  return to_jsonb(q);
 end if;
 select * into q from app_private.techcheck_transfer_outbox where event_id=p_id and status='processing' and lease_token=p_lease and locked_until>now() for update;
 if not found then raise exception 'Delivery lease expired.';end if;
 if p_action='checkpoint' then
  if p_data ? 'drive_manifest' then
   m:=p_data->'drive_manifest';
   if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'parts') is distinct from 'object' or m->>'snapshot_sha256' is distinct from q.snapshot_sha256 then raise exception 'Exact delivery archive required.';end if;
   for k,v in select key,value from jsonb_each(q.drive_manifest->'parts') loop
    if m->'parts'->k->>'id' is distinct from v->>'id' or v->>'done'='true' and m->'parts'->k is distinct from v then raise exception 'Reserved archive identities cannot change.';end if;
   end loop;
   if q.drive_manifest->>'complete'='true' and m is distinct from q.drive_manifest then raise exception 'Verified archive is immutable.';end if;
   if m->>'complete'='true' then
    select sum(jsonb_array_length(e->'photos'))::integer into n from jsonb_array_elements(q.delivery_snapshot->'events') e;
    if (select count(*) from jsonb_each(m->'parts'))<>n+4 then raise exception 'Every archive part must be verified.';end if;
    foreach k in array array['folder','html','json','pdf'] loop
     if m->'parts'->k->'done' is distinct from 'true'::jsonb or nullif(m->'parts'->k->>'id','') is null then raise exception 'Every archive part must be verified.';end if;
    end loop;
    for k in select 'photo_'||i from generate_series(0,n-1) i loop
     if m->'parts'->k->'done' is distinct from 'true'::jsonb or nullif(m->'parts'->k->>'id','') is null then raise exception 'Every evidence image must be verified.';end if;
    end loop;
   end if;
   update app_private.techcheck_transfer_outbox set drive_manifest=m where event_id=p_id;
   q.drive_manifest:=m;
  end if;
  if p_data ? 'email_state' then
   result:=p_data->>'email_state';
   if q.drive_manifest->'complete' is distinct from 'true'::jsonb or not ((q.email_state='pending' and result='sending') or (q.email_state='sending' and result='sent' and nullif(p_data->>'email_id','') is not null)) then raise exception 'Verified archive and ordered email confirmation required.';end if;
   update app_private.techcheck_transfer_outbox set email_state=result,email_id=case when result='sent' then p_data->>'email_id' else email_id end where event_id=p_id;
  elsif p_data ? 'email_id' then raise exception 'Email identity requires send confirmation.';
  end if;
 elsif p_action='finish' then
  result:=p_data->>'status';
  if result is null or result not in ('sent','retry','blocked','review') then raise exception 'Invalid delivery result.';end if;
  if result='sent' and (q.email_state<>'sent' or nullif(q.email_id,'') is null or q.drive_manifest->'complete' is distinct from 'true'::jsonb) then raise exception 'Verified archive and provider email confirmation required.';end if;
  if q.email_state in ('sending','review') or result<>'sent' and q.attempts>=8 then result:='review';end if;
  update app_private.techcheck_transfer_outbox set status=result,last_error=case result when 'sent' then null when 'review' then 'Delivery requires reconciliation.' when 'blocked' then 'Delivery connection unavailable.' else 'Delivery interrupted; retry pending.' end,
   lease_token=null,locked_until=null,next_attempt_at=now()+make_interval(mins=>least(240,5*(2^(q.attempts-1))::integer)),delivered_at=case when result='sent' then now() else null end where event_id=p_id;
 else raise exception 'Invalid delivery action.';end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function app_private.techcheck_transfer_delivery_v3(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.techcheck_transfer_delivery_v3(text,uuid,uuid,uuid,jsonb) to service_role;
create function public.techcheck_transfer_delivery_v3(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select app_private.techcheck_transfer_delivery_v3(p_action,p_id,p_actor,p_lease,p_data)$$;
revoke all on function public.techcheck_transfer_delivery_v3(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.techcheck_transfer_delivery_v3(text,uuid,uuid,uuid,jsonb) to service_role;
-- The existing scheduler and Google scopes/destination are reused by the worker.
-- reports_ready/receipt_link_ready/custody_ready/enabled remain false on install.
commit;
