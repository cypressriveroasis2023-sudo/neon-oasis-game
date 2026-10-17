# Equipment check-in/out: exact installation and access proposal

This is a held draft for Parent review. No item below has action-time approval.
Do not install, deploy, create a secret, grant access, publish the frontend or
activate from a generic earlier approval. PR creation is the only authorized
external write in this review step. PR187 and other owners' branches are excluded.

## Decision requested

Review the held legacy installation as **Stage A only**, using the SQL hash in
the final PR receipt. It installs the specific endpoints, policies and shared
custody locks below with all four release flags false and no key. It does affect
the lock order of existing writers even while the feature is held.

**Do not approve native ITTECH provisioning as part of phone handoffs.** Do not
approve activation yet: the current Shop-proof adapter still requires a linked
native identity. That avoidable dependency must be replaced by an exact,
read-only legacy-actor proof path and reviewed before ITTECH can make a fresh
checkout. This draft deliberately records that unresolved blocker rather than
granting broader native rights to work around it.

## ITTECH finding and scope correction

Read-only production checks confirm legacy project `goqrnolcvqnirjmzaeyk` has
active `ittech` / `Test IT`, ID `05bf20fe-19f7-4db7-ac05-5b2a5f681fdf`, ordinary
role `it`, no archive date, and `cos_verified_fleet_actor(...) = true`.
No new legacy role or permission is needed. The phone host, readiness/context
RPCs, signed receipt/return/cancel operations and daily linkage use that existing
legacy identity. They do not inherently require native Auth provisioning.

The candidate's fresh checkout path calls `/api/techcheck/location-proof` before
the legacy v7 submission. That adapter currently uses the native-authorized
Field Map/MHelp pipeline and therefore denies unlinked ITTECH. A regression test
demonstrates the denial and that no other person's native actor is borrowed.
This is an implementation blocker, not a justification for a new account.

The optional `COS_ITTECH_NATIVE_ACTOR_ID` configuration/link code and the proposed
native parity test were removed from this draft. The existing ITTECH desktop
Camera Health entry is preserved. No native Auth account, organization membership,
`it_technician` role, seven-permission bundle, Owner access, invitation, password
reset or email is requested. Broader native desktop parity is a separate decision.

## Stage A — legacy SQL and storage

**Project:** `goqrnolcvqnirjmzaeyk`. **Operator:** approved database administrator,
using the existing migration/install role. No browser or service-role install.

The reviewed assembled SQL SHA256 is
`dee5f33444ac90106718e434c95cf9923eb21fd3bb12b6c65d2ec40faf898db4`.
The single transaction from `assemble-backend.mjs` applies eight ordered files:
named handoffs v1, rollout v2, delivery v3, partial returns v4, daily receipt links
v5, writer lock order v6, shared custody v6, location proof v7. It refuses an
existing handoff installation and changed prerequisite or writer definitions.
Use the final receipt's exact SQL SHA256; do not use the earlier `bc693891` SQL.

It creates **11 private RLS tables** for settings, rules, transfers, signed events,
reservations, outbox, per-item returns, inventory permits/releases and proof
keys/receipts. `PUBLIC`, `anon`, `authenticated` and `service_role` receive no
direct table grants. Existing schema USAGE grants remain unchanged. The private
key table is empty. All settings end false: `enabled`, `reports_ready`,
`receipt_link_ready`, `custody_ready`. Installation creates no handoff, signature,
inventory movement, provider request or email.

### Exact browser-callable grants

The following **eight public RPCs** receive EXECUTE only for `authenticated`;
EXECUTE is explicitly revoked from `PUBLIC`, `anon` and `service_role`. The
function bodies still enforce the actual active actor, ownership and readiness.
The final revokes close the live public-schema default grant to `service_role`.

| Public function signature | Actual actor/action gate |
| --- | --- |
| `techcheck_transfer_readiness_v1()` | Active verified fleet actor or Service; own capability only, no equipment list |
| `techcheck_transfer_context_v1()` | Same gate; Service sees only its own named transfers; verified fleet actor sees permitted IT context |
| `submit_techcheck_transfer_v1(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text)` | Signed exact receipt/partial return/cancel or identical retry; **fresh checkout rejected** |
| `submit_techcheck_transfer_v7(uuid,uuid,text,integer,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb)` | Existing IT/fleet actor gate plus exact Shop proof for a fresh checkout; no Service checkout |
| `techcheck_daily_receipts_v5()` | Active Service, only that actor's current accepted receipt revisions |
| `complete_service_daily_report_v5(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)` | Active Service; exact current receipts explicitly reviewed; existing inspections/photos/signature still required |
| `owner_techcheck_return_reviews_v6()` | Active Owner only; current signed intake and evidence |
| `owner_release_techcheck_return_v7(uuid,uuid,text,uuid,boolean,text,jsonb)` | Active Owner only; passing signed IT intake, explicit MHelp inventory confirmation and fresh Shop proof |

