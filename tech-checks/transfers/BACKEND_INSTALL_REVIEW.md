# Held backend installation review — 17 October 2026

This is a review package, not production activation. No migration, identity,
role, secret, deployment or release flag has been changed by this work.
Parent owns integration. PR187 is outside this patch.

## Implemented behavior

Named, signed IT checkouts and independently signed Service receipts now have
immutable event delivery, verified Drive archives, PDF/email rendering, bounded
leases and retries. Ambiguous email responses require reconciliation rather than
automatic resend. The existing daily-report Google connection, recipient and
archive folder are reused; no new destination or OAuth scope is requested.

Service daily reports bind the exact reviewed receipt IDs and revisions into the
signed snapshot, HTML, JSON and PDF. Existing morning inspections, truck minimums,
photos and sign-off remain required. Old unsigned/cached completion paths cannot
bypass receipt review after release. Identical historical retries remain valid.

Partial returns record only selected exact units. Remaining units stay assigned;
all returned units remain reserved. Repair reinspection creates another signed
event with a new photo and complete condition checks. Original failures remain
immutable. Owner review separately confirms the MHelpDesk inventory step and
calls the existing inventory creation/status routines with their original gates.
No fictional Service job return is inserted. A return alone never releases stock.

Eight legacy tables have statement and row custody guards. The reviewed companion
migration prefixes 105 exact existing writer bodies with the same transaction
lock before their row locks. It preserves signatures, security mode, search paths,
ownership and ACLs, and rejects any changed/new unreviewed writer. The captured
definitions are code fixtures, not production inventory records. Legacy bare-tag
collisions veto checkout; they never supply a positive equipment identity.

Checkout and Owner release require a server HMAC attestation from two complete
authenticated reads of the existing current map and guarded MHelp placement.
The native identity, exact family/tag, active inventory status and current Shop
observation must agree. Unknown, ambiguous, stale, installed, field or conflicting
records remain held. Proofs are bound to the legacy actor, request, purpose and
exact equipment revision, expire in 30 seconds, and are consumed under the legacy
custody lock. The original observation is retained in the immutable report.
These are point-in-time cross-project reads, not a distributed transaction or a
guarantee against a later native placement change. Physical checks remain signed
by the technician. No native placement, GPS or health writer is added.

## Exact installation boundary requiring action-time approval

1. **Legacy project `goqrnolcvqnirjmzaeyk`:** apply the single transaction produced
   by `assemble-backend.mjs`. It requires the reviewed existing daily sign-off v4
   installation and exact prerequisite hashes. It is a fresh install and aborts
   if a named-handoff installation already exists. It installs eight ordered SQL
   files, private RLS tables/functions, the private JPEG evidence bucket and the
   explicit authenticated technician/Owner endpoints. It changes the 105 existing
   writer bodies only by the shared lock prefix. All four release flags finish
   **false**, with no location key installed.
2. **Native project `tughscoxralhofrckvxy`:** deploy the reviewed
   `cos-operations-pages` bundle, adding the authenticated placement-proof route
   and optional exact ITTECH identity configuration. Existing route authorization
   remains in force. No native database permission is added for this proof route.
3. **One new narrowly scoped shared secret:** generate 32 cryptographically random
   bytes only after approval. Store its lowercase hex value as native Edge secret
   `COS_HANDOFF_LOCATION_HMAC_V1`, and the same bytes in legacy private
   `app_private.techcheck_location_keys_v7`, key ID `v1`. No client, authenticated
   user or service-role SQL table grant can read this key. Do not put it in Git,
   Library artifacts, SQL receipts or logs. This key signs only short-lived Shop
   observations; it is not a legacy service-role credential.
4. **Legacy delivery worker:** deploy the reviewed `service-daily-delivery` bundle
   using the existing Google credentials and existing scheduling. Its queue claim
   functions are restricted to service_role; manual requests are checked against
   the actual active IT or named Service actor. Do not send fabricated test events.
