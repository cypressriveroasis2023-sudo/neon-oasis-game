-- REVIEW CANDIDATE. Install only after explicit approval of this server schedule
-- and deployment of the reviewed techcheck-correction-delivery Edge Function.
-- Reuses the existing server-only cron authentication; does not expose its value,
-- enable correction writes, change sharing or create a handoff/correction.
begin;
do $$
begin
 if to_regprocedure('public.techcheck_correction_delivery_v1(text,uuid,uuid,uuid,jsonb)') is null then
  raise exception 'Install the reviewed correction migration first.';
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='service_daily_delivery_cron_secret' and length(decrypted_secret)>0) then
  raise exception 'The existing delivery cron authentication is unavailable.';
 end if;
end$$;
select cron.schedule('techcheck-correction-delivery-v1','*/5 * * * *', $job$
 select net.http_post(
  url:='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/techcheck-correction-delivery',
  headers:=jsonb_build_object('Content-Type','application/json','x-techcheck-cron',(select decrypted_secret from vault.decrypted_secrets where name='service_daily_delivery_cron_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
commit;
