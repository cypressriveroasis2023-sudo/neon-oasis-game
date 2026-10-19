-- Retry signed handoff report delivery using the existing server-only secret.
-- This schedule never enables the handoff workflow or changes inventory.
begin;
select cron.schedule('techcheck-transfer-delivery-v1','* * * * *', $job$
 select net.http_post(
  url:='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/techcheck-transfer-delivery',
  headers:=jsonb_build_object('Content-Type','application/json','x-techcheck-cron',(select decrypted_secret from vault.decrypted_secrets where name='service_daily_delivery_cron_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
commit;
