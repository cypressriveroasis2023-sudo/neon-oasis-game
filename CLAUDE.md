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
| `cron.job` (Tech Check) | 16 jobs on interleaved minutes. Pick a free minute; don't reuse another job's slot. |
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

- **2026-11-27** — **Refresh runs the camera checks now: live** (James's go, ~22:00 UTC). Tech Check
  `public.cos_check_now_v1()` + `app_private.cos_check_now_log` applied (migration `cos_check_now_v1`,
  text as in `20261127_cos_check_now.sql`); then `cos-unit-camera-status/check-now-v26` deployed: live now
  **v27 `81a7a8a5`** (pins updated, source record `tech-checks/docs/cos-unit-camera-status-v27-entry`).
  A Refresh tap can start the same three calls as cron jobs 2, 4 and 5 (never within 75 s after a
  quarter hour, 20 s before one, or 2 min after another tap). Rollback `rollback-to-v26-entry`, then drop
  the function and table. A next patch to this function must start from v27.
- **2026-11-27** — Refresh runs the camera checks now (**prepared, nothing applied or deployed**;
  each step needs James's go). Order: (1) Tech Check `public.cos_check_now_v1()` and
  `app_private.cos_check_now_log`, `tech-checks/docs/db-changes/20261127_cos_check_now.sql`: Owner
  or approved IT; makes the same three `net.http_post` calls as cron jobs 2, 4 and 5 unless the
  timer's run is under 75 s old or under 20 s away, or one was started under 2 minutes ago. No
  cron job or schedule changes. (2) Operations patch `cos-unit-camera-status/check-now-v26`
  (starts from live v26 `d1136141`): `POST /api/unit-camera-status/check-now`, rollback
  `rollback-to-v26-entry`. The board client (merged with this) calls it on Refresh, waits the
  seconds Tech Check gives, then reads; until both are live the route is missing, Refresh reads
  the saved reading as before and says a live check could not run. If another patch to this
  function deploys first, rebuild this one.
- **2026-11-27** — Tech Check: "power, not router". `inhand_private.router_night_drops`
  (refreshed each alert run by `cos_router_night_drops_refresh_v1`, hooked into
  `cos_router_down_alerts_v1` after the signal record line); `cos_router_down_hint_v1` replaces
  the down alert's fixed advice line; `cos_router_details_v1` adds `nightDrops`. All anchored
  replaces. No audit row, no cron change. Record in
  `tech-checks/docs/db-changes/20261127_router_power_drops.sql`.
- **2026-11-27** — **Sweep not publishing since 08:45 UTC**, cause outside the sweep: mHelpDesk
  rejected the saved authorization at 08:01 (`cos-mhelp-readiness` 409 `reconnect_required`),
  `cos-mhelp-inventory-sync` has returned 503 since 08:05, and from 08:45
  `cos-sheets-placement-publish/endpoint-source` answers 503 `inventory_not_current`, so the
  direct collector holds all 44 Snipers / CAM Vs ("Native source refused" in the sweep log;
  published 0, unverified 44). It clears when someone with the login reconnects mHelpDesk in
  the app; no code change is involved and none should be made to get around it.
- **2026-11-27** — `public.cos_sweep_watchdog_check_v1()` **crashes whenever it has a reason to
  record** (`text[] || 'literal'` → malformed array literal), so it logged nothing through the
  26 Nov refusal or today's hold. Fix **prepared, not applied** (needs James's go):
  `tech-checks/docs/db-changes/20261127_sweep_watchdog_reasons_fix.md`. Until then do not
  trust `cos_sweep_watchdog_recent_v1` showing `ok`; check `cron.job_run_details` for job 15.
- **2026-11-27** — Deployed `cos-unit-camera-status/last-direct-check-v25` (#572, 15:20 UTC,
  James's go): live now **v26 `d1136141`** (pins updated). Each IP-checked unit carries
  `directCheck`, so the board's router second witness (`boardData.routerWitness`) is now
  **on**: a Sniper or CAM V whose own check has no current reading may read Up or Down on a
  single fresh InHand report that agrees with what the check last found. Rollback
  `rollback-to-v25-entry` turns it off again. A next patch to this function must start from v26.
- **2026-11-27** — Router as a second witness for Snipers / CAM Vs (board client merged; the
  function patch was **prepared**, now deployed, see above). Operations patch
- **2026-11-27 (later)** — Operations: `public.cos_vrm_placement_read()` now reads the **active mHelp
  upload** (`upload_control` -> `upload_batches.records`), not `census_mhelp_current_coverage`.
  Watch, for everyone: that view is **empty for a while after every mHelp upload** (it waits for the
  address job), so anything reading it sees no units in that window. Record:
  `tech-checks/docs/db-changes/20261127_cos_vrm_placement_read.md`.
- **2026-11-27** — Operations: Helios Field/Shop from mHelp's own list. New read-only
  `public.cos_vrm_placement_read()` (service role only) and `cos-vrm-mppt-read` **v2**, whose answer
  now also carries `placements`. Why: `equipment_units` only holds HELIOS 001-010, so the Victron
  page could not place 011-020. The saved list still decides; mHelp answers only for a Helios the
  saved list has no record of (`withMhelpPlacement`). Watch: if HELIOS 011-020 are ever added to
  `equipment_units`, the saved answer takes over for them. Record and rollback:
  `tech-checks/docs/db-changes/20261127_cos_vrm_placement_read.md`.
- **2026-11-26** — Tech Check: router signal history **live** (#561). New
  `inhand_private.signal_history` (8 days), filled once per pull by
  `public.cos_router_signal_record_v1()`, which `cos_router_down_alerts_v1` now calls first
  (cron job 16; no new job). `public.cos_router_trend_v1(unit)` (service_role) feeds the unit
  card's 7-day chart through `cos-router-details` **v2** (action `trend`). First record: 278
  routers; watchdog `ok`. Record in `tech-checks/docs/db-changes/20261126_router_signal_history.sql`.
- **2026-11-27** — Router as a second witness for Snipers / CAM Vs (**board client merged, inert;
  function patch prepared, not deployed**). Operations patch
  `cos-unit-camera-status/last-direct-check-v25` (starts from live v25 `2927fdeb`) adds
  `directCheck` to each IP-checked unit: what COS's own check last found, when, and whether it
  is a confirmed outage. Status and counts are unchanged. `src/cosBoard/boardData.ts`
  (`routerWitness`): when that check has no current reading, a single InHand live-pull report
  under 45 minutes old and newer than the check may uphold it (last Online + router online =
  Up; confirmed outage + router offline = Down), for at most six hours; anything else stays
  Not verified. The card says when a line is the router's report. Until the patch deploys no
  unit carries `directCheck`, so the board behaves exactly as before. Rollback
  `rollback-to-v25-entry`. If another patch to this function deploys first, rebuild this one.
  Note: the board judges a direct check current for **20 minutes** (`CAMERA_FRESH_MS`), not the
  45 the function uses, so one held or refused sweep already reads Not verified on the board.
- **2026-11-26** — Deployed `camera-health-sweep` **v104** (Tech Check, 18:39 UTC, James's go):
  a one-line loader pinned to `caa6d89`,
  `tech-checks/docs/camera-health-sweep-checker-refused-20261126/source/index.ts` (SHA-256
  `0e85bc0f…`, #567). Three or more endpoints refused on every saved port in one run are held
  as `checker_connection_refused` and keep their previous result; timeouts are written as
  before. Rollback: redeploy the v103 loader (commit `91e8d52`, path in that README). A next
  change to the sweep must start from this source, not from `endpoint-retry-20261110`.
- **2026-11-26** — `camera-health-sweep` (Tech Check) fix was **prepared** (now deployed, see above):
  `tech-checks/docs/camera-health-sweep-checker-refused-20261126/` (recipe against the live
  v103 source). When three or more endpoints in one run answer "Connection refused" on every
  saved port, the collector writes nothing for them (hold reason `checker_connection_refused`,
  previous result kept): that is the worker's own path to the AT&T range, not the units, and
  was 235 of last week's 313 Sniper/CAM V "offline" rows. Timeouts are written as before.
  No audit action, schedule or table changes. Deploying needs James's go.
- **2026-11-26** — Deployed `cos-unit-camera-status/send-to-it-loop-v24` (#564): live now
  **v25 `2927fdeb`** (pins updated). The camera-status read carries `troubleshootReports`,
  and `POST /api/unit-camera-status/troubleshoot-close` closes one (Operations
  `cos_troubleshoot_close_v1`). Rollback `rollback-to-v24-entry`. A next patch to
  this function must start from v25.
- **2026-11-26** — Operations: Send to IT loop. `cos_troubleshoot_private.report_closures`,
  `public.cos_troubleshoot_open_v1` / `cos_troubleshoot_close_v1` (service_role only).
  Operations patch `cos-unit-camera-status/send-to-it-loop-v24` is **prepared, not
  deployed** (starts from live v24). Record in
  `tech-checks/docs/db-changes/20261126_troubleshoot_loop.md`.
- **2026-11-26** — Deployed `cos-unit-camera-status/router-swap-v23` (#560): live now
  **v24 `45576950`** (pins updated). The camera-status read carries `routerSwaps`, and
  `POST /api/unit-camera-status/router-swap` applies one (Tech Check
  `cos_router_swap_apply_v1`). Rollback `rollback-to-v23-entry`. A next patch to
  this function must start from v24.
- **2026-11-26** — Operations: Victron MPPT readings. New `cos_vrm_private.mppt_latest` /
  `mppt_history` / `mppt_paths_seen`, `public.cos_vrm_mppt_targets` / `cos_vrm_mppt_save`
  (service_role only), edge function `cos-vrm-mppt-sync` v1 (main = deployed) and Operations
  cron job 3 at `7,22,37,52`. The fleet sync, `cos_vrm_fleet_finish` and its cron job are
  unchanged; the new reader stands back whenever the fleet sync is busy or failing. Note:
  deployed `cos-vrm-fleet-sync` v11 is **not** what is on `main` (its `vrmPower.ts` is from
  open PR #419, and its `vrmDiscovery.ts` is older than main's). Also `public.cos_vrm_mppt_read`
  (service_role only) and edge function `cos-vrm-mppt-read` v1 (read-only, gated like
  `cos-vrm-history`, which it imports `history.ts` from). Record in
  `tech-checks/docs/db-changes/20261126_cos_vrm_mppt_readings.md`.
- **2026-11-26** — Tech Check: Router swapped. `public.cos_router_swaps_state_v1` /
  `cos_router_swap_apply_v1` (Owner or approved IT) move a unit's router link to a new
  InHand router; writes `ADD_ROUTER_LINK` with before_state `{inhand_serial, swap}` (no
  `id`/`public_ip`; endpoint claims stay complete, tested). Operations patch
  `cos-unit-camera-status/router-swap-v23` is **prepared, not deployed**, rebuilt on
  live v23 after `down-needs-two-misses-v22` deployed first. Record in `tech-checks/docs/db-changes/20261126_router_swaps.md`.
- **2026-11-26** — Deployed `cos-unit-camera-status/down-needs-two-misses-v22` (#557,
  05:31 UTC, James's go): live now **v23 `2efe829a`** (pins updated). A Sniper or CAM V
  whose saved check missed once reads Not verified ("Avigilon check missed once,
  checking again"); the second miss in a row, or a confirmed outage, is Down. Rollback
  `rollback-to-v22-entry`. A next patch to this function must start from v23.
- **2026-11-26** — Tech Check: router-down alert **live** (#554). Cron job **16**
  `cos-router-down-alert` at `11,41` (after the InHand pull at :07/:37) calls the new edge
  function `cos-router-down-alert` → `public.cos_router_down_alerts_v1()`: a field router
  online then offline for two pulls alerts Owner + IT (in-app `camera_health` /
  `camera_recovered`, plus web push). State in `inhand_private.router_watch` /
  `router_alerts`. No audit row. First run seeded 278 routers, 0 alerts; watchdog `ok`.
  Rollback in `tech-checks/docs/db-changes/20261126_router_down_alert.sql`.
- **2026-11-26** — Tech Check: `cos_router_details_v1` trusts InHand's public IP only
  while the router is online (fresh) and no other online router shares it; else the COS
  record. Offline routers keep stale, reassigned IPs in InHand. "IP differs" 6 → 2; no
  COS IP changed. Record in
  `tech-checks/docs/db-changes/20261126_router_details_trust_inhand_ip_only_when_online.md`.
- **2026-11-26** — Operations patch `cos-unit-camera-status/down-needs-two-misses-v22`
  was **prepared** (now deployed, see above) (starts from live v22 `a306656f`). A Sniper or CAM V
  whose saved check missed once reads Not verified ("Avigilon check missed once,
  checking again") instead of Down; the second miss in a row, or a confirmed outage,
  is Down. The read adds `confirmed_outage,consecutive_failures` to its
  `camera_health_current` select; nothing is written. Source:
  `tech-checks/operations/shared/otherUnitStatus.ts`. Rollback `rollback-to-v22-entry`.
  If another patch to this function deploys first, this one must be rebuilt on it.
- **2026-11-25** — Vendor follow-ups (prepared, deploy pending James): Tech Check
  `cos-vendor-requests-v3.sql` (EYE account number per unit in `app_private.vendor_unit_accounts`,
  `vendor_requests.closed_*`, four service_role functions; reads `camera_devices.eyeforce_id`, never
  writes it); `cos-vendor-request` v3 actions `account` / `account_set` / `open` / `close`; Manager
  tab "Waiting on vendor" box and the SIM-rule switch (`operations-host.js` kind `simRequire`). Record
  in `tech-checks/docs/db-changes/20261125_vendor_followups.md`.
- **2026-11-26** — Deployed `cos-unit-camera-status/morning-list-v21` (#549): live now
  **v22 `a306656f`** (pins updated). The camera-status read carries `overnight` (the
  morning list, Owner and approved IT; Tech Check `cos_overnight_v1`). Rollback
  `rollback-to-v21-entry`. A next patch to this function must start from v22.
- **2026-11-25** — Tech Check: morning list. `public.cos_overnight_v1` (Owner or
  approved IT, read only) lists field cameras down, new in 24 h first, with router
  reading, likely cause and IT-sheet line. Operations patch
  `cos-unit-camera-status/morning-list-v21` is **prepared, not deployed** (starts
  from live v21). Record in `tech-checks/docs/db-changes/20261125_morning_list.md`.
- **2026-11-25** — Tech Check: BEFORE INSERT trigger `sim_drawer_require_v1` on
  `app_private.techcheck_transfer_events` and `public.sim_drawer_require_v1(boolean)` (Owner).
  Applied with the rule **off** (`sim_drawer_settings.require_listed=false`); when on, a checkout
  with a SIM not free in the drawer is refused. Do not turn it on without James. Record in
  `tech-checks/docs/db-changes/20261125_sim_drawer_required.md`.
- **2026-11-25** — Vendor emails v2 **live** (#544, 22:46 UTC): Eyeforce account add / unit
  swap are the full CIF form, approved IT may send them, the filled CIF goes as an attachment.
  Tech Check `cos-vendor-requests-v2.sql` applied (actor `fleet`, unit cameras, cron-secret read);
  `cos-vendor-request` **v2 is a pinned entry** (`docs/cos-vendor-request-v2-entry/serve.ts`,
  commit 0537670) — a next change must redeploy with a new pin. New **Operations** function
  `cos-deactivation-log` v1 (verify_jwt off, cron-secret checked by Tech Check) writes the
  cancellation sheet as the COS service account. No audit row. Record in
  `tech-checks/docs/db-changes/20261125_eyeforce_cif_forms.md`.
- **2026-11-25** — New edge function `cos-vendor-request` (Tech Check, v1) and
  `app_private.vendor_requests`: the unit card's "Email a vendor" (SIM cancel to
  Vendera/Simetry, Eyeforce add/remove/swap). Owner only; sends from James's Gmail
  via `TECHCHECK_GOOGLE_*`, IT@ in CC; appends to the deactivation sheet. Record in
  `tech-checks/docs/db-changes/20261125_cos_vendor_requests.md`.
- **2026-11-25** — `camera_devices`: SolarSpotter 029 (3 renamed by serial, old
  029_4 row 158 `deactivated`), Helios 009 (Cam 001/002 swapped) and Solar Spotter
  002 CAM 2 matched to VCC's names. Moved in VCC also lists camera-number
  differences inside a unit. No audit row. Record in
  `tech-checks/docs/db-changes/20261125_ss029_cam_numbers.md`.
- **2026-11-25** — Board, three merged: #517 the maps draw CARTO `dark_all`
  instead of inverting OpenStreetMap light tiles in CSS (all three
  `.leaflet-tile-pane` filters removed — do not add one back, it erases the
  streets); #520 `canonicalCameraUnit` lets a **Recon only** carry a trailing
  site after a space, so all 36 Reconeyez keys like `RII005 - Newmark/Gembler`
  resolve instead of reading "No site on record" at Unknown (the two anchored
  patterns are unchanged, `RII-007-junk` is still nothing, and the durable
  backend `savedFleetBoard.mjs` + preview manifest were repackaged because they
  bundle that parser); #526 the map note now reads "193 of 198 field units on
  the map". Watch: `dist` conflicts on every one of these — `verify` takes ~75
  min while main moves every ~15, so a `dist`-touching PR needs the
  resolve/rebuild/push/merge done in one pass.
- **2026-11-25** — Tech Check: truck standard + extras + tech-to-tech moves
  (`techcheck-truck-extras-v1.sql`). New `app_private.truck_extra_units` /
  `truck_moves` / `truck_standard`, bucket `techcheck-truck-moves`, trigger
  `techcheck_extra_place_guard_v1` on `service_truck_units`. Edits (anchored):
  `techcheck_handoff_covering_v1`, `techcheck_transfer_custody_hold_v1`,
  `techcheck_ticketfree_context_v1`, `submit_techcheck_ticketfree_return_v1` (also
  releases an accepted handoff's hold). A truck "has" = slot + extras. Record in
  `tech-checks/docs/db-changes/20261125_techcheck_truck_extras.md`.
- **2026-11-25** — Deployed `cos-unit-camera-status/vcc-moves-v20` (#537): live now
  **v21 `ac4a0ff3`** (pins updated). The camera-status read carries `vccMoves` for the
  Owner and approved IT, and `POST /api/unit-camera-status/vcc-move` applies one item
  (Tech Check `cos_vcc_move_apply_v1`). Rollback `rollback-to-v20-entry`. A next
  patch to this function must start from v21.
- **2026-11-25** — Tech Check: Moved in VCC. `public.cos_vcc_moves_state_v1` /
  `cos_vcc_move_apply_v1` (Owner or approved IT) list and apply camera records that
  no longer match VCC (moved / new / gone); applies write `camera_devices` one row at
  a time and log to `app_private.cos_vcc_move_log`. No audit row. Operations patch
  `cos-unit-camera-status/vcc-moves-v20` is **prepared, not deployed** (starts
  from live v20). Record in `tech-checks/docs/db-changes/20261125_vcc_moves.md`.
- **2026-11-25** — Tech Check returns: `app_private.techcheck_ticketfree_photos_v1`
  now needs at least one photo (Service send and IT check-in), and
  `techcheck_handoff_gaps_v1` adds `returns_not_checked_in` (Manager tab). Old
  definitions in `app_private.techcheck_returns_evidence_backup_v1`. Record in
  `tech-checks/docs/db-changes/20261125_techcheck_returns_evidence.md`.
- **2026-11-25** — Linked 31 InHand routers to COS units by exact name
  (James approved the list) with `cos_router_link_v1`: 31 `ADD_ROUTER_LINK` rows,
  safe after_state; watchdog `ok` after. 37 left unlinked on purpose. Record in
  `tech-checks/docs/db-changes/20261125_inhand_link_31_routers.md`.
- **2026-11-25** — Deployed `cos-unit-camera-status/a-links-v19` (#525): live now
  **v20 `a9cc477f`** (pins updated). The camera-status read gives a unit with no
  A# its hand-linked A#, and `POST /api/unit-camera-status/link-a` links one
  (Tech Check `cos_mhelp_hand_link_v1`). Rollback `rollback-to-v19-entry`. A
  next patch to this function must start from v20.
- **2026-11-25** — Tech Check: `public.cos_mhelp_hand_link_state_v1` and
  `public.cos_mhelp_hand_link_v1` (A# linked by hand from the unit card; Owner or
  approved IT; writes `app_private.cos_mhelp_unit_link` `decided_by='hand'`, and
  `camera_devices.mhelp_product_id` only for single-camera units). No audit row.
  Operations patch `cos-unit-camera-status/a-links-v19` is **prepared, not
  deployed**; it starts from live v19. Record in
  `tech-checks/docs/db-changes/20261125_mhelp_hand_link_functions.md`.
- **2026-11-25** — `camera_devices`: Spotter 265 matched to VCC (row 275 moved
  from SOLARSPOTTER 253 to SPOTTER 265 as CAM 4 by serial, 3340/3341 renamed,
  new row 3342 for CAM 1, NVR row 384 `deactivated`). Approved by James. No audit
  row. Backup `app_private.camera_devices_265_253_fix_backup_20261125`. Record in
  `tech-checks/docs/db-changes/20261125_spotter265_ss253_camera_records.md`.
- **2026-11-25** — Tech Check: InHand router details (#529). `camera_unit_routers`
  gained `inhand_public_ip`, `inhand_signal`, `inhand_carrier`, `inhand_firmware`,
  `inhand_gps`, `inhand_details_at` (written only by the InHand pull; `router_public_ip`
  untouched); `inhand_private.unmatched_routers`; `cos_inhand_router_status_apply`
  replaced; new `cos_router_details_v1` / `cos_router_link_v1` (service_role only) and
  edge function `cos-router-details` (Owner/IT; Link router writes the existing
  `ADD_ROUTER_LINK` action, same safe after_state). `inhand-router-status-pull` now v6.
  Note: a bare `DELETE` is refused through PostgREST (safeupdate), so use `where true`.
  First pull: 248 updated, 68 unmatched; watchdog `ok`. Record in
  `tech-checks/docs/db-changes/20261125_inhand_router_details_and_link.sql`.
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
