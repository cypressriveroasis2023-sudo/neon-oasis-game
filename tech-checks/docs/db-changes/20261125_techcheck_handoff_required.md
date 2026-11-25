# 2026-11-25 — A unit goes on a Service truck only through a signed IT handoff

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-handoff-required-v1.sql`
Status: **applied 2026-11-25 06:54 UTC** at the owner's direction; live check as Josh refused a new unit with the NEXT STEP message and allowed re-saving an existing one. Earlier: Dry-run on the live database inside a rolled-back
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

## 2026-11-25 06:58 UTC — starting point (owner's direction)

The owner asked that everything already on the trucks count as handed over, with
the rule applying only from now on. `techcheck-handoff-baseline-v1.sql` recorded
the 12 units on Service trucks at that moment (8 real, 4 on the Test Service
account) in `app_private.techcheck_handoff_baseline`, and `covering_v1` now
treats each one like an accepted handoff to that tech. Live check: Josh could take
Sniper 332 off and put it back; a new unit (Sniper 322) was still refused.
`techcheck_handoff_gaps_v1` now lists no units without a handoff.

Rollback: `drop table app_private.techcheck_handoff_baseline` and re-run the
`covering_v1` definition from `techcheck-handoff-required-v1.sql`.
