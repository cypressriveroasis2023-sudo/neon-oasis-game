# mHelp automatic intake runtime (local proposal)

This directory and its sibling Edge functions are locally assembled but disabled
preparation. Protected `Deno.serve` entrypoints now exist; no deployment, migration
application, cron activation, environment mutation, new credential, notification
or vendor business write has occurred. No operational source schema adapter is registered. Enabling a policy or toggling a
switch cannot produce a working production source mapper.

## Boundaries

- The scheduler-facing legacy handler accepts only `{"action":"run"}` after the
  existing Camera Health verification. Its response contains bounded counts, states
  and allowlisted errors only. This is the only response safe for a pg_net job.
- The legacy runtime uses its own already-available service client to call ONE
  service-only public RPC, `camera_mhelp_ticket_intake_v1(p_request)`. It does not
  impersonate an Owner or transfer a service key to native Operations.
- The native source handler accepts only the fixed `ticket_batch` action and a
  bounded creation window. It independently fetches the legacy authoritative policy
  through the existing verifier's locally prepared `intake_policy` action, reusing the
  incoming Camera Health credential. No request may choose a portal, actor,
  assignment, URL, credentials or activation settings.
- The policy read returns the fixed portal, activation floor, schema evidence and
  type/identity/source-status-policy coverage booleans. These booleans are diagnostics,
  not global discovery gates. Ready authority still requires the reviewed portal,
  activation floor and exact registered schema evidence. SQL independently checks
  every ticket’s type, status, identity and current profiles before creating work.
  There is only one durable watermark, in legacy.
  Repeated bounded source reads are intentionally allowed for retries and overlap.
- `createNativeMhelpTicketAccess` takes the SAME `nativeMhelpTokens` object already
  constructed by native maintenance. Its optional constructor fallback uses the
  identical existing manager and token-session RPC, never a parallel store. The
  account read renews once on HTTP 401, retains the fixed portal constraint, and
  uses only fixed account/type/status/ticket GET endpoints. The original manager
  continues to own single-flight rotation, lease contention and durable pair commit.
- Source schemas are not assumed. The unregistered adapter must verify real type,
  status, assignment, site/work and equipment structure before using the bounded
  reader. The known preview DTO deliberately lacks work/equipment details and is
  insufficient. Actual rowIndex semantics also require verification; this prepared
  access layer does not silently guess a different pagination convention. A future
  evidence-bound type registry may project only verified routes; unknown types
  remain in the complete source batch with `request:null`, never silently filtered
  out. The production registry remains empty until its real source proof exists.
- Operational ticket responses travel directly native Edge → legacy Edge, never
  through pg_net request/response tables. HTTP output is no-store; no implementation
  logs source rows, raw errors, billing, contacts, attachments, credentials or headers.
  Only the normalized allowlisted work envelope reaches the private receipt RPC.

## Runtime and storage contract

Apply `legacy/mhelp-intake-proposal.sql` definitions and then
`intake/mhelp-intake-scheduler-proposal.sql`, then
`legacy/mhelp-local-lead-upgrade-proposal.sql` as one reviewed fresh-deployment assembly.
An existing disabled PR114 installation uses only the forward local-lead upgrade;
see the legacy README for drift guards and deployment order.
The latter supplies only private, explicitly revoked helpers and an RLS table;
the former owns the only exposed service-role-only wrapper.

- `begin`: database-derived fixed portal/window, a 180-second fenced lease, or an
  aggregate disabled/busy/backoff/idle state. No caller-supplied scope.
- `record`: `{leaseId,ticket}`; the wrapper validates the current lease and exact
  portal/window, then atomically records an immutable source receipt with any work.
- `finish`: `{leaseId,expectedTicketIds,total}`; verifies all expected unique keys
  have durable created/review receipts in the same window/schema, then commits the
  forward-only watermark. Repeating the identical finish after an uncertain response
  is safe; a different manifest is rejected. A lost finish acknowledgement is marked
  `completionUncertain` if retries do not establish the result.
- `fail`: `{leaseId,code,retryable,retryAfterSeconds?}`; no cursor advance, only a
  safe allowlisted code and persisted cooldown. Optional provider seconds must be
  an integer from 0 through 86,400; SQL uses at least the existing backoff and the
  requested delay. Stale workers cannot clear a newer lease.
- Private state includes last attempt/success times, failure count, retry time,
  last safe error code, completed lease and its exact expected manifest.

