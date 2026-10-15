# Full-upload hosted synthetic proof harness

Prepared source for the approved generic synthetic CI scope. No hosted run, publication, production read, production write, dependency installation, local PostgreSQL/Docker server, or browser run was performed while preparing this directory. The included authorization marker records the lead's scoped synthetic-CI authority; it does not authorize production installation.

## Integration layout

Integrate the package root as `tech-checks/operations/tests/hosted-full-upload-proof/`, retaining this `harness/` subdirectory and the parent-supplied `build-package.mjs` and `db/` source files. Copy `cos-full-upload-hosted-proof.yml` to `.github/workflows/cos-full-upload-hosted-proof.yml` only through the lead's reviewed publication flow. The workflow is runnable in that approved scope, with no intentionally disabled CI placeholder.

Accepted source provenance supplied by the lead: main commit `8c21cac1`, tree `d71e404df6029f5ebe47865c9fb4ec18691ae4c2`. This historical baseline is recorded separately from the tested GitHub checkout SHA, PR head SHA, and PR base SHA. The workflow checks out and verifies the exact PR head (or manual event SHA), rather than treating an unverified merge-ref checkout as head evidence.

The existing camera-receipt harness and generated fixture are reused from the accepted source checkout. Official `postgres:17.6` and `postgrest/postgrest:v14.5` images are used. The binary check is exactly `docker run ... postgrest/postgrest:v14.5 /bin/postgrest --version`; the image has no default entrypoint that could safely accept `--version` alone. Image digests and actual versions are preserved as run evidence.

The only connection targets are the inherited fixed disposable endpoints:

- PostgreSQL: `postgresql://postgres:synthetic-ci-only@127.0.0.1:55432/cos_camera_receipt_test_ci`
- PostgREST: `http://127.0.0.1:53000`
- Public synthetic JWT secret: `synthetic-camera-receipt-proof-only-20261014`
- Public synthetic authenticator credential: `synthetic-authenticator-ci-only`

These values are fixture constants, not account credentials. Custom endpoint/secret overrides fail closed. Connections require `CI=true`, `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, a path-scoped pull-request or explicit manual event, the scoped authorization marker, and the execution opt-in. No GitHub secrets, write-scoped token, user data, production connection, or application production handler is used.

## Exact-package contract

The workflow explicitly runs the nested package, parity, adversarial, ordering, runtime-drift and permissions PGlite suites before native bootstrap. Their synthetic result JSON and logs are retained separately under `results/offline/`. Native bootstrap then regenerates the native-specific package, so a PGlite-generated installer can never silently become the native installer.

1. Bootstrap refuses a prepopulated application database or existing application roles, verifies PostgreSQL 17.6 and ICU `en-US`, and creates only generated fixture rows.
2. It loads the accepted label-index and camera-overload setup. The unchanged public definitions must have these exact SHA256 fingerprints:
   - Two arguments: `95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9`
   - Three arguments: `c14b0f888d51cbeb6f322cd80df3317caafc16357812c4ee676e4111b36660dd`
3. The parent-provided `prepareGuardedPackage(client, {packageDir, repoRoot})` reads this trusted synthetic catalog and writes `install.sql`, `rollback.sql`, and `manifest.json` at the package root. It does not execute candidate DDL to discover the expected fingerprint.
4. The runner verifies the manifest's exact source, installer and rollback file hashes, freezes the loaded manifest and bytes, and applies only those exact guarded installer/rollback bytes for every baseline/candidate switch. It never substitutes a bare candidate definition for the installed optimization.
5. Every switch checks the exact target definition, both public signatures, all non-body function catalog fields/OIDs/ACLs, all other function bodies, table/column security, schema ACLs, roles, relation ACLs, triggers and indexes. Only `cos_mhelp_placement_private.upload_snapshot()` may change.
6. Installer cases include catalog/helper drift rejection, injected pre-COMMIT failure with atomic rollback, idempotent re-entry, concurrent installers, and exact rollback. A racing second installer may safely reject its maintenance lock or observe the exact idempotent target.

Native synthetic installation fingerprints are generated against that run's exact fixture metadata. They are not production fingerprints. Production installation remains held for exact-head hosted/full checks and a fresh separately authorized catalog/root gate.

## Coverage prepared for the hosted runner

- Complete SQL JSON text equality, including every returned field, array position and binding flag. Errors compare SQLSTATE, message, detail and hint. PostgreSQL internal stack/context text is diagnostic, not part of the externally defined error contract.
- Actual PostgREST HTTP status and complete JSON response text/body equality across baseline/candidate, successful and error cases. No mock HTTP or imitation of a PostgREST wrapper.
- Both named public overloads, invalid selectors/named dispatch, wrong organization, denied anon/authenticated roles, malformed/unsigned JWTs, actor and permission failure, status failure, private-helper/table access denial, and unchanged camera output.
- Native/tracker/SHOP/source changes and deletions, source graph OR overlap, native-only/null identities, source/archive overlap, duplicate Owner history and claims, malformed UUID/sourceRow/array inputs, missing/null bindings, opaque fields and redaction.
- Runtime dependency drift by helper result changes, helper errors and newly defaulted overloads of each pinned helper. The graph-helper overload case recreates the unchanged continuity helper with transaction-local body checks off/on to force a fresh SQL parse; baseline and candidate must both return SQLSTATE `42725`, so a cached helper plan cannot hide ambiguity. Cleanup removes the overload, restores the exact helper definition and verifies session settings. The exact installed candidate must produce the baseline result/error through its lazy fallback. A transactionally added full-row field and alternate caller time zone are compared through SQL; the DDL is rolled back without leaving catalog residue.
- Eight real READ COMMITTED writer/reader cases: native change, new history, new Owner claim, changed source, new source, SHOP tombstone, new archive, and active-upload pointer switch. Two independent SQL clients plus actual HTTP reads verify uncommitted invisibility, rollback invisibility, and a fresh committed result. Baseline/candidate complete stage outcomes must match.
- In-call commit and rollback races pause both independent readers inside the original first link-guard statement using a synthetic advisory barrier. The link-guard hook is outside the candidate's pinned upload-helper fast-path dependencies. The exact diagnostic gate expression is verified against the frozen candidate and asserted true during benchmarks and this hook. The first public statement keeps its old snapshot; the later upload statement must observe committed fresh graph/upload evidence. Exact original definitions and all temporary hook functions are restored after each case.
- Nonempty successful continuity: 64 generated append-only rows, 32 identities, two matching heads each, with graph changes between heads. The latest matching head must keep the bindings current. Wrong payload/original guard and later source/Owner changes must retain baseline behavior. These rows are direct synthetic continuity fixtures; successful production admission writes are not claimed.
- Reduced-width and wider generated records/graphs. Wider payloads use existing columns plus ordinary opaque JSON fields, three history/claim rows per native,64 archive rows with overlapping endpoints, and the same 64-row successful continuity chain. Source/payload byte sizes are recorded; no production row-width estimate is claimed.
- Six alternating paired rounds at each width: one full SQL RPC, one actual HTTP RPC, two independent full SQL clients, two concurrent actual HTTP requests, five independent full SQL clients, and five concurrent actual HTTP requests. All results remain exactly equal. Warm-up and installer time are excluded.
- Mean, p95, max, individual samples and paired-round wins for each workload. The prepared gate requires at least 10% mean reduction and 4/6 paired wins for every SQL/HTTP sequential/two-client/five-client workload at both widths. It also rejects a candidate p95 or max regression over 10%, and no successful measured call may reach 8 seconds. Failed material improvement is a failed proof, not a rollout recommendation.
- Whole public RPC `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plus the exact installed upload function body plan, for both modes and widths, including planning/execution/buffer/temp evidence.
- Actual simultaneous full-RPC HTTP requests blocked on upload tables must honor the unchanged 8-second lock/statement limit; the existing camera overload must remain successful.

