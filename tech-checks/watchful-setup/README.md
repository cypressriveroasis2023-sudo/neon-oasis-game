# Watchful setup check

Every camera on a unit has to prove it sends an event to Watchful before the unit goes live.
Built from James's spec "COS install checklist" v1.0 (2026-11-27). Lives inside Tech Check.

## How it works for the team

1. **Service, IT or the owner** taps **📡 Watchful setup check** on their home screen, then *Start a check on a unit*.
2. They find the unit. COS fills in what it already has on file (from `camera_devices`, i.e. VCC): the recorder
   model and each camera's model. The tech only confirms against the labels, or picks another model.
   A model not on the list is typed exactly as printed, with a photo of the label.
3. The checklist is built for those exact models. **▶ Do the next step** walks through it one step at a time:
   unit, recorder mail page, each channel or camera's event settings, physical checks, Watchful mapping.
   Steps marked *Standard unconfirmed* still count; *Pending standard* steps cannot be ticked and never block.
4. **Walk test**: Test mode on in Watchful (screenshot) → walk in front of each camera, enter the event time
   Watchful shows and screenshot it → Test mode off (screenshot). An event from before the last setting change
   does not count. After 3 tries with no event, the app points the tech back to that camera's settings.
5. **Send to the office.** IT or the owner (not the same person as the tech, unless the owner gives a reason)
   enters Watchful's "Cameras sending events X / Y" with a screenshot. X = Y = COS's camera count, or it goes back.
6. After sign-off the cameras are watched: **Quiet cameras** (IT and owner) imports Watchful's last-event list
   as CSV and shows Quiet / Never sent / Unknown / Going quiet soon / Not watched. No reading is *Unknown*; it
   is never shown as down. Shop / test / burn-in units are never quiet.

Rules nobody can skip are in the database, not the screens. Photos are re-drawn on the phone (drops GPS/EXIF)
and stored privately. Notes refuse anything that looks like an IP address, token or password.

## Files

| Path | What |
| --- | --- |
| `host.js` | The screens and the home-screen button (shown only once the database answers) |
| `client.js` | Calls to the database and photo uploads |
| `model.js` | Pure logic: prefill from COS, next step, Central time, CSV import (unit-tested) |
| `sql/10_rules.sql` | Tables and every rule |
| `sql/20_app_calls.sql` | The `public.ws_*_v1` calls the screens use, photo bucket, grants |
| `sql/30_catalog.sql` | Generated from `tools/model_catalog_v3.csv` by `tools/build_catalog.py` |
| `tools/assemble.mjs` | Builds `../database-maintenance/watchful-setup-check-v1.sql` (`--check` in CI) |

Tests: `tech-checks/operations/tests/watchful-setup-*.test.mjs` (spec section 8 on the real change file,
screen logic, rollback) and `watchful-setup.browser.spec.mjs` (the whole job on a phone screen against the
real rules; `WS_SHOTS=dir` saves screenshots). Local harness: `node tests/watchful-setup-e2e/server.mjs`,
then open `http://127.0.0.1:4180/?as=josh` (or `teddy`, `james`).

## Follow-ups (not in this change)

- A template/catalog editor screen (S8); today the owner fills placeholders with two SQL calls (see the db-change record).
- Fleet setup status (S6) and unit-card history (S5).
- Automatic Watchful last-event import and pre-filled walk-test times, if Watchful offers an API or export.
- The 7:00 AM in-app digest needs a cron job (`app_private.ws_build_digest()`), on a free minute, with James's go.
