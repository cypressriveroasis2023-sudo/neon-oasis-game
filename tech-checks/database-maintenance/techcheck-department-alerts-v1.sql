-- COS TechCheck mandatory IT <-> Service department messages.
-- Does not change physical custody, source placement, camera health, truck stock or evidence.
-- Apply only after the detached Edge worker and regression tests have been reviewed.
begin;

create table app_private.techcheck_department_alert_outbox_v1 (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('it_checkout','service_return')),
  source_id uuid not null,
  recipient_user_id uuid not null references public.profiles(user_id),
  recipient_email text not null check (recipient_email ~* '^[^@\s]+@camerasonsite[.]com$'),
  subject text not null,
  body text not null,
  state text not null default 'queued' check (state in ('queued','processing','retry','review','sent')),
  email_state text not null default 'pending' check (email_state in ('pending','sending','sent','review')),
  email_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  locked_until timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_kind,source_id,recipient_user_id)
);
create index techcheck_department_alert_outbox_pending_v1 on app_private.techcheck_department_alert_outbox_v1 (next_attempt_at,created_at)
  where state in ('queued','retry','processing');
alter table app_private.techcheck_department_alert_outbox_v1 enable row level security;
revoke all on app_private.techcheck_department_alert_outbox_v1 from public,anon,authenticated,service_role;

