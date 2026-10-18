# Native Shop attestation: production approval bundle

**Implemented and tested locally; production remains held.** Local implementation
and synthetic testing were authorized by Parent. No further approval was needed
for that work. This document requests review of the concrete production boundary;
it does not authorize installation, grants, deployment, a key or activation.
No live checkout success is claimed.

## Exact installation scope

| Item | Held production action |
| --- | --- |
| Native project | `tughscoxralhofrckvxy` |
| Fixed organization | `ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5` |
| Install file | `tech-checks/operations/db/techcheck-shop-attestation-v1.sql` |
| Install SHA256 | `ffe44ce5d630ae2bcafb3dd54408fca7354a264c5e2850a1363f12ec402dd707` |
| Public signature | `public.cos_techcheck_shop_attestation_v1(p_legacy_actor_id uuid, p_request_id uuid, p_purpose text, p_items jsonb) returns jsonb` |
| API caller grant | EXECUTE on that exact signature to **existing `service_role` only** |
| Explicit revocations | PUBLIC, anon and authenticated cannot execute the RPC; defaults are closed explicitly |
| Private helper | `cos_mhelp_placement_private.techcheck_identity_concern_v1(text)`; no API-role EXECUTE |
| Function settings | Public RPC: STABLE SECURITY DEFINER, empty search path, function-local `jit=off`; helper: IMMUTABLE SECURITY INVOKER, empty search path |
| Installer/owner | Existing approved database migration administrator; local effective owner is `postgres` |
| Cache notification | `NOTIFY pgrst, 'reload schema'` after creation/grant in the same transaction |

The SQL creates two functions and grants one signature. It creates no table,
user, membership, credential, native ITTECH identity or storage policy. No schema
USAGE, table access or existing RPC grant changes. Existing actor-gated native
map, placement and Owner endpoints are unchanged. Six exact captured authority
reader definitions are sealed by SHA256 preflight; missing/changed dependencies
or an existing installation stop the transaction. Do not override the preflight.

The native function performs only SELECTs. It reuses the installed MHelp guard,
complete graph guard and current upload reader, including continuity, scoped
corrections and Owner identity receipts. It runs successfully in a PostgreSQL
READ ONLY transaction. Function-local JIT suppression avoids compilation overhead
for this bounded composed read; it changes no global database setting.

## Trust boundary and actor revocation

Legacy project: `goqrnolcvqnirjmzaeyk`. Existing ITTECH is legacy actor
`05bf20fe-19f7-4db7-ac05-5b2a5f681fdf`; no native account is required by this route.
The bridge validates the actual bearer through that fixed legacy Auth endpoint
and the exact active/unarchived profile. It then revalidates the bearer/profile
and calls existing `cos_verified_fleet_capabilities_v1()` with the caller's token
before each observation and immediately before signing. `fleetRead` must be true.
The actor, role and Owner status must remain identical. Existing native checks
for already-linked accounts remain; other routes retain their native actor gate.

Checkout accepts existing verified IT or Owner; inventory release requires
Owner. The bridge never accepts a caller-supplied actor, organization, native ID,
role or service credential. The native service credential remains on the existing
server. The database itself cannot validate the legacy project's JWT: it trusts
the existing server caller to bind `p_legacy_actor_id`. Possession of that existing
server credential permits invoking this scoped read RPC with a syntactically
valid legacy UUID. This is the new access boundary under review.

The bridge checks exact legacy equipment keys, family/tag identity, Shop state,
duplicate/variant identities and full timestamp revision before calling native
SQL. It independently reads legacy Owner placement evidence and camera identity
under the same caller token. Current reviewed ROOT may corroborate Shop; Field,
identity conflicts and later unmarked edits veto issuance. Legacy v7 consumption
still rechecks the active actor, exact revisions and custody under its existing
shared transaction gate. These are current authorization checks, not a promise
that bearer revocation or logout invalidates every previously issued token instantly.

## Request scope and exact disclosed fields

Each call is bound to one nonnull actor UUID, request UUID, and purpose
`checkout` or `inventory_release`. `p_items` has 1–20 objects with exactly
`equipment_key`, `family`, `unit_tag`. Strings are trimmed, nonempty, at most 160
characters with no controls/angle brackets; the JSON item array is at most 16,000
bytes. Duplicate keys and same bare tags in a batch are rejected. Exact identities
are resolved from the guarded native source mapping, never a caller-selected UUID.
The complete requested set is returned in UTF-8 byte order or the whole call is
denied. There is no pagination, arbitrary organization or list-all mode.

Only these response fields are permitted:

| Field | Value |
| --- | --- |
| `contract` | `COS_TECHCHECK_SHOP_ATTESTATION_V1` |
| `organization_id` | Fixed organization above |
| `legacy_actor_id` | Exact server-bound input actor |
| `request_id` | Exact input request |
| `purpose` | Exact allowed input purpose |
| `checked_at` | Database statement timestamp |
| `valid_until` | At most checked time + 30 seconds, capped by source freshness |
| `items` | Exact requested item set |
| `items[].equipment_key` | Requested legacy key |
| `items[].family` | Requested canonical family |
| `items[].unit_tag` | Requested tag |
| `items[].representation_id` | Exact native or tracker inventory UUID |
| `items[].representation_kind` | `native` or `tracker` |
| `items[].native_unit_id` | Exact native UUID, or null for tracker-only |
| `items[].tracker_id` | Exact guarded tracker UUID |
| `items[].placement` | `SHOP` only |
| `items[].observed_at` | Current confirmed MHelp observation timestamp |
| `items[].source_success_at` | Successful MHelp sync timestamp |
| `items[].authority_sha256` | SHA256 of scoped current authority inputs |

