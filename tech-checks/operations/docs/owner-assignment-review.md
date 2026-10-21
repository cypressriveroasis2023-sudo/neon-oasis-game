# Owner assignment review candidate

A genuine source movement currently detaches a previously reviewed Product-ID
binding. This change attaches an explicit current-state review to the existing
private source stage. It does not introduce another inventory importer.

The Owner stages the original bytes, reads the before/after assignments and exact
existing native/internal-tracker identities, checks the explicit confirmation and
provides a note. The gateway repeats original-file parsing/checksum and the live
Google 2027 census on both review and approval. The database binds approval to the
stage, actor, organization, full source hash/records, current census digest,
active-source/scoped revisions, original bindings, current protected graph,
recorded Shop receipt and saved exact Product-ID links. No identity is inferred
from a name. The full existing upload validator is run before accepting approval.

Approval changes only private stage records and stores the audit receipt there.
Existing native/tracker IDs, represented membership and historical binding
provenance remain; the current guard is recorded only after explicit review of
that exact state. Stale guards are eligible only with an exact source-bound
recorded Shop receipt, matching native identity/model/current Shop state, no
archive/source conflict, no competing identity claim and no protected installation
GPS/site. Other stale states remain blocked. Neither approval nor commit repeats
native Shop actions. Tracker-only equipment uses its existing tracker identity.

Commit refuses to activate a source that would detach these existing bindings
without a valid review. It repeats the receipt/current-state comparison under
short-lived shared graph-table locks, then invokes the original full transactional
validator. New changes, expiry, differing census/source/scoped revisions or
conflicting approval replays fail atomically. Applied commits retain the existing
idempotent return. The effective inventory overlay uses the reviewed source
assignment; raw internal tracker/native records, GPS, history, IP/SIM, devices and
health are preserved. Source service addresses remain estimates, never GPS proof.
The Google workbook is separate from COS's internal tracker records.

## Separate production approval required

Proposed migration name: `cos_owner_assignment_review_20261021`.
`prepareOwnerAssignmentReviewSql` requires fresh installed stage/commit definitions,
checks their SHA-256 inside the transaction, adds private invoker review/locking/
assertion helpers, adds one Owner-authorized service-only review RPC, and inserts
one review assertion into stage replay and commit. It preserves existing function
owners, ACLs, security configuration, all unrelated bytes and existing commit
logic. The new RPC repeats equipment.manage and organization checks; no anon or
authenticated execution grant is added. This is a NEW privileged function and
requires separate action-time approval, not the earlier Shop migration approval.

No production stage/approval/commit is part of development or deployment. Deploy
only after latest required CI and review, fresh readback/builders and separate
migration approval. Install the database gate before the dependent runtime/UI;
retain v111 plus current session/health releases. Verify exact definitions, ACLs,
files/version and read-only behavior. No flags, credentials, provider scans or
scheduler changes are needed. The user should not retry preview or Apply until
the complete release is verified.
