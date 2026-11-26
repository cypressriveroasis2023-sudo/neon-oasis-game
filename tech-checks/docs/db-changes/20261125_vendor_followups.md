# 2026-11-25 — Vendor follow-ups: account number on the unit, Waiting on vendor, SIM rule switch (prepared)

Asked by James ("Proceed with your recommendations"): the SIM rule on/off button, saving the Eyeforce account
number on the unit, and a "Waiting on vendor" list in the Manager tab.

Status: **prepared, not applied or deployed** (needs James's go-ahead to merge and deploy).

## What changes

**Tech Check** (`goqrnolcvqnirjmzaeyk`), `database-maintenance/cos-vendor-requests-v3.sql`:

- `app_private.vendor_requests` gains `closed_at`, `closed_by_name`, `closed_note`.
- New `app_private.vendor_unit_accounts` (one Eyeforce account number per unit) and `vendor_unit_account_log`.
- `public.cos_vendor_account_v1(unit)`, `cos_vendor_account_set_v1(unit, eye, actor, how)`,
  `cos_vendor_open_v1()`, `cos_vendor_close_v1(id, actor, note, eye)`. All service_role only.
- Reads `camera_devices.eyeforce_id` as a fallback (two units have one today). **Never writes `camera_devices`.**
  No audit row.

**Edge function `cos-vendor-request`** (Tech Check), v3 — new actions:

- `account` / `account_set`: Owner or approved IT read and save a unit's EYE number.
- `open` / `close`: Owner only. Lists emails nobody has marked done; marking an Add account done can take the
  EYE number from Eyeforce's reply; marking a Remove account done clears the unit's number.
- A sent swap moves the number from the unit taken out to the unit put in.

**Screens** (`operations/dist`, and `tech-checks/operations-host.js` for the SIM switch):

- Unit card, Email a vendor: "Eyeforce account number" line with Add it / Change; Remove account and Swap unit
  start with it filled in.
- Manager tab: new "Waiting on vendor" box; SIM drawer box gets the "SIMs must come from the drawer" switch
  (calls the already-live `public.sim_drawer_require_v1`, asks once more before turning on).

## Order to go live

1. Apply `cos-vendor-requests-v3.sql` to Tech Check.
2. Merge the PR (publishes the screens).
3. Redeploy `cos-vendor-request` with a new pinned entry at the merge commit.

Until step 3, the new card line stays hidden and the Manager box says the list could not be read; nothing breaks.

## Check after

```sql
select public.cos_vendor_account_v1('Helios 002');   -- {"eye": null} until one is saved
select public.cos_vendor_open_v1();                   -- {"open": [...], "done": [...]}
select public.cos_sweep_watchdog_recent_v1(3);        -- ok (no audit table change)
```

## Rollback

- Function: redeploy the v2 pinned entry (`docs/cos-vendor-request-v2-entry/serve.ts`).
- SQL: `drop function public.cos_vendor_account_v1(text); drop function public.cos_vendor_account_set_v1(text,text,uuid,text);
  drop function public.cos_vendor_open_v1(); drop function public.cos_vendor_close_v1(uuid,uuid,text,text);`
  (the tables and columns can stay; nothing else reads them).
