# equipment_master refresh: source_page, and a dry run that proves the insert

Applied to Tech Check (`goqrnolcvqnirjmzaeyk`) on 2026-11-24.

## What happened

`public.cos_equipment_master_refresh(true)` failed on its first real run:

```
23502: null value in column "source_page" of relation "equipment_master"
```

`equipment_master.source_page` is `NOT NULL`. Every existing row came from the
2026 tracker PDF and carries a page number, 1..42. The insert that adds mHelp
rows did not supply one.

The transaction rolled back whole: the table stayed at 762 rows and nothing was
written.

The dry run had reported clean twice before this. It only counted rows; it
never ran the insert, so it could not have caught a constraint failure. The
clean dry run was not evidence that apply would work.

## The two fixes

1. **`source_page` is supplied as `0`** for rows sourced from mHelp, which come
   from no paged document. Nothing in the app, and no database function or
   view, reads `source_page` — it is provenance only. A sentinel was preferred
   over dropping a `NOT NULL` on a live table.

2. **The dry run now proves the insert.** It replays the same statement into a
   temporary copy of the table created with `including constraints`, and
   reports any failure as an abort (`insertProbe` in the receipt). The probe
   runs in both modes, so apply can no longer discover a constraint failure
   that the dry run missed.

## Result of the apply

| | |
| --- | --- |
| rows before | 762 |
| rows after | 1148 |
| added | 386 |
| placements updated | 118 |
| held for review | 223 |
| unreadable labels | 2 |
| adds with no known family | 0 |
| `insertProbe` | ok |

`canonical_family` is never overwritten; the mHelp category is kept in
`source_family`. The 223 held rows are old tracker rows with no mHelp match;
they stay in the table and are listed in
`app_private.cos_equipment_master_review` for a person to decide on.

A backup of the table as it stood was taken automatically by the function, as
`app_private.equipment_master_backup_<timestamp>`.

## Checked afterwards

`equipment_master` feeds the camera health sweep, which holds a unit as
unverified if its key appears more than once. After the refresh there were
**0 duplicate sweep keys** across 190 keyed rows, and the next sweep published
34 of 44 with 34 online — unchanged from before the refresh.

## Rollback

Restore the table from the backup created by the run, and re-apply the previous
function body from migration `20261124_cos_equipment_master_refresh` (no
`source_page`, no probe).
