-- UNAPPLIED. This file is not a migration and nothing in CI runs it.
-- Leave the job unscheduled until the producer secret patch is deployed
-- and a person has set the secret in both places below. Do not put the
-- secret in this file, a URL, or a log.
--
-- Deploy order: PR 425's producer gate first, then the schedule-produce-secret
-- function patch, then cadence-5min.sql, then this schedule.
--
-- Secret, set by a person to the same value in both places:
-- 1. Edge function secret COS_FLEET_BOARD_PRODUCE_SECRET on cos-fleet-board-producer.
-- 2. Vault secret named fleet_board_produce_secret, which this job reads.
--
-- The job asks for a lease with cos_fleet_board_begin(p_force := false).
-- A running build inside the 180-second lock, or a next_at still in the
-- future, returns null and this job does not call produce. When a lease
-- id comes back, produce still has to claim that run. The secret is not
-- sent on any other route.

create or replace function public.cos_fleet_board_produce_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $tick$
declare
  lease jsonb;
  secret text;
  request_id bigint;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'fleet_board_produce_secret';
  if secret is null or length(secret) < 32 then
    raise exception 'fleet board produce secret is not configured';
  end if;
  lease := public.cos_fleet_board_begin(false, gen_random_uuid());
  if lease is null or coalesce(lease->>'id', '') = '' then
    return;
  end if;
  select net.http_post(
    url := 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-fleet-board-producer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-COS-Fleet-Board-Produce', secret
    ),
    body := jsonb_build_object(
      'path', '/api/fleet-saved-board/produce',
      'method', 'POST',
      'body', jsonb_build_object('run', lease->>'id')
    ),
    timeout_milliseconds := 20000
  ) into request_id;
end
$tick$;

alter function public.cos_fleet_board_produce_tick() owner to service_role;
revoke all on function public.cos_fleet_board_produce_tick() from public, anon, authenticated;
grant execute on function public.cos_fleet_board_produce_tick() to postgres;

-- Not scheduled by this change. A person runs the next statement only after review.
-- select cron.schedule('cos-fleet-board-produce', '*/5 * * * *', 'select public.cos_fleet_board_produce_tick()');
