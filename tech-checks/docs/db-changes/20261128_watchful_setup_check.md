# 2026-11-28 — Tech Check: Watchful setup check (PREPARED, NOT APPLIED)

Project: Tech Check `goqrnolcvqnirjmzaeyk`
File: `tech-checks/database-maintenance/watchful-setup-check-v1.sql`, built from `tech-checks/watchful-setup/sql/*.sql`
by `node tech-checks/watchful-setup/tools/assemble.mjs`. One transaction: it all applies or nothing does. Run it once
(a second run stops at the first `create type` and changes nothing).
Spec: "COS install checklist" v1.0, 2026-11-27 (James Martin). Apply only with James's go.

## Why

On 11/27, 110 of 553 cameras configured in Watchful were not sending events. Units of the same model were set up
differently, and nothing proved a camera reached Watchful before the unit went live. This makes every unit pass a
checklist for its exact models, a Watchful walk test on every camera, and an office check of Watchful's camera
count before it is live; then it watches each camera's last event.

## New (all names start with `ws_`; none existed on 2026-11-28)

- `app_private.ws_*` tables: model catalog (`ws_device_models`, `ws_unit_type_models`, `ws_unit_type_model_gaps`,
  `ws_unit_types`), versioned checklists (`ws_checklist_templates`, `ws_checklist_template_items`,
  `ws_placeholders`, `ws_notices`), checks (`ws_installs`, `ws_install_cameras`, `ws_install_items`, `ws_evidence`,
  `ws_walk_test_sessions`, `ws_walk_test_attempts`, `ws_walk_test_waivers`), live state (`ws_unit_setup`,
  `ws_unit_cameras`, `ws_unit_placement`), quiet cameras (`ws_event_imports`, `ws_camera_last_events`,
  `ws_camera_name_mappings`, `ws_quiet_camera_alerts`, `ws_alert_settings`, `ws_digests`) and the append-only
  `ws_audit_log` (UPDATE/DELETE/TRUNCATE refused for every role).
- `public.ws_*_v1` functions, the only way in (security definer; `authenticated` only, nothing for `anon`).
  Service, IT and the owner do the steps; IT and the owner sign off as the office; the owner waives, overrides,
  matches models, hides photos and sets the quiet-days threshold. Roles come from `public.profiles`.
- Storage bucket `techcheck-watchful-setup` (private, JPEG only, 15 MB) with policies `ws_photos_insert_v1` /
  `ws_photos_read_v1` on `storage.objects`.
- Seed: the 36 rows of `model_catalog_v3.csv` (23 models, 27 unit-type links, 9 "model not on file" rows),
  29 published checklists from spec section 2.2, 19 placeholders, global quiet threshold 7 days / stale read 24 h.

## Not touched

No existing table, function, trigger, cron job or edge function is changed. Nothing is written to
`camera_inventory_audit` (no new action value; the camera sweep is unaffected). `camera_devices` is only read
(to fill in a unit's models). Nothing logs into or calls any device, Watchful, VCC, mHelp or InHand.

## After applying, check

```sql
select count(*) from app_private.ws_device_models;                                    -- 23
select count(*) from app_private.ws_checklist_templates where status = 'published';  -- 29
select public.cos_sweep_watchdog_recent_v1(5);                                        -- still ok
```
Then open Tech Check: the "📡 Watchful setup check" button appears for Service, IT and the owner only once these
functions answer (the screens are safe to publish before this file is applied).

## Rollback

`tech-checks/database-maintenance/watchful-setup-check-v1-rollback.sql`. It drops everything above. The photo bucket
is removed only if it is empty; otherwise it stays (private) so no evidence is lost.

## Filling a placeholder later (no code change)

When `confirmed_standards.md` is ready: as the owner, `select app_private.ws_new_template_draft(<published id>)`,
edit the draft's item (set `standard`, `standard_status = 'CONFIRMED'`, `placeholder_key = null`), then
`select app_private.ws_publish_template(<draft id>, '<note>')`. Live units on the old version get
"re-check needed"; open checks keep their version until the owner rebuilds them. (A template editor screen is a
follow-up.)
