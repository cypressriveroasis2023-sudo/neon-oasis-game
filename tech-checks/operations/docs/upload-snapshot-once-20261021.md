# Evaluate the current inventory snapshot once per request

## Observed failure

After approved PR268 was installed, the October 21, 12:36 PM Central Owner attempt still failed before Stage. The exact CSV has no saved stage or commit. Its preview and current 2027 Product ID proof succeeded.

Production request logs for 17:34–17:37 UTC show `cos_mhelp_placement_snapshot` responses timing out after approximately 8.3–14.2 seconds and returning HTTP500. The Operations runtime returns HTTP503 and “COS workflow could not be completed. Please retry.” No Owner Stage RPC request appears in this interval.

The existing Stage route calls `readMhelpPlacements` before the Stage bridge. A failure in this preliminary read therefore prevents the import transaction from starting. This is separate from the canonical identity proof repaired by PR268.

## Narrow repair

The installed private `upload_snapshot()` contains a non-materialized subquery that supplies `api_base_upload_snapshot()` to three expressions. A production `EXPLAIN (VERBOSE)` confirmed three separate evaluations in its plan. The lower guarded snapshot's existing optimized path remains eligible.

The candidate changes that subquery to a materialized CTE. The same helper evaluates once per SQL statement. It introduces no saved cache, new function, endpoint, permission, timeout increase or runtime/UI change. The existing actor authorization, source checks, Shop-address rules, missing-record guards and proof redaction remain in their existing functions.

The migration accepts only the exact reviewed installed definition and its owner, ACL, security mode, volatility and empty search path. Source or permission drift aborts. Function replacement occurs in one transaction and preserves all existing function attributes.

## Evidence

At 17:42:17 UTC, a read-only production comparison returned identical complete JSON for all 1,001 current records. Both result hashes were `70859b77aa7dffd1f1a0dcb33ce108af00f387caaa3e1afe0ad4ee2094384a1b`.

The original read took 1,777.38 ms and the candidate 611.19 ms in this single comparison. This demonstrates eliminated duplicate work, not a guarantee against every future database timeout or completed live Owner acceptance.

Six focused local PGlite test groups passed in 12.05 seconds: exact three-to-one source invocation count and full JSON parity; null/absent/empty cases; fresh source and guard changes across calls without refreshing stale guards; propagation of source/Shop/guard failures; unchanged permissions and configuration; source/ACL drift rejection and late-failure transaction rollback. The existing guarded Owner workflow runs this same suite against disposable PostgreSQL17 as well.

## Approval and release

Proposed migration: `cos_mhelp_upload_snapshot_single_evaluation_20261021`.

Exact candidate: `docs/drafts/cos-upload-snapshot-once-20261021.sql`, 1,902 bytes, SHA256 `64b836b4d5122f42179abfde5de0b27eda89971c227b505b5b0357516b9ec36e`.

This candidate is prepared but **not approved or installed**. The original handoff requires separate approval for additional privileged production function changes. PR268 approval covers the already installed identity-proof repair; it does not authorize this successor migration.

After approval, verify the current function still matches the source guard, install the exact candidate, and read back the function body and unchanged permissions. Resume fresh authenticated Owner preview, Stage and explicit assignment review. Final Apply remains held until review succeeds. Require the exact October20 file receipt, protected binding readback and persistent map placement before claiming operational reconciliation. No direct database inventory import is permitted.