5. **Frontend:** publish the reviewed source/build through the normal integration
   workflow only after backend and ITTECH access preparation is approved and
   verified. The code removes the ITTECH-only desktop Camera Health exception,
   so shipping it before the exact native link is ready would deny that account's
   desktop Fleet view. Phone handoffs remain held while release flags are false.

Creating keys, granting/provisioning access, installing SQL, deploying and turning
on the flags are separate persistent production actions. This package itself
authorizes none of them. Before each action, recheck the current branch/deployed
heads and live catalog, then present the exact artifact hash and changes to Parent.

## ITTECH parity preparation

Read-only checks found active legacy `ittech` / `Test IT`, ID
`05bf20fe-19f7-4db7-ac05-5b2a5f681fdf`, role `it`, with existing verified Fleet
capability. Its existing auth email is `ittech@cameras-on-site.invalid`.
No matching native auth user exists by ID, exact email or legacy-ID metadata.
The native auth.users table has no user-created triggers. No identity was created.

After explicit approval, use the standard server-side Auth admin create-user
operation for that exact existing identity, without an invitation, outbound email
or password reset. Preserve the legacy project and user ID in administrator-owned
app metadata, and record the **returned** native UUID; do not guess it or reuse
another person's native actor. The documented admin creation interface is
[Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

Provision the new native UUID with the existing
`appdeploy_provision_team_member` Owner-authorized operation in organization
`ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5`, display name `Test IT`, department `it`.
The exact role is `it_technician` (`3c1728b2-ae72-4dea-a4f6-35dc1c019799`), with the
same seven permissions as Teddy and Victor: `equipment.assign`,
`equipment.intake`, `equipment.view`, `job.edit`, `job.view_assigned`,
`purchasing.create`, `workflow.execute`. Do not grant Owner or extra permissions.

After verifying the exact new auth/profile/role rows, set native Edge configuration
`COS_ITTECH_NATIVE_ACTOR_ID` to that returned UUID. This is an explicitly configured
same-person pair, never an email/name lookup at login. Every request still checks
the active legacy role/name, native organization profile/name/department and
ordinary IT role. Missing configuration, inactive/revoked accounts, foreign orgs
and attempts to borrow existing technician/Owner actors are denied. No value has
been set in production.

## Release, verification and recovery

Keep `enabled`, `reports_ready`, `receipt_link_ready`, `custody_ready` false until
the full reviewed package, key, identity and worker are installed and authenticated
read-only smoke checks succeed. Review the actual mobile/desktop sessions for
ITTECH and another IT account, Service and Owner. Synthetic browser fixtures and
PostgreSQL tests are implementation evidence, not authenticated production proof.

Activation requires Parent's specific approval of the current artifact and flags.
The first saved handoff must be genuine authorized work, with actual signatures
and photographs, followed by observed delivery and exact archive readback. Do not
manufacture an inventory event to get a green smoke check. An unavailable placement
proof, Google connection, missing endpoint or conflicting custody stays explicit.

To hold a release, set all four flags false. Preserve reservations, custody guards,
signed events, delivery checkpoints and evidence; disabling must not make an
assigned or repair-held unit available. Do not drop the new tables or blindly
restore writer bodies while reservations exist. Reconcile ambiguous email sends
against the provider before any deliberate retry.

## Local commands

From `tech-checks/operations`, run the focused Node suites and the full
`tests/playwright.transfer.config.mjs` browser suite with the current Operations
build. This workspace uses `PW_DISABLE_TS_ESM=1` with Node 24 and Chromium.
Real PostgreSQL tests accept only a disposable loopback database whose name starts
`cos_handoff_test_`; run delivery, partial-return, custody and location SQL suites
sequentially because their disposable cluster roles are shared. Never point them
at either production project. The exported receipt lists exact commands and counts.

Generate the review transaction locally with:
`node tech-checks/transfers/assemble-backend.mjs /absolute/new/output.sql`.
The assembler performs no network or database operations and refuses to overwrite
an existing file. Hash the resulting SQL before proposing installation.
