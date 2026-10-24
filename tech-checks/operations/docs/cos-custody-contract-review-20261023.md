# COS custody contract review — bounded continuation proposal

Status: review only. No migration, new grant, synchronization or production reconciliation has been installed. Local implementation and isolated tests are authorized; production security surfaces and real stock operations require the specific approvals below.

## Reused work and confirmed boundaries

| Existing work | Latest inspected head | Reusable contract | What it does not establish |
| --- | --- | --- | --- |
| PR 271 | `1dc73582b0ba8c5efc0d1a64ffbfb33d3b981772` | Immutable correction evidence, actor-bound replay, revision/reservation locking, purpose-preserving audited Owner/IT action | Its SQL and PR explicitly do not create truck stock, accept receipt or connect the complete custody cycle. Its approved deployment scope must not be silently expanded. |
| PR 231 | `b23ca4af73dedd82ec7cfc6d185b0416a5284334` | Source-event/recipient-unique notification outbox and delivery lease/review behavior | Notifications do not accept custody or move equipment. No messaging activation is needed for the read-only changes. |
| PR 228 | `7efb2ce47b9f74c373d53317078c55471ed2e40c` | Exact Product-ID active census with source SHA; strict one-to-one 2027 family/label index; CAS placement intent and outbox; no camera/IP/SIM/GPS overwrite | This is a placement/Sheet mapping, not a reviewed binding from legacy `equipment_master.equipment_key` to Product ID, nor a technician custody baseline. Its draft remains uninstalled. |

Legacy Tech Check uses project `goqrnolcvqnirjmzaeyk` (`app.js`); Operations uses `tughscoxralhofrckvxy` (existing Operations transport). The private mHelp census and the legacy transfer tables are not one local database join. Do not copy PR 228's SQL into the legacy database or manufacture a cross-project FK.

## Exact bounded read migration prepared

File: `drafts/cos-custody-history-read-v1.sql`.

Adds **only** `public.techcheck_transfer_history_page_v1(uuid,text,integer)` in the legacy Tech Check project. No table, trigger, existing function replacement, row update, source import, notification or worker is added. Its new authenticated execute grant is the complete proposed permission change; PUBLIC, anon and service_role do not receive execute.

- Calls the existing `app_private.techcheck_transfer_role()` with the actual `auth.uid()`. Verified Owner/IT retain the existing IT scope; Service sees only `service_actor = auth.uid()`; inactive/unverified callers are rejected by the existing helper.
- Reads all historical states through UUID keyset pages, 1–100 rows per page. Returns exact role-scoped handoff count and awaiting-receipt/review count, not an equipment custody total.
- Requires a SHA-256 snapshot token after page one. A changed revision/population aborts the continuation with SQLSTATE 40001, so the caller must restart rather than combine inconsistent pages.
- Projects only handoff identities, manifest, state, revision and source dates. No signatures, photo paths, signed documents, credentials or raw event snapshots are returned.
- Does not replace the original 100-row context or enable a new frontend dependency before deployment/readback approval. The current UI continues labeling that limit honestly.

Isolated PGlite test `custody-history-draft.test.mjs` paged 205 records without repeats, verified Service's separate 130-record scope, stale-token rejection, invalid arguments, denied anon access and unchanged row/revision totals after all reads. This is not native hosted concurrency or installed ACL evidence.

**Smallest deployment approval:** installation of this one exact read-only function and its authenticated execute grant after reviewing installed helper definition/ACL fingerprints, passing native PostgreSQL tests and preserving the function's fixed role guard. No permission to reconcile inventory, change other grants, add a scheduler or send messages is implied.

## Product-ID/current-holder extension: exact proposed data contract

This remains blocked on verified input, not on authorization to write local code. An approved cross-project source connection and initial binding/custody evidence are not present in the checked sources. A browser-supplied name match cannot provide them.

Proposed immutable binding review tuple:

