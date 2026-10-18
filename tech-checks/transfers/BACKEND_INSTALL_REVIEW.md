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
scoped reads of guarded current MHelp placement and legacy equipment/evidence,
with fresh legacy principal/capability checks before signing.
The native identity, exact family/tag, active inventory status and current Shop
observation must agree. Unknown, ambiguous, stale, installed, field or conflicting
records remain held. Proofs are bound to the legacy actor, request, purpose and
exact equipment revision, expire in 30 seconds, and are consumed under the legacy
custody lock. The original observation is retained in the immutable report.
These are point-in-time cross-project reads, not a distributed transaction or a
guarantee against a later native placement change. Physical checks remain signed
by the technician. No native placement, GPS or health writer is added.

## Current approval boundary and ITTECH correction

The exact current proposal is [INSTALL_ACCESS_APPROVAL.md](INSTALL_ACCESS_APPROVAL.md).
It lists both projects, eight authenticated browser RPCs, the two service-role
queue signatures, private storage policies, 105 writer locks, server operations,
deployment order, activation, rollback and remaining evidence gaps.

Native ITTECH provisioning is **not requested** for legacy phone handoffs. The
existing active legacy account already passes the verified IT capability. The
optional native identity configuration was removed and the existing desktop
Camera Health entry preserved. The narrow legacy-authorized Shop proof path is
implemented and tested locally. Its exact service-only native RPC grant and
remaining production decisions are described in
[NATIVE_SHOP_ATTESTATION_APPROVAL.md](NATIVE_SHOP_ATTESTATION_APPROVAL.md).
No new native account or broader desktop access is requested. Live checkout and
inventory eligibility are unverified. This supersedes the earlier bc693891 parity
proposal and the proposal-only status in commit 9229fa7.

The held SQL explicitly revokes inherited service-role access to its eight new
browser RPCs. Effective permissions are recorded in
[approval-access-catalog.json](approval-access-catalog.json), measured on the
complete disposable PostgreSQL installation with live default ACLs reproduced.
All production installation, secrets, deployment and activation still require
specific action-time approval. Parent owns integration.

## Local assembly

From the repository root:
`node tech-checks/transfers/assemble-backend.mjs /absolute/new/output.sql`.
The assembler performs no network/database operation and refuses overwrites.
Use the final PR receipt's hash, not an older assembled SQL file.
