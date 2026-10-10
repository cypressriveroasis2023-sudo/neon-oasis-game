# Legacy mHelp intake adapter: local, inactive proposal

Target: actionable legacy Tech Check `goqrnolcvqnirjmzaeyk`. The SQL is outside the protected migration directory and is not in a deployment runner. No SQL has been applied, no function deployed, and no historical tickets imported by this work.

## Files and verification

- `mhelpIntakeAdapter.ts`: pure normalized-payload preparation; no network/execution.
- `mhelp-intake-proposal.sql`: private receipts/reviewed mappings, constrained service attribution, and one restricted public RPC.
- `mhelp-intake-fixture.mjs`: isolated synthetic database fixtures.
- `tests/mhelp-legacy-intake.test.mjs`: normalizer, SQL, privilege and original-workflow contract tests.
- `../tests/mhelp-intake-assembled.test.mjs`: real proposal/helper SQL plus runtime, lost acknowledgements, private identity projection and backend/UI contract tests.
- `tests/contracts/legacy-workflow-contract.sql`: inspected claim/queue/managed-ticket definitions for local contract tests only. Never deploy this evidence file.

Run from `tech-checks/operations`:

```sh
node --import tsx --test --test-concurrency=1 legacy/tests/mhelp-legacy-intake.test.mjs
npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck legacy/mhelpIntakeAdapter.ts
```

The thin `tests/mhelp-legacy-intake.test.mjs` wrapper runs this coverage in normal `npm test` after integration. Fixtures use one serial WASM engine, rebuilding isolated schemas between tests to avoid repeated-runtime teardown instability. No external database or credential is used.

## Restricted service API

The only new exposed function is `public.camera_mhelp_ticket_intake_v1(p_request jsonb)`. Its explicit EXECUTE grant is solely to existing `service_role`; PUBLIC, anon and authenticated are explicitly revoked. The postgres-owned SECURITY DEFINER wrapper requires the actual SQL `role` setting to be `service_role` and `auth.uid()` to be NULL. Human identity claims are rejected, including active Owners. It does not set any identity/role claim.

All private helpers are SECURITY INVOKER with empty search paths. `cos_mhelp_intake` schema usage, tables and helper execution are revoked from PUBLIC, anon, authenticated and service_role; every private table has RLS. Existing service table rights do not expose this private ledger.

Actions:

- `policy`: no caller parameters; returns fixed enabled portal, activation floor, schema contract/evidence, and aggregate verification flags. No person identities.
- `review_status`: bounded aggregate Owner-review DTO: counts, timing/backoff, and at most 25 held printed ticket numbers with fixed reason codes. No source payload or person identity. Transport must enforce the existing Owner gate.
- `begin`: no caller parameters; invokes the separate scheduler helper.
- `record`: `leaseId` and normalized `ticket`; validates the existing lease, exact portal, strict bounded creation window, then the atomic intake helper.
- `finish`: `leaseId`, `expectedTicketIds`, `total`; separate scheduler helper verifies durable receipts before cursor advancement.
- `fail`: `leaseId`, fixed `code`, `retryable`; separate scheduler helper records bounded backoff.

Install the scheduler proposal from `../intake/mhelp-intake-scheduler-proposal.sql` after this base SQL and before use. Native provider reading and handler wiring are separate. No cron, new secret, network request, vendor write or automatic activation is included here.

## Attribution and ordinary workflow preservation

Production metadata verified `job_assignments.assigned_by` is a NOT NULL UUID referencing `auth.users(id)`; checkpoint actor fields are nullable. A service is not an auth user. This proposal permits NULL `assigned_by` only with fixed `created_from='mhelpdesk_service_intake'` and `assigned_by_name='mHelpDesk automatic intake'`. A CHECK retains the ordinary nonnull actor requirement. An invoker trigger rejects direct service-role marker inserts, requires the postgres-owned restricted service-function context, and makes the created service attribution immutable. It does not block later notes, status, assignee, schedule or lead changes.

No user/auth record is created or impersonated. The private receipt records `actor_kind='service_role'`, NULL `received_by`, received/created timestamps, immutable source snapshot, resulting assignment IDs and review reasons. The existing checkpoint trigger records a NULL actor and its established `System` display fallback. Receipt attribution identifies the service precisely. Keep receipts and audit history permanently for duplicate protection; there is no cleanup/deletion action in this proposal.

Configuration supports a verified real Owner reviewer or explicit `review_actor='approved_service'` with a nonblank approval reference and NULL human reviewer. Never put test UUIDs, assumed Owner IDs or name-based identity guesses into production configuration. Current assigned technicians and IT lead are always checked as real active, unarchived profiles with the exact department.

