-- 2026-11-26 — Router-down alert (Tech Check `goqrnolcvqnirjmzaeyk`)
--
-- James (25 Nov): "Go" on the router-down alert: hear about a field unit's router going offline without opening
-- the board. Read-only towards InHand; nothing is changed on any router or unit.
--
-- How it works
--   * The 30-minute InHand pull (cron job 14, :07/:37) keeps camera_unit_routers.reported_status fresh.
--   * Cron job 16 (:11/:41, a free minute) calls edge function `cos-router-down-alert`, which calls
--     public.cos_router_down_alerts_v1() below and pushes what it returns to Owner and IT phones.
--   * inhand_private.router_watch remembers, per router serial, the status seen last and since when.
--   * A field router that was seen ONLINE and then reads OFFLINE in two pulls in a row (about 30 minutes) raises one
--     alert. When it comes back, one "back online" note, only if an alert went out. A unit that went down less than
--     6 hours after its last alert is not alerted again (flapping). At most 15 alerts in one run; the rest are
--     summed up in one line.
--   * A router already offline when this starts is never alerted (no first-run flood): its "since" is unknown.
--   * Field means mHelp says FIELD: through the unit's own A# link first, else a single exact unit-number match.
--   * In-app: one app_notifications row per active Owner and IT (kinds 'camera_health' / 'camera_recovered', the
--     existing ones, so the kind check constraint is unchanged). Push: the edge function, honouring each person's
--     browser_notifications preference.
--   * No camera_inventory_audit row is written, so the camera sweep allow-list is not touched.
--
-- Rollback:
--   select cron.unschedule('cos-router-down-alert');
--   drop function if exists public.cos_router_down_alerts_v1();
--   drop table if exists inhand_private.router_alerts; drop table if exists inhand_private.router_watch;
--   (and delete the edge function cos-router-down-alert)

