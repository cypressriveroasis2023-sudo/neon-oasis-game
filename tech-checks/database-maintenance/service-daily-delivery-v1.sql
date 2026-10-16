begin;
-- Server-only queue API; users cannot change delivery status or destinations.
create function app_private.service_daily_delivery_v1(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report app_private.service_daily_reports%rowtype;v_token uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server access required.' using errcode='42501';end if;
 if p_action='claim' then
  select * into v_report from app_private.service_daily_reports r
  where (p_id is null or r.id=p_id) and (p_actor is null or (r.service_tech_id=p_actor and exists(select 1 from public.profiles where user_id=p_actor and active and archived_at is null and role::text='service')))
   and r.delivery_status in ('queued','retry','blocked','processing') and r.next_attempt_at<=now() and (r.locked_until is null or r.locked_until<now())
  order by r.submitted_at limit 1 for update skip locked;
  if not found then return null;end if;
  update app_private.service_daily_reports set delivery_status='processing',lease_token=v_token,locked_until=now()+interval '10 minutes',attempts=attempts+1 where id=v_report.id returning * into v_report;
  return to_jsonb(v_report)-'request';
 end if;
 select * into v_report from app_private.service_daily_reports where id=p_id and lease_token=p_lease and locked_until>now() for update;
 if not found then raise exception 'Delivery lease expired.';end if;
 if p_action='checkpoint' then
  update app_private.service_daily_reports set drive_manifest=coalesce(p_data->'drive_manifest',drive_manifest),email_state=coalesce(p_data->>'email_state',email_state),email_id=coalesce(p_data->>'email_id',email_id) where id=p_id;
 elsif p_action='finish' then
  if p_data->>'status' not in ('sent','retry','blocked','review') then raise exception 'Invalid delivery result.';end if;
  if p_data->>'status'='sent' and (v_report.email_state<>'sent' or not coalesce((v_report.drive_manifest->>'complete')::boolean,false)) then raise exception 'Archive and email confirmation required.';end if;
  update app_private.service_daily_reports set delivery_status=p_data->>'status',last_error=left(p_data->>'error',240),locked_until=null,lease_token=null,
   next_attempt_at=now()+interval '15 minutes',delivered_at=case when p_data->>'status'='sent' then now() else null end where id=p_id;
 else raise exception 'Invalid queue action.';end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function app_private.service_daily_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.service_daily_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;
create function public.service_daily_delivery_v1(p_action text,p_id uuid default null,p_actor uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select app_private.service_daily_delivery_v1(p_action,p_id,p_actor,p_lease,p_data)$$;
revoke all on function public.service_daily_delivery_v1(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_daily_delivery_v1(text,uuid,uuid,uuid,jsonb) to service_role;

-- Authenticate the scheduler without putting a server key into cron or source.
do $$begin
 if not exists(select 1 from vault.secrets where name='service_daily_delivery_cron_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'service_daily_delivery_cron_secret','Daily archive scheduler authentication');
 end if;
end$$;
create function app_private.service_daily_cron_authorized_v1(p_secret text) returns boolean
language sql security definer set search_path='' as $$
 select auth.role()='service_role' and length(p_secret)=64 and exists(select 1 from vault.decrypted_secrets where name='service_daily_delivery_cron_secret' and decrypted_secret=p_secret)
$$;
revoke all on function app_private.service_daily_cron_authorized_v1(text) from public,anon,authenticated;
grant execute on function app_private.service_daily_cron_authorized_v1(text) to service_role;
create function public.service_daily_cron_authorized_v1(p_secret text) returns boolean language sql security invoker set search_path='' as $$select app_private.service_daily_cron_authorized_v1(p_secret)$$;
revoke all on function public.service_daily_cron_authorized_v1(text) from public,anon,authenticated;
grant execute on function public.service_daily_cron_authorized_v1(text) to service_role;
select cron.schedule('service-daily-delivery-v1','*/5 * * * *', $cron$
 select net.http_post(
 url:='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/service-daily-delivery',
 headers:=jsonb_build_object('Content-Type','application/json','x-techcheck-cron',(select decrypted_secret from vault.decrypted_secrets where name='service_daily_delivery_cron_secret')),
 body:='{}'::jsonb, timeout_milliseconds:=120000);
$cron$);
commit;
