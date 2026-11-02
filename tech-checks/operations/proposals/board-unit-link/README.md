# Board to exact unit: inactive integration candidate

Prepared November 2, 2026, on the existing approved design branch. Base inspected: `9a7b0381734527fed4a98188a6c10b14403e4bd7`. No release.

## What is implemented

- A bounded, parameterized, read-only assignment query using the existing `jobs -> equipment_assignments -> equipment_units` foreign-key relationship. It returns every active primary assignment rather than guessing the latest one.
- A pure server-side resolver requiring one saved assignment, same-organization native equipment, and current, already-validated Fleet projection evidence with an exact `reviewed_product_id` binding.
- A candidate route adapter using the existing `workspaceHash` and exact native unit UUID. Missing or inconsistent evidence produces no link. No label, IP, customer, site, or job-number matching is performed.
- Completed visits explicitly resolve the CURRENT job assignment, not historical visit equipment. Tasks use only their explicit saved related job.
- Additive Board metadata without mutation of original notes, work states, readiness, camera evidence, or timestamps.

## This is not enabled in the application

These files live under `proposals`, are not imported by the Board, backend router, or publisher, and do not change the compiled application. The SQL is a SELECT, not a migration or installed function. There is no new RPC, grant, table, scheduler, network request, or operational write. No existing source, workflow, lockfile, dist, auth, permissions, camera, inventory, or deployment configuration is changed by this candidate.

The native Board still shows Unit not linked. This preparation does NOT claim that a working live Board-to-unit button has been released or even mounted in the application.

## Verified source gap

A read-only query against the native COS project at **2026-11-02 19:50:00.506583 UTC / 1:50 PM Central** returned **2 native Board jobs and 0 active primary equipment assignments** in the configured COS organization. These are native Board database counts, NOT the count of service jobs in mHelp, technicians, equipment, or cameras.

Installed `appdeploy_owner_jobs_snapshot` exposes `equipmentUnitTag` from the saved primary assignment but no authoritative unit UUID/Product ID. Installed `cos_daily_board_snapshot` inherits that shape. Its completed-visit rows refer to the current job snapshot, not an independently established historical equipment assignment.

The inspected existing `mhelpUploadPlacement.ts` projection (blob `874d531039965df4fb9ac9d818a0f246eb1e6605`) exposes Product ID, binding state, represented unit IDs, hold reason, match method, applied-overlay status, and original source evidence. The candidate consumes that already-validated projection; it does not recreate or weaken its guards. Name-only and alias-derived match methods remain unlinked under this deliberately strict candidate.

## Integration prerequisites

1. Recover/reconcile the active camera repair's actual deployed backend source. Do not copy an older index or bundle over it.
2. Establish the real saved native-job-to-equipment relationship through the existing authorized mHelp/assignment integration. Do not create a competing job system, new job, or fabricated assignment to make this link work.
3. After the EXISTING Board membership and job-view permission checks, obtain the bounded assignment facts and existing authorized Fleet identity projection in the same tenant. Reuse the existing read/freshness decisions; this candidate does not add polling, an expiry timer, or a new Fleet read on every Board refresh.
4. Add the metadata to the existing response and render its route only after source-unavailable and record-context checks. Label completed-visit navigation as current job equipment, not historical equipment. Use Open unit, not an assertion that every linked record is a camera.
5. Verify the real Board -> exact unit -> existing location/history flow, repair overlap and live-role acceptance. James's separate combined-release approval is still required.

`readAssignments.sql` intentionally does not declare `readState`. The existing trusted caller must supply its availability/freshness decision. Resolver input is SERVER-INTERNAL evidence, never browser-supplied proof. UUID syntax or a contract string is not authorization. Keep existing source, permission and identity checks in front of these helpers.

## Executed checks and limitations

Local Node **22.16.0**, repository-pinned TypeScript **5.7.3**, tsx **4.19.2**, and PGlite **0.5.8**:

```
node --import tsx --test proposals/board-unit-link/*.test.mjs
# 94 passed; 0 failed; 0 skipped; 0 cancelled

node node_modules/typescript/bin/tsc --noEmit --strict --target es2022 \
  --module esnext --moduleResolution bundler --skipLibCheck \
  proposals/board-unit-link/resolveBoardUnitLink.ts \
  proposals/board-unit-link/boardUnitHref.ts
# Passed
```

The 94 tests comprise 67 resolver tests, 17 actual isolated SQL tests, and 10 existing-route adapter tests. They cover duplicates, scope/tenant mismatches, missing assignments, contradictory release state, retired/deleted equipment, stale/unavailable inputs, held/name-only Product bindings, source mismatches, completed-visit context, exact route round-trip, query bounds and no source mutation. The SQL tables/data exist only inside local PGlite.

This is NOT a full-application build, hosted CI pass, browser walkthrough, current production-identity proof, or global-regression result. Existing application source was not modified, so no replacement build is attached. Earlier tests from other heads are not counted here. No production schema/data was written and no deployment was requested.
