# Owner assignment-review timeout — October 21, 2026

## Problem and observed state

PR #269 fixed repeated upload-snapshot evaluation. The Owner then successfully staged the exact October 20 CSV at 19:08:47 UTC (2:08 PM Central). Stage `311ebe5e-e6f2-4a5d-8ccc-0e9aafdd0958` contains 1,001 Product IDs, 284 Field and 717 Shop, with source SHA-256 `8f0d8ac0b677ad3b2d23c8f6604a3933821c1613d78d5fd39640a4ede1019599` and 195,275 original bytes. It expires at 20:08:47 UTC. The active inventory remains the earlier API source, 287 Field and 714 Shop; no final import has been applied.

At 19:14 UTC, the Owner clicked **Review current assignment identities**. The assignment-review RPC returned HTTP 500 / SQLSTATE 57014, followed by a runtime 503. PostgreSQL timed out inside `assignment_review(uuid)` at its repeated scoped-record lookup. The UI therefore displayed “Current owner input guards could not be verified. No source update was authorized.” This response does not establish a stale-identity conflict.

A read-only call of the installed private review completed in 6,131 ms and returned 354 eligible review items. It included all five requested source-assignment changes. The saved continuity evidence comprises 344 timestamp-only references, eight historical assignment differences and two other reviewed records. These are evidence references, not 354 new equipment moves. The five actual CSV changes remain:

| Product ID | Unit | Proposed placement |
| --- | --- | --- |
| 2233383 | Solar Spotter 013 | Field, HEB Aledo, 14820 Skyline Ridge Rd, Aledo TX 76008 |
| 2300344 | Solar Spotter 054 | Shop |
| 2226860 | Spotter 261HDC2 | Shop |
| 2229407 | Solar Spotter 008 | Shop |
| 2229931 | Solar Stand 015 | Shop |

The installed function scans all 1,001 scoped records for each staged row, then scans saved continuity and original identity references repeatedly. A separate read-only profile measured 2,307 ms for the repeated scoped lookup and 386 ms for all 354 current-evidence snapshots. The optimization therefore targets array lookups; it leaves evidence reads in place.

## Proposed repair

`prepareOwnerAssignmentReviewIndexedSql.mjs` produces a guarded migration replacing only `cos_mhelp_placement_private.assignment_review(uuid)`.

- Build request-local indexes for scoped Product IDs and saved continuity references, retaining ordered arrays of all matches. The first-match behavior and duplicate-continuity rejection remain exact.
- Index original native/tracker identity references once and retain the existing cross-Product-ID conflict checks.
- Build indexes lazily where the original function could skip an input. Keep the original expression for malformed non-array identity input, preserving its conditional error behavior.
- Recompute live snapshots, protected-state fingerprints, exact Shop receipts and identity eligibility on each request. Preserve the complete review JSON, item order and review digest.
- Leave Stage, assignment approval, Commit, API renewal, browser/runtime code and inventory data unchanged. This repair does not raise timeouts or introduce a cache across requests.

The migration requires the exact installed definition SHA-256 `dd6e404d28c23fc4afdb20335f4b60bd8f7c44f26084c1e2a2342f0083339f9b`, owner `postgres`, private owner-only ACL, security-invoker behavior, STABLE volatility and empty search path. Source or metadata drift aborts the transaction.

Candidate: `docs/drafts/cos-owner-assignment-review-indexed-20261021.sql`, 11,215 bytes, SHA-256 `e3a53cdf7cb1344fb1e960c6a685359825f46eaa5f8ee26b7a9e5f41aba76b6a`.

## Validation and limits

The focused test suite executes the original and proposed functions in disposable synthetic databases with 1,001 records and 354 review items. It compares complete JSON and digest output, all five requested cases, duplicate/missing/null IDs, current-state changes, conflicting native/tracker identities, lifecycle restrictions, source/revision/byte/expiry guards, repeated reads, catalog metadata, source drift and installation rollback. Existing PostgreSQL Owner transaction tests remain in the hosted gate.

All eight focused PGlite groups passed, including 34 original/repaired edge-case comparisons, in 21.89 seconds. The final full-size run measured 2,233.5 ms before and 984.2 ms after, with identical complete review JSON and digest. These are synthetic test timings, not a measured deployed improvement. A live SQL diagnostic also showed exact scoped-lookup output equality; its aggregate timing is unsuitable for full-review performance claims.

## Release boundary

Migration name: `cos_owner_assignment_review_indexed_20261021`.

**This migration requires separate Owner approval and is not installed by opening or merging the PR.** Earlier approvals for PR #268 and #269 remain completed and do not cover it. The CSV remains unapplied.

After approval and passing hosted checks, verify the current installed definition/ACL, install the exact candidate, and read back its definition and unchanged protected functions. Then use the authenticated Owner workflow to read and approve the assignments, followed by the final source commit. If the saved stage expires or any bound source/census/current-state value changes, create a fresh Owner stage; do not refresh its guards manually.

Completion still requires the exact-file commit receipt, saved inventory readback, preserved five identities and protected fields, and persistent address-based map placement. The actual 2027 tracker remains the operational IP authority. Inventory placement is separate from camera health.
