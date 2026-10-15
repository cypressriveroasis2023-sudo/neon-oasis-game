# Synthetic camera placement receipt proof

This harness tests the additive service-only camera projection using disposable GitHub-hosted PostgreSQL17.6 and PostgREST14.5. It generates its records from existing public fixtures. It contains no customer export, production endpoint, production credential or private bundled runtime.

The original two-argument placement RPC remains unchanged. The three-argument overload accepts only `p_projection: 'camera'`, retaining all actor/permission checks, guarded items and status while omitting the unrelated upload subtree. The application switches only its two camera receipt reads; full map/roster readers retain the original RPC.

## Execution boundary

`PREPARE-ONLY.json` is closed in the prepared package. A maintainer records the scoped repair/test authorization after final review. This flag is a safety switch and does not independently grant permission. Publication and scoped synthetic testing do not authorize production exposure, grants or deployment.

The workflow supports path-scoped `pull_request` and `workflow_dispatch` only. Its gate runs before service creation. Runtime guards require GitHub-hosted execution, the exact dedicated synthetic database/API/secret and frozen SQL hashes. Local/self-hosted execution, arbitrary endpoints and HTTP redirects are rejected.

Fixed services:
- PostgreSQL: `127.0.0.1:55432`, database `cos_camera_receipt_test_ci`
- PostgREST: `127.0.0.1:53000`
- Official images: `postgres:17.6`, `postgrest/postgrest:v14.5`
- Node24; existing locked `pg`8.16.3 and `tsx` dependencies

Actual binary versions, image digests and ICU details are recorded. Session assertions require READ COMMITTED,8-second statement/lock limits,2184kB work_mem and the default planner, including a service-role-only HTTP settings probe. The authenticator has no superuser/bypass-RLS access; JWT roles are NOLOGIN. No broad table grants are added.

## Eight proof groups

1. Exact baseline/catalog preservation; unexpected default EXECUTE grants, metadata drift and post-CREATE failures reject atomically; concurrent installers yield one successful transaction; duplicate installation safely rejects; rollback is exact.
2. Actual JWT role dispatch, unsigned/invalid JWT rejection, service-only RPC access and private-table/helper denial. Actor/permission failures are injected to prove identical propagation.
3. Actual HTTP two-key/full versus three-key/camera routing, reordered/missing/extra/invalid parameters, no default ambiguity, schema-cache reload and old-route continuity.
4. Generated434-link exact status/items equality, consumed status/link errors and intentional removal of unrelated malformed/upload-function failures.
5. Independent readers/writer test uncommitted, rolled-back and committed Owner/native/source/link changes. The actual public SHOP consumer uses first/fresh-second SQL receipts for a generated identity and vetoes a committed guard change.
6. A separate-session barrier demonstrates identical old-link/new-status READ COMMITTED observations. No cross-statement atomicity or ABA claim is made.
7. Concurrent two-full/two-camera dependency workload; consumed versus unrelated upload-table locks at8s; an active HTTP query is observed blocked before client abort, followed by an independent unchanged read.
8. Exact SQL rollback/cache removal and existing-route continuity; executed GitHub revision/head/base are recorded separately from the accepted baseline.

`hosted-results.json` uses `passed` only for this implemented synthetic subset and always records `releaseApproved:false` and `completeReleaseGatePassed:false`. Server-side cancellation timing after disconnect, exact±1ms freshness/deadline sweeps, actual Edge deployment/in-flight application rollback and complete production field-map latency are not claimed. Existing Edge authentication is supported separately by byte preservation and actual-handler authorization regressions; this harness does not impersonate production users.

## Inputs and invocation

Accepted reference main: `6bf7f1b12dbdadd54624ec424ce59a6cba4e9ce6`; tree `6e71bd54065134720dabfcb1168654adf9e61f26`.

The harness imports public `tests/fixtures/placement-label-index.mjs`, its fixture/SQL chain, `camera-tracker-shop-fixtures.mjs`, and the actual `cameraTrackerShopScope.ts` dependency chain. Existing package lockfiles supply all dependencies. Bootstrap asserts the old function definition hash before any candidate installation.

Frozen install SHA256: `7bb17684835bee2b80b9b735876358a64fe46dbf604256f4cfdbd606b219f0a6`.
Frozen rollback SHA256: `c156c4deeaa3b175440f9b689002511958f22c984303226a8074459a3130f438`.
Expected full-function SHA256: `95a859becc87439d9fd5ab66ed238644b73193ce9fea1d25d15f594bb17d7de9`.

The workflow bootstraps the empty fixture before starting PostgREST; the runner tests the old HTTP route before installing the overload. It invokes `node --import tsx tests/hosted-camera-receipt-proof/hosted-runner.mjs` from `tech-checks/operations`. Results contain generated data only and are collected under `results/`; database clients close even when report writing fails.