Every SQL client and actual PostgREST role session uses `statement_timeout=8s`, `lock_timeout=8s`, `work_mem=2184kB`, READ COMMITTED, and default planner settings. The guarded maintenance transaction may use its own shorter local lock timeout; the session is checked again after each installer/rollback. No timeout is increased. No planner forcing, cache, new RPC exposure, table grant, broad function EXECUTE grant, or RLS bypass is added by the optimization/harness. The synthetic runtime-settings probe receives only a specific service-role EXECUTE grant.

Fixture restoration is the only place `session_replication_role=replica` is used, within a rollback-safe administrator transaction in the disposable database. This restores generated rows and sequence state exactly after a case. Every tested writer mutation and RPC runs with triggers enabled (`origin`). The shared restore implementation itself has a bounded PGlite regression check.

## Files and verification status

- `bootstrap.mjs`, `bootstrap-roles.sql`: inert import, strict execution gate, trusted fixture/camera bootstrap, exact package builder hook, synthetic roles/settings.
- `hosted-runner.mjs`: native SQL/HTTP, catalog/security, equality, races, timing and rollback checks.
- `fixture-state.mjs`: shared exact generated-data checkpoint/restore.
- `workload-fixtures.mjs`: shared width and successful continuity fixtures.
- `overload-fixture.mjs`: shared transactional fresh-parse overload fixture and exact cleanup.
- `cos-full-upload-hosted-proof.yml`: approved-scope hosted workflow source, with dedicated service and minimal read-only Actions permissions.
- `static-check.mjs`: Node-only syntax, fixed endpoint and workflow safety checks.
- `local-fixture-check.mjs`: optional in-memory PGlite smoke checks using an already installed dependency. Does not start a server, container, browser or HTTP listener.
- `static-check-results.json`, `local-check-results.json`, `local-check.log`: preparation evidence, clearly labeled local-only. The candidate SHA is taken from actual bytes, not an obsolete prototype hash.

Offline verification:

```
node harness/static-check.mjs
COS_FULL_UPLOAD_LOCAL_FIXTURE_ROOT=/absolute/path/to/accepted/source-checkout node harness/local-fixture-check.mjs
```

The local smoke checks verify exact fixture restore, guarded install/rollback/idempotence, new source insertion, duplicate claims, SHOP triggers, transactional schema drift, and shared wide fixture/continuity equality. They do not establish shared native MVCC, PostgREST behavior, hosted latency, image startup or CI success.

Hosted artifacts are written only to `harness/results/` and retained for seven days. The bootstrap report, frozen manifest, run summary, plans and image metadata are synthetic-only. The final report retains `releaseApproved=false`; the runner is not a production rollout authorization mechanism.
