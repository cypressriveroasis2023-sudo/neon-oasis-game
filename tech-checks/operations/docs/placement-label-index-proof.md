# Placement label equality index proof

This is a narrow SQL performance change, with no data, graph, access, timeout, Edge, or UI changes. The raw SQL is a synthetic proof input. Production maintenance requires separate authorization and the guarded installer.

## Change and invariants

- One non-unique HASH index on the exact built-in expression `regexp_replace(lower(unit_number),'[^a-z0-9]','','g')`.
- Three left-hand predicate expansions: one in the placement guard and two in the native-source guard. The right-hand normalizer, equality/count rules, whole-row digests, Owner checks, array ordering and null/error behavior remain unchanged.
- No persistent snapshot cache or skipped guard. Normalized duplicates remain denial conditions; the index is deliberately non-unique.
- Built-ins in index maintenance avoid granting private-helper EXECUTE to existing writers. HASH avoids adding a B-tree key-length restriction to unbounded native labels.
- Coordinate concern scans remain a separate issue. This change does not claim to resolve that path.

## Generic files

- `db/mhelp-placement-label-index.sql`: raw candidate for transactional synthetic comparisons
- `tests/fixtures/placement-label-index-baseline.sql`: exact baseline guard code only
- `tests/fixtures/placement-label-index-catalog.json`: portable synthetic function/index expectations, no production OIDs or operator receipts
- `scripts/build-placement-label-index.mjs`: deterministic installer/rollback generator; no database connection
- `db/mhelp-placement-label-index-install.sql` and `-rollback.sql`: guarded atomic maintenance scripts

The generator verifies the baseline/candidate function source fingerprints before emitting SQL. An installer checks all six placement functions plus native-source guard and source-label normalizer, including source fingerprints and security attributes. It accepts only the exact expected index shape and an exact baseline or already-installed state. An exact completed state is a no-op; missing, mixed, colliding or drifted state fails closed.

Both directions use a transaction, advisory serialization, a two-second local lock timeout and a catalog-first local search path. They preserve the caller's statement timeout and do not run ANALYZE. The index and both function replacements commit together. Full non-source function catalog and equipment table/column ACL/RLS metadata must remain unchanged.

The copied expression depends on the exact immutable `cos_source_label` implementation. Any future change to that helper requires reviewing or rolling back this optimization; do not bypass its fingerprint guard.

## Verification

Run the portable PGlite tests through the repository test runner. The dedicated PostgreSQL workflow uses the existing pinned `pg` client and a disposable loopback-only PostgreSQL 17.6 service. The proof rejects other database URLs and pre-populated application databases.

The actual PostgreSQL proof must record server/ICU/collation versions and test the deployment's deterministic ICU `en-US` default-collation context. A different ICU version is disclosed, not assumed identical. PGlite measurements are synthetic observations and cannot prove PostgreSQL concurrency, deployment latency, or another collation's behavior.

Required coverage includes:

- Complete baseline/candidate snapshots and SQLSTATEs, source/Owner changes, normalized collisions, nulls, malformed UUIDs, array errors and coordinate reads
- All user-function non-source catalog properties, exact unaffected function bodies, table/column ACL/RLS parity, unchanged eight-second statement budget
- Default-planner index use immediately after installation, without post-install ANALYZE; any separately analyzed results are labeled
- Real hash collisions, same-/cross-organization labels, duplicate counts, Unicode/locale equality and long native text
- Existing writer privileges with inaccessible private normalizers, and immediate insert/rename/delete behavior
- Multiple PostgreSQL sessions proving uncommitted/committed/rolled-back Owner/native changes under MVCC
- Exact install/retry/rollback/retry behavior, name/body/helper/catalog drift, caller search-path shadowing, and injected mid-change failure with atomic rollback

No production polling, credentials, source rows, private receipts or external provider calls belong in this proof or its published artifacts.

Before any production authorization, perform one fresh bounded metadata preflight for all eight function fingerprints/security catalogs, table/column ACL and collation state, index-name state, server version, and the existing intended writers' EXECUTE permission on `pg_catalog.lower(text)` and `pg_catalog.regexp_replace(text,text,text,text)`. Built-in access is assumed only by the isolated fixture until verified live. This preflight does not authorize deployment or a heavier read probe.
