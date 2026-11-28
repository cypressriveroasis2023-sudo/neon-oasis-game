# mHelp alert (Tech Check, applied 2026-11-27 21:58 UTC)

James, 27 Nov: "build the mHelp alert". mHelpDesk refused COS's saved login (refresh token `invalid_grant`) at
08:01 UTC and nobody knew until about 21:00, while the camera sweep held every Sniper / CAM V as Unknown. It is the
9th refusal since 29 Oct (`cos_mhelp_placement_private.rejected_refresh_grant`, Operations). James confirmed the bots
use the same mHelp developer login, which is the likely cause.

Source: `tech-checks/database-maintenance/cos-mhelp-auth-alert-v1.sql`.

## What changed

- `app_private.mhelp_auth_watch` (one row): last known state `ok` / `reconnect_required`. Seeded `ok` at apply.
- `public.cos_mhelp_auth_alerts_v1()` reads the newest `COS_MHELP_RENEWAL_STATUS_V1` answer (cron job 10's call to
  Operations `cos-mhelp-readiness`) from `net._http_response`, last 3 hours. On the change to `reconnect_required` it
  writes an in-app notice to Owner and IT and returns one alert; repeats every 6 hours while unresolved; on the change
  back to `renewed` / `not_due` it says "mHelpDesk reconnected". Nothing is called; Operations is not touched.
- `public.cos_mhelp_auth_alerts_safe_v1()` wraps it: any error gives no mHelp alert, never a failed router run.
- `public.cos_router_down_alerts_v1()` anchored edit: its returned `alerts` now append
  `public.cos_mhelp_auth_alerts_safe_v1()`, so cron job 16 (`:11` / `:41`) and edge function `cos-router-down-alert`
  push it to phones with the router alerts. No new cron job, no new edge function, no audit row.

Detection: the refusal shows up at the `:01` readiness call; the next router-alert run (`:11` or `:41`) sends it.

Tested in a rolled-back transaction: a fake refusal gave one alert, a second call none, a fake `not_due` gave
"reconnected"; 6 notices (3 recipients x 2).

## Board

`src/cosBoard/boardApp.ts`: when mHelp's own read time is more than 50 minutes old (it is read every 15), a red line
above the counts says mHelp has not been read since then and how the Owner reconnects. Client only.

## Rollback

```sql
do $do$ declare d text := pg_get_functiondef('public.cos_router_down_alerts_v1'::regproc); begin
  execute replace(d, $a$'alerts', v_new || public.cos_mhelp_auth_alerts_safe_v1());$a$, $a$'alerts', v_new);$a$); end $do$;
drop function if exists public.cos_mhelp_auth_alerts_safe_v1();
drop function if exists public.cos_mhelp_auth_alerts_v1();
drop table if exists app_private.mhelp_auth_watch;
```
