# Preserve canonical identity proof across API and Owner CSV imports

## Observed production failure

At 16:56:13 UTC on October 21, 2026, the Owner Stage request failed inside the
unchanged `review_upload` validator with `Canonical identity evidence required`.
The UI displayed its generic source/evidence conflict message. No stage or exact
file commit was created; the active source remained 1,001 records, 287 Field and
714 Shop at the 16:57 UTC readback.

The API importer reads `upload_snapshot()`, whose public projection correctly
removes private `binding.reviewEvidence`. It then persisted that sanitized binding
in its immutable API batch. The subsequent Owner CSV importer therefore received
existing canonical identities without their original private proof. Refreshing
the preview cannot restore that field.

Read-only production inspection found 116 affected bindings. All have uniquely
agreeing identity proof in saved historical uploads. The reviewed historical
upload `7893cec87f652954f7a9015e0ac82ea107b9200f23fa91cca5d0e8337c5ee891`
contains 1,001 unique Product IDs and a valid receipt/payload checksum. An older
batch without an explicit reviewed flag is excluded from recovery.

These 116 bindings are not additional placement changes. The October 20 source
still has five intended movements and target totals of 284 Field / 717 Shop.

## Change

Two private read-only helpers recover an absent proof only when the saved Product
ID, full label, native/tracker identities and labels, canonical key, match method,
evidence digest, representation digest and all remaining identity fields agree.
The current expected guard and prior-assignment reference are retained exactly.

Historical candidates must be explicitly reviewed complete uploads with matching
source hashes, record counts, unique Product IDs and payload checksums. All
matching candidates must agree on one proof. Missing, ambiguous, malformed or
inconsistent evidence fails closed. The receipt records historical source,
payload, record and proof hashes as private recovery provenance.

The Owner Stage and approval paths use the recovered private proof. Existing
assignment snapshots also bind it, preserving rejection of changes after staging.
The API importer retains the proof in future source batches, including its
missing-record history. Bulk recovery validates historical payloads once per
request to avoid repeated full-file hashing.

The shared validator, binding guard, raw scoped-source hashes, Owner permission
checks, native Shop-receipt exception, lifecycle restrictions and public read
projections are unchanged. Both helpers deny execution to public, anon,
authenticated and service_role. Existing function owners, ACLs, security modes
and configuration are retained by exact-definition replacement.

No equipment, source batches, active-source pointer, GPS, IPs, SIMs, links or
history are updated by installing this repair. Source activation remains the
authenticated Owner preview, stage, assignment approval and commit workflow.

## Validation and release

`tests/mhelp-canonical-evidence-postgres.mjs` reproduces the actual API projection
loss and exercises the repaired Stage → review → approve → commit sequence,
replays, eleven invalid-history cases, concurrent changes, late-failure rollback,
protected-field preservation, API proof persistence and private-proof redaction.
Its seven local PGlite groups passed. The existing guarded Owner workflow also
runs this file against disposable PostgreSQL 17.

The builder `prepareOwnerCanonicalEvidenceSql.mjs` accepts fresh installed
definitions and fails if any of the four production function definitions changed
or either new helper already exists. It emits one transactional migration.

Proposed migration name: `cos_owner_canonical_identity_evidence_20261021`.
This new privileged production-function change needs the separate approval
required by the original continuation handoff. It has not been installed.
Runtime v114 and the deployed UI do not need replacement for this SQL repair.

After approval, install the exact tested candidate, read back functions and ACLs,
then resume the existing Owner workflow. Require an exact-file commit receipt,
saved readback, preserved bindings and persistent map placement before declaring
the October 20 CSV operationally reconciled.
