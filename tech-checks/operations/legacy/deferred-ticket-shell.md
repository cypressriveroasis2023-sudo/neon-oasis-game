# Scheduled ticket shells with technician equipment selection

This is an **inactive, unapplied proposal**. The pure planner/preparer, SQL writer
and bounded pending scheduler now support the shell contract locally. They do not
establish production readiness: no operational source adapter is registered, and
real appointment semantics, exact private identity mappings, live schema/trigger
compatibility and current hosted PostgreSQL proof remain gates. Do not retry the
older rejected production SQL or deploy fixture/contract files.

## The intended workflow

Create the mHelp ticket, assign and schedule its actual technician, keep work
instructions in description/notes, and let the technician choose real equipment
later through the existing workflow. No equipment, site or IT Ticket Lead must be
invented upfront. Shell creation only records `assigned` work; it never claims,
starts or completes it.

## Explicit shell policy

With no `localWorkflowPolicy`, source-complete behavior remains: reviewed complete
equipment/parts, site, description, schedule and a verified source-crosswalk IT
Ticket Lead. Shells opt in with exactly:

```json
{"localWorkflowPolicy":{"policy":"technician_equipment_selection_v1"}}
```

This is a local workflow decision, not vendor evidence that equipment is absent
or a department is unassigned. Extra marker fields, unknown policies and mixed
shell-plus-structured-equipment/parts inputs reject. A source adapter must not
silently discard genuine structured scope to obtain a ready shell.

Both preparation and SQL require verified source identity/status/type, a reviewed
exact type mapping, one genuinely assigned source appointment technician and a
verified date with explicit time or explicit no-time. Unknown/unassigned/ambiguous
technicians and missing dates stay pending. Missing dates never become today.

SQL resolves the assigned person's exact portal/source identity through its
private reviewed crosswalk to a real active, unarchived matching-role profile.
The input target UUID may be NULL to avoid sending private legacy identities
across projects; that is an unresolved projection, never an unassigned claim.
A supplied UUID must match the map. The pure ready planner's synthetic crosswalk
is not a production authority, and no synthetic UUID may configure production.

## Original instructions and prepared shape

`site` may be omitted/null in preparation. If present it needs reviewed evidence
and valid text. Description still has reviewed/evidence/value fields, but its
value may be empty when original notes contain the instructions. Description and
notes are preserved independently, including permitted whitespace and line
breaks. At least one must be nonblank. Neither is parsed to invent units, parts,
site, assignment or work type. Keep real text out of fixtures and logs.

Retain the actual reviewed source type. `delivery` is supported directly; an
arbitrary `Installation` label is not automatically an alias. A detected source
versus instruction conflict needs review, not a prose-based override.

The normalized shell includes:

- The fixed local policy and `sourceEvidence.complete:false`.
- Instruction/date evidence and optional site evidence; no equipment/parts evidence.
- Empty equipment manifest and NULL requested unit count.
- NULL site when none was supplied.
- Zero placeholders for existing nonnull part columns, explicitly unresolved scope.
- Original description/notes, verified date/time and source assignment facts.
- No Ticket Lead when none was deliberately selected. An explicitly selected lead
  must still resolve to its exact verified IT crosswalk/profile.

The obsolete `reviewed_local_unassigned_v1` lead marker is not supported by this
fresh SQL assembly. It is not a fallback for assigned shells. `targetProvenance`
is diagnostic planner output only and is never accepted in the SQL envelope.
SQL derives local counterpart queues again from the fixed policy and genuine
source facts; it never fabricates vendor department assignments.

## Routing and unchanged technician gates

- Delivery/Swap: IT first, then handoff-gated Service. The appointment technician
  is assigned only to the verified matching department. A missing counterpart
  gets a local department queue; explicit unknown/contradictory facts still hold.
  The actual IT technician supplies site/types/counts before creating prep, then
  enters unit tags and satisfies the normal evidence/release steps.
- Service: scheduled field-work shell. The Service technician still verifies the
  ticket and truck readiness and records actual equipment/parts. A known need
  for new IT-prepared equipment/parts must use the established IT route; do not
  hide it in a zero-placeholder shell or bypass SIM/SD handoff requirements.
- Pickup: Service first, return-gated IT. Actual units/types are recorded through
  the existing return workflow. Unknown expected count remains NULL. The existing
  completion trigger deliberately does not complete unknown/zero-quantity work.
  When scope is known, reconcile it through the authorized ordinary workflow;
  never guess one unit or weaken the guard. Existing 110V Stand direct-to-shop
  returns may also need queue reconciliation.

Department/assignee queues do not require Ticket Lead. Existing IT Managed
Tickets/Calendar/MHelp views are lead-filtered, so no-lead shells are not promised
there. Do not claim to force visibility: claiming and prep linkage start work.
No progress timestamps, prep/return rows, inventory movements, checklist results
or completion fields are created by intake.

## Late appointment and safe replay

A minimally identified post-activation ticket can first persist as a private
`request:null` review receipt. The first source snapshot, immutable ID, printed
reference and source creation instant stay fixed. Until local work exists, a
later normalized candidate may add the appointment/instructions and be validated
again. Exact admitted pending IDs can be refreshed beyond the original discovery
window; no arbitrary historical import is allowed.

After creation, the candidate and resulting assignment IDs freeze. Identical
replays return those IDs; changed source marks review required without changing
local notes, assignee, schedule, claim, completion or cancellation. Identity
contradictions and observed existing-work collisions permanently park the
receipt for explicit reconciliation; deleting old manual history cannot let
automatic retries recreate that work.

The scheduler commits complete discovery separately from pending refresh. It
refreshes at most ten due admitted IDs under the same 180-second lease with one
30-second/20-provider-request budget, including retries. Already recorded pending
outcomes survive later failures; untouched items remain due. Lost acknowledgements
replay the same outcome without creating duplicate work or doubling backoff.
Owner waiting status is aggregate-only and stays behind the existing Owner gate.
See [the implementation overview](README.md) for exact protocol, retention and
activation gates.

## Local verification and limits

Focused synthetic tests cover four routes, exact source/private UUID resolution,
notes-only instructions, optional site/lead, wrong/missing/unknown facts, immutable
first/created snapshots, late enrichment, local edits, dedupe, partial pending runs,
lease fencing, retry cooldowns and unchanged protected workflow contracts.

```sh
node --import tsx --test --test-concurrency=1 tests/mhelp-deferred-ticket-shell.test.mjs tests/mhelp-legacy-route-plan.test.mjs tests/mhelp-deferred-shell-sql.test.mjs tests/mhelp-intake-pending.test.mjs tests/mhelp-intake-assembled.test.mjs
npm run typecheck
```

PGlite/synthetic fixtures are not current production or real multi-session proof.
Before any activation, verify the real source contract/crosswalk, current hosted
PostgreSQL concurrency and full UI workflow evidence, private ACLs, live trigger
behavior, retention, and the separately authorized revised atomic deployment.
