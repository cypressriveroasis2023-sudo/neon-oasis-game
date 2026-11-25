# 2026-11-25 — Troubleshoot reports ("Send to IT")

Project: Operations `tughscoxralhofrckvxy`
SQL: `tech-checks/operations/db/20261125_troubleshoot_reports.sql` (applied by hand 2026-11-25)

Adds `cos_troubleshoot_private.reports` (append-only; update/delete refused by
trigger; a whole IPv4 address in a note is refused) and
`public.cos_troubleshoot_report_v1(uuid,uuid,uuid,jsonb)`, security definer,
Owner or verified IT only (`app_private.cos_owner_identity_assert_actor`), execute
for `service_role` only. The same request id sent twice returns the first report.

It records what a tech found on the unit card for the next daily IT sheet. It
schedules nothing and changes no unit, camera, mHelp, Star4Live or InHand data.
Nothing calls it until `cos-unit-camera-status` carries the
`/api/unit-camera-status/troubleshoot` route (patch `troubleshoot-route-v17`).

Checked after applying: anon and authenticated cannot execute or read; an
unknown actor is refused and nothing is written.

## Rollback

```sql
drop function if exists public.cos_troubleshoot_report_v1(uuid,uuid,uuid,jsonb);
drop schema if exists cos_troubleshoot_private cascade;
```
