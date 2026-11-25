# equipment_master refresh — applied 2026-11-24

`equipment_master` is what the camera health sweep reads to decide which units
it checks. Until today it held 762 rows imported once, on 22 September 2026,
from a file called `2026 UNIT TRACKER.pdf`, and nothing had written to it since.

mHelp holds 925 units and is the home of record. The 2027 Unit Tracker agrees
with mHelp, and so do COS's own camera records — Recon is the clearest case:
mHelp says 38 Recon units, `camera_devices` says 38, `equipment_master` says
109. The extra are ghosts of the stale import, not units mHelp is missing.

## What is live on the database

| Object | What it is |
| --- | --- |
| `public.cos_read_unit_name(text)` | Reads a unit label into `FAMILY\|number`. Mirrors `operations/shared/unitName.ts`, which carries the tests. |
| `public.cos_family_for(text)` | Maps a family to COS's own `canonical_family` and `workflow_type`. |
| `public.cos_equipment_master_refresh(boolean)` | Dry run, or apply. Service role only. |
| `app_private.cos_equipment_master_runs` | A receipt per run, dry or applied. |
| `app_private.cos_equipment_master_review` | Units the table holds that mHelp does not. Never acted on by a job. |

## Rules the function keeps

- Additive only: inserts, and placement updates. It never deletes and never retires.
- `canonical_family` is never overwritten. The sweep matches a monitoring profile
  against it, and mHelp's `category` is a product name ("Spotter HDC2", "CAM-V"),
  not COS's vocabulary. Writing one into the other would have changed 294 rows
  and quietly unhooked those units from monitoring. mHelp's category goes to
  `source_family`.
- A full backup of `equipment_master` is taken before any write.
- It aborts without writing if more than 10 labels are unreadable, if the mHelp
  list comes back short, or if it would add more rows than the table holds.
- A unit mHelp does not list goes to the review table, for a person.

## Dry run, 2026-11-24

    masterBefore 762   wouldAdd 386   wouldUpdatePlacement 118
    wouldHold 223      unreadable 2   addsWithNoKnownFamily 0   abort null

The 223 held are real inventory differences, not spelling: 109 Recon (settled —
mHelp and the camera records both say 38), 76 retired Snipers already flagged in
`camera_devices`, 34 Spotters needing the same confirmation, and 18 others.

The 2 unreadable are `ALPHA 010`, a family nothing else uses, and
`Solar Pole 013 72 (Hybrid solar stand) 074`, where 013 and 074 are both
candidates and the name does not settle it.

## To apply

    select public.cos_equipment_master_refresh(true);

## To roll back

The function names its backup `app_private.equipment_master_backup_<timestamp>`.
Restoring is a delete of the rows it added and an update from the backup; nothing
it does removes data.
