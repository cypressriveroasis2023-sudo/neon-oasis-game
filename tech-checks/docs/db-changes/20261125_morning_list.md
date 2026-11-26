# 2026-11-25 — The morning list (Tech Check function)

Project: Tech Check `goqrnolcvqnirjmzaeyk`
Source: `tech-checks/database-maintenance/cos-overnight-v1.sql` (applied by hand 2026-11-26 04:56 UTC)

James asked for it ("build the morning list"). 153 VCC cameras read Offline,
but 145 sit under VCC's root (the board's "in the shop, not at the site"), so
the raw count hides what actually broke.

- `app_private.cos_overnight_compute(p_hours)` and
  `public.cos_overnight_v1(p_hours default 24)` (Owner or approved IT): field
  cameras that are down (VCC Offline and not under root; others offline in
  `camera_health_current`), grouped by unit, split into **new** (last online
  within the window) and **still down**, with the unit's router reading, a
  likely cause and a draft IT-sheet line. If the router stopped reaching InHand
  well before the cameras did, the router is not offered as the cause.
- Read only. No table, no audit row, no cron.

At apply time: 2 new (Ranger 007, Helios 016) and 8 still down; the board also
leaves out units it knows are in the shop.

The Operations side ships as recorded patch
`cos-unit-camera-status/morning-list-v21` (from live v21 `ac4a0ff3`), rollback
`rollback-to-v21-entry`.

Rollback:

```sql
drop function if exists public.cos_overnight_v1(int);
drop function if exists app_private.cos_overnight_compute(int);
```