The hash covers the current link/control, full graph guard, native identity epoch,
source/upload head and current scoped rows, related tracker records and provider
matches. PostgreSQL JSONB text provides the native canonical serialization. The
bridge binds this opaque hash with its scoped legacy evidence using canonical
JSON before signing the existing v7 envelope. Native checked/expiry times are
excluded from the authority hash so unchanged observations compare equal.

No customer/site names, addresses, GPS, emails, SIMs, photos, notes, raw crosswalks,
provider secrets or unrelated records are disclosed by the RPC. The native result
stays server-side; the browser receives the existing signed v7 envelope containing
the requested identities, revisions, timestamps and combined authority hash.

## Eligibility and timing limits

Require one exact current MHelp link and current guarded uploaded source record,
both Shop, with unchanged labels, product ID, source revision and customer
assignment. Feed enabled, no error, successful sync at/after observation, both
nonfuture and no older than 40 minutes. Require current source/continuity guards,
active lifecycle and no holds, conflicting aliases, archive, native installation,
GPS/history, Owner claim or conflicting provider membership. Related current
tracker records cannot be held, Field, inactive or claim another product.

This narrow path is deliberately conservative: legacy alias-only representations,
absent reviewed uploads, old Field uploads despite a later Shop observation, and
any native Owner identity claim (including revoked history) remain held. It does
not make every unit visible in Fleet eligible for checkout. Real eligibility and
the actual ITTECH session still require live read-only verification after approved
installation; local fixtures do not establish production inventory coverage.

Each native call uses one consistent statement snapshot. The bridge brackets two
complete native/legacy observations, requires identical scoped authority and
revisions, then rechecks the principal. It will not issue after the ten-second
request budget. The proof expires at the earliest native validity boundary and
no later than 30 seconds after signing. Timeouts, missing grants, malformed results
and unavailable source evidence fail closed; there is no `last_good` fallback.

**No distributed custody lock is provided.** Native placement may change after
the final observation. Existing native epochs detect some change-and-restore
sequences; tracker/source ABA and post-read changes remain possible. The legacy
transaction gate protects legacy custody only. Strict cross-project exclusion
requires a separately reviewed native reservation/writer protocol, outside this
read-only access change.

## Verification and remaining review

The exact final commit/tree, logs, effective ACL catalog and patches are supplied
in the accompanying implementation receipt. Tests cover the actual native SQL on
PostgreSQL, READ ONLY execution and unchanged rows, all existing function bodies
and ACLs unchanged, scope/permission denial, guard/source/Owner revocation,
concurrent native mutation and consistent statement snapshots. The integration
test runs actual native SQL in isolated PGlite through the actual bridge and
consumes its proof on PostgreSQL for checkout, receipt, return and Owner release;
it also rejects account deactivation after issuance. Native concurrency is tested
separately with two PostgreSQL clients. Neither test contacts production or a
provider. Maximum item scope is exercised against 1,001 synthetic source rows.

No fresh independent reviewer sign-off, hosted CI, live authenticated ITTECH
verification, genuine handoff, provider email or archive delivery is claimed.
Existing 105-writer definition seals and added boundary/race tests pass; executing
every historical writer branch under production contention remains open.

## Separate approvals and rollback

1. **Native SQL only:** approve the exact install SHA above and its one service
   EXECUTE grant after a fresh dependency/owner/default-ACL check. Keep the legacy
   four release flags false. Read back effective function ACLs and definition.
2. **Bridge deployment separately:** reviewed `cos-operations-pages` source in
   native project `tughscoxralhofrckvxy`, preserving existing configuration and
   Owner import gate. Recheck the deployed baseline before deployment.
3. **Signing key separately:** the earlier paired native Edge secret and legacy
   private key proposal remains held. No key has been created or transmitted.
4. **Activation separately:** legacy installation, keys, delivery/backend checks,
   live role/eligibility verification and final review must complete first.

Rollback file: `tech-checks/operations/db/techcheck-shop-attestation-v1-rollback.sql`,
SHA256 `c0d538d633de72c008a7eafb2628874fade74c192106470ea0223f2c1cd10786`.
It revokes only this RPC's service EXECUTE and reloads the schema cache, causing
issuance to fail closed. No data, users, existing grants, keys, signed history or
custody reservations are removed. Already-issued proofs may remain consumable
until their short expiry; an urgent full stop requires the separately approved
existing legacy handoff-hold procedure. Do not auto-release any custody hold.

**Production approval question for Parent:** Approve installation of this exact
read-only native SQL and its single EXECUTE grant to the existing server role,
with all handoff release flags still false? Bridge deployment, signing keys and
activation remain separate approvals.
