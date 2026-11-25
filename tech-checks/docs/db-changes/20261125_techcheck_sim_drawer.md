# 2026-11-25 — SIM drawer

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-sim-drawer-v1.sql`

Adds `app_private.sim_drawer`, `sim_drawer_history`, `sim_drawer_settings`;
`public.sim_drawer_v1()`, `sim_drawer_add_v1(text[],text,text)`,
`sim_drawer_mark_v1(text,text,text)` (owner and IT only); and two AFTER triggers:

- `sim_drawer_follow_transfer_v1` on `app_private.techcheck_transfer_events`
  (checkout → card `in_unit`; cancel → back `in_drawer`; unlisted SIMs recorded)
- `sim_drawer_follow_truck_v1` on `public.service_truck_sims` (slot → `on_truck`)

Both triggers swallow their own errors, so the drawer can never stop a handoff or
a truck save. Nothing is refused for an unlisted SIM yet (`require_listed` is off).

Screens: Manager tab "SIM drawer" box (owner); Tech Check checkout SIM pick list (IT).

## Rollback

```sql
drop trigger if exists sim_drawer_follow_transfer_v1 on app_private.techcheck_transfer_events;
drop trigger if exists sim_drawer_follow_truck_v1 on public.service_truck_sims;
```
