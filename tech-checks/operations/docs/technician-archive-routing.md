# Technician archive destinations

This is a review candidate for the existing `techcheck-transfer-delivery` and
`service-daily-delivery` workers. It has not been deployed or used to create,
move, copy, share or email any production record. Installing its privileged SQL
and enabling its routing gate require approval. The gate starts disabled.

## Scope and exact destinations

New original packages use the saved source actor and original Central submission
date. A mutable display name, the current operator and the delivery retry date
cannot choose the destination. An Owner/IT purpose amendment uses the technician
from its immutable original checkout, verified by the original event ID and same
transfer. Its actual applying actor stays on the event, report and routing
context. No Owner folder is guessed or created, and a missing or unmapped
original technician blocks filing.

| Existing source worker | Canonical destination for a new package |
| --- | --- |
| `techcheck-transfer-delivery` | Technicians → source event technician → `YYYY-MM-DD` in America/Chicago → Equipment Transfers → existing per-event package format |
| `service-daily-delivery` | Technicians → saved Service technician → `YYYY-MM-DD` in America/Chicago → Truck Inspections → existing per-report package format |

The canonical root is **Technicians**, ID
`1Ea2F0rQAhx9emvHaqFu4fRIRnYVBYfGH`. Both the server registry and worker allowlist
must agree on the independently verified technician bindings:

| Exact folder name | Existing folder ID |
| --- | --- |
| Teddy Hopper | `1Im1trPgcC4NIw9eTfaobWTRSpNPlfgvt` |
| Victor Garcia | `1xa5s67_JsQWG5A9XG-6ZHlb1oyVEK4Lm` |
| Josh Mireles | `1gzBr-u6Xd6i19I7PE0rnB_47Ipi8IWWz` |
| Abel Cervantes | `1NGanUoAXTVAZDPuHGE-pz6Xt6kkuanU6` |

The SQL binds these folders to exact profile UUIDs. Unknown technicians block
until their binding is independently verified and approved; the worker never
guesses by profile name. Date and category folders are actual Drive folders.
There are no navigation Docs and no changes to sharing.

This change does not add an IT Checks or ticket-free report producer. Those
records need a separately verified delivery path before anyone can claim their
ongoing filing is connected. It does not change equipment custody, receipts,
truck inventory, returns, original signatures, answers or photo bytes.

The correction archive worker remains unchanged. A correction belongs inside
the original package identified by its trusted, completed original delivery
manifest, even if that package predates the canonical hierarchy. It must not be
relocated under the correction date.

## Resume and duplicate prevention

`_shared/technicianArchive.ts` first examines an existing package ID in the
source's delivery manifest. If the folder exists, it verifies the exact ID,
folder type, untrashed state, source event/report marker and single current
parent. It resumes that ID in its current parent. It does not require the former
shared root or move an Owner-organized package. It records the observed parent
in `folder.readback_parent_id` without replacing the saved original ID.

A missing folder marked `done: true` blocks for review. It is never silently
recreated. An ID reserved before the folder was created retains that exact ID;
its canonical destination is pinned before the existing package creator runs.
An already saved routing decision cannot be replaced on retry.

For a new package, the worker gets a service-only routing context bound to the
current source queue lease. It verifies the exact root and technician metadata,
then resolves the date and category:

1. An exact name/parent query must return zero or one untrashed folder. Multiple
   exact matches block for review. A descriptive package such as
   `Equipment Transfers - Teddy to Josh - a314aad4` is not the category folder
   named exactly `Equipment Transfers`.
2. A unique existing folder is adopted by ID. Otherwise the worker requests a
   provider-generated ID. The SQL registry stores the candidate before any
   folder create. Its canonical winner is returned to every concurrent job.
3. The worker creates only the returned ID and verifies the exact name, parent,
   type and, for a newly generated folder, its actor/date/category markers.
   A lost create acknowledgement or HTTP 409 is resolved by that exact readback.
4. An adopted folder that later disappears is never replaced. A different
   same-name folder or a changed parent blocks, including when a reserved folder
   has not yet been created. A registry reservation cannot be rewritten or
   deleted through the worker.
5. The worker checkpoints the full `archive_destination` decision before the
   existing original package creation. Per-package generated file IDs and
   email states keep their existing retry protections.

The registry's date key is shared by transfer and daily jobs for the same actor
and Central date. Its category key distinguishes Equipment Transfers from Truck
Inspections. Concurrent jobs converge on the same canonical folder IDs.

