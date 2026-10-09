# Reviewed mHelp support admission

This operator-only path adds an absent FIELD support asset as a tracker target and
admits its mHelp address source in the same transaction. It creates no equipment
camera, provider association, Owner event, authentication identity or coordinate.
The target says `mHelpDesk product import`; it never inherits the tracker table's
`2027 Unit Tracker` default. All pre-existing records are preserved.

The supported source categories are exactly `Stand` and `Solar Pole 72`, with a
complete three-digit nonzero unit number and, for a pole, its explicit capacity.
The actual source ProductId, source file/selected-row SHA-256, source observation
watermark, original components and reviewed installation components are required.
A tracker-only asset without an actual mHelp ProductId requires a future typed
source adapter and must not use this function.

## Installation and privileges

`db/support-source-admission.sql` is a review artifact, not an automatically
applied migration. Its prerequisites are the current native source schema,
`cos-geocode-sources-admin-import.sql`, native Owner identity tables, source
inventory/catalog tables and ordinary native camera/equipment/audit/history
schemas. Verify their actual columns, constraints and triggers before applying.
The source importer body SHA-256 must be
`45a4071388d9823fc9d4442c66012458f8eff56f78957674f27a8625fcbc405d`;
admission rejects drift. No SQL is sent to the legacy database by this code.

Installation adds one RLS-enabled private reservation/receipt table and five
private SECURITY INVOKER functions with empty search paths. PUBLIC, anon,
authenticated and service_role receive no table or function privileges. There are
no new roles, schema grants, JWT settings, definer functions or public endpoints.
The existing SQL administrator must have `current_user = 'postgres'`. Its actual
role is recorded in the receipt; no Owner actor is supplied or assumed.

## Required independent review

1. Verify the deployed UI renders ordinary ST/Stand and Solar Pole targets as
   blue support assets with zero cameras. Record the deployed commit and evidence
   outside this repository. A source-code merge alone is insufficient.
2. Verify immutable source file and selected-row hashes against the actual supplied
   export. Scan the entire export for unique ProductIds and complete family,
   capacity and unit identities, including missing/do-not-use dispositions.
3. Re-read the complete current tracker, including archive and unmatched tabs,
   and all legacy devices, placement/identity audits, manual coordinates and
   history. Do not use bounded/truncated samples as proof of absence. Reject any
   native, provider, archived, missing, Owner or historical identity conflict.
   A matching currently FIELD source row is evidence, not an existing native
   target. Never merge units because they share an address, customer or unit digits.
4. Independently inspect any literal component repair. The only supported repair
   splits an empty Street plus a City containing one house/street/road-suffix and
   city. It preserves the original literal, state and ZIP. Require exactly one
   parse and corroboration in the latest tracker. Do not add words, guess a ZIP,
   normalize a different site or use this path to relocate an existing asset.
5. Assemble the private review receipt with hashes, row counts, completeness and
   read times for `mhelp`, `tracker`, `archive` and `legacy`. A caller-supplied
   receipt is an administrator's reviewed evidence, not cryptographic proof that
   external systems were read. The function requires all four scans to be complete,
   conflict-free and at most ten minutes old; it also requires the deployed
   classifier check. Keep exports and detailed evidence in the private work package.

Legacy and spreadsheet systems are outside the native transaction. Keep their
review/admission sequence serialized, stop if they change, and re-read immediately
after application. This is not a distributed transaction and does not claim to lock
those external systems. A drifted postcheck requires review/withdrawal, not invented
identity bindings or silent replacement.

## Native transaction behavior

A bounded batch contains 1–100 records. READ COMMITTED is required: a transaction
that retained an older snapshot could otherwise miss a writer that commits while
locks are acquired. An advisory lock serializes this admission path. A consistent
set of SHARE ROW EXCLUSIVE table locks excludes other writers across the native
inventory, source ledger/events, Owner reservations, camera/provider records,
catalog/source inventory, audits and history while absence is checked and targets
are created. NOWAIT acquisition fails the whole transaction if another writer is active; retry only after fresh review. Withdrawal takes the existing source-ID advisory locks first to avoid lock inversion.
The locks can briefly delay ordinary writes, so use the supplied short timeouts.

