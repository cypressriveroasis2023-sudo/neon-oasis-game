# Owner mHelpDesk reconnect candidate

## Scope and activation gate

This local candidate replaces an already initialized invalid token pair for the
existing company portal. It does not provision a portal or modify the existing
mHelpDesk Client ID/API Key or Client Secret. The observed failure was HTTP 400
`invalid_grant`; that result alone does not distinguish expiry, revocation, or a
mismatched token pair.

Production publication/deployment requires explicit approval of the new Owner
credential-replacement capability. Configuring persistent credentials is a
separate action-time authorization boundary. The user must personally obtain,
enter, and submit the fresh matching access/refresh pair in the actual deployed
Owner form. The assistant must not retrieve or enter values through tools, chat,
logs, SQL, screenshots, or browser inspection. A browser handoff must show the
real form after its production deployment and Owner gate are verified. No generic
chat input is a credential-entry form.

The public vendor Partner API documentation at
https://www.mhelpdesk.com/partner-api/index.html and its Current User page were
inaccessible through the research tool on 2026-10-10. Existing repository evidence
identifies Developer Access and password confirmation, but current button names,
account/session availability, and the actual generation flow are not verified.
Verify that official vendor flow before directing the user through exact clicks.
Do not regenerate the API Key/Secret or expand scopes. If the vendor requires new
approval, new client credentials, or another security change, stop for its own
approval/handoff rather than widening this flow.

## Boundary and data flow

1. The current same-origin Tech Check iframe bridge supplies the existing COS
   bearer session. The backend rechecks legacy active Owner and the exact existing
   same-person native identity and Owner role on every request and again before
   claiming, calling the provider, rotating, or committing a replacement pair.
2. Only explicit POST requests from the two existing official GitHub Pages and
   Cloudflare app origins with
   `application/json` are accepted. The bearer is never cookie-authenticated, so
   an attacker cannot cause an authenticated ambient-cookie form submission.
   Arbitrary preview deployments, missing/null origins, query parameters, GET requests,
   unlinked/inactive/revoked users, IT, and Service are denied. The frontend to
   Supabase API transport is necessarily cross-origin; the host-to-frame session
   transfer remains same-origin. No broader CORS or role allowlist is added.
3. A secret-free explicit status read shows the immutable portal and current
   revision. The form takes only a fresh access token and matching refresh token.
   Two masked uncontrolled inputs are never stored in React state, browser
   storage, URLs, logs, or telemetry. Values exist transiently in DOM/request
   memory only. Fields clear on submit, Close, auth invalidation, navigation,
   document hiding, and unmount. JavaScript cannot guarantee memory zeroization.
4. Submission carries only the two values, expected revision, and a random
   request ID. Per-token limits are 16,384 characters, the reconnect body is
   bounded to 36,000 UTF-8 bytes, and unsupported fields fail closed.
5. A reconnect claim uses the existing service-only RPC and shared 120-second
   rotation lease. Revision mismatch, a concurrent renewal/reconnect, or a reused
   request with a different base cannot rotate or replace credentials.
6. The server verifies the submitted access token with production `/users/me`,
   then uses the submitted refresh token in the existing normal refresh grant
   with unchanged client credentials and existing scope. It verifies the renewed
   access token's portal before any Vault replacement. Both account reads must
   match the fixed stored portal. This verifies company/client binding, not a
   cryptographic relationship between two same-company user identities; the user
   must supply the matching pair generated together.
7. Only the issued access token and returned rotated refresh token (or the
   supplied refresh token when the provider omits rotation) are atomically saved.
   SQL checks lease, request ID, expected revision, portal, expiry, and both values
   in one transaction. Validation failure or either Vault-write failure preserves
   the old pair. No existing token value is returned by reconnect status/claim.
8. A confirmed pre-rotation failure releases its lease. Once refresh is attempted,
   any uncertain provider response or persistence outcome retains the lease until
   expiry and never replays the provider refresh automatically. A lost database
   commit acknowledgement retries only the identical idempotent commit once.
