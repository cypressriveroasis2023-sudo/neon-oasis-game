# 2026-11-25 — SIMs must come from the SIM drawer (applied, switched off)

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-sim-drawer-required-v1.sql`
Status: **applied 2026-11-26 ~04:55 UTC on James's go-ahead, rule left OFF** (`require_listed=false`), so no
handoff changes until the Owner turns it on. Live dry run (rolled back) with the rule on: an unlisted SIM and a
SIM on a truck were both refused with the NEXT STEP; a card in the drawer passed the check.

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
