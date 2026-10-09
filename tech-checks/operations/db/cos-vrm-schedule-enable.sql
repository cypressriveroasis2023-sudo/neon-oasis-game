-- Apply only after the user approves ongoing VRM/scheduler access, sets COS_VRM_ACCESS_TOKEN
-- through secure Supabase secret entry, and a manual discovery succeeds in the last five minutes.
-- This generates the specifically approved scheduler credential entirely inside Vault.
-- It never returns/copies the credential, and never stores a Supabase service-role key in Vault.
begin;
do $$ begin
  if not exists (select 1 from cos_vrm_private.sync_state where singleton and source_user_id is not null and last_success_at > now() - interval '5 minutes' and error_code is null) then
    raise exception 'Verify a successful manual VRM discovery before enabling the schedule';
  end if;
end $$;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'cos_vrm_sync_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'cos_vrm_sync_secret','COS VRM discovery scheduler only');
  end if;
end $$;
create or replace function cos_vrm_private.enqueue_scheduled_sync() returns bigint language plpgsql security definer set search_path = '' as $$
declare request_id bigint;
begin
  if exists(select 1 from cos_vrm_private.sync_state where singleton and (lease_until > now() or retry_after_at > now())) then return null; end if;
  select net.http_post(
    url := 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-vrm-fleet-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cos-vrm-sync',(select decrypted_secret from vault.decrypted_secrets where name = 'cos_vrm_sync_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000
  ) into request_id;
  return request_id;
end $$;
revoke all on function cos_vrm_private.enqueue_scheduled_sync() from public,anon,authenticated,service_role;
select cron.schedule('cos-vrm-fleet-discovery','*/15 * * * *','select cos_vrm_private.enqueue_scheduled_sync();');
commit;
