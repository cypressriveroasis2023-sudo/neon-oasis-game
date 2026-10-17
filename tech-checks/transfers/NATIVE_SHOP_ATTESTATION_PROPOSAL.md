# Narrow native Shop attestation — proposal only

Status: **not approved, not implemented, not installed**. This document requests
review of one new read boundary. It does not authorize SQL execution, a grant,
deployment, a secret, activation, or a native ITTECH account. All four handoff
release flags remain false. The preserved candidate is `09be92ae74d5cb412d2f0000b39c38844a9b914f`.
The isolated compatibility merge includes main `ba1b7422b88de41ee2e4344857333aca7cbe0073`.

## Why an access change is needed

Existing legacy ITTECH (`05bf20fe-19f7-4db7-ac05-5b2a5f681fdf`) is active,
unarchived, role `it`, and passes the existing verified-fleet actor check. The
2026-10-17 read-only catalog check found no matching native Auth user. Existing
native map/placement/identity snapshot RPCs require a native actor. The existing
actor-free location candidate RPC returns guarded `last_good` data, not the
current placement observation required for checkout. The placement-begin RPC
writes a lease and cannot substitute for a read.

## Exact proposed access boundary

Native project: `tughscoxralhofrckvxy`.
Fixed organization: `ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5`.

Proposed single public signature:

```sql
public.cos_techcheck_shop_attestation_v1(
  p_legacy_actor_id uuid,
  p_request_id uuid,
  p_purpose text,
  p_items jsonb
) returns jsonb
```

Only the **existing native server role `service_role`** receives EXECUTE on this
signature. Explicitly revoke EXECUTE from PUBLIC, anon and authenticated, including
inherited public-schema defaults. No role membership, schema USAGE, table SELECT,
storage policy, other RPC grant, service key or native user is added. The existing
bridge uses its existing server credential. This is a new restricted service RPC,
not a request to grant broad service-role access to a person or client.

The proposed function is `STABLE SECURITY DEFINER SET search_path = ''`, owned by
the existing migration owner; all references are schema-qualified. It contains
only bounded SELECTs, with no dynamic SQL, caller-selected relation, network call,
lease, audit insert or settings update. If an internal helper is necessary it
receives no API-role EXECUTE. Existing actor-gated RPCs and their checks are
unchanged. Verify effective ACLs from PostgreSQL after a disposable installation;
source GRANT text alone is insufficient.

## Caller authentication and scope

The native database cannot authenticate a legacy-project JWT. It trusts the
existing server caller to bind the legacy actor. Passing an actor UUID is **not**
native proof of that person's authorization. Anyone holding the existing native
service credential can invoke this new read RPC for a syntactically valid UUID;
this is the precise trust boundary being proposed.

The bridge must add a route-specific legacy authentication path for
`POST /api/techcheck/location-proof`; it must not relax the general native actor
gate or create a native alias. Before each attestation cycle and immediately
before signing, it must:

1. Validate the presented bearer token through the fixed legacy project's Auth
   user endpoint, deriving the actor exclusively from the returned user ID.
2. Read that exact legacy profile with the same caller token. Require active,
   unarchived `it` or `owner`; call existing
   `cos_verified_fleet_capabilities_v1()` with the caller token and require
   `fleetRead === true`. No caller-supplied role, name, actor override, native ID,
   organization, or service credential is accepted.
3. Permit `checkout` for verified IT or Owner. Permit `inventory_release` only
   for an active Owner. Recheck the same actor, role and capability at the final
   read. A failed, incomplete or timed-out check denies issuance.
4. Resolve every requested equipment key from the caller-authorized legacy
   equipment context. Require one exact family/tag/key tuple, current Shop state,
   current `updated_at`, and no duplicate identity or bare-tag custody conflict.
   Read applicable legacy placement/Owner evidence under that caller token;
   missing or ambiguous evidence denies issuance. Legacy custody and actor gates
   are checked again inside the existing v7 consuming transaction.

