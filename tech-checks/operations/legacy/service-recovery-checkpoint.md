# Service recovery checkpoint 1 — inactive proof core

This is rebuilt source with new verification. No results from the lost worktree
apply to these bytes. It does not yet activate a public Service writer, replace
legacy Start, submit installation work, approve billing or update mHelp.

## Actual source contract

`service-original-contracts.json` and `service-schema-contract.json` contain a
fresh read-only PostgreSQL catalog capture from the repository's legacy project
`goqrnolcvqnirjmzaeyk` on 2026-10-11. They contain definitions/ACL/column metadata,
not customer records or credentials. Readiness and its two called routines are
MD5-pinned before the private proposal can be loaded.

## Rebuilt authority

Apply order for a future reviewed assembly: shared membership foundation,
actual legacy functions, `service-departure-witness-proposal.sql`, then
`service-submission-kernel-proposal.sql`. Both files are inactive proposals.
They create only revoked private tables/helpers with RLS. No public grant or
Storage policy is introduced.

`capture_departure_start_v1(assignment,prep)` captures prospective own Service
Start in the same transaction as the captured genuine Start routine.
`capture_claimed_departure_start_v1(assignment,prep)` requires both genuine claim
markers equal to the transaction timestamp. The source public wrappers have not
yet been rebuilt in this checkpoint and are required before activation.

The snapshot stores actual canonical membership, actor, assignment and optional
prep, exact morning/inventory row IDs, authoritative readiness, unit/SIM/stock
facts and the exact Start timestamp. It is immutable. Replay uses the witness,
never a later overwritten daily inventory row. A historical started assignment
without a witness is held. Each coworker's assignment history stays independent.

`require_departure_start_v1(assignment,prep)` returns only the validated private
witness identity. It works with NULL prep for genuine Pickup/notes-only Service
jobs and asserts no installation/unit proof. Inventory fences use NOWAIT SHARE
ROW EXCLUSIVE because the genuine readiness routine itself can initialize rows;
compatible SHARE locks followed by lock upgrades would be unsafe.

The private submission kernel currently provides the recorded-phase seal only.
Its fixtures insert an explicitly synthetic seal to test new-Start denial; that
is not a claim that a rebuilt installation finalizer has executed.

## Fresh results and remaining gates

- 15/15 fresh tests passed: 10 actual foundation cases and 5 departure cases.
- The fixture uses captured real readiness, baseline, restock and own Start
  routines; a clearly synthetic released prep isolates this component. Genuine
  shared IT release → Service → Owner composition is still required.
- Production Start/link/claim wrappers, fresh installation proof/CAS, Helios
  bridge, Owner projection and session/view controls are not complete here.
- Bidirectional actual PostgreSQL concurrency is a mandatory hosted ephemeral
  CI gate before activation. Local PGlite tests do not establish race safety.
- No production SQL, live tickets, notifications, deployment or credentials were
  changed. No public access was expanded.

Privilege-preservation amendment: all revokes enumerate only the five new private
functions. Existing schema privileges are untouched; only a newly created schema
is initialized private. A genuine unrelated capability canary remains executable.
The first amended run stopped on a Node 24/V8 WASM assertion. One identical ordinary
retry passed all seven departure/capture cases; no runtime or permission flags were
changed. Native hosted concurrency remains required.
