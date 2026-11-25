# 2026-11-25 — Four more field camera units linked to their mHelp A#

Project: Tech Check `goqrnolcvqnirjmzaeyk`
Table: `app_private.cos_mhelp_unit_link` (4 rows inserted by hand, `decided_by = 'hand'`)

Field camera units linked to mHelp went from 189 to **193 of 200**. The name
reader could not match these four on its own, so each was confirmed and approved
by James before it was written. The basis for each is recorded in the row's
`agreement` JSON.

| COS `unit_key` | mHelp A# | mHelp label | Why these are the same unit |
| --- | --- | --- | --- |
| `SOLARSPOTTER 285` | 2232443 | Spotter 285 - SOLAR COMPATIBLE | family-name variant |
| `SOLARSPOTTER 254` | 2252484 | Spotter 254 - SOLAR COMPATIBLE | family-name variant |
| `SS HYBRID 298` | 2299213 | Spotter 298 HDC2S - SOLAR COMPATIBLE | family-name variant |
| `RII024`→ see note | 2161656 | Recon II 022 | same customer (CityZen) and street (Hawthorne St); the reader read "1317" in the site name as a unit number |

Note: the fourth `unit_key` is `RII022 - CityZen_1317HawthorneSt`.

Each of the four was checked before writing: the COS unit exists, has cameras,
carries no A# already, and had no row in the link table. After the insert:
0 duplicate A#s and 0 duplicate `unit_key`s across all 302 rows.

No row was written to `public.camera_inventory_audit`, so no new action value was
introduced and the camera sweep is unaffected. Checked afterwards:
`public.cos_sweep_watchdog_check_v1()` returned `ok`, 34 of 44 eligible units
fresh, newest reading 6.6 minutes old, no unknown audit actions.

## Still unlinked: 7 of 200

These need someone who knows the hardware, not a name match:

- **Spotter 310** — could be `SOLARSPOTTER 310` (free) or `SNIPER 310` (already A#1812833)
- **Spotter 052** — `SOLARSPOTTER 052` already holds A#2300341 for *Solar Spotter 052*;
  mHelp lists both a "Spotter 052" and a "Solar Spotter 052" against one COS record
- **Spotter 088** — no COS record
- **WA 003**, **WA 100** — Wall-E units; COS holds no records of that family
- **RANGER 029 .2** — COS has `RANGER 029` (2 cameras, free); the ".2" suggests a
  second unit on the same stand
- **Spotter 028.1 HDC4S** — COS has `SPOTTER 028` (1 camera, free); same ".1" question

## Rollback

```sql
delete from app_private.cos_mhelp_unit_link
 where mhelp_product_id in ('2232443','2252484','2299213','2161656')
   and decided_by = 'hand';
```
