# 2026-11-25 — SIMs must come from the SIM drawer (prepared)

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-sim-drawer-required-v1.sql`
Status: **prepared, not applied** (needs James's go-ahead). Applying it changes nothing on its own: the rule
stays off until the Owner turns it on.

- BEFORE INSERT trigger `sim_drawer_require_v1` on `app_private.techcheck_transfer_events`: when
  `sim_drawer_settings.require_listed` is on, an IT handoff (checkout) is refused if a SIM is not in the
  drawer, or the drawer shows it in another unit, on a truck, bad, deactivated or removed. The refusal names
  the SIM and the unit and gives the NEXT STEP. A repeat of the same handoff is never refused.
- `public.sim_drawer_require_v1(on boolean)`: Owner only; each change is kept in `sim_drawer_history`
  (`sim_number='SETTING'`).

Before turning it on: the drawer holds 24 cards (plus 4 on trucks). Every SIM IT hands out has to be in it
first, or handoffs stop until someone adds the card.

## Rollback

```sql
drop trigger if exists sim_drawer_require_v1 on app_private.techcheck_transfer_events;
update app_private.sim_drawer_settings set require_listed=false where singleton;
```
