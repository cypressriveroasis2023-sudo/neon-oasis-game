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
