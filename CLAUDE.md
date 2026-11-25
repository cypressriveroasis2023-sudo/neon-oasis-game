# Working in this repo

More than one Claude session works here at the same time, on different parts of
COS. Sessions cannot see or talk to each other. This file is where they
coordinate, so read it before changing anything in "Shared ground" below, and
append to the log at the bottom when you do.

## Shared ground

These are the places where one session's change has silently broken another's
work. A change here is not local, however small it looks.

| What | Why it crosses boundaries |
| --- | --- |
| `public.camera_inventory_audit` | A new `action` value breaks the camera sweep. See the rule below. |
| `public.camera_devices` | One row per **camera**, not per unit. The camera health sweep requires exactly one row per `unit_key` or it holds the unit unverified. |
| `public.equipment_master` | What the camera sweep iterates. Still holds a stale 22 Sep 2026 import; a refresh is pending. |
| `cron.job` (Tech Check) | 15 jobs on interleaved minutes. Pick a free minute; don't reuse another job's slot. |
| Edge functions under `tech-checks/supabase/functions/` | Several are loaded from **pinned GitHub commits**, so the deployed code is not what's on `main`. Check the entrypoint before assuming. |
| `tech-checks/operations/dist` | Committed to the repo and published by GitHub Pages on push to `main`. |
| `tech-checks/supabase/migrations/` | Pinned by the `verify` workflow to an authorized file list. Adding a file here fails CI on every PR. Put change records in `tech-checks/docs/db-changes/` instead. |

Two Supabase projects, easy to confuse:

- **Tech Check** `goqrnolcvqnirjmzaeyk` — cameras, equipment master, health, **all cron jobs**
- **Operations** `tughscoxralhofrckvxy` — mHelp inventory, placement, hand-edit log

## Rule: adding an action to `camera_inventory_audit`

`public.cos_tracker_endpoint_claims_v1` holds an allow-list of action values. It
treats **any** unrecognised action as making the whole endpoint history
incomplete, which blocks the camera direct-TCP sweep: every unit is held
"unverified", nothing is published, and the board shows Unknown.

The failure is silent. `pg_cron` reports success and the function returns HTTP
200, because the sweep is designed to hold units rather than error.

**If you add a new action value, add it to that allow-list in the same change.**

A watchdog now catches this within ~3 minutes (`cos-sweep-watchdog`, job 15).
Check it after any change to the audit table:

```sql
select public.cos_sweep_watchdog_recent_v1(20);
```

`status` of `alarm` with `unknown_audit_action_blocks_endpoint_claims` means a
new action value needs adding to the allow-list.

## Conventions

- Merge with an explicit SHA: `gh api -X PUT .../pulls/N/merge -f merge_method=merge -f sha=<full sha>`
- Rebuild before committing `dist`: `rm -rf dist/assets`, `git checkout -- dist`, `npm run build`, then `node .github/scripts/verify-cos-build-artifact.mjs` (expect exit 0)
- `app_private` is not exposed to PostgREST. Reach it through a security-definer function in `public`.
- Record live database changes as a file in `tech-checks/docs/db-changes/`, with a rollback line, even when applied by hand. **Do not add files to `tech-checks/supabase/migrations/`**: the `verify` workflow pins that folder to an authorized list of files and fails closed on any other, so a new file there blocks every PR until the owner extends the pin.
- Don't commit another session's unrelated work-in-progress; stage only your own files.

## Log of changes to shared ground

Newest first. One line: date, what changed, what to watch.

- **2026-11-25** — Tech Check: `public.cos_mhelp_hand_link_state_v1` and
  `public.cos_mhelp_hand_link_v1` (A# linked by hand from the unit card; Owner or
  approved IT; writes `app_private.cos_mhelp_unit_link` `decided_by='hand'`, and
  `camera_devices.mhelp_product_id` only for single-camera units). No audit row.
  Operations patch `cos-unit-camera-status/a-links-v19` is **prepared, not
  deployed**; it starts from live v19. Record in
  `tech-checks/docs/db-changes/20261125_mhelp_hand_link_functions.md`.
- **2026-11-25** — Linked `SOLARSPOTTER 253` to mHelp A# 2226712 in
  `app_private.cos_mhelp_unit_link` (`decided_by='hand'`, approved by James). No
  audit row; watchdog `ok`. Record in
  `tech-checks/docs/db-changes/20261125_mhelp_link_ss253.md`.
- **2026-11-25** — Tech Check: `submit_techcheck_transfer_v2` also refuses a
  note that says something is still needed unless confirmed (`_note_ready`), and
  `techcheck_transfer_differences_v2` compares SIM lists cleaned. The held
  placement-review package must carry this too. Record in
  `tech-checks/docs/db-changes/20261125_techcheck_handoff_clean_checks.md`.