Both Edge and RPC reject unknown fields. `p_items` is 1–20 objects with exactly
`equipment_key`, `family`, `unit_tag`, each a trimmed nonempty string of at most
160 characters with no control characters or angle brackets. Reject duplicate
keys, duplicate family/tag pairs and bare-tag ambiguities. Sort by equipment key
using a documented bytewise order. `p_purpose` is exactly `checkout` or
`inventory_release`; actor and request are nonnull UUIDs. Request scope is one
existing signed handoff/release attempt, with the exact item set bound to its
request UUID. The RPC accepts no organization override and no pagination/list-all
mode. It returns all requested attestations atomically or one generic denial;
it does not disclose which rejected identity exists.

## Exact successful response fields

No additional keys or nested fields are permitted in the response contract.
The bridge consumes this server response; the browser receives only the existing
signed v7 proof envelope.

| Field | Type and meaning |
| --- | --- |
| `contract` | Literal `COS_TECHCHECK_SHOP_ATTESTATION_V1` |
| `organization_id` | Fixed organization UUID above |
| `legacy_actor_id` | Exact input actor UUID; server-bound, not independently authenticated by this RPC |
| `request_id` | Exact input request UUID |
| `purpose` | Exact allowed input purpose |
| `checked_at` | UTC database statement timestamp |
| `valid_until` | `checked_at` plus 30 seconds; no later than the observation freshness boundary |
| `items` | Exact requested set, sorted by equipment key |
| `items[].equipment_key` | Exact requested legacy equipment key |
| `items[].family` | Exact requested canonical family |
| `items[].unit_tag` | Exact requested tag |
| `items[].representation_id` | Exact UUID of the eligible inventory representation |
| `items[].representation_kind` | `native` or `tracker` |
| `items[].native_unit_id` | Exact linked native UUID, or null for a tracker-only representation |
| `items[].tracker_id` | Exact guarded MHelp tracker UUID |
| `items[].placement` | Literal `SHOP` |
| `items[].observed_at` | UTC timestamp of the current confirmed observation |
| `items[].source_success_at` | UTC timestamp of the latest successful MHelp sync |
| `items[].authority_sha256` | Lowercase 64-character SHA256 of the current scoped native authority inputs |

The authority hash covers exact identities, current tracker/native/source
mapping revisions, current MHelp link guard and observation, sync control state,
archive/admission/continuity state, applicable native Owner claims/epochs, and
native placement/GPS/install conflicts. Exclude `checked_at` and `valid_until`
from the hash so unchanged bracketing reads compare equal. Specify canonical
serialization in the implementation and test it. A hash is a change detector,
not a permission, monotonic revision, or proof that no intervening write occurred.

No names, email addresses, customer/site labels or addresses, GPS coordinates,
IPs, SIMs, photos, notes, provider secrets, raw crosswalks or unrelated fleet
records are returned. Legacy `updated_at` is read and bound by the bridge, not
invented or attested by the native database.

## Current-state and concurrency rules

Use one consistent PostgreSQL statement snapshot for each native attestation.
Resolve exact family-qualified identity under the fixed organization and reuse
the current reviewed guard/identity rules. Require one current, confirmed MHelp
link observation with matching guard, `SHOP`, explicit `locationReview=false`
and `assignmentChanged=false`; source enabled, no error, and successful sync at
or after the observation. Observation and sync timestamps must be nonfuture and
no older than the existing 40-minute limit. `last_good`, stale fallback, upload
labels, a bare unit number, or an absent error do not establish current Shop.

Reject archived, retired, installed, field/GPS, identity-review, duplicate,
Owner-claimed or conflicting source representations. A native representation
must satisfy the current available/no-site/no-placement-history guard. Retain
current source admission/continuity and archive rules from main. Conservative
denial is required whenever the restricted read cannot establish the same
eligibility as the complete existing placement authority. Do not silently remove
an authority check to make ITTECH pass. Cross-project legacy placement/Owner
evidence remains a separate bridge veto; native success alone is insufficient.

