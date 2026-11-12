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

## Progress and findings, 2026-11-12 1:00 PM CT
- **Production:** #383 rolled back 12:22 PM (both functions pinned `b5b1882`, bundle hashes equal to the
  pre-install versions). Boards complete again from 12:26 PM. Bridge: `cos-mhelp-inventory-sync` every
  30 min (`5,35`), tracker publish unchanged. Address automation still paused; its sync step was run
  once by hand at 12:02 PM for the then-active source.
- **Built on this branch (not deployed):**
  - a census named by a matching freeze is not stale (`mhelpInventoryAuthority.ts`);
  - under a freeze the IP census age is reported, not enforced, and the envelope carries
    `inventoryFrozenAt` (`exactProductConnection.ts`); every other census rule still applies;
  - packaged board and reviewed frontend rebuilt; local tests pass.
- **Still to build, in order:**
  1. Tech Check SQL: freeze record (fingerprint, real read time, acceptor) with Owner-only
     freeze/unfreeze, and the marker delivered on the census in BOTH routes that read it
     (field map and Product-ID connections). Route RPCs are `service_role`-only, security definer,
     and take the actor id — follow `cos_mhelp_placement_snapshot`.
  2. Camera project SQL: `cos_tracker_endpoint_read_v1` drops receipts past `expiresAt`, so with the
     tracker publish off the IP list would empty out. Under a freeze the last complete generation
     must be kept as the COS-owned list (no expiry), and manual IP edits become new audited
     receipts in that generation's shape.
  3. Edge code + bundled `serve.ts` for 1–2, with a test that runs the bundled route end to end.
  4. Board label "Inventory frozen – mHelp as of <real date>".
  5. Owner/IT edit screens (Field/Shop, customer/site, IP) with append-only receipts.
  6. Then pause `cos-mhelp-inventory-sync` and `cos-sheets-placement-publish`.
- **Install rules added today:** database healthy first; after any deploy a board run must complete
  or the deploy is rolled back immediately.

## Update 2026-11-12 1:30 PM CT
- Finding: the board's `connections` step calls `/api/product-connections`, which reads the tracker
  **live from Google Sheets on every board build** (`read2027ProductIpsFromGoogle`). The stored
  tracker "authority" in the camera project is not what the board uses, and the
  `cos-sheets-placement-publish` job is not what keeps the board alive. Item 2 above is therefore
  replaced by: under a freeze, `/api/product-connections` uses the COS-kept IP list.
- Built (not installed) in `db/20261112_inventory_freeze.sql`, 8 local DB tests:
  freeze record (Owner only, exact active reviewed census + totals, real read time), guard on
  `upload_control`, the approved IP list stored with the freeze, `cos_inventory_ip_edit_v1`
  (Owner or verified IT via `cos_owner_identity_assert_actor(...,false)`), and
  `cos_inventory_freeze_state_v1` returning `{freeze, ipCensus, ipEdits}`.
- Next (edge + bundle, with a bundled end-to-end test):
  a. `POST /api/inventory-freeze` (Owner): read the active census and the tracker once from Google,
     require `buildExactProductConnections` to accept the pair, show totals, then call
     `cos_inventory_freeze_v1` with that tracker census as `ipCensus`.
  b. Field-map route: read `cos_inventory_freeze_state_v1`; attach `frozen` to the upload
     inventory only when it names the same fingerprint.
  c. `/api/product-connections`: when frozen, use `state.ipCensus` instead of Google and attach
     the same marker to the census; otherwise unchanged.
  d. Board label; Owner/IT IP edit screen calling `cos_inventory_ip_edit_v1`.
  e. Field/Shop and customer/site hand edits (replaces #379's open question).
- Open point for Vision: an IP edit changes `publicIp` only. Seeded tracker holds
  (`reviewReasons`, e.g. placement_mismatch) stay, so those A#s remain Unknown until a
  placement edit path exists (step e).
