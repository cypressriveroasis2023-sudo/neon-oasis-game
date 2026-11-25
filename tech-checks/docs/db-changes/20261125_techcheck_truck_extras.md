# 2026-11-25 — Tech Check: truck standard, extra units, tech-to-tech moves

Project: Tech Check `goqrnolcvqnirjmzaeyk`
File: `tech-checks/database-maintenance/techcheck-truck-extras-v1.sql` (re-running is a no-op)

## New

- `app_private.truck_standard` (how many of each unit every Service truck carries; starts at 1 each),
  `app_private.truck_extra_units` (units beyond the one truck slot, each by number),
  `app_private.truck_moves` (a unit given from one Service tech to another: giver photo, receiver checks,
  photo and signature). Storage bucket `techcheck-truck-moves` with its own insert/read policies.
- Service: `public.truck_my_v1`, `truck_put_from_it_v1`, `truck_give_v1`, `truck_cancel_give_v1`, `truck_take_v1`.
- Owner: `public.owner_truck_board_v1`, `owner_truck_standard_set_v1`, `owner_truck_extra_remove_v1`.
- Trigger `techcheck_extra_place_guard_v1` on `public.service_truck_units`: a unit is never both a slot and an
  extra. Typing your own extra into the truck screen moves it to the slot; another tech's extra is refused.
  Named so it fires before `techcheck_handoff_required_guard_v1`.

`public.service_truck_units` itself is unchanged (still one slot per type per truck).

## Edited (anchored; the anchor must match exactly once or nothing changes)

| Function | Change |
| --- | --- |
| `app_private.techcheck_handoff_covering_v1` | An accepted tech-to-tech move counts as the receiver's handoff. |
| `app_private.techcheck_transfer_custody_hold_v1` | An extra on a truck counts as assigned truck equipment (IT cannot hand it out). |
| `app_private.techcheck_ticketfree_context_v1` | The truck list for swaps and returns includes extras. |
| `app_private.submit_techcheck_ticketfree_return_v1` | A swap can install an extra, an unused extra can be returned, an extra of another tech counts as on another truck, and the hold of an ACCEPTED IT handoff to the same tech is released (it used to block every swap or return of that unit forever). |

Old definitions: `app_private.truck_extras_backup_v1`.

## Checked

- 8 PGlite tests (`tests/truck-extras-sql.test.mjs`) on the real return and handoff functions.
- Live dry run (rolled back): Abel gave Ranger 007 to Josh, Josh signed; Josh Ranger 2 of 1, Abel 0 of 1,
  Josh's swap list had 008 and 007; all four anchored edits applied to the live text.

## Rollback

```sql
do $$ declare d text; begin
  for d in select definition from app_private.truck_extras_backup_v1 loop execute d; end loop;
end $$;
drop trigger if exists techcheck_extra_place_guard_v1 on public.service_truck_units;
-- the new tables and functions can stay; nothing else reads them.
```
