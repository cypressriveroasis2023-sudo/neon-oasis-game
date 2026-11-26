# Victron MPPT readings (Operations)

Applied to Operations (`tughscoxralhofrckvxy`) on 2026-11-26 at about 09:12 CST, with the manager's approval.
The SQL is `tech-checks/operations/db/20261125_cos_vrm_mppt_readings.sql`, applied via `apply_migration` (name `cos_vrm_mppt_readings`).

## What it added

- `cos_vrm_private.mppt_latest`, `mppt_history` (10 days) and `mppt_paths_seen` (path names only). RLS is on, with no client grants.
- `public.cos_vrm_mppt_targets()` and `public.cos_vrm_mppt_save(jsonb, jsonb)`: execute is granted to `service_role` only.
- `cos_vrm_private.enqueue_mppt_sync()`: posts to the new function with the existing `cos_vrm_sync_secret`, read inside the database only.
- Edge function `cos-vrm-mppt-sync` (v1, `verify_jwt=false`, its own scheduler-credential check). Source: `tech-checks/supabase/functions/cos-vrm-mppt-sync/`. What is on `main` is what is deployed.
- Operations cron job 3 `cos-vrm-mppt-sync` at `7,22,37,52 * * * *` (`db/cos-vrm-mppt-schedule-enable.sql`), seven minutes after each fleet sync.

`cos-vrm-fleet-sync`, `public.cos_vrm_fleet_finish` and the fleet-sync cron job are **unchanged**. The new function stands back whenever the fleet sync is running, failing, rate limited or stale, and reads only Helios units that reported power in the last 24 hours.

## Checked afterwards

- `anon` and `authenticated` cannot execute the two functions or the enqueue; `service_role` can.
- One manual `select cos_vrm_private.enqueue_mppt_sync();` at 09:17 CST, after the 09:15 fleet sync: HTTP 200, `{"ok":true,"state":"current","units":14,"rows":154}`.
- 154 rows saved for 14 units, 11 readings each. Victron sends, per charger: `/Pv/V`, `/Dc/0/Voltage`, `/Dc/0/Current`, `/State`, `/ErrorCode`, `/MppOperationMode`, `/History/Daily/0/Yield`, `/History/Daily/0/MaxPower`, `/History/Daily/1/Yield`, `/History/Daily/1/MaxPower`, `/Yield/User`. It does not send `/Pv/I`.
- 22 charger path names recorded in `mppt_paths_seen`.

## Stage 2, same day (about 09:47 CST): the read for the app

- `public.cos_vrm_mppt_read()` (`tech-checks/operations/db/20261126_cos_vrm_mppt_read.sql`, migration `cos_vrm_mppt_read`): one row per Helios, execute granted to `service_role` only.
- Edge function `cos-vrm-mppt-read` (v1, `verify_jwt=false`): read-only, the same gate as `cos-vrm-history` (the caller's token is forwarded to Operations `GET /api/vrm-fleet`; readings are served only on a 200). It deploys with `cos-vrm-history/history.ts` as a relative dependency. Main = deployed.
- Checked: `anon` and `authenticated` cannot execute the read; it returns 14 units; a plain GET to the function answers 405 "Use POST.".
- Rollback for this stage: `drop function if exists public.cos_vrm_mppt_read();` and delete the `cos-vrm-mppt-read` edge function. The app shows no Panels line when it is unreachable.

## Rollback

```sql
select cron.unschedule('cos-vrm-mppt-sync');
drop function if exists cos_vrm_private.enqueue_mppt_sync();
drop function if exists public.cos_vrm_mppt_save(jsonb, jsonb);
drop function if exists public.cos_vrm_mppt_targets();
drop table if exists cos_vrm_private.mppt_history, cos_vrm_private.mppt_latest, cos_vrm_private.mppt_paths_seen;
```

Then delete the `cos-vrm-mppt-sync` edge function. Nothing else reads these tables yet.