An already sent email remains sent with the same email ID. Uncertain sends stay
in review. Routing neither resets completed jobs nor requeues old packages.

## SQL contract and release approvals

Review candidate: `database-maintenance/techcheck-archive-routing-v1.sql`.

`public.techcheck_archive_destination_v1(p_action, p_source, p_id, p_lease,
p_data)` is executable only by `service_role`. The private function uses a fixed
empty search path and checks that JWT role itself. It validates the current
processing source row and unexpired lease, derives the actor and original
Central date from saved records, and rejects client-supplied actors or paths.

- `context` returns version, source ID, canonical actor/date/category, root and
  technician metadata, and nullable canonical date/category slots.
- `reserve` accepts only `kind`, `candidate_id`, `parent_id` and `adopted`. It
  returns the immutable winning `{id, parent_id, name, adopted}` slot. It cannot
  replace a prior ID or its adoption flag.
- With the gate disabled, a valid context reports `enabled: false`; a new
  package blocks. The existing verified-package resume path remains available.
- A missing mapping reports `mapping_required`. There is no fallback to the
  former shared root.

Approval must cover the three private tables, immutable-registry trigger,
service-only definer/wrapper RPC, exact verified profile/folder seed bindings,
redeployment of the two existing workers with this shared module, and explicit
activation of `app_private.techcheck_archive_routing_settings.enabled`.
The script itself leaves the setting false. The correction feature's separate
readiness gates are unaffected.

Existing workers retain their current credentials:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
`TECHCHECK_GOOGLE_CLIENT_ID`, `TECHCHECK_GOOGLE_CLIENT_SECRET` and
`TECHCHECK_GOOGLE_REFRESH_TOKEN`. They continue to require the verified
Operations Manager Google account and their existing authenticated user/cron
entry paths. No new recipient, scope, secret or cron schedule is added here.
The existing schedules will use the revised workers after an approved deploy;
this patch must not be described as a separate automation.

Install the approved SQL before deploying the workers, and keep gate activation
coordinated with their deployment. New packages intentionally block while the
gate is false; deploying the workers without their RPC also prevents new filing.
Do not reset or requeue completed jobs to demonstrate the change.

The transfer worker's cron-authenticated `{"action":"check_connection"}` probe
now verifies the Google account, exact Technicians root and all four mapped
folders with read-only metadata requests. It never claims a job, reserves an ID,
creates a file or sends email. Its successful response includes
`archive_root_id` and `technician_folders_verified: 4`. This probe does not enable
the gate or prove a complete archive delivery.

Production completion still requires approved deployment IDs/source hashes,
saved queue/manifest readback for an approved non-disputed submission, exact
folder/file IDs and parent hierarchy, and email status/ID readback without an
uncertain or duplicate send. Passing local tests alone is not that evidence.

## Local verification

From `tech-checks/operations`, use Node 22 with test isolation disabled in this
environment so individual tests actually execute:

```sh
node --import tsx --test --experimental-test-isolation=none \
  tests/transfer-archive-routing.test.mjs \
  tests/transfer-delivery.test.mjs \
  tests/service-daily-delivery.test.mjs
```

The focused routing suite has 15 named tests; the two original suites add 15.
All provider operations use synthetic in-memory mocks. The cases cover saved
identity/date, duplicate/unknown destinations, authorization/lease rejection,
exact parent checks, adopted folders, concurrent reservations, lost create
acknowledgements, moved originals, missing completed originals, pinned retries,
read-only connection probing and preservation of existing sent email IDs.

Strict TypeScript checks the shared resolver and both original worker modules:

```sh
node ./node_modules/typescript/bin/tsc --noEmit \
  --allowImportingTsExtensions --module esnext --moduleResolution bundler \
  --target es2022 --lib es2022,dom --strict --skipLibCheck \
  ../supabase/functions/_shared/technicianArchive.ts \
  ../supabase/functions/techcheck-transfer-delivery/index.ts \
  ../supabase/functions/service-daily-delivery/index.ts
```

This uses the repository's TypeScript 5.7.3 and Web API types. It does not check
the Deno bootstraps or prove deployed Google permissions. The independent
`transfer-archive-routing-sql.test.mjs` suite checks the actual SQL, source role
and lease enforcement, immutable bindings and overlapping PostgreSQL
transactions. Its PostgreSQL-required gate must pass with the same release
candidate; an optional skipped concurrency case is not release evidence.
