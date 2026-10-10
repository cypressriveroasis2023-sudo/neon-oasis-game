# Legacy mHelp intake: revised, inactive proposal

Target: actionable legacy Tech Check `goqrnolcvqnirjmzaeyk`, never the native
read-only source project. This is a **fresh-install proposal**, not a migration
runner entry or an upgrade for a deployed predecessor. The older rejected SQL
must not be retried or split into smaller deployment calls. This revised work is
unapplied and inactive. No production configuration or source adapter is seeded.

The [scheduled shell contract](deferred-ticket-shell.md) now has local planner,
SQL write-boundary, durable pending refresh and aggregate Owner-status coverage.
That is implementation evidence, not production readiness. The production source
adapter registry is still empty; real appointment semantics and exact same-person
crosswalks have not been verified.

## Files

- `mhelpIntakeAdapter.ts` and `../shared/mhelpLegacyRoutePlan.ts`: pure preparation;
  `ready` means a valid non-executing envelope, never authority to create work.
- `mhelp-intake-proposal.sql`: private configuration, exact mappings, receipts,
  immutable snapshots, constrained service attribution and one public RPC.
- `../intake/mhelp-intake-scheduler-proposal.sql`: discovery leases, pending refresh,
  receipt-checked cursor commit, bounded retry metadata and aggregate status.
- `deploymentAssembly.mjs`: assembles only those two SQL proposals in one atomic
  transaction. No database/network access, activation or configuration insertion.
- `mhelp-intake-fixture.mjs` and `tests/contracts/`: isolated synthetic fixtures and
  captured workflow definitions for tests only. Never deploy the contract files.
- `tests/mhelp-deferred-shell-sql.test.mjs`, `../tests/mhelp-intake-pending.test.mjs`
  and `../tests/mhelp-intake-assembled.test.mjs`: shell, replay and integration tests.
- `tests/mhelp-postgres-concurrency.ci.mjs`: ephemeral hosted PostgreSQL proof,
  never a production test runner.

The former local IT Ticket Lead upgrade/table is intentionally absent from the
fresh assembly. A backwards-compatible pure preparer can still describe its old
`reviewed_local_unassigned_v1` marker, but this SQL rejects it before retention.
Do not register a source adapter that emits that obsolete marker. A scheduled
shell can simply omit Ticket Lead; source-complete mode retains its exact
source-crosswalk lead requirement.

## Restricted service boundary and privacy

The sole added public function is
`public.camera_mhelp_ticket_intake_v1(p_request jsonb)`. EXECUTE is granted only to
the existing `service_role` and explicitly revoked from PUBLIC, anon and
authenticated. The postgres-owned SECURITY DEFINER wrapper requires the actual
SQL role setting to be `service_role` and `auth.uid()` to be NULL. It never sets a
human identity or JWT claim.

All private helpers are SECURITY INVOKER with empty search paths. Schema usage,
table privileges and helper execution are revoked from PUBLIC, anon,
authenticated and service_role; all private tables have RLS. Source payloads,
private mapping UUIDs and review provenance are not exposed to the Owner UI.
Only allowlisted normalized fields are retained; raw provider bodies, arbitrary
nested fields and malformed identity keys reject before receipt storage.
Original instruction/notes text remains private but may itself contain personal
information. Do not put real records, notes or credentials into fixtures or logs.

The existing runtime identities/transports are reused. No new key, credential,
cron, provider write, notification request or automatic activation is included.
A future adapter must use only its verified fixed provider read contract.

## Shell and source-complete write rules

- Scheduled shells use the exact fixed
  `technician_equipment_selection_v1` marker and `sourceEvidence.complete:false`.
  They require a real source-assigned appointment technician, verified schedule,
  reviewed exact source type/status and nonblank description or original notes.
  Equipment selection, site and IT Ticket Lead are not mandatory upfront.
- The private writer resolves only the exact portal/source-person crosswalk to
  an active, unarchived profile in the routed department. A NULL target UUID is an
  unresolved projection for an explicitly assigned source fact; SQL resolves the
  real UUID. A supplied nonnull UUID must match. Unknown or contradictory facts
  hold; they never become guessed users or unassigned queues.
