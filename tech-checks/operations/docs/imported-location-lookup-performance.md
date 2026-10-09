# Imported location lookup batching

Camera Health's imported location reader used to normalize every camera device
and audit label separately for every binding in its 250-binding request. The
existing plain `unit_key` index cannot accelerate the private PL/pgSQL concern
function predicate. A bounded production baseline for 237 active bindings took
7,131.786 ms and returned 120 successful estimates, 115 no matches, and 2 holds.

## Change

Apply `db/geocodio-imported-lookup-batch.sql` to the existing Camera Health project
after the source-precedence migration. The reader materializes normalized legacy
device/audit rows once per read, under the same NOWAIT SHARE locks, and creates
exactly the same ordered guard JSON and SHA-256 values. The map exists only inside
the call. Bindings with reviewed source precedence continue through the original
scalar precedence guard and current registered review checks.

No persistent cache, TTL, index, customer/equipment write, geocoding request,
permission expansion, or higher application timeout is introduced. The existing
Owner/approved-IT reader gate, Service exclusion, exact source binding comparison,
per-job row locks, invalidation, cache status semantics, and source re-reads are
unchanged. The new helper has an empty search path, is security invoker, and has
EXECUTE revoked from PUBLIC, anon, authenticated, and service_role. Only the
existing security-definer reader invokes it.

An expression index using the private concern helper was rejected: it would make
existing direct authenticated Owner CSV inserts/updates require additional helper
EXECUTE privileges. This implementation preserves those writer paths and all
existing grants instead.

## Verification and rollout

- Run `npm test`, `npm run typecheck`, `npm run build`, and the complete browser CI.
- The dedicated lookup-batch tests compare scalar and batch guards, full reader
  outputs, permissions, late mutations, empty/unknown/held cases, and rollback.
- Use a bounded, read-only-in-effect call to the existing reader over the same
  ordered current bindings before/after. Record only counts, timings, and input/
  output hashes. The output digest includes all returned coordinates and source
  evidence; it does not publish those private records.
- Confirm identical input/output hashes. If live data legitimately changed,
  compare under a fresh consistent snapshot rather than forcing historical counts.
- Confirm authenticated FieldView loads its actual units and accepted map points.

The transaction uses a one-second DDL lock wait and a 30-second migration limit;
these are deployment safety bounds, not application query timeout changes. The
migration adds no new read or write authority.

## Rollback

Apply `db/geocodio-imported-lookup-batch-rollback.sql` to restore the preceding
public reader first, then remove the unused private helper. It preserves the
reader's ownership, ACL, security-definer flag, and empty search path. No data or
other source-precedence/placement functions are reverted.
