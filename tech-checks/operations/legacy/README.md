# Legacy mHelp intake adapter: local, inactive proposal

Target: actionable legacy Tech Check `goqrnolcvqnirjmzaeyk`. The SQL is outside the protected migration directory and is not in a deployment runner. No SQL has been applied, no function deployed, and no historical tickets imported by this work.

## Files and verification

- `mhelpIntakeAdapter.ts`: pure normalized-payload preparation; no network/execution.
- `mhelp-intake-proposal.sql`: private receipts/reviewed mappings, constrained service attribution, and one restricted public RPC.
- `mhelp-local-lead-upgrade-proposal.sql`: disabled-only forward upgrade for a private reviewed local IT Ticket Lead; no configuration rows or public grants.
- `../tests/mhelp-local-lead-policy.test.mjs`: local policy, provenance, contradictory-source, replay, ACL and forward-upgrade tests.
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
- `fail`: `leaseId`, fixed `code`, `retryable`, optional `retryAfterSeconds`; separate scheduler helper records backoff. Provider seconds must be a JSON integer from 0 through 86400 (omission means 0); strings, null, fractions and out-of-range values reject before changing lease state. The persisted delay is the greater of existing exponential/permanent backoff and the provider minimum. The private four-argument helper remains fully revoked.

Install the scheduler proposal from `../intake/mhelp-intake-scheduler-proposal.sql` after this base SQL and before use. Native provider reading and handler wiring are separate. No cron, new secret, network request, vendor write or automatic activation is included here.

## Attribution and ordinary workflow preservation

Production metadata verified `job_assignments.assigned_by` is a NOT NULL UUID referencing `auth.users(id)`; checkpoint actor fields are nullable. A service is not an auth user. This proposal permits NULL `assigned_by` only with fixed `created_from='mhelpdesk_service_intake'` and `assigned_by_name='mHelpDesk automatic intake'`. A CHECK retains the ordinary nonnull actor requirement. An invoker trigger rejects direct service-role marker inserts, requires the postgres-owned restricted service-function context, and makes the created service attribution immutable. It does not block later notes, status, assignee, schedule or lead changes.

No user/auth record is created or impersonated. The private receipt records `actor_kind='service_role'`, NULL `received_by`, received/created timestamps, immutable source snapshot, resulting assignment IDs and review reasons. The existing checkpoint trigger records a NULL actor and its established `System` display fallback. Receipt attribution identifies the service precisely. Keep receipts and audit history permanently for duplicate protection; there is no cleanup/deletion action in this proposal.

Configuration supports a verified real Owner reviewer or explicit `review_actor='approved_service'` with a nonblank approval reference and NULL human reviewer. Never put test UUIDs, assumed Owner IDs or name-based identity guesses into production configuration. Current assigned technicians and IT lead are always checked as real active, unarchived profiles with the exact department.

Inspected `my_available_assignments` and `my_managed_tickets_v1` read assignments without an assigning-user parent join; local tests cover service-attributed rows appearing in Service and IT views. Repository Owner views read assignment rows directly. Inspected Owner override and lead-change functions do not change created actor fields. The push formatter uses `assigned_by_name`, but intake never invokes it. The prepared `tech-checks/supabase/database.types.ts` change reflects nullable assigned_by in the affected assignment row/insert/update and queue result types; deploy those types together with the actual schema change.

## Transaction and review model

- Empty/missing configuration is disabled. Activation requires reviewed schema evidence, source mappings, provenance, and an explicit UTC start. Canonical UTC source creation timestamps are mandatory. If vendor dates are naive, the upstream normalizer must verify the actual portal timezone; it must not assume one. Before-start tickets are excluded without retaining their payload or creating work.
- The durable key is `(portal_id, immutable ticket_id)`, separate from printed number. Printed references use the same conservative 1–128-character grammar in SQL, the backend DTO and the Owner UI: initial ASCII alphanumeric, followed by alphanumeric or `. _ / -`. Contacts, whitespace, colons and control characters are rejected before retention. Exact canonical JSONB equality uses an immutable normalized snapshot. Raw vendor bodies and unknown envelope fields are never retained. Type mappings, exact status/custom-status classifications, and identity crosswalks are persisted, reviewed, and checked again at write time. Only reviewed open source status pairs create assignments; terminal, unknown or review-classified states remain durable review holds. No source status creates local completion.
- Source advisory lock, the existing bundle ticket-number advisory lock, and short NOWAIT legacy table locks precede history checks and inserts. All first-stage assignments, audit checkpoints and receipt commit together. A second-target error rolls everything back. Existing assignment/prep/return/prior-receipt history requires reconciliation, including completed/cancelled work and missing assignment rows.
- Complete zero-scope Service creates Service only. Explicit equipment/parts adds IT then handoff-gated Service. Install uses delivery. Swap uses IT then Service and the original returned-equipment Intake flow. Pickup creates Service then return-gated IT. No prep, claim, checklist, physical confirmation, inventory move, completion or notification is manufactured.
- Assignment IDs need not cross the source-project boundary. With an explicit assigned source fact, a null target ID is an unresolved projection: SQL resolves only the exact reviewed private crosswalk and active matching-role profile. A supplied nonnull UUID must match. Inserts consume a separate verified target array; the immutable original envelope retains its unresolved source projection. An explicit unassigned fact plus null remains a department queue. Missing IDs, unknown identities and mismatches hold for review.
- Every ticket needs a deliberately verified active IT Ticket Lead for the original managed-ticket view. Only source-explicit unassigned work may use a department queue. Unknown identities, types, source status or source scope produce durable review holds. All nested envelope scalar types are checked before retention, including review receipts; evidence objects and raw nested bodies are rejected without storage.
- Replays return original assignment IDs, before consulting mutable current assignees or statuses. No assignment update occurs, including after claims, completion, cancellation or manual edits. Changed source marks `review_required=true` while retaining created state/IDs. Review queries/index use `review_required`, including changed-source holds for created work. An unchanged held envelope can proceed after verified private mapping/status repair only if it is read again within the bounded source scope; there is no automatic old-hold reprocessing. Explicit `request:null` normalizes only the local validation view and persists as a durable unresolved receipt. Later enriched projections, including adding a request after new type evidence, require explicit reconciliation; the original snapshot is never rewritten. A source-change hold remains latched even if the original envelope reappears and private mappings become valid.

