# 2026-11-25 — Eyeforce account forms on the unit card, and the cancellation sheet through Operations

**Applied and deployed 2026-11-25 ~22:46 UTC (James: "merge #544 and deploy").** SQL applied to Tech Check;
`cos-vendor-request` v2 deployed as a pinned entry (`docs/cos-vendor-request-v2-entry/serve.ts`, commit
0537670); `cos-deactivation-log` v1 deployed to Operations. Checked: James owner+fleet, Teddy fleet, Josh
neither; Helios 002 lists 3 cameras; the Operations check opens the sheet and finds the tab.

Asked by James (25 Nov): "Add account" and "Swap unit at account" become Eyeforce's own Customer Video
Guarding Information Form (CIF V5), filled on the unit card by the techs, and emailed to techops@eyeforce.com
with the form attached. The deactivation-sheet row now goes through the Operations project's service account,
because James's own Google sign-in cannot write that sheet (the card showed the yellow note).

## What changes

**Tech Check** (`goqrnolcvqnirjmzaeyk`), `database-maintenance/cos-vendor-requests-v2.sql`:

- `public.cos_vendor_actor_v1` also answers `fleet` (Owner or approved IT, `app_private.cos_verified_fleet_actor`).
- `public.cos_vendor_unit_cameras_v1(text)`: a unit's active cameras (name, type, public IP, forwarded ports, serial)
  to start the form's camera tab.
- `public.cos_vendor_log_secret_v1()`: the camera cron secret for the call to the Operations sheet function.
- All three service_role only. No table change; `app_private.vendor_requests` keeps the same kinds.

**Edge function `cos-vendor-request`** (Tech Check), v2:

- Approved IT may preview and send `monitor_add` and `monitor_swap`; everything else stays Owner only.
- Those two carry the CIF fields with Eyeforce's drop-down lists, and send the filled workbook as an attachment
  (`cif.ts`, `xlsx.ts`, `cif_template.ts`). The email text has a summary; camera passwords are only in the
  attachment, and COS stores `(given)` in their place.
- A tech's email is still sent from James's Gmail with IT@ in copy, signed once with the tech's name.
- The cancellation-sheet row and the sheet check go to the Operations function below, not James's token.

**Operations** (`tughscoxralhofrckvxy`), new edge function `cos-deactivation-log` (verify_jwt off; own check):

- Accepts only a caller with the camera cron secret, checked by Tech Check's `camera-mhelp-readiness`
  (the same boundary as `cos-sheets-placement-publish`).
- Only appends one nine-cell plain-text row to `Deactivation History` of sheet
  `1ygv0GfUm-0_irHrZiIbF04e6bDEHz61UWhjh8JXrpwI`, as `cos-unit-tracker@…` (shared on the sheet by James).
- Uses the existing `COS_GOOGLE_SERVICE_ACCOUNT_JSON` secret in Operations; no key moves between projects.

## The form template

`cif_template.ts` is Eyeforce's CIF V5 with the sample answers blanked and the VMS password line Eyeforce gives
dealers replaced ("Password: as given by Eyeforce"), because the repo is public. Rebuild it with
`tools/make-cif-template.mjs` from the original workbook if Eyeforce sends a new version.

## Check after

```sql
select public.cos_vendor_actor_v1('e4abc521-1ef3-45a6-9829-b87faff78210');  -- owner true, fleet true
select jsonb_array_length(public.cos_vendor_unit_cameras_v1('Helios 002'));  -- 3
select public.cos_sweep_watchdog_recent_v1(5);                                -- ok (no audit table change)
```

## Rollback

- SQL: re-run `cos-vendor-requests-v1.sql`, then
  `drop function public.cos_vendor_unit_cameras_v1(text); drop function public.cos_vendor_log_secret_v1();`
- Function: redeploy `cos-vendor-request` v1 (the files of #543, entry `serve.ts`, import map `deno.json`).
- Operations: delete the `cos-deactivation-log` function.
