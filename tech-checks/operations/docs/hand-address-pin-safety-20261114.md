# Hand address pin safety — integrated draft, not deployed

This patch is based on deployed source / PR #396 head `f09268fbd223b12d75e648818f49422863e440ed`, rechecked unchanged against main `45627e53d0eed1a7495510533a2e215cfc3273ec`. PR #397 is the single pin-safety review and depends on #396. Claude's branch is untouched.

## Scope

Pin-only clear appends an address edit without coordinates, copying exact current stored text inside the existing database lock. Every address write supplies the immutable current edit UUID (or null for no previous address). SQL checks that revision after geocoding and before append. Original rows remain immutable. The private address_request audit column distinguishes clear_pin from explicit address removal. Identical requests replay their first persisted result; stale writes and reused IDs with different requests fail closed.

Remove address and pin is separate. Retry pin lookup works for unchanged saved no-pin addresses. Duplicate clicks are blocked and uncertain writes require successful explicit refresh. A withdrawn hand pin cannot reappear through saved-source fallback. Identity, placement, camera health, monitoring and billing are unchanged.

A provider pin requires house number, street, city and state agreement after conservative case/suffix normalization. Missing/unparseable or contradictory evidence saves the address without a pin. No coordinates are manufactured. The strict unattended geocoder is untouched.

## Reconciliation with deployed functionality

The exact deployed #396 local/remote fallback, v2.1 endpoint, key handling, comparable-confidence rule, logging and display rename behavior are retained. Census unverified_match is terminal and cannot fall through to either provider. Both local Geocodio results and remote secondLookup success are checked for address agreement and usable coordinates, with another check around the entire lookup at the handler write boundary. A remote unverified_match is retained. Existing fallback on provider outage remains as deployed; no provider/key is enabled and all test calls use synthetic transports.

Both regression examples are rejected across Census, local Geocodio, remote secondLookup and handler boundary:

- 22725 Ashley Pines Dr, Spring, TX versus 22726 Ashley Pines Dr.
- SS032: 10426 IH37 Access Road, Corpus Christi TX 78410 versus 10428 I-37 Mathis TX 78368 at 28.084928, -97.803507. The saved previous address 10426 I-37 Access Rd, Corpus Christi TX 78410-4656 and every live record remain untouched by this task.

The SQL preserves the exact installed non-address writer as an API-inaccessible private delegate. It retains installed rename support without introducing it on the older main baseline. Its ACL denies direct service-role calls, so it cannot bypass address revision checks.

## Source and artifact provenance

Read-only production inspection: cos-unit-camera-status v14 imports `caf633dc95743f1591d233fbad3c05939d6adff4/tech-checks/supabase/functions/cos-unit-camera-status/dist/index.ts`. That imported file identifies f09268fb as its source; SHA-256 is `48ac30ca4023892dee86b9d680458db499e14a8d7b14ecf8617b68305059ee32`. The wrapper EZBR hash is `7c8632c0195aaa1dbdc246eb8394c915b76db94b291536ab6fa78fd6420bce4f` (a different artifact).

The dedicated serve.ts and build.mjs remain unchanged. Build from the clean reviewed integration commit; retain its full source commit, generated module hash and frontend manifest as release evidence. No deployed import pin has been changed. Do not replace the separate cos-operations-pages production artifact.

## Verification

The integration adds explicit provider/remote-boundary SS032 regressions, preserves #396's existing valid fallback/rename tests, and tests pin-only clear, exact text/history, auth denial, stale revisions and replay. The final PR records exact-head counts and artifacts.

The previous Node 24.22.1 full run failed one unrelated PGlite file with a native V8/WASM assertion: `jit_page_->allocations_.erase(addr) == 1`, inside ThreadIsolation::UnregisterWasmAllocation. No JavaScript assertion caused that failure. That unchanged file passed all seven tests under Node 22.16.0. The full reconciled serial suite is run under Node 22, matching the Operations CI runtime; no assertion, timeout or skip is relaxed.

Local PostgreSQL/Docker is unavailable. The existing CI PostgreSQL 17.6 job now runs hand-address-postgres-concurrency.mjs, using its existing pinned pg dependency and unchanged service/permissions. The script refuses non-loopback or non-disposable targets, refuses an existing database, observes actual pg_stat_activity lock waits, exercises concurrent stale clear, late retry, duplicate replay and changed-request rejection, then drops only its own test database. The CI receipt is required before release; do not represent PGlite tests as multi-session certification.

## Required release order — separate authorization

1. Finish exact-head CI and independent review; establish #396's source dependency without overwriting concurrent work. Recheck live wrapper and imported hash before proceeding.
2. Review/apply `db/20261114175728_hand_address_pin_safety.sql` after the existing hand-edit installation. Do not reinstall the older writer afterward. No existing audit row is updated or deleted; old address clients without revision fail closed.
3. Build and verify the reconciled dedicated cos-unit-camera-status artifact from that exact clean commit, retaining all #396 functionality. Deploy only that dedicated function with the new read/write revision contract; preserve existing authentication and configuration.
4. Publish the matching committed frontend, refresh clients, and independently verify supported user actions. Any live SS023/SS032 pin correction belongs to a separately authorized operational action, never this code task.

Migration remains unapplied. No production data, service, key, provider control or deployment was changed. No PR was merged and no email was sent. Historical rows must survive any rollback; never restore an unguarded address writer while revised clients are active.