`app_private.techcheck_transfer_file(text,boolean)` receives authenticated
EXECUTE only as the storage-policy predicate. The replacement private
`complete_service_daily_report_v4(uuid,jsonb,jsonb,jsonb,jsonb,jsonb)` retains its
authenticated EXECUTE compatibility boundary and rejects new old-client daily
submissions once handoffs are active. Existing public v4 ACLs are preserved
(authenticated and service_role EXECUTE); its private actor gate is not broadened.
Identical historical retries remain valid. Core/internal routines are revoked
from all API roles. `owner_release_techcheck_return_v6` moves into `app_private`
and is no longer a public callable bypass.

`approval-access-catalog.json` records exact argument names, final local effective
ACLs, function security settings, tables, policies and false flags. It is produced
from the complete assembly on PostgreSQL 17.6 with the observed live defaults and
existing v4 wrapper ACL reproduced, not inferred from GRANT text alone.

### Storage policies and evidence

New bucket: `techcheck-transfer-evidence`, **private**, JPEG only, maximum
5,242,880 bytes. Object names are `<actor UUID>/<event UUID>/<SHA256>.jpg`.

- `techcheck_transfer_insert`: authenticated INSERT on `storage.objects` only
  for that bucket, a ready authorized actor, own actor path, and an event that
  has not already been accepted. Upload uses `upsert: false`.
- `techcheck_transfer_read`: authenticated SELECT only for that bucket and a
  ready authorized actor. The actor may read its own path; accepted-event images
  are also visible to the verified IT/fleet actor or exact named Service actor.
  A cross-actor path must be present in that immutable event's photo list.
- No new authenticated UPDATE or DELETE policy; accepted evidence cannot be
  replaced through these policies. Existing bucket policies are unchanged.
- Evidence viewing uses five-minute signed URLs. The existing delivery worker's
  server key downloads exact referenced bytes and verifies their SHA256 names.
  Supabase's service key bypasses storage RLS; it remains server-only.

### Existing custody writers affected

105 exact captured legacy writer bodies receive the same advisory transaction
lock before any legacy row locks. Signatures, ownership, ACLs, security mode and
search paths are preserved. All changed bodies are sealed by definition hashes;
new/unreviewed writers abort installation. Sixteen triggers (statement gate and
row guard on each table) protect `equipment_master`, `unit_registry`, `prep_items`,
`prep_tickets`, `unit_returns`, `asset_inventory`, `service_truck_units`, and
`service_truck_restock_requests`. Named reservations block conflicting legacy
writes and truncation. Legacy custody also blocks a new named checkout.

Owner release reuses `owner_add_inventory_asset` and
`owner_set_inventory_asset_status` with their existing gates/history. It adds an
immutable review record and removes only the exact released reservation; it
does not fabricate a Service job return. Partial returns and failed inspection
remain reserved until a separate passing intake and Owner release.

## Stage B — server operation and deployment, separately approved

### Legacy delivery worker

Project `goqrnolcvqnirjmzaeyk`, Edge function `service-daily-delivery` (observed
baseline **v7**, SHA256
`a8ec40c2d8997730fb46cb7fdc70f300fd0bda86d3cdb346e9ddfef55a1edb11`).
Deploy the reviewed bundle only after a fresh baseline check. Preserve existing
`verify_jwt: false` transport configuration: the handler itself validates either
the existing cron secret or the actual user token; a public invoke is not an
authorized delivery. Origins/methods remain restricted.

Only these two new SQL signatures receive service_role EXECUTE:

- `public.techcheck_transfer_delivery_v3(text,uuid,uuid,uuid,jsonb)`
- `app_private.techcheck_transfer_delivery_v3(text,uuid,uuid,uuid,jsonb)`

Operations are `claim`, `checkpoint`, `finish`. Claims verify the active exact
manual actor or existing scheduler, use 10-minute leases and row locks; retries
stop after eight attempts, with 5–240 minute backoff. Ambiguous in-flight email
goes to review. Sent requires all archive parts verified plus a provider email ID.
There are no new direct table grants. Existing daily-report service RPCs and
existing scheduling remain; the same scheduler drains handoffs when no daily
report is pending. Do not add a cron schedule or change its secret in this stage.

