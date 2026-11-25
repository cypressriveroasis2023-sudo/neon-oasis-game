# Victron battery history (Operations)

Applied to Operations (`tughscoxralhofrckvxy`) on 2026-11-24 at about 21:25 CST, with the owner's approval.
The SQL is `tech-checks/operations/db/20261124_cos_vrm_power_history.sql`, applied via `apply_migration` (name `cos_vrm_power_history`).

## What it added

- `cos_vrm_private.power_history`: one point per Helios per saved Victron reading (battery %, solar W, battery W, volts), kept 8 days. RLS is on, with no client grants.
- `cos_vrm_private.capture_power_history()` and the trigger `cos_vrm_power_history_capture`: `AFTER INSERT OR UPDATE OF power_observations ON cos_vrm_private.installations`.
  - `public.cos_vrm_fleet_finish` (the Victron sync) is **unchanged**.
  - The trigger swallows its own errors, so history can never fail the sync.
- `public.cos_vrm_power_history(p_hours)`: execute is granted to `service_role` only.
- Seeded one point per Helios from the reading already saved.

The edge function `cos-vrm-history` (v1, `verify_jwt=false`) serves this read-only. It forwards the caller's token and origin to `cos-operations-pages` `GET /api/vrm-fleet` and serves history only on a 200. Source: `tech-checks/supabase/functions/cos-vrm-history/`.

## Checked afterwards

- 20 points seeded.
- The 21:30 sync succeeded with the trigger in place, and history grew to 33 points.
- `authenticated` and `anon` cannot execute the read; `service_role` can.
- The app's first read through `cos-vrm-history` returned 200 at 21:57.

## Rollback

```sql
drop trigger if exists cos_vrm_power_history_capture on cos_vrm_private.installations;
drop function if exists cos_vrm_private.capture_power_history();
drop function if exists public.cos_vrm_power_history(integer);
drop table if exists cos_vrm_private.power_history;
```

Then delete the `cos-vrm-history` edge function. The app shows no history when that function is unreachable.