- **2026-11-25** — Deployed 18:00 UTC (live now **v19 `c434eaf6`**, pins updated): patch
  `cos-unit-camera-status/camera-ports-v18` (from live v18 `3c521a58`, record in
  `tech-checks/docs/cos-unit-camera-status-v18-entry`). The camera query also
  reads `source_metadata->>localIp`, and each camera in `cameraList` carries
  `port` (1400/1500/1600/1700/1900 for 192.168.10.14-17/19); the local address is
  never sent. Rollback `rollback-to-v18-entry`. A next patch must start from v19.
- **2026-11-25** — Operations: `cos_troubleshoot_private.reports` and
  `public.cos_troubleshoot_report_v1` (Send to IT from the unit card; append-only,
  service_role only). Deployed 2026-11-25 17:31 UTC: patch
  `cos-unit-camera-status/troubleshoot-route-v17` added one route to the frozen
  v17 bundle, so live is now **v18 `3c521a58`** (pins updated). Source record
  `tech-checks/docs/cos-unit-camera-status-v17-entry`; rollback
  `rollback-to-v17-entry`. A next patch to this function must start from v18.
  Record in `tech-checks/docs/db-changes/20261125_troubleshoot_reports.md`.
- **2026-11-25** — Linked four more field camera units to their mHelp A#
  in `app_private.cos_mhelp_unit_link` (`decided_by='hand'`, approved by James):
  SOLARSPOTTER 285, SOLARSPOTTER 254, SS HYBRID 298 and
  `RII022 - CityZen_1317HawthorneSt`. Field links now 193 of 200. No
  `camera_inventory_audit` row written, so no new action value and the sweep is
  unaffected; watchdog `ok` afterwards. Record in
  `tech-checks/docs/db-changes/20261125_mhelp_link_four_field_units.md`.
- **2026-11-25** — `operations/dist` republished with the unit-card Troubleshoot
  box (#503), Check it now (#497) and its fixes (#508): Check it now reads the
  verify answer (green only when online), uses the unit's own A# (never a fuzzy
  mHelp match), and the board calls a unit out of power only under 20% battery
  (a Victron alarm alone no longer does). The Pages deploys for 960068a and
  d9acd48 failed on a GitHub 500, not on the build; check the next deploy.
- **2026-11-25** — Tech Check: SIM drawer. AFTER INSERT trigger on
  `app_private.techcheck_transfer_events` and AFTER UPDATE trigger on
  `public.service_truck_sims` keep `app_private.sim_drawer` in step; both
  swallow their own errors. Record in
  `tech-checks/docs/db-changes/20261125_techcheck_sim_drawer.md`.
- **2026-11-25** — Tech Check: `app_private.submit_techcheck_transfer_v2` now
  requires Service to answer every equipment check (Pass/Problem) on a receipt.
  The held `operations/transfer-placement-review/` package replaces this
  function and will abort on md5 drift until it carries the same block. Record
  in `tech-checks/docs/db-changes/20261125_techcheck_service_receipt_checks.md`.
- **2026-11-24** — Operations: added `cos_vrm_private.power_history` and an
  AFTER trigger on `cos_vrm_private.installations` (Victron battery history;
  errors are swallowed and the sync is unchanged), plus the
  `public.cos_vrm_power_history` read (service_role only) and a new edge
  function `cos-vrm-history`. Record in `tech-checks/docs/db-changes/`.
- **2026-11-24** — Tech Check cron: `cos-mhelp-inventory-sync` moved from
  `5,35` to `5,20,35,50`, so a failed mHelp read retries 15 minutes later.
  Record in `tech-checks/docs/db-changes/`.
- **2026-11-24** — Refreshed `equipment_master` from mHelp: 762 → 1148 rows
  (386 added, 118 placements updated, 223 held for review). Fixed
  `cos_equipment_master_refresh` to supply `source_page` and to prove its
  insert during a dry run. Checked afterwards: 0 duplicate sweep keys, and the
  next sweep published 34 of 44 as before. Record in
  `tech-checks/docs/db-changes/`.
- **2026-11-24** — Added `ADD_ROUTER_LINK` to the allow-list in
  `cos_tracker_endpoint_claims_v1` (migration
  `20261124_cos_tracker_endpoint_claims_allow_add_router_link.sql`). Three such
  rows written at 21:10 UTC had stopped the camera sweep publishing for 90
  minutes. The InHand router feature itself was not changed. Added the
  `cos-sweep-watchdog` cron job (15) and
  `app_private.cos_sweep_watchdog_log`.
- **2026-11-24** — Marked 82 stale 2026-tracker Sniper rows `do_not_use` in
  `camera_devices`. Reversible from
  `app_private.camera_devices_stale_2026_tracker_backup_20261124`. The sweep
  does not read `do_not_use`, so this does not affect monitoring.
- **2026-11-24** — Attached mHelp A# (`mhelp_product_id`) to 113 single-camera
  units, taking units with an A# from 97 to 210.