Reuse only existing Google client ID/secret/refresh token and their current
scopes. Destination remains `jmartin@camerasonsite.com`; Drive parent remains
`1sEOK-nffQB46pcSj7rifT-9Huts4P2B4`. The worker creates event folders and exact
JSON/HTML/PDF/JPEG artifacts, verifies archive identities/hashes and sends Gmail.
No new recipient, folder, provider credential, scope or fabricated test event.

### Native placement proof adapter

Project `tughscoxralhofrckvxy`, Edge function `cos-operations-pages` (observed
baseline **v96**, SHA256
`1b6c1b449fb97a7005c28b176c8f7abbdfa07689d8a4e907b84da5788a199fc7`).
Current candidate adds POST `/api/techcheck/location-proof`, exact purpose/item
validation and two complete authenticated current placement observations. It
uses existing native read RPCs and the existing server key; **no native database
grant or user role is proposed**. It does not write placement, GPS or health.
It currently requires the existing exact linked native IT/Owner actor; fixing
the unlinked ITTECH path is a prerequisite to approving this deployment for the
requested complete workflow. No other actor's ID may be substituted.

After that blocker is resolved and separately approved, generate 32 random bytes
and store their lowercase hex as native Edge secret
`COS_HANDOFF_LOCATION_HMAC_V1` and the same bytes in legacy private
`techcheck_location_keys_v7`, key ID `v1`. Keep the secret out of artifacts/logs.
No grant exposes that table to service_role or a browser. Proofs are bound to the
legacy actor/request/purpose/exact equipment revision and expire in 30 seconds.
They are point-in-time cross-project observations, not a distributed transaction
or a guarantee against later native placement changes.

## Stage C — frontend, activation and real verification

Separate approval is required for each deployment/publication and for activation.
Before any action, recheck current main/PR head, deployed hashes and live catalog.
Integrate the reviewed source through the normal PR workflow; do not manually
overwrite the published dist assets from another owner.

Keep all four flags false until the unlinked-ITTECH proof path, backend/key,
worker, final CI and authenticated read-only role checks are verified. Test real
ITTECH and existing IT, Service and Owner mobile/desktop sessions without making
up equipment activity. Activation is the explicit update of all four flags to
true in the singleton settings row, followed by readiness readback.

The first saved handoff must be genuine authorized work, with actual identity,
photos and signatures. Observe the exact accepted receipt/partial return,
separate Owner release, email provider ID and archive readback. A user-visible
success is not delivery proof. Do not auto-resend an ambiguous Gmail result.

## Rollback / return to hold

An installation failure aborts the single transaction. Preserve a pre-action
catalog/definition receipt. Do not run a fresh-install package over an existing
install or blindly restore old writer functions.

After installation, the safe hold operation is to set all four flags false.
It stops new accepted handoffs, storage-policy access and new transfer claims;
it does **not** cancel an already-running provider send. Reconcile/drain any
in-flight lease before reverting the worker, and preserve exact provider IDs.
Keep reservations, custody guards, signed events, evidence, delivery checkpoints
and release history. Do not drop tables/bucket/guards or free assigned/repair-held
stock. A previous frontend or worker can be restored only with this held state
and compatibility review; retain the current existing daily-report behavior.
Do not remove the HMAC key while an approved proof is being consumed; hold first.

## Verification and remaining gaps

The final PR receipt lists the exact tested head/tree and commands. Local checks
cover the full transfer browser configuration, focused regressions, real
PostgreSQL concurrency/assembly and effective grants under production defaults.
Synthetic browser success is not authenticated production verification.

Remaining activation blockers/gaps:

1. Unlinked ITTECH cannot yet obtain the fresh Shop proof. No provisioning workaround
   is approved; implement a narrow legacy-actor path without extra native rights.
2. No authenticated live role smoke, genuine first-event email/archive readback,
   or production workload/lock-contention observation has occurred.
3. This workspace uses Chromium 154; the pinned Playwright download was blocked.
   New PR CI is separate evidence and must finish before review completion.
4. The local fixture compiles all 105 exact writer definitions and tests shared
   custody categories/concurrency, but does not execute every historical workflow
   branch against full production data.
5. A 30-second proof cannot guarantee that native placement never changes after
   observation. This remains an explicit design limit.

Storage semantics reviewed against [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
The requested changelog index was blocked by this environment (403); no new SDK
version, Auth API or CLI behavior is introduced by these review changes.