```
contract: COS_CUSTODY_BINDING_REVIEW_V1
legacy_project_id: goqrnolcvqnirjmzaeyk
native_project_id: tughscoxralhofrckvxy
equipment_key: exact existing equipment_master key
legacy_identity: { canonical_family, workflow_type, unit_tag, source_label }
legacy_identity_sha256: digest of the fixed versioned tuple above
product_id: exact current mHelp Product ID
mhelp_source_sha256: current accepted source receipt
tracker_binding: { workbook_id, sheet_id, row_number, exact_label, evidence_sha256 } | null
review_revision: positive integer
reviewed_by: server-derived verified Owner identity
reviewed_at: server time
review_reason: nonempty explanation
supporting_evidence: stable approved evidence reference
```

Reject duplicate Product IDs/keys, any source/identity drift, missing evidence, inactive/missing/retired holds, and ambiguous mappings. Reuse PR 228's exact-index validation rules; do not normalize away suffixes, pad unit numbers, select the first match or treat Shop as an IT holder. No records are seeded from the October 22 count reference.

For a separately approved current-holder baseline, require each Product ID's exact existing holder UUID or an explicit unresolved state, source observation, evidence, reviewed revision and Owner attribution. Preserve placement independently. The baseline is an explicitly approved inventory reconciliation operation; it is not part of deploying a frontend or read RPC.

After those inputs are available, the minimal command extension must:

1. Extend the existing transfer validator/submission path with a new version rather than accepting free-form browser Product IDs or rewriting old signed manifests. Resolve Product ID from the locked, current verified binding server-side and preserve the binding/source revisions in new signed events.
2. Use the existing actor checks, named receiver, checks/photos/signature validation, equipment locks, request IDs and immutable replay rules. A checkout records pending custody; only that receiver's real acceptance or the already authorized, auditable Owner completion can advance it. Owner action must keep its actual actor and never impersonate a technician signature.
3. Record return intent separately from physical IT intake. Intake disposition may require repair/review and must not automatically mark stock deployable. Partial returns need exact per-item events; the current full-manifest return contract must not silently stand in for them.
4. Keep historical handoffs, correction/purpose events and delivery manifests immutable. Backfill no receiving signatures or acceptance. A cross-project transfer cannot be one SQL transaction: use an explicit idempotent receipt/outbox protocol, keep each side's revision and display pending/failed reconciliation until verified acknowledgement. Do not add notification fan-out; preserve #231's unique-event/recipient design if that separately approved feature is deployed.
5. Read authoritative current custody only from the reconciled baseline plus accepted immutable per-item events, with exact Product-ID uniqueness and an explicit unresolved bucket. Never add custody categories to Field/Shop placement totals.

**Smallest missing input for this extension:** an Owner-reviewed exact `equipment_key → Product ID` binding set and a designated/evidenced initial current-holder baseline, plus the approved cross-project server transport to verify the native receipt in the legacy command path. These do not exist in #271/#231/#228. Implementation can be completed once those facts are supplied; production installation and real baseline reconciliation remain distinct approvals.

## Calendar finding and implementation

The existing Owner calendar reads `job_assignments.scheduled_for` and `scheduled_time` and renders saved `work_type`, site and ticket. This is a real scheduled-activity source; no new due-date schema is required to show appointments already saved there.

`schedule-read.js` now provides a fixed read of that existing table under the signed-in Owner's existing RLS session, limited to the displayed date range (maximum 62 days), with exact count and explicit 1,000-row truncation. It projects no private notes and changes no assignment. `SavedTechCheckSchedule` adds these appointments to the existing Calendar alongside separately labeled handoff/return history and existing Operations schedule. Missing or denied reads do not become zero appointments. No automatic linkage/deduplication is invented between independent assignment and native job IDs.

An actual handoff/return due date still cannot be inferred where no scheduled record exists. This is a missing record, not permission to create an appointment or recreate dispatch.