- Shell manifests stay empty, requested unit count stays NULL and existing part
  quantity columns use zero placeholders. Those values mean unresolved scope,
  not reviewed absence of equipment. SQL derives local counterpart queues under
  the fixed policy without manufacturing source department facts.
- Without the shell marker, source-complete validation and scope-based routing
  remain: reviewed equipment/parts/site, description, schedule, exact source
  assignment facts and a deliberately verified IT Ticket Lead.
- Only reviewed open source status pairs can create assignments. Unknown,
  terminal, deleted and review-classified source facts never create local
  completion. Canonical UTC source creation is mandatory; do not infer timezone.

## Attribution, deduplication and protected workflows

`assigned_by` becomes nullable only with both fixed service attribution markers.
The CHECK uses NULL-safe comparisons so ordinary rows still require a human
actor. A validation trigger rejects direct service-role marker writes outside
the required postgres/service context and makes service attribution immutable.
It does not block normal later notes, assignee, schedule, lead or status changes.
No user/auth record is created or impersonated.

A source-key advisory lock and the existing printed-ticket advisory lock serialize
validation. Potentially creating candidates also take NOWAIT locks on all three
legacy history tables before collision checks and insertion. Already-invalid
candidates use ordinary history reads without those write-conflicting locks. All
first-stage assignments, existing trigger audit rows and receipt commit together.
Existing assignment/prep/return/receipt history, including completed or cancelled
work, is held for reconciliation rather than adopted or overwritten.

The writer only INSERTs assignments and leaves existing triggers enabled. It
never claims, starts, completes, creates prep/returns, records checklist answers,
moves inventory or invokes the notifying assignment RPCs. Defaults/trigger
semantics were captured for local contract evidence and must be rechecked for
live drift before any production write. Existing protected technician files and
migration directory are not modified by this proposal.

Queue visibility uses department/assignee and assignment state. Managed
Tickets/Calendar/MHelp views remain lead-filtered; no-lead shells are not promised
visibility there. Service handoff, return Intake and completion checks remain in
the existing workflows. See the shell contract for the unknown-count pickup caveat.

## Immutable first observation and pending enrichment

The durable key is `(portal_id, immutable ticket_id)`; printed number is separate
and globally deduplicated for the legacy workflow. A minimum admitted receipt has
verified portal ID, immutable ID, safe printed reference, source creation instant,
registered schema contract and `request:null`. Missing optional facts are omitted,
not replaced with invented values or arbitrary null containers.

`first_payload`, source key, printed number and source creation instant never
change. While there is no assignment, a later normalized candidate may enrich
`candidate_payload` and be fully revalidated. A later appointment can therefore
create the shell after the original creation window has passed. A source identity
contradiction is latched for explicit reconciliation; the changed payload is not
retained and automatic pending refresh is parked. An observed existing-work
collision is also permanently latched for reconciliation, even if ordinary work
is later removed; pending refresh and overlapping discovery cannot recreate it.

At creation, candidate/state/assignment IDs/creation timestamp become immutable.
An unchanged replay returns the original IDs before consulting mutable assignees,
statuses or mappings. Source changes mark review required without changing local
work or the frozen candidate. Claims, manual edits, completion and cancellation
are never overwritten or re-created by intake.

## Split discovery and pending protocol

The one restricted RPC supports:

1. `policy`, `review_status`, `pending_status`: fixed reads. Owner transports must
   retain their existing Owner authorization gate. Review status exposes bounded
   printed references/reason codes; pending status adds aggregate counts/timing
   only, with no source record, assignee or notes.
2. `begin`: one fixed enabled portal, 180-second fenced lease, five-minute minimum
   cadence, at most 15 minutes of cursor progress and ten minutes of overlap.
3. `record`: validates the lease and strict discovery bounds, records the ticket
   atomically, and schedules a held uncreated receipt for later refresh.
4. `commit_discovery`: validates the complete manifest and every durable receipt
   before advancing the watermark. Partial discovery never advances it. Exact
   commit replay is idempotent after a lost acknowledgement.