## Canonical unresolved source envelope

A verified source adapter must retain every in-scope ticket even when operational
facts are unknown. The smallest durable hold has only the verified identifiers,
printed reference and UTC creation instant, plus the exact registered contract:

```json
{
  "contract": "cos-mhelp-legacy-intake-v1",
  "schemaContract": "the-actually-verified-schema-contract",
  "source": {
    "portalId": "17",
    "ticketId": "42",
    "ticketNumber": "WO-000042",
    "createdAt": "2026-10-10T06:00:00.000Z"
  },
  "request": null
}
```

Those values illustrate the shape, not production mappings or permission to
activate. Portal, source key, printed reference and createdAt are mandatory and
must come from verified source facts. Unknown optional typeId, statusId,
assignment, ticketLead, sourceEvidence and departmentAssignments must be omitted,
not filled with JSON null containers, placeholder strings or guessed values.
An explicit JSON-null typeId/statusId or container still rejects before retention;
only request:null has the narrow local validation normalization. customStatusId:null
has a separate established meaning and is allowed only when the source explicitly
confirms no custom status, not when its value is unknown.

The minimal envelope persists a review receipt and creates no assignments or
checkpoints. It participates in the complete batch manifest; the cursor cannot
advance until that receipt exists. A later enriched projection still requires
explicit reconciliation. This contract deliberately does not normalize arbitrary
nulls, scalars, arrays or unrecognized nested source bodies.

## Notification proof

Narrow read-only metadata on 2026-10-10 verified the legacy types/defaults/CHECKs and three assignment triggers: retired Solar Pole validation; audit checkpoint after insert/update/delete; Service notification only after UPDATE of assignee_user_id. The adapter performs assignment INSERTs only. The captured checkpoint function only reads the actor and inserts an audit row. A bounded pg_trigger/pg_proc query at 05:07 UTC found zero noninternal triggers on workflow_checkpoints. The inspected INSERT path therefore ends at local audit storage without outgoing notification/network calls. Recheck if production trigger definitions change. New service-actor guard performs validation only.

## Rollback and remaining activation gates

Rollback means disable portal_config.enabled and stop scheduling new work. Do not delete receipts, mappings, checkpoints or created assignments. Do not restore the old assigned_by NOT NULL constraint while legitimate service-attributed rows exist. Retain the constrained attribution schema and private ledger, and roll back application behavior without removing user work.

Remaining gates: verified live source semantics/equipment/schedule timezone; exact type/person/lead mappings; real schema/trigger drift checks; database advisors; combined scheduler/handler tests; review visibility; actual authorized deployment. No source adapter should be activated by placeholder assertions.

The migration runs atomically with a 2-second lock timeout and 30-second per-statement timeout; a busy metadata lock or slow constraint validation rolls back all changes. It requires the verified postgres deployment owner. The public RPC has a 2-second lock timeout. History-table locks use NOWAIT, so an occupied table aborts intake with 55P03 instead of waiting in an opposing human-workflow lock order. Classify that as retryable WRITE_UNAVAILABLE.

PGlite proves rollback, privilege behavior, routes and queued replay, not true multi-session contention. Before activation, test real PostgreSQL concurrency and table-lock latency, bound transaction time, and retry entire aborted transactions by receipt key. Uncontended table locks briefly serialize maximum-two-row intake against legacy writers; do not hold those locks across provider/network work.

## Atomic definition deployment

`deploymentAssembly.mjs` reads the base, scheduler, and local-lead-upgrade proposal files and produces one transaction; it does not connect to a database or activate intake. Use that reviewed assembly for deployment so the restricted wrapper, scheduler helpers, attribution guard and grants become visible together. Local rollback tests deliberately fail the final statement and verify that all new objects disappear and the original nonnull actor requirement remains. A successful assembly still inserts no portal configuration or assignments.