The fixed minimum poll interval is five minutes, enforced durably by the private
begin action before source access. The prepared provider-reconcile hook reuses
its three existing cron opportunities at :03, :06 and :09 in every 15-minute
block. Their 3/3/9-minute spacing normally yields eligible polls six and nine
minutes apart (at most eight per hour); the middle +3-minute request is idle.
This is not an exact five-minute polling schedule. A run advances at most 15
minutes to catch up after short outages, overlapping the last ten minutes; each complete source
batch is at most 500 tickets, 50 per page and ten pages. Reads are strictly within
an independently checked 25-minute-plus-1ms window and never before activation.
The initial strict lower bound is activation minus one millisecond so a ticket at
the exact activation millisecond is included. Store activation in canonical UTC
with millisecond precision; do not set an arbitrary historic floor.

A run has a 120-second maximum budget including a short failure-recording reserve.
Transient failures without a cooldown have at most three attempts with bounded
exponential delay plus jitter. Source errors preserve their explicit retryable
flag across the native HTTP boundary: a vendor 403 or post-renewal 401 cannot turn
into an immediate retry just because that boundary returns 503. A Retry-After
integer or HTTP-date is reduced to bounded numeric seconds (maximum 24 hours);
missing/invalid values on 429 fall back to 300 seconds. Any supplied cooldown,
including zero, ends immediate attempts and is persisted by the same fail action.
Opaque failures from the unchanged token manager also defer 300 seconds instead
of repeatedly attempting renewal. Its hidden provider response is not parsed.
SQL retains its 30-second–30-minute exponential/permanent backoff and never uses
less than the supplied provider delay. If failure persistence itself is unavailable,
the lease still fences writes, but the provider cooldown cannot be guaranteed;
the next scheduled run may resume after lease expiry. Empty complete scans can
advance; missing/incomplete/duplicate/reordered/changing-total/over-limit scans
cannot. Receipts commit before watermark movement, so a crash retries unchanged
source keys rather than recreating claimed/completed/manually edited work.

`complete` and last-success timestamps mean the source scan was durably accounted
for, not that assignments were created or every mapping is ready. An all-held
scan advances only after every review receipt exists and reports zero created,
with the full review-needed count. Such a scan is not proof of operational rollout
success. Mapping coverage and held work must be reported separately.

A null request is retained as an unresolved immutable snapshot. Filling in a new
projection later requires explicit reconciliation; do not rewrite the receipt or
loosen equality. Exact private mapping/status repair may promote an unchanged
envelope only when that ticket is read again within the existing bounded scope.
There is no automatic reprocessing of older holds beyond the overlap window.

The ten-minute overlap mitigates short source indexing delays. It does NOT prove
late visibility or old-ticket changes are fully covered. A source ticket first
visible after that overlap can be missed; an over-500 window is held rather than
silently skipped. Production activation needs actual source guarantees or a
separately reviewed reconciliation approach for those cases.

## Remaining activation gates

### Existing cron runtime hook (prepared, not deployed)

The local `camera-provider-reconcile` handler registers one background intake
pass only after its existing cron verification succeeds. Requests with Origin or
Authorization headers never start intake; the existing Owner/IT provider fallback
and provider response remain unchanged. Names-only production inspection confirmed
that cron jobs 3/4/5 target this function with the cron header and no Origin or
Authorization header. No cron job, frequency or additional camera work is added.

`mhelpIntakeBackground.ts` reuses that invocation's existing SDK service client
and the existing-credential native source transport. It does not read Vault,
look up a credential, make a loopback request or create a grant. The protected
restricted intake RPC remains the only new data capability, separately reviewed.
The database policy still decides whether intake is enabled; the production
source adapter remains unregistered. This hook cannot enable either one.

`EdgeRuntime.waitUntil` receives a caught promise; provider success or failure
does not gate intake and intake is never awaited by the provider response.
Registration failure starts no untracked work. Each pass has at most the existing
120-second budget including cleanup, additionally capped at invocation start plus
140 seconds as a conservative invocation ceiling. Hosted wall-clock limits apply
to a worker that may serve multiple requests, so this does not guarantee remaining
worker lifetime; the platform may still interrupt it earlier. Background transport uses its own run
signal, so sending or cancelling the provider response does not cancel intake.
Camera-health-sweep and its 52-second deadline are unchanged. These tasks still
share platform/database resources; production timing requires verification and
background execution is not a durable queue. The next eligible cron request and
existing lease/replay semantics recover interrupted work without moving its cursor.

The durable five-minute poll guard follows busy/backoff checks and precedes lease
creation. It does not change the 180-second lease, receipt protection, provider
cooldown or 15-minute-forward catch-up bound. A throttled request returns `idle`
without updating attempt timestamps or the watermark and without vendor reads.
Failure retries respect the later of their backoff and the minimum poll interval.
Intake output does not enter the provider response or logs; safe status remains
in the existing restricted review projection.

### Deployment prerequisites

