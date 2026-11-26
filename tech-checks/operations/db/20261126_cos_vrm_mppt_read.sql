-- Read-only MPPT summary for the app: one row per Helios with saved charger readings.
-- Additive: one function, nothing else changed. Chargers on one unit are added together (yield, peak)
-- or the highest is taken (panel volts, error code). observedAt is the newest live reading (epoch seconds),
-- so the app can tell a unit that is reporting now from one that was unplugged.
create or replace function public.cos_vrm_mppt_read()
returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object('units', coalesce((
    select jsonb_agg(u.unit order by u.name, u.installation_id) from (
      select i.name, i.installation_id, jsonb_build_object(
        'installationId', i.installation_id, 'name', i.name,
        'observedAt', floor(extract(epoch from max(l.observed_at) filter (where l.path in ('/Pv/V','/Dc/0/Voltage','/Dc/0/Current'))))::bigint,
        'yieldToday', sum(l.value) filter (where l.path = '/History/Daily/0/Yield'),
        'yieldYesterday', sum(l.value) filter (where l.path = '/History/Daily/1/Yield'),
        'peakToday', sum(l.value) filter (where l.path = '/History/Daily/0/MaxPower'),
        'peakYesterday', sum(l.value) filter (where l.path = '/History/Daily/1/MaxPower'),
        'panelVolts', max(l.value) filter (where l.path in ('/Pv/V','/Pv/0/V','/Pv/1/V')),
        'errorCode', max(l.value) filter (where l.path = '/ErrorCode')) as unit
      from cos_vrm_private.installations i
      join cos_vrm_private.mppt_latest l on l.installation_id = i.installation_id
      where i.name ~* '^HELIOS[[:space:]]+[0-9]{1,3}$'
      group by i.installation_id, i.name
    ) u), '[]'::jsonb));
$function$;
revoke all on function public.cos_vrm_mppt_read() from public, anon, authenticated;
grant execute on function public.cos_vrm_mppt_read() to service_role;