Inspected `my_available_assignments` and `my_managed_tickets_v1` read assignments without an assigning-user parent join; local tests cover service-attributed rows appearing in Service and IT views. Repository Owner views read assignment rows directly. Inspected Owner override and lead-change functions do not change created actor fields. The push formatter uses `assigned_by_name`, but intake never invokes it. Regenerate/update `tech-checks/supabase/database.types.ts` for nullable assigned_by when integrating the actual schema change; that existing file was deliberately not edited here.

## Transaction and review model

- Empty/missing configuration is disabled. Activation requires reviewed schema evidence, source mappings, provenance, and an explicit UTC start. Canonical UTC source creation timestamps are mandatory. If vendor dates are naive, the upstream normalizer must verify the actual portal timezone; it must not assume one. Before-start tickets are excluded without retaining their payload or creating work.
- The durable key is `(portal_id, immutable ticket_id)`, separate from printed number. Printed references use the same conservative 1–128-character grammar in SQL, the backend DTO and the Owner UI: initial ASCII alphanumeric, followed by alphanumeric or `. _ / -`. Contacts, whitespace, colons and control characters are rejected before retention. Exact canonical JSONB equality uses an immutable normalized snapshot. Raw vendor bodies and unknown envelope fields are never retained. Type mappings, exact status/custom-status classifications, and identity crosswalks are persisted, reviewed, and checked again at write time. Only reviewed open source status pairs create assignments; terminal, unknown or review-classified states remain durable review holds. No source status creates local completion.
- Source advisory lock, the existing bundle ticket-number advisory lock, and short NOWAIT legacy table locks precede history checks and inserts. All first-stage assignments, audit checkpoints and receipt commit together. A second-target error rolls everything back. Existing assignment/prep/return/prior-receipt history requires reconciliation, including completed/cancelled work and missing assignment rows.
- Complete zero-scope Service creates Service only. Explicit equipment/parts adds IT then handoff-gated Service. Install uses delivery. Swap uses IT then Service and the original returned-equipment Intake flow. Pickup creates Service then return-gated IT. No prep, claim, checklist, physical confirmation, inventory move, completion or notification is manufactured.
- Assignment IDs need not cross the source-project boundary. With an explicit assigned source fact, a null target ID is an unresolved projection: SQL resolves only the exact reviewed private crosswalk and active matching-role profile. A supplied nonnull UUID must match. Inserts consume a separate verified target array; the immutable original envelope retains its unresolved source projection. An explicit unassigned fact plus null remains a department queue. Missing IDs, unknown identities and mismatches hold for review.
- Every ticket needs a deliberately verified active IT Ticket Lead for the original managed-ticket view. Only source-explicit unassigned work may use a department queue. Unknown identities, types, source status or source scope produce durable review holds. All nested envelope scalar types are checked before retention, including review receipts; evidence objects and raw nested bodies are rejected without storage.
- Replays return original assignment IDs, before consulting mutable current assignees or statuses. No assignment update occurs, including after claims, completion, cancellation or manual edits. Changed source marks `review_required=true` while retaining created state/IDs. Review queries/index use `review_required`, including changed-source holds for created work. Same held source can proceed after verified mapping repair; changed source requires explicit reconciliation.

## Notification proof

Narrow read-only metadata on 2026-10-10 verified the legacy types/defaults/CHECKs and three assignment triggers: retired Solar Pole validation; audit checkpoint after insert/update/delete; Service notification only after UPDATE of assignee_user_id. The adapter performs assignment INSERTs only. The captured checkpoint function only reads the actor and inserts an audit row. A bounded pg_trigger/pg_proc query at 05:07 UTC found zero noninternal triggers on workflow_checkpoints. The inspected INSERT path therefore ends at local audit storage without outgoing notification/network calls. Recheck if production trigger definitions change. New service-actor guard performs validation only.

## Rollback and remaining activation gates

Rollback means disable portal_config.enabled and stop scheduling new work. Do not delete receipts, mappings, checkpoints or created assignments. Do not restore the old assigned_by NOT NULL constraint while legitimate service-attributed rows exist. Retain the constrained attribution schema and private ledger, and roll back application behavior without removing user work.

Remaining gates: verified live source semantics/equipment/schedule timezone; exact type/person/lead mappings; real schema/trigger drift checks; database advisors; combined scheduler/handler tests; review visibility; actual authorized deployment. No source adapter should be activated by placeholder assertions.

The migration runs atomically with a 2-second lock timeout and 30-second per-statement timeout; a busy metadata lock or slow constraint validation rolls back all changes. It requires the verified postgres deployment owner. The public RPC has a 2-second lock timeout. History-table locks use NOWAIT, so an occupied table aborts intake with 55P03 instead of waiting in an opposing human-workflow lock order. Classify that as retryable WRITE_UNAVAILABLE.

PGlite proves rollback, privilege behavior, routes and queued replay, not true multi-session contention. Before activation, test real PostgreSQL concurrency and table-lock latency, bound transaction time, and retry entire aborted transactions by receipt key. Uncontended table locks briefly serialize maximum-two-row intake against legacy writers; do not hold those locks across provider/network work.
