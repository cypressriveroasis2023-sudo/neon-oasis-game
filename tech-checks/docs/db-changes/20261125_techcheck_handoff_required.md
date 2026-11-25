# 2026-11-25 — A unit goes on a Service truck only through a signed IT handoff

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-handoff-required-v1.sql`
Status: **not applied yet.** Dry-run on the live database inside a rolled-back
transaction on 2026-11-25 ~06:55 UTC; afterwards confirmed the trigger and tables
do not exist.

## Dry-run results (signed in as Josh Mireles, rolled back)

- New unit Sniper 322 → refused: "Sniper 322 was not added to your truck. IT has
  not handed it to you in the app. NEXT STEP: Ask IT (Teddy or Victor) to tap
  "Check Out / Hand Off" …"
- Re-saving Solar Spotter 202 already on his truck → allowed (no new unit).
- Spotter 999 (not in `equipment_master`) → refused with the "not in the COS
  equipment list … tell James" next step.
- Units on trucks today covered by an accepted handoff: 0. They stay where they
  are; they show on `techcheck_handoff_gaps_v1` until IT hands them over.

## Not in shared ground

Adds a BEFORE trigger on `public.service_truck_units` only. No change to
`camera_inventory_audit`, `camera_devices`, `equipment_master` (read only),
cron jobs or edge functions.

## Check after applying

```sql
select public.techcheck_handoff_gaps_v1();
```

## Rollback

```sql
drop trigger if exists techcheck_handoff_required_guard_v1 on public.service_truck_units;
-- softer: update app_private.techcheck_handoff_enforcement set mode='log';
```