The negative checks include retired and tombstoned data and former audit labels.
Label matching is deliberately conservative and used only to refuse a creation.
Bare digits use an explicit native model family for denial; unrelated families or
shared addresses do not identify an asset. Ambiguous capacity/number representations
can produce a refusal and must be reviewed rather than weakening a guard.

A target is generated only after the checks pass. Its real server guard is then
computed and handed to the existing reviewed source importer. The new target,
source revision/event and permanent ProductId/identity reservation commit together.
Any record failure rolls back the whole batch. The receipt captures the resulting
UUID, complete target snapshot, source revision, original request and review.

An exact retry returns the same target and source revision with no new event.
Changed payload, placement, customer, GPS, target incarnation, source revision,
Owner evidence or provider/history association makes a retry fail closed.
Withdrawn reservations cannot be reused or reactivated.

`p_apply=false` performs validation/negative checks only. It allocates no UUID,
inserts no target/source/receipt/event and does not consume a source event sequence.
It takes the inventory locks, so run it in a short transaction and roll back.

## Private operator artifacts

Use the synthetic fixture as the record/review shape. Keep real records and review
receipts outside the checkout. Generate transaction files with:

```sh
node scripts/build-support-admission.mjs /private/records.json /private/review.json /private/prepared
```

The builder makes no network or database calls. It refuses repository-contained
input/output and refuses to overwrite files. It emits `dry-run.sql`, `execute.sql`
and a manifest containing input/output hashes. Both SQL files set READ COMMITTED,
a two-second lock timeout and a twenty-second statement timeout. Dry-run rolls
back; execute commits. Save the actual returned JSON execution receipt privately.
Review exact generated bytes before execution through the existing administrator.
Never set freshness timestamps or completeness flags merely to make an old review
pass. No private payload, source address, customer, live ProductId, UUID or evidence
file belongs in the public commit.

No provider lookup is performed by admission. Existing source-change consumption
may subsequently queue quality-gated free-tier geocoding. Before applying, coordinate
with the release owner if that consumer must remain paused. Accepted estimates
remain source-bound and separate from physical GPS; every support unit keeps its
own asset/pin even when an address cache result is shared.

## Rollback and withdrawal

Before COMMIT, roll back the transaction. No old records were edited. Sequence
values can have gaps after a failed execution because PostgreSQL sequences are
not transactional; the dry-run path does not use them.

Post-commit withdrawal deletes newly created tracker records and is not an in-product restore flow. Admission authorization does not authorize that deletion. Separately assess the need, obtain any required approval and review the exact affected targets before executing a withdrawal. A template can be prepared from the exact execution receipt:

```sh
node scripts/build-support-admission.mjs /private/records.json /private/review.json /private/withdrawal-prepared /private/execution-receipt.json
```

`withdraw.sql` verifies every ProductId/UUID/source-revision reservation, the entire
unchanged created target, all native negative guards and current source state.
It withdraws the source using the existing revocation function, removes only the
unchanged newly created tracker target from active projection, and retains the
source tombstone/events and admission reservation. It never changes placement to a
fabricated SHOP value. Any Owner/GPS/history/source/target change blocks withdrawal;
review that asset individually. A repeat of the exact withdrawal is a no-op.
The receipt retains the created target for a separately reviewed restoration; this
admission path deliberately cannot reactivate a withdrawn identity.

## Verification

- `node --import tsx --test tests/support-source-admission.test.mjs tests/support-admission-builder.test.mjs`
- `python tests/support-source-admission-postgres.py --psql /path/to/psql --port LOCAL_DISPOSABLE_PORT [--library-path /path/to/lib]`
- `npm test`, `npm run typecheck`, `npm run build`

The multi-session suite accepts only localhost and uses a disposable database and
synthetic records. It verifies actual role denials, stale-snapshot rejection,
non-cooperating concurrent writers, native changes committed before a fresh retry,
atomic visibility and idempotent retry. It must never be pointed at production.