The bridge brackets the complete native and legacy authority reads twice and
requires identical item identities, legacy revisions and authority hashes, then
revalidates the legacy principal before signing. Total issuance deadline is
10 seconds. The signed v7 proof expires no later than 30 seconds after its issue
time **and no later than either attestation's `valid_until`**. Retain actor,
request, purpose, exact items and legacy revisions in the signed payload.

This provides point-in-time evidence, not a cross-project lock. Native placement
can change after the final read; an ABA change between snapshots may be invisible.
The legacy consuming transaction's shared advisory gate protects legacy custody,
not native writers. Strict cross-project exclusion would require a separately
designed reservation/writer gate and is outside this read-only proposal. Existing
request idempotency and one-time proof binding remain; a different actor, purpose,
request or item set cannot reuse a proof. Do not claim revocation is instantaneous:
legacy consumption rechecks current actor eligibility, while a previously issued
proof has a bounded remaining validity window.

## Required isolated acceptance tests before implementation approval

- Effective ACLs: PUBLIC/anon/authenticated denied; only existing service_role
  permitted. No new table or schema access; private helpers denied. Verify all
  preexisting actor-gated endpoints and native Auth/user counts are unchanged.
- Principal: missing/forged/expired/wrong-project JWT; forged actor or role in
  body; Service; unverified IT; inactive or archived IT/Owner; role/capability
  removed before first read, between reads, and before signature. Confirm
  existing unlinked ITTECH succeeds only through its own valid legacy identity.
- Scope: wrong organization/extra fields, invalid purpose/UUID, 0 or 21 items,
  duplicate identities, cross-family bare-tag collisions, missing and unrelated
  units, malformed/case-changed identities, excessive body size and timeouts.
- Authority: current observation versus conflicting `last_good`; disabled/error
  sync, stale/future timestamps, changed guard, changed assignment, missing
  booleans, archive, source admission/revocation/continuity changes, native Owner
  claim/epoch changes, installed site, unit GPS, duplicate/ambiguous mapping,
  unavailable legacy Owner evidence. Every uncertain case fails closed.
- Concurrency: native placement, source guard, archive or Owner claim changes
  between reads; legacy identity/role/custody changes before consumption; exact
  deadline boundaries; explicit test demonstrating the documented post-read
  native-change limitation rather than claiming distributed atomicity.
- Abuse/replay: tampered signature/authority hash, expired proof, wrong actor,
  purpose/request/items/revision, repeated identical request and conflicting
  retry. Verify denial has no side effects and leaks no rejected unit details.
- Read-only: run the native RPC inside a READ ONLY transaction and compare
  all touched relation contents/leases/settings before and after success and
  denial. API role cannot invoke writer helpers through this function. Use no
  production equipment events, provider calls, email or secrets in tests.
- Rollback drill: revoke only this signature's service EXECUTE; issuance must
  fail closed while unrelated native/legacy routes remain functional. Verify
  all four rollout flags remain false on complete installation.

These are proposed acceptance tests, **not passed receipts**. The accompanying
local writer/current-main tests exercise existing candidate code and do not
validate an unimplemented RPC or close the independent security review.

## Rollback and remaining decisions

For this boundary alone, revoke service_role EXECUTE on the exact new signature
and disable the bridge proof adapter. Preserve existing data, custody holds,
signed history, roles and actor gates. A read-only function needs no data rollback;
drop it only after dependents are removed in a separate reviewed migration.
Already issued proofs may remain valid for their short remaining lifetime; an
urgent complete issuance/consumption stop uses the separately reviewed existing
handoff hold procedure. No key or account is deleted or rotated by this proposal.

Implementation, final security review, exact SQL hash, effective ACL readback,
deployment, the previously proposed signing-key installation and activation
remain separate gates. No key has been created or transmitted. The old approval
document's statement that no native grant is proposed describes the preserved
candidate; this document proposes precisely this additional EXECUTE boundary.

**Suggested approval question:** May we implement and locally test one native
read-only Shop-attestation RPC, callable only by the existing server role for
exact requested units, so the existing verified legacy ITTECH account can obtain
checkout proofs without a native account? Installing its narrow EXECUTE grant,
deploying, adding the signing key and enabling handoffs would remain separate
approvals.