create table if not exists inhand_private.router_watch (
  serial text primary key,
  unit_key text not null,
  status text not null check (status in ('online', 'offline')),
  since timestamptz,            -- null = was already in this state when watching began (start unknown)
  offline_pulls integer not null default 0,
  seen_online boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists inhand_private.router_alerts (
  id bigint generated always as identity primary key,
  serial text not null,
  unit_key text not null,
  kind text not null check (kind in ('down', 'back')),
  went_offline_at timestamptz,
  created_at timestamptz not null default now(),
  pushed integer,
  push_failed integer
);
create index if not exists router_alerts_serial_created on inhand_private.router_alerts (serial, created_at desc);
revoke all on inhand_private.router_watch, inhand_private.router_alerts from public, anon, authenticated;

create or replace function public.cos_router_down_alerts_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record; w record;
  v_new jsonb := '[]'::jsonb;
  v_down integer := 0; v_back integer := 0; v_capped integer := 0;
  c_cap constant integer := 15;
  v_recipients uuid[];
  v_obs timestamptz;
begin
  select max(status_observed_at) into v_obs from public.camera_unit_routers where status_source = 'InHand live pull';
  if v_obs is null or v_obs < now() - interval '40 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'no fresh InHand pull', 'alerts', '[]'::jsonb);
  end if;
  select array_agg(user_id) into v_recipients from public.profiles
   where active and archived_at is null and role in ('owner', 'it');

  for r in
    select upper(btrim(cr.inhand_serial)) serial, cr.unit_key, cr.reported_status st, cr.status_observed_at at,
           coalesce(
             (select f.placement from app_private.cos_mhelp_unit_link l
                join app_private.cos_mhelp_field_list f on f.mhelp_product_id = l.mhelp_product_id
               where l.unit_key = cr.unit_key limit 1),
             (select case when count(*) = 1 then max(f.placement) end from app_private.cos_mhelp_field_list f
               where regexp_replace(upper(regexp_replace(f.unit_number, 'SOLAR\s*SPOTTER', 'SOLARSPOTTER', 'i')), '[^A-Z0-9]', '', 'g')
                   = regexp_replace(upper(cr.unit_key), '[^A-Z0-9]', '', 'g'))) place,
           (select f.customer from app_private.cos_mhelp_unit_link l
              join app_private.cos_mhelp_field_list f on f.mhelp_product_id = l.mhelp_product_id
             where l.unit_key = cr.unit_key limit 1) site
      from public.camera_unit_routers cr
     where nullif(btrim(cr.inhand_serial), '') is not null
       and cr.status_source = 'InHand live pull'
       and cr.reported_status in ('online', 'offline')
       and cr.status_observed_at >= v_obs - interval '5 minutes'
  loop
    select * into w from inhand_private.router_watch where serial = r.serial for update;
    if not found then
      insert into inhand_private.router_watch (serial, unit_key, status, since, offline_pulls, seen_online, updated_at)
      values (r.serial, r.unit_key, r.st, null, case when r.st = 'offline' then 1 else 0 end, r.st = 'online', r.at);
      continue;
    end if;
    if w.updated_at >= r.at then continue; end if;   -- this pull was already counted

    if r.st = 'online' then
      if w.status = 'offline' and w.seen_online and r.place = 'FIELD'
         and exists (select 1 from inhand_private.router_alerts a where a.serial = r.serial and a.kind = 'down'
                      and a.created_at >= coalesce(w.since, now() - interval '7 days')
                      and not exists (select 1 from inhand_private.router_alerts b where b.serial = r.serial and b.kind = 'back' and b.created_at > a.created_at)) then
        insert into inhand_private.router_alerts (serial, unit_key, kind, went_offline_at) values (r.serial, r.unit_key, 'back', w.since);
        v_back := v_back + 1;
        v_new := v_new || jsonb_build_object('kind', 'back', 'unit', r.unit_key, 'site', r.site,
          'title', 'Router back: ' || r.unit_key,
          'body', r.unit_key || '''s router is back online' ||
                  case when w.since is not null then ' after ' || public.cos_router_alert_span_v1(now() - w.since) else '' end ||
                  '. Check the cameras answer too.');
      end if;
      update inhand_private.router_watch set status = 'online', since = case when w.status = 'online' then w.since else r.at end,
        offline_pulls = 0, seen_online = true, unit_key = r.unit_key, updated_at = r.at where serial = r.serial;
    else
      update inhand_private.router_watch set status = 'offline',
        since = case when w.status = 'offline' then w.since when w.seen_online then r.at else null end,
        offline_pulls = case when w.status = 'offline' then w.offline_pulls + 1 else 1 end,
        unit_key = r.unit_key, updated_at = r.at where serial = r.serial
      returning * into w;
      if w.offline_pulls = 2 and w.seen_online and w.since is not null and r.place = 'FIELD'
         and not exists (select 1 from inhand_private.router_alerts a where a.serial = r.serial and a.kind = 'down' and a.created_at > now() - interval '6 hours') then
        if v_down >= c_cap then
          v_capped := v_capped + 1;
        else
          insert into inhand_private.router_alerts (serial, unit_key, kind, went_offline_at) values (r.serial, r.unit_key, 'down', w.since);
          v_down := v_down + 1;
          v_new := v_new || jsonb_build_object('kind', 'down', 'unit', r.unit_key, 'site', r.site,
            'title', 'Router down: ' || r.unit_key,
            'body', r.unit_key || coalesce(' (' || nullif(r.site, '') || ')', '') ||
                    ': the router has not reached InHand for about ' || public.cos_router_alert_span_v1(now() - w.since) ||
                    '. The cameras behind it cannot be reached either. Check power first, then the SIM and antenna.');
        end if;
      end if;
    end if;
  end loop;

  if v_capped > 0 then
    v_new := v_new || jsonb_build_object('kind', 'down', 'unit', null, 'title', 'Routers down: ' || v_capped || ' more',
      'body', v_capped || ' more field routers went offline in the same half hour. That many at once usually means InHand or a carrier, not the units. See Punch list → Router problems.');
  end if;

  if coalesce(array_length(v_recipients, 1), 0) > 0 and jsonb_array_length(v_new) > 0 then
    insert into public.app_notifications (recipient_user_id, kind, title, body, unit_tag)
    select u, case when a->>'kind' = 'back' then 'camera_recovered' else 'camera_health' end, a->>'title', a->>'body', a->>'unit'
      from unnest(v_recipients) u cross join jsonb_array_elements(v_new) a;
  end if;

  return jsonb_build_object('ok', true, 'down', v_down, 'back', v_back, 'capped', v_capped, 'alerts', v_new);
end $$;

create or replace function public.cos_router_alert_span_v1(p interval)
returns text language sql immutable set search_path = '' as $$
  select case when p < interval '90 minutes' then greatest(1, round(extract(epoch from p) / 60))::int || ' minutes'
              when p < interval '48 hours' then round(extract(epoch from p) / 3600)::int || ' hours'
              else round(extract(epoch from p) / 86400)::int || ' days' end;
$$;

-- Who gets the push, and where. Service role only. Never returns another person's keys to a browser.
create or replace function public.cos_router_alert_push_targets_v1()
returns table (user_id uuid, endpoint text, p256dh text, auth text, sub_id uuid)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.endpoint, s.p256dh, s.auth, s.id
    from public.push_subscriptions s
    join public.profiles p on p.user_id = s.user_id and p.active and p.archived_at is null and p.role in ('owner', 'it')
    left join public.notification_preferences np on np.user_id = s.user_id
   where s.enabled and coalesce(np.browser_notifications, true);
$$;

do $$
declare f text;
begin
  foreach f in array array['public.cos_router_down_alerts_v1()', 'public.cos_router_alert_span_v1(interval)', 'public.cos_router_alert_push_targets_v1()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Schedule (run once, after the edge function is deployed). Minutes 11 and 41 are free; the pull is :07/:37.
-- The secret header is built the same way as job 14 (inhand-router-status-pull); copy that job's command and
-- change only the URL to /functions/v1/cos-router-down-alert and drop the prune line:
--   select cron.schedule('cos-router-down-alert', '11,41 * * * *', $cmd$ <job 14 command with the new URL> $cmd$);