## Reviewed local IT Ticket Lead (follow-on proposal)

There are two mutually exclusive normalized lead selections:

- Existing source-crosswalk selection: `ticketLead: {sourceIdentity, evidence}`. This still requires the exact reviewed source-identity → legacy IT profile mapping. A configured local policy is never a fallback for an unknown source identity.
- Explicit local ownership selection: `ticketLead: {policy: "reviewed_local_unassigned_v1"}`. The fixed marker contains no person UUID, vendor identity, source evidence or approval claim. The pure preparer's `ready` means a valid non-executing envelope, not authorization or configured lead availability.

The local marker can be chosen only for verified explicitly unassigned work. A source-explicit lead must retain the source-crosswalk representation; never erase it or replace it with the local marker to make a ticket pass. Unknown lead/source assignment semantics remain unresolved. Mixed marker/source fields or caller-supplied UUIDs reject before receipt storage. Global assigned/unknown facts or contradictory department assignments cause a durable `ticket_lead_policy_conflict` hold. Queue targets still have NULL assignees: selecting a Ticket Lead does not claim, start, complete, or personally assign either department's work.

A real user must deliberately choose the responsible existing IT person before any production policy configuration. Verify that person's exact legacy profile, never a name guess or synthetic fixture UUID. The private `ticket_lead_policies` table holds one row per portal with the fixed policy name, actual legacy UUID, disabled-by-default flag, bounded evidence, review timestamp, and either a real Owner reviewer or approved-service provenance with a real approval reference. The SQL writer locks and checks the exact policy and active, unarchived IT profile; Owner review also needs a currently active, unarchived Owner. Missing, disabled, wrong-portal, wrong-role, inactive, archived, future-dated or invalid-review policies create no assignments. No policy/person row is seeded by either SQL proposal.

The private receipt's new `ticket_lead_resolution` stores the actual resolution and review provenance at first successful creation, independently of the immutable normalized source envelope. A local resolution truthfully identifies local policy ownership, with no invented vendor mapping. Source-crosswalk resolutions retain their genuine source identity and review evidence. Historical and still-held receipts remain NULL; no prior selection is inferred or backfilled. Created replays return original IDs before consulting mutable policy, profile or portal settings. Later policy changes, disabling, deletion, profile edits or manual assignment-lead edits do not rewrite work or saved creation provenance. Changing the normalized marker to a source lead (or vice versa) remains source-change reconciliation.

The new table is private, RLS-enabled, and fully revoked from PUBLIC, anon, authenticated and service_role. The existing single service-role-only RPC and its public ACL are unchanged. Neither the source-policy DTO nor Owner review DTO exposes a local UUID or private review provenance. Identity-crosswalk coverage diagnostics keep their original meaning and may remain false for fully unassigned local-policy work; SQL makes per-ticket decisions. The production schema-adapter registry remains empty.

### Forward deployment plan, not authorization to deploy

1. Preserve the original base SQL for existing installations. If PR114 is already installed, do not rerun its CREATE TABLE/schema/trigger statements.
2. While intake remains disabled, review current schema/function/ACL/trigger drift, confirm no live intake lease, and obtain the separate deployment approval. The upgrade itself refuses enabled portal configuration, a live lease, an unexpected function owner or a changed original acceptance body. Its baseline `prosrc` MD5 is `a82b4b83d707b22665c7593c4b5812fe`; this is a drift guard, not a security signature. Stop and re-review on any mismatch rather than editing the guard to force deployment.
3. For an existing disabled installation, the pure `mhelpLocalLeadUpgradeSql()` helper returns only `mhelp-local-lead-upgrade-proposal.sql`: one transaction adds the private table, adds the nullable receipt provenance column, and replaces the private acceptance helper. It does not modify the public wrapper, grants, activation, mappings, receipts, assignments or scheduler cursor. A failure rolls everything back. A second application refuses because the old acceptance contract no longer matches.
4. For a fresh installation only, `mhelpIntakeDeploymentSql()` assembles base → scheduler → forward upgrade in one transaction. It seeds no policy/person/configuration and remains disabled. Local fixtures and the hosted PostgreSQL harness use this same upgraded acceptance implementation.
5. Ship the marker-aware runtime plus backend/UI reason-code allowlists before any source adapter can emit the new marker. Existing source-crosswalk envelopes remain supported. Configure a policy only after the actual person and scope are explicitly selected and verified. All existing source-semantic, schedule, equipment, status, trigger, concurrency and activation gates still apply.
6. Rollback means keep intake disabled and retain the private table/receipt history. Do not delete provenance or user work, synthesize a vendor crosswalk, backfill old receipts, or switch old normalized envelopes automatically. Reverting the acceptance function requires a separate reviewed plan once marker receipts exist.

Focused local tests use synthetic isolated PGlite data. They establish atomic upgrade/rollback, ACLs, truthfulness and normal workflow behavior, not production readiness or multi-session race behavior. The hosted PostgreSQL concurrency harness still requires its explicit ephemeral CI environment; do not point it at production.