-- IT return and Service handoff inbox messages are mandatory operational records,
-- independent of optional push permission and ordinary notification preferences.
-- Exclude archived and synthetic .invalid accounts, but allow newly hired verified staff.
create or replace function public.notification_enabled(p_user_id uuid,p_kind text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_kind in ('returned_unit','equipment_ready_service') then
      exists (
        select 1 from public.profiles p
        where p.user_id=p_user_id and p.active and p.archived_at is null
          and p.role::text=case when p_kind='returned_unit' then 'it' else 'service' end
          and lower(coalesce(nullif(btrim(p.notification_email),''),nullif(btrim(p.email),''),''))
            ~ '^[^@[:space:]]+@camerasonsite[.]com$'
      )
    when p_kind='new_assignment' then coalesce((select n.new_assignments from public.notification_preferences n where n.user_id=p_user_id),true)
    when p_kind='owner_action' then coalesce((select n.owner_actions from public.notification_preferences n where n.user_id=p_user_id),true)
    else true
  end;
$$;

-- Private utility: an event creates exactly one queued email AND one inbox entry
-- per eligible department member. A retry cannot manufacture extra notifications.
create function app_private.techcheck_department_alert_enqueue_v1(
 p_kind text,p_source uuid,p_role text,p_subject text,p_title text,
 p_body text,p_ticket text default null,p_unit text default null
) returns integer
language plpgsql security definer set search_path='' as $$
declare v_recipient record;v_id uuid;v_count integer:=0;
begin
 if (p_kind='it_checkout' and p_role<>'service')
    or (p_kind='service_return' and p_role<>'it')
    or p_kind not in ('it_checkout','service_return') or p_source is null
 then raise exception 'Invalid department alert source.';end if;
 for v_recipient in
   select p.user_id,lower(coalesce(nullif(btrim(p.notification_email),''),nullif(btrim(p.email),''))) as address
   from public.profiles p
   where p.role::text=p_role and p.active and p.archived_at is null
     and lower(coalesce(nullif(btrim(p.notification_email),''),nullif(btrim(p.email),''),''))
         ~ '^[^@[:space:]]+@camerasonsite[.]com$'
 loop
   v_id:=null;
   insert into app_private.techcheck_department_alert_outbox_v1(
      source_kind,source_id,recipient_user_id,recipient_email,subject,body
   ) values (
      p_kind,p_source,v_recipient.user_id,v_recipient.address,left(p_subject,180),left(p_body,4000)
   ) on conflict (source_kind,source_id,recipient_user_id) do nothing returning id into v_id;
   if v_id is not null then
     insert into public.app_notifications(
        recipient_user_id,kind,title,body,ticket_no,unit_tag
     ) values (
        v_recipient.user_id,
        case when p_role='it' then 'returned_unit' else 'equipment_ready_service' end,
        left(p_title,140),left(p_body,700),p_ticket,p_unit
     );
     v_count:=v_count+1;
   end if;
 end loop;
 return v_count;
end$$;
revoke all on function app_private.techcheck_department_alert_enqueue_v1(text,uuid,text,text,text,text,text,text)
 from public,anon,authenticated,service_role;

-- New signed IT -> Service handoff. Notify both Service technicians; only the
-- chosen service_actor can acknowledge or hold physical custody in the original workflow.
create function app_private.techcheck_department_alert_checkout_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_units text;v_named text;v_actor text;v_body text;
begin
 if new.kind<>'checkout' then return new;end if;
 select coalesce(string_agg(left(coalesce(i.value->>'family','Unit')||' '||
        coalesce(i.value->>'unit_tag','unknown'),100),', ' order by i.ordinality),'Equipment')
 into v_units
 from jsonb_array_elements(case when jsonb_typeof(new.snapshot->'expected')='array'
   then new.snapshot->'expected' else '[]'::jsonb end) with ordinality as i(value,ordinality);
 v_named:=coalesce(nullif(new.snapshot->>'service_name',''),'the designated Service technician');
 v_actor:=coalesce(nullif(new.actor_name,''),'IT');
 v_body:='IT technician '||v_actor||' signed a handoff for: '||v_units||
   '. Assigned receiver: '||v_named||
   '. Both Service technicians are notified, but only the assigned receiver can verify physical receipt.'||
   ' Open COS: https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/tech-checks/';
 perform app_private.techcheck_department_alert_enqueue_v1(
   'it_checkout',new.id,'service',
   'COS - Equipment handoff from IT: '||left(v_units,110),
   'IT handoff - equipment for Service',
   v_body,null,null
 );
 return new;
end$$;
revoke all on function app_private.techcheck_department_alert_checkout_v1() from public,anon,authenticated,service_role;
create trigger techcheck_department_alert_checkout_v1
 after insert on app_private.techcheck_transfer_events for each row
 execute function app_private.techcheck_department_alert_checkout_v1();

-- Reuse the existing, guarded Service Return -> IT Intake insert trigger;
-- never notify on an unsent phone draft, a duplicate retry or a 110V stand
-- that legitimately returns straight to Shop without IT Intake.
create or replace function public.notify_return_waiting_it()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_body text;
begin
 if new.status is distinct from 'waiting_it' then return new;end if;
 v_body:='Service technician '||coalesce(nullif(new.service_tech_name,''),'Service')||
   ' returned '||coalesce(new.equipment_type,'Unit')||' '||coalesce(new.unit_tag,'')||
   ' under MHelpDesk #'||coalesce(new.ticket_no,'unknown')||
   '. This unit is WAITING FOR IT CHECK-IN. Open IT Intake, inspect it and record physical receipt. '||
   'Do not mark received until IT actually checks it in. '||
   'Open COS: https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/tech-checks/';
 perform app_private.techcheck_department_alert_enqueue_v1(
    'service_return',new.id,'it',
    'COS - IT Check-In Required: '||coalesce(new.equipment_type,'Unit')||' '||coalesce(new.unit_tag,''),
    'Returned unit waiting for IT Check-In',
    v_body,new.ticket_no,new.unit_tag
 );
 return new;
end$$;

-- Service-role delivery RPC only; client browser cannot claim or send email.
create function app_private.techcheck_department_alert_delivery_v1(
 p_action text,p_id uuid default null,p_lease uuid default null,p_email_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.techcheck_department_alert_outbox_v1%rowtype;v_token uuid;
begin
 if (select auth.jwt()->>'role') is distinct from 'service_role' then
   raise exception 'Server authorization required.' using errcode='42501';
 end if;
 if p_action='claim' then
   select * into v_row from app_private.techcheck_department_alert_outbox_v1 a
   where a.email_state='pending'
     and a.state in ('queued','retry','processing')
     and a.next_attempt_at<=now()
     and (a.locked_until is null or a.locked_until<now())
   order by a.next_attempt_at,a.created_at
   for update skip locked limit 1;
   if not found then return null;end if;
   v_token:=gen_random_uuid();
   update app_private.techcheck_department_alert_outbox_v1 set
      state='processing',lease_token=v_token,locked_until=now()+interval '5 minutes',
      attempts=attempts+1
   where id=v_row.id;
   return jsonb_build_object('id',v_row.id,'lease_token',v_token,
      'recipient_email',v_row.recipient_email,
      'subject',v_row.subject,'body',v_row.body);
 end if;
 if p_id is null or p_lease is null then raise exception 'Delivery lease required.';end if;
 select * into v_row from app_private.techcheck_department_alert_outbox_v1
    where id=p_id and lease_token=p_lease and state='processing' and locked_until>now()
    for update;
 if not found then raise exception 'Delivery lease invalid or expired.';end if;
 if p_action='begin_send' then
    if v_row.email_state<>'pending' then raise exception 'Email already attempted; review required.';end if;
    update app_private.techcheck_department_alert_outbox_v1
      set email_state='sending' where id=p_id;
 elsif p_action='sent' then
    if v_row.email_state<>'sending' or nullif(btrim(p_email_id),'') is null then
       raise exception 'Verified provider message ID required.';end if;
    update app_private.techcheck_department_alert_outbox_v1 set
      state='sent',email_state='sent',email_id=p_email_id,
      sent_at=now(),lease_token=null,locked_until=null,last_error=null
    where id=p_id;
 elsif p_action='retry' then
    if v_row.email_state<>'pending' then
       raise exception 'Ambiguous send cannot be retried automatically.';end if;
    update app_private.techcheck_department_alert_outbox_v1 set
      state='retry',lease_token=null,locked_until=null,
      next_attempt_at=now()+interval '15 minutes',
      last_error='Delivery configuration or connection unavailable'
    where id=p_id;
 elsif p_action='review' then
    update app_private.techcheck_department_alert_outbox_v1 set
      state='review',email_state='review',lease_token=null,
      locked_until=null,last_error='Check Gmail delivery before resending'
    where id=p_id;
 else
    raise exception 'Unknown department alert delivery action.';
 end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function app_private.techcheck_department_alert_delivery_v1(text,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function app_private.techcheck_department_alert_delivery_v1(text,uuid,uuid,text) to service_role;
create function public.techcheck_department_alert_delivery_v1(
 p_action text,p_id uuid default null,p_lease uuid default null,p_email_id text default null
) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.techcheck_department_alert_delivery_v1(p_action,p_id,p_lease,p_email_id);
$$;
revoke all on function public.techcheck_department_alert_delivery_v1(text,uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.techcheck_department_alert_delivery_v1(text,uuid,uuid,text) to service_role;
commit;