5. `pending_scope`: freezes at most ten due existing post-activation receipt IDs
   under that lease, excluding the current discovery manifest. Callers cannot
   supply arbitrary ticket IDs or historical windows.
6. `record_pending`: accepts only admitted IDs and the exact lease. Identical
   per-ticket outcome replay does not increment backoff twice; a changed outcome
   under the same lease rejects. Completed outcomes survive a later partial run.
7. `finish`: releases the lease after confirmed discovery commit. Pending work
   may be partial; unattempted receipts remain due. It does not advance an
   unverified discovery window.
8. `fail`: releases the current lease and records safe fixed error/backoff data.
   It cannot reverse already committed discovery progress.

Native pending reads have one shared 30-second, 20-provider-request budget,
including retries/auth/open/appointment pagination, and a 1 MiB normalized result
limit. A provider cooldown stops the batch; prior valid outcomes are recorded
before global backoff. Invalid/unknown errors are not blindly retried. A future
adapter must route every provider request through that shared allowance.

Completed pending attempts back off from five minutes up to one hour, with a
saturating counter and any larger provider Retry-After respected up to one day.
Discovery observations are not pending attempts. The current scheduler refreshes
uncreated holds except identity/source-change and existing-work reconciliation
latches. Terminal/review-classified status and explicit deletion still need a
retry-policy decision before activation; review that ongoing source-read cost. Missing or unattempted
pending items do not receive a false success/cursor update.

## Retention, deployment and remaining gates

Receipts, first/created snapshots and dedupe history are durable; there is no
cleanup action or TTL. No unbounded attempt log is added: retry state retains the
latest outcome/digest. Permanent retention includes original instruction text and
must be acceptable for the production data before activation. Any later retention
change needs a design that preserves dedupe and audit integrity.

The installation transaction uses a verified postgres deployment owner, a
two-second lock timeout and 30-second per-statement timeout. It modifies an existing table constraint and
adds an attribution trigger even while intake is disabled; disabled configuration
does not eliminate schema-change risk. The RPC has a two-second lock-acquisition timeout and NOWAIT history locks;
these do not bound how long acquired locks are held, and the installation
statement timeout does not persist into runtime RPCs. Eligible writes block
ordinary writers while holding the table locks. Current real PostgreSQL
concurrency/latency evidence and an effective request-level execution limit are
activation gates. Retry an
aborted intake as a whole transaction, never by fragments.

Before a separately authorized deployment or activation:

- Verify the real source appointment/assigned-person/date/timezone contract,
  status/type mapping and exact private same-person crosswalk. The empty adapter
  registry is an intentional blocker; synthetic review flags are not evidence.
- Confirm current legacy schema/defaults/triggers/function ownership/ACLs and
  notification behavior against the reviewed contract, then run advisors.
- Run real PostgreSQL contention, role and atomic rollback tests on the exact
  revised head, plus full application/type/browser tests. Prior-head proof and
  PGlite are not substitutes for current multi-session evidence.
- Verify Owner waiting/review visibility, private source handling, bounded retry
  behavior, data retention and no-lead queue/pickup behavior in staging.
- Review the materially revised atomic assembly and explicit activation floor.
  Never use the previously rejected DDL, obsolete local-lead upgrade or fixtures.

Rollback means disable intake and scheduling while keeping created work, receipts,
private mappings, audit and service attribution intact. Do not delete evidence,
reset the watermark, drop the constrained attribution guard, or restore blanket
`assigned_by NOT NULL` while legitimate service rows exist.

Run local synthetic tests from `tech-checks/operations`:

```sh
node --import tsx --test --test-concurrency=1 tests/mhelp-deferred-shell-sql.test.mjs tests/mhelp-intake-pending.test.mjs tests/mhelp-intake-assembled.test.mjs
npm test
npm run typecheck
```

These commands do not verify production data, deployment or real multi-session
behavior. Hosted CI must run the dedicated ephemeral PostgreSQL harness against
the current commit before it can supply that evidence.
