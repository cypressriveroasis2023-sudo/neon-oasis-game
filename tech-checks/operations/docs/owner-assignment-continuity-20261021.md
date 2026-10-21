# Owner assignment continuity successor

This continues the merged PR263 Owner review path. The first production Stage
attempt rejected stale `previousAssignment` references before it could create a
reviewable stage. No stage or commit was created for the October 20 CSV.

The fresh read found 352 historical references: 344 differed only by observation
timestamp and eight differed in historical assignment fields. These counts
overlap the five actual CSV movements. All 352 use exact reviewed Product IDs and
have unrestricted lifecycle state. Only two existing source guards differ, for
the already-recorded native Shop moves. Those moves must not be repeated.

The user separately approved this scoped production repair on October 21 after
the blocker and proposed repair were explained. The approval covers deployment
of this successor and completion of the existing authenticated Owner workflow.

## Protected review

- Stage retains the prior binding, exact current links, latest native Shop
  receipt, and protected-state hash in a private immutable receipt.
- A stale historical reference is held for explicit Owner review. It cannot be
  silently refreshed. Missing, ambiguous, unconfirmed, restricted, or mismatched
  identities remain blocked.
- The review displays actual CSV assignment changes, historical differences,
  and an expandable timestamp-only manifest. Review reasons can overlap; a
  Product ID is approved once.
- Reads, approval, Stage retries, and commit compare the captured evidence to
  current state. Later evidence, identity, history, or protected-state changes
  require a fresh Stage and review.
- Approval changes only the staged historical reference. A source guard can
  change only under PR263's existing exact native Shop-receipt policy. No
  equipment is created, no recorded move is repeated, and original evidence
  remains in the audit receipt.
- The full existing source/census/assignment validator still runs. The final
  transaction remains atomic and exact-file bound.

## Scoped installation

`prepareOwnerAssignmentContinuitySql.mjs` requires fresh installed definitions,
checks their hashes inside the migration, and preserves existing function
headers, security configuration and ACLs. The new snapshot helper is private and
has no execute grant for public, anon, authenticated, or service_role. The shared
full validator and binding-guard functions are unchanged.

Only the three public equipment RPC boundaries convert serialization conflicts
to SQLSTATE `PT409`. This avoids automatic PostgREST 14 transaction retries for a
deterministic business conflict. Owner authorization failures remain `42501`.

`prepareOwnerAssignmentContinuityRuntime` patches the fresh v113 runtime in two
bounded places: its assignment-review helper and equipment-route conflict
handler. It proves a byte-for-byte round trip of all unrelated runtime code and
preserves runtime configuration, existing authentication, renewal code and the
second runtime file.

## Release and completion gates

The focused database suite covers all five real movements, tracker-only
identity, existing Shop receipts, original evidence, protected-field
preservation, microsecond observation drift, stale identities, retries and
atomic rollback. The hosted PostgreSQL 17 gate remains required. Focused bridge,
runtime, UI and browser checks cover projection, overlap counts, blockers and
approval controls. Existing build, typecheck and publication gates remain in
place.

Production completion requires authenticated Owner preview, a fresh Google 2027
census, Stage, explicit review, and commit of this exact file:

`ServiceItem_List_20261020172623.csv` — 195,275 bytes,
SHA256 `8f0d8ac0b677ad3b2d23c8f6604a3933821c1613d78d5fd39640a4ede1019599`.

The expected source is 1,001 IDs: 284 Field and 717 Shop. Deployment alone is not
an import receipt. Completion also requires a saved exact-file receipt,
protected binding readback, and persistent placement after reload. Inventory
placement is not evidence of live camera health.
