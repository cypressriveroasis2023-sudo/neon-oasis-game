# Statement-local upload adapter optimization

This package replaces only the body of `cos_mhelp_placement_private.upload_snapshot()`. The two existing public snapshot overloads, every other function body, and all non-body `pg_proc` properties are preserved. There are no new production functions, grants, caches, timeouts, or application runtime paths.

Reviewed generic source and synthetic hosted CI are within the approved camera-reliability repair. Production installation is a separate gate requiring exact-head hosted/full checks, freshly authorized metadata capture, a production-specific guarded draft, independent review, and the lead/root execution decision. A fixture-generated installer is never a production installer.

## Transformation and dependency contract

The accepted upload adapter deduplicates binding triples but calls a six-component whole-row graph digest helper for each distinct binding. This candidate materializes relevant table rows once, groups the same complete rows per binding, retains the same sorted JSONB arrays, and computes the exact same UTF-8 SHA256 digest. Source and archive OR matches are deduplicated by the existing immediate unique key; duplicate history and Owner-claim rows remain duplicated. Latest continuity selection, original guard, payload/source identity, null semantics, active pointer, currentness, lifecycle/SHOP checks, ordering, malformed-input errors, and all output fields remain intact.

The optimized work remains inside the original SQL STABLE statement. The public wrapper's original READ COMMITTED statement boundaries are untouched. There is no reuse between calls or between the public wrapper's statements.

A statement-time CASE selects the fast path only when:

- Both embedded helper definitions, owners, ACLs, and effective caller EXECUTE rights match the accepted contract.
- The complete same-name helper inventory contains exactly the expected signatures; defaulted and variadic overload drift is rejected.
- The seven cardinality keys are valid, immediate, live, ready, non-null primary keys of the expected types, with no inherited descendants.
- The control singleton CHECK and continuity guard NOT NULL/type invariants remain valid.

On drift the other CASE branch lazily runs the unchanged accepted query, including its calls to current helpers. The fallback's LIMIT 1 preserves the original scalar SQL function's first-row behavior if active-upload cardinality constraints change. Missing or incompatible objects may raise the same baseline errors or fail closed during parsing.

Existing-role and public-wrapper authorization behavior is exact. For a future direct caller given only a novel partial set of table/helper privileges, both paths deny access, but planning can report a different first missing-object 42501. No dispatcher or extra grants are introduced to normalize that hypothetical first error.

## Guarded package builder

`build-package.mjs` separates read-only catalog capture from pure rendering. The renderer pins the ten named dependencies, every public snapshot overload and both embedded helper overload inventories, plus all nine relations' columns, defaults, types, collation, constraints, indexes, triggers, inheritance, RLS, policies, owners, and ACLs. Complete captured schemas stay in the private or synthetic artifact directory; installers embed only their SHA256 fingerprint.

The install and rollback transactions acquire a bounded maintenance lock, reject any unspecified catalog/schema drift, preserve all non-body `pg_proc` fields, verify the exact postcondition before COMMIT, and treat only the exact already-installed state as an idempotent no-op. Both public overloads are explicitly included. The maintenance lock timeout is shorter than the unchanged application 8-second limit.

The automatic preparation entry point accepts only the fixed disposable hosted database or PGlite. It renders exact fixture-specific installer/rollback files without applying the candidate to discover its expected hash. The same pure renderer can consume a separately approved, private, single-statement catalog capture; fixture fingerprints must not be substituted for production metadata.

## Test layout

Integrate this directory at `tech-checks/operations/tests/hosted-full-upload-proof/`. Copy `harness/cos-full-upload-hosted-proof.yml` to `.github/workflows/cos-full-upload-hosted-proof.yml` through the reviewed publication flow. Use the explicit `publish-files.json` list; generated installers, schema captures, local logs, and operational capture material are not source files.

Local tests use only the already installed Node/PGlite dependency:

```
node tests/package.test.mjs
node tests/parity.mjs
node harness/static-check.mjs
node harness/local-fixture-check.mjs
```

For an isolated draft outside the repository, set `COS_FULL_UPLOAD_REPO_ROOT` for the first two tests and `COS_FULL_UPLOAD_LOCAL_FIXTURE_ROOT` for the harness fixture test to the accepted source checkout. No package installation or local database/server/container is required or performed by these tests.

- `tests/parity.mjs`: 45 complete-output/error cases, exact six-component digest comparison, unchanged public camera/catalog/security, fresh subsequent statements, and alternating whole-RPC timings. Its independent PGlite engines do not establish shared native concurrency.
- `tests/review-*.mjs`: 147 independently authored synthetic differential checks covering graph semantics, ordering/error precedence, dependency/key/inheritance/privilege/overload drift, lazy fallback, and existing-role parity. All run under PGlite in dedicated CI steps. Ordering stress cases intentionally vary planner choices or lower work memory inside rolled-back test transactions; hosted performance uses unchanged defaults.
- `tests/package.test.mjs`: exact install/rollback, duplicate execution, injected post-replacement atomic rollback, and catalog/schema/security/public or helper overload drift rejection.
- `harness/`: PostgreSQL 17.6 and PostgREST 14.5 actual hosted proof, two-client READ COMMITTED races, original phase-boundary visibility, actual HTTP equality, and sequential/two/five-client full-RPC workloads. Both widths include nonempty successful continuity. Mean/p95/max and individual samples are retained under unchanged 8-second settings. See its README for exact gates and fixture-only cleanup behavior.

Synthetic hosted checks are required before any production rollout judgment. Local latency reductions are evidence for pursuing the proof, not native capacity estimates or a guarantee against concurrent production timeouts.
