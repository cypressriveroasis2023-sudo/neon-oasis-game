# COS-owned inventory and IPs — plan (2026-11-12). NOTHING HERE IS DEPLOYED.

## Direction from James (2026-11-12)
- COS must show camera online/offline in the field. That is the job.
- COS keeps ONE exact copy of the mHelp inventory as its own unit list. After that
  only James (Owner) and IT edit it, by hand. No automatic inventory changes from
  mHelp, the tracker, InHand or any other source.
- mHelp automation is off except the hourly API key renewal.
- "Change the code that says mHelp is the reason for Fleet updates."

## Production state at 11:10 AM CT
- Tech Check Platform compute raised Nano -> Small at 10:27 AM (disk IO budget was depleting).
- Paused jobs: cos-mhelp-address-automation, cos-vrm-fleet-discovery (Tech Check);
  camera-field-address-geocode, cos-mhelp-inventory-sync, cos-mhelp-placement-sync (camera project).
- Still scheduled: cos-mhelp-token-renewal (hourly), cos-sheets-placement-publish (:10/:40),
  camera health sweep, provider reconciles, deliveries.
- #383 was installed at 7:44 AM (two Owner-approved links recorded; functions pinned at aee873b).
- No Fleet board has completed since 2026-11-12 06:50 UTC.

## Why the board cannot save today (two source rules, both in src/exactProductConnection.ts)
`buildExactProductConnections` returns null — and the producer refuses the board — when:
1. the mHelp census is stale (`readMhelpInventoryAuthority`: >45 min for a live API read), or
2. the tracker IP census is missing, older than 30 min (`SOURCE_FRESH_MS`), not tied to the
   same census fingerprint, or does not list exactly the same A#s.

## Target design (smallest change that matches the direction)
Keep the existing evaluation, guards and Unknown rules. Change only where the two inputs come from.

1. **Inventory = an Owner-accepted COS copy.** One fresh complete mHelp read is taken and shown
   to James (total / Field / Shop). On approval it is recorded as the frozen census
   (`COS_INVENTORY_FREEZE_V1`: fingerprint, real read time, acceptor). Rule already built and
   tested on this branch: a matching freeze is not stale; the read time never moves; a mismatch
   is ignored. Still to build: the freeze record + Owner-only freeze/unfreeze RPC, attaching the
   marker in `mhelpUploadPlacement.ts`/bundled `serve.ts`, the board label.
2. **IPs = a COS-owned A# -> public IP list.** Seeded once from the last verified tracker census
   (an exact copy, like the inventory), then edited only by Owner/IT with an append-only receipt
   per change (who, old, new, when, reason). The server builds the connection census from this
   list instead of reading the Google tracker; `verifiedAt` becomes the time the COS list was
   read. All per-A# guards stay: one IP claimed by two A#s -> Unknown for both; held identity ->
   Unknown; Shop stays Shop. Then `cos-sheets-placement-publish` can be paused.
3. **Manual edits (Owner + IT only).** Field/Shop, customer/site, IP per A#, each recorded.
   Under a freeze a manual edit stands until changed by hand. This replaces the open question
   in #379.
4. **Health keeps flowing.** Camera sweep and provider checks are unchanged. Missing, stale or
   failed checks stay Unknown. A router being online is never camera health.
5. **Scheduled board publish** so a board is saved with the app closed (the producer has no
   schedule today), and real checks every 10 minutes — after 1–3 are live and measured.

## Order of work
A. Freeze record + marker + label (finish #385).  B. COS-owned IP list + seed + census adapter.
C. Owner/IT edit screens with receipts.  D. Pause tracker publish; scheduled board publish.
Each step: local tests, hosted checks, Vision review, read-only precheck, James's approval.

## Not decided
- Whether mHelp/tracker sync runs in a reduced form as a bridge until A+B are live.
- Repair of `address_automation_sync_v1` (re-reads all history per source; retried every minute
  and exhausted the disk budget overnight). Stays paused.
- Pruning of 288+ stored mHelp batches and `cron.job_run_details`.
