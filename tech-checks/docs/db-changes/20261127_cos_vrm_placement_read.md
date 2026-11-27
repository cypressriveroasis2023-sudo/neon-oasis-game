# Helios Field/Shop from mHelp's own list (Operations)

Applied to Operations (`tughscoxralhofrckvxy`) on 2026-11-27 at about 09:35 CST, with the manager's approval.
The SQL is `tech-checks/operations/db/20261127_cos_vrm_placement_read.sql`, applied via `apply_migration` (name `cos_vrm_placement_read`).

## Why

The Victron page took Field/Shop from the saved equipment list (`public.equipment_units` through `/api/field-map`).
That list only holds HELIOS 001-010. HELIOS 011-020 were never added, so the page could not place them: seven
unpowered Shop units showed as "not reporting", and three Field units (011, 017, 019) were left out of
"Needs attention". mHelp's current list (`cos_mhelp_placement_private.census_mhelp_current_coverage`) has all 20.

## What it added

- `public.cos_vrm_placement_read()`: read-only, `security definer`, execute granted to `service_role` only.
  One row per Helios installation that has **exactly one** current mHelp record saying FIELD or SHOP:
  `installationId`, `name`, `placement`, and a 5-digit `zip` for Field units only.
- Edge function `cos-vrm-mppt-read` **v2** (`verify_jwt=false`, same gate as before): its answer now also carries
  `placements` (the list above, or `null` if that read fails; the charger readings do not depend on it).
  Main = deployed.

Nothing else changed. No table, no schedule, no write path. `equipment_units` is untouched.

## How the app uses it

`withMhelpPlacement` (`src/victronAttention.ts`): the saved list still decides. mHelp's answer is used only for a
Helios the saved list has **no record of at all**. A Helios the saved list holds keeps its saved answer,
including "unknown, needs review".

## Checked afterwards

- `anon` and `authenticated` cannot execute the function; `service_role` can.
- It returns 20 units: 12 FIELD, 8 SHOP.

## Rollback

```sql
drop function if exists public.cos_vrm_placement_read();
```

Then redeploy `cos-vrm-mppt-read` from the commit before this one (or leave v2: with the function gone it
answers `placements: null` and the page falls back to the saved list alone).

## Changed the same day: read the active upload, not the census view

Applied 2026-11-27 at about 15:27 CST (`apply_migration`, name `cos_vrm_placement_read_active_upload`), with the
manager's approval. Same function name, same answer shape, same grants.

**What went wrong.** The first version read `cos_mhelp_placement_private.census_mhelp_current_coverage`. That view
joins the census product and address tables, which are filled by the address job *after* an upload becomes
active. A new mHelp upload was admitted at 15:21 CST; the view had **0 rows** from then on (still 0 at 15:30),
so the function answered an empty list and the Victron page lost Field/Shop for HELIOS 011-020 again. The same
gap follows every mHelp upload (three were admitted between 00:50 and 01:35 that night).

**What it reads now.** The active upload itself: `upload_control.active_sha256` -> `upload_batches.records`
(newest batch for that source), taking `unitNumber`, `placement` and `sourceAddress.zip`. No dependency on the
census tables. About 13 ms.

**Checked afterwards.** 20 units (12 FIELD, 8 SHOP) while the census view was still empty; `anon` and
`authenticated` cannot execute it.

**Also changed.** The page ignores an empty placement answer and keeps the last list it had. The scheduled
"Helios night power alert" now takes Field/Shop from this function instead of the view.

**Rollback of this step** (back to the census view): re-apply the function body from commit `e776dca9`
(`git show e776dca9:tech-checks/operations/db/20261127_cos_vrm_placement_read.sql`).

**For anyone else using `census_mhelp_current_coverage`:** expect it to be empty for a while after each upload.
