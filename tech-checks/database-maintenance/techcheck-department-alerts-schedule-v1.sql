-- Run only AFTER the Edge Function has been deployed, the queue migration
-- verified, and the existing manager Google credentials probe has succeeded.
-- Reuse the existing private scheduler secret, never copy it into source.
begin;
select cron.schedule('techcheck-department-alerts-v1','* * * * *', $job$
  select net.http_post(
    url:='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/techcheck-department-alerts',
    headers:=jsonb_build_object(
       'Content-Type','application/json',
       'x-techcheck-cron',(select decrypted_secret
         from vault.decrypted_secrets where name='service_daily_delivery_cron_secret')
    ),
    body:='{}'::jsonb,timeout_milliseconds:=120000
  );
$job$);
commit;