1. Inspect the real read-only schema evidence and register a production adapter
   with matching evidence for the authorized fixed portal and new-only bounds.
   Approve exact workflow/identity mappings and open/terminal/custom-status
   classifications for tickets that may create work; unknown per-ticket mappings
   remain durable review holds instead of preventing discovery globally.
2. Reconcile and test the assembled service wrapper/helpers against the actual
   legacy trigger/schema contract and privilege checks.
3. Publish the locally assembled protected entrypoints only after review. The
   original verifier keeps its exact authenticate response; the new intake_policy
   callback uses the existing cron check. Legacy intake accepts only cron run or
   genuine active Owner review_status, never both credential modes. Server-to-server
   requests must omit Origin; the Owner browser uses the existing Operations proxy.
4. Expose the bounded `review_status` DTO through a real Owner-authenticated backend
   read route; the prepared `mhelpIntakeReview.ts` projector allows only counts, last
   attempt/success/error state and at most 25 printed ticket references with fixed
   reason codes. The Owner-only legacy Edge read mode uses that DTO; regular users get no SQL access.
5. Verify expected local/legacy app visibility with real authorized records, then
   set the reviewed activation floor and enable the existing cron path. Never put
   operational ticket payloads into pg_net, which retains request/response data.

## Verification

`node --import tsx --test --test-concurrency=1 tests/mhelp-intake-runtime.test.mjs`
uses only synthetic in-memory transport and isolated PGlite data. It covers auth
before reads, field rejection, no sensitive output, page bounds, source scope,
duplicate keys, retry/backoff, deadlines, leases, crash/replay, immutable manifests,
review receipts, policy changes and token-manager renewal/rotation continuity.

The new core/source/handler/transport files pass standalone strict TypeScript.
The token-access file also passes with the repository's existing token dependency
under `--strictNullChecks false`; standalone strict-null checking reaches pre-existing
errors in unchanged `mhelpTokenSession.ts`. Do not silently claim those existing
files were modified or strict-null checked successfully.

## Local Edge assembly

New function entrypoints:
- `supabase/functions/camera-mhelp-ticket-intake/serve.ts` on legacy
- `supabase/functions/cos-mhelp-ticket-source/serve.ts` on native
- Existing legacy `supabase/functions/camera-mhelp-readiness/serve.ts` gains only
  the protected policy read alongside its compatible authenticate action

Use `tech-checks` as the common bundle root so `operations/intake/` imports remain
inside the bundle. Include the reachable canonical DTO under
`supabase/functions/cos-operations-pages/mhelpIntakeReview.ts` and existing token
modules. Do not copy a divergent projector or escape the bundle root. The existing
flat Operations bundle can include that self-contained pure projector without
including scheduler modules. No deployment was performed by this local assembly.

All three cron-compatible functions require their existing handler-owned custom
cron verification instead of the gateway-only JWT check. The legacy intake handler
independently verifies genuine Owner JWTs with `auth.getUser` and current profiles;
it does not trust decoded claims or caller-supplied actor IDs. Review requests have
10-second auth/read caps and 256-byte bodies; all cron/source HTTP outputs have
no-store/nosniff headers. No new credential, SQL grant or cron job is created here.

The deployed verifier baseline was freshly checked before this edit: ACTIVE v2,
verify_jwt=false, exact serve/index source match, artifact SHA
`c480a34bf3d0b3791ce78c5bf43b2405fc1207765d053cf131b05737823aa8f1`.
Reconfirm before publication if other work changes the function.

## Real PostgreSQL concurrency CI

The existing verification job additionally starts the official pinned
`postgres:17.11` ephemeral service and runs
`node --import tsx legacy/tests/mhelp-postgres-concurrency.ci.mjs` using the hosted
runner's psql client. This mandatory step retains all original workflow guards,
unit/type/build/browser checks and publishing protections.

The harness requires GitHub Actions plus its explicit CI flag, uses only a fixed
127.0.0.1 test database with synthetic credentials, and does not consume any
production connection variables. It reuses the exact legacy fixture initializer,
proposal SQL, real scheduler SQL and captured workflow contract. Independent psql
sessions establish actual lock contention before releasing the first transaction.
It checks duplicate Swap intake, a human-style legacy table lock with NOWAIT and
no cursor advance, and discarded acknowledgements followed by genuine synthetic
claim/manual edits/completion. Replay must preserve the assignment rows and any
notifications generated by the human claim.

Local validation checks syntax, isolation guards, workflow preservation and fixture
reuse. This execution environment has no psql/server, so the real concurrent-session
tests are prepared for hosted CI and must not be reported as run until CI executes.
No local Docker daemon or launch workaround is assumed.
