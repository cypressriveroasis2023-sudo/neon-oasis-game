# Sweep watchdog crashes whenever it has something to report

**Applied 2026-11-27 17:50 UTC (James's go).** Tech Check (`goqrnolcvqnirjmzaeyk`). First run after: `alarm`, reasons `no_fresh_reading_for_any_eligible_unit` + `sweep_readings_stale_over_25_minutes`, 0 of 44 fresh, recorded.

## What is wrong

`public.cos_sweep_watchdog_check_v1()` (cron job 15, added 2026-11-24) builds its
list of reasons with `v_reasons := v_reasons || 'some_reason';`. With a `text[]`
on the left and an untyped literal on the right, Postgres reads the literal as an
array and raises `malformed array literal`. So the function fails on exactly the
runs where it should record an alarm or a warning, and records nothing.

Seen in `cron.job_run_details` for job 15:

- first failure 2026-11-26 20:13 UTC, during the three and a half hours the
  carrier refused the checker;
- failing on every run since 2026-11-27 08:58 UTC, when the sweep stopped
  publishing because the accepted mHelp inventory was no longer current
  (mHelpDesk needed reconnecting from 08:01 UTC).

`select public.cos_sweep_watchdog_recent_v1(n)` therefore showed only old `ok`
rows through both events. The watchdog only writes
`app_private.cos_sweep_watchdog_log`; it sends nothing, so nobody was misled by
an alert, but nobody was told either.

## The change

Replace the four concatenations with `array_append(v_reasons, '...'::text)`.
Nothing else in the function changes: same eligibility, same thresholds, same
allow-list, same log table, same return value.

```sql
-- in public.cos_sweep_watchdog_check_v1(), four lines of this shape:
--   v_reasons := v_reasons || 'unknown_audit_action_blocks_endpoint_claims';
--   v_reasons := v_reasons || 'no_fresh_reading_for_any_eligible_unit';
--   v_reasons := v_reasons || 'sweep_readings_stale_over_25_minutes';
--   v_reasons := v_reasons || 'fewer_than_half_of_eligible_units_fresh';
-- become:
--   v_reasons := array_append(v_reasons, 'unknown_audit_action_blocks_endpoint_claims'::text);
--   (and the same for the other three)
```

Apply with `create or replace function` carrying the whole current definition
(`select pg_get_functiondef('public.cos_sweep_watchdog_check_v1()'::regprocedure)`)
with only those four lines changed.

## Check after applying

```sql
select public.cos_sweep_watchdog_check_v1();   -- returns, does not raise
select public.cos_sweep_watchdog_recent_v1(3);
```

While the sweep is not publishing, the first call should return `status` `alarm`
with `no_fresh_reading_for_any_eligible_unit` and
`sweep_readings_stale_over_25_minutes`, and record a row.

## Rollback

Re-create the function with the four lines back as `v_reasons := v_reasons || '...';`
(the definition before this change). That restores the crash, so there is no
reason to, but nothing else depends on the difference.