9. The response contains only fixed contract/state, portal, revision, request ID,
   and a renewal-verification boolean. No provider error body or credentials are
   emitted. Browser uncertainty clears token fields and retains only request
   correlation for an explicit status check, never token replay. The latest
   reconnect receipt survives subsequent normal renewals. A later reconnect
   supersedes this single receipt; it is not an indefinite audit/history store.

## Database compatibility and release order

The SQL contract runs in one transaction. It removes the prior six-argument
function and creates the same RPC name with two optional trailing arguments.
Existing six-argument/named-argument calls continue working, with no overload.
In-flight normal leases are marked as renewals, preserving old-runtime commits.
The table remains RLS-enabled with no anonymous/authenticated privileges. The RPC
remains executable by the existing service role only; no human grants or new
credentials are introduced.

After approval: deploy the transactional contract first, verify its exact
signature/ACL and secret-free metadata only, then deploy the reviewed Edge
Function bundle preserving unrelated files, and finally publish the reviewed
Owner UI. Check the ordinary Owner and denied-role routes before offering the
user handoff. Do not invoke reconnect using tools. The user's successful form
submission proves normal refresh and same-portal account access. Resume the
ordinary already-authorized read afterward to confirm the original use case.

A frontend-only rollback can remove the form while retaining the backward-
compatible server/SQL changes. Do not roll back token values. Do not drop active
lease/receipt columns or revert the SQL contract while reconnect is in flight.

## Local verification

All credential strings in tests are synthetic. Tests cover Owner/role/origin
boundaries, response field allowlists, input/body bounds, provider deadlines,
fixed endpoints, concurrent submits, invalid/cross-portal pair preservation,
issued-pair persistence, expired/replaced leases, request/revision CAS, atomic
rollback, lost acknowledgements, six-argument compatibility, and ordinary renewal
regressions. PGlite executes the actual SQL with explicit local Vault stubs; its
serialized interleavings do not constitute multi-backend PostgreSQL concurrency
or real Vault encryption certification. Production execution remains pending.

Verification checkpoint (2026-10-10 UTC): the aggregate unit run passed 2,353
cases with 3 existing skips and no failures. Subsequent final privacy/schema-
notification hardening passed the 22 reconnect runtime/SQL cases; the broader
39-case reconnect plus ordinary-renewal group also passed. Frontend typecheck,
strict reconnect-runtime TypeScript check, Vite build, and 18 synthetic browser
cases at 390/1024/1440 widths passed. Hosted CI and production verification are
not yet run. The final exact publication head must run its required checks.

Final local review hardening also covers same-Owner session/role revocation during
verification and before an identical lost-ack commit retry. Both existing official
app origins are accepted; no new origin is introduced. These changes do not alter
SQL permissions. Fresh final focused runtime tests pass 13 cases; the prior full
aggregate and browser counts above predate this backend-only hardening.

A native PostgreSQL gate is now authored for the repository's existing fixed,
ephemeral GitHub Actions PostgreSQL service. It tests actual contended reconnect
claims and commit replay, normal-renewal exclusion, rollback if the second Vault
stub update fails, later-renewal preservation, and denied browser roles. The
ordinary local refusal/guard test passes. The native race gate itself remains
unrun until an approved exact-head hosted CI execution; no local guard override
or production database is used.

Final UI cancellation review: the actual API transport receives an AbortSignal
for both status and submission. Close, private-session invalidation, navigation,
verified parent hiding and unmount cancel a request still waiting for parent
authentication. They cannot send a captured pair with a replacement Owner
session. A request already dispatched may finish server-side; the non-secret
attempt identity remains available for explicit outcome recovery. All 30 final
synthetic browser cases at 390/1024/1440 widths pass, including delayed-parent
replacement-session/Close/hide/unmount cases with zero credential POSTs. Final
frontend typecheck and production build pass. Independent exact-source review
also reproduced the original race and verified its corrected transport behavior.
