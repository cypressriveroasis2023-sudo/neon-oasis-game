# Exactly one Owner Census attempt

Review artifact only. Installing the SQL does not enroll a target or call a provider.

## Scope and immutable allowance

The existing private global account table receives two nullable JSON columns:
one allowance policy and one distinct preparation marker.
The service role already has table-level SELECT/UPDATE. Existing RPC signatures,
function owners, EXECUTE grants, invoker modes, search paths, table ACLs and RLS
remain unchanged. The existing private non-callable diagnostic trigger gains an
independent allowance and preparation validation branches; the original diagnostic branch is unchanged.
The patch checks exact deployed function-definition digests, stops on drift and is
idempotent. No new public function, credential, role, grant or network permission
is introduced.

The separate preparation marker is immutable, exact-target and bound to the
verified authorizing legacy Owner. It accepts only the current invalid_address
terminal before-image, exact audit/roster and no competing same-address work.
It does not contain execution/source digests or an allowance. Existing read-many
returns only censusPreparation:{nativeUnitId} for that exact authenticated Owner,
never service, IT or another Owner. Cache/source changes remove the control.
The normal Owner-only preparation route performs the full current proof through
existing actor authentication and returns only eligibility, the two digests and
a server preparation timestamp. It never claims, calls a provider or writes data.
This resolves the auth.uid-gated epoch bootstrap without impersonation, token
extraction, placeholder digests or a duplicate implementation of private RPCs.

A separately approved private one-row enrollment CAS records one exact current
Owner audit, normalized full address/hash, native identity, actor-bound execution
proof and actor-independent complete-source digest,
audit-row digest, exact device roster, original Census row and approval reference.
The private enrollment operator requires the exact preparation marker and genuine
normal-UI preparation digests. Enrollment leaves the terminal Census row untouched. It rejects another current
Owner job for that address, any current imported job, any outstanding same-address
Owner/imported Census permit even after source supersession, active fallback reservation,
successful fallback, postal retry cohort or diagnostic recovery overlap.

The database trigger assigns the real enrollment timestamp, replacing any caller
timestamp. A mandatory 480-second drain begins while all ordinary same-address
claims/reservations are already held. Exact target reads show draining and the
server not-before time; no allowance can be consumed until the SQL clock says ready.
This exceeds Supabase hosted worker wall-clock limits (currently at most 400s).
Verify that platform limit still applies before deployment; if it changes above
480s, stop and review the bound. Source: https://supabase.com/docs/guides/functions/limits

The policy is frozen. Only null claimToken/consumedAt may transition once to the
real committed Census claim. The matching cache attempt count increments without
resetting historical attempts; the before-image is immutable. Ordinary callers
cannot reset, delete, change the target or rearm it. The hash hold is lifetime,
including after an audit changes or a new calendar day starts.

## Claim protocol

Ordinary list_due excludes the held address. Exact targeted list_due returns a
policy-marked row, including after consumption. Only a new, explicitly targeted
handler may call the unchanged claim signature with a versioned audit discriminator:
owner_one_census_v1:<numeric audit ID>. SQL strips this prefix before validating
and locking the exact original audit. Unprefixed old or direct claims cannot spend
the allowance. A prefix without an enrolled exact binding grants nothing.

The source lock and Owner Census row are acquired before the global account row.
After the drain, claim independently rechecks all visible outstanding same-address
Census and fallback permits. Allowance consumption and cache claim occur in the same transaction before the
worker can perform network I/O. Every Owner fallback list and reserve checks the
hold. The imported Census/reserve paths also deny the exact held address under
their existing account lock, so shared-address work cannot bypass the boundary.
No unrelated queue, cron schedule, budget or fallback behavior is changed.

The worker proves the native source before claim, after claim immediately before
the only provider send, and after its response before finishing. Each read uses
the bounded Owner-only exact-target proof route under the original actor; the
route retains complete identity/collision and archive/precedence validation while
avoiding unrelated estimate hydration.
One safely parsed Census request uses street/city/state/supplied ZIP(+4), never
suite text, native identity or credentials. There are no redirects or retries.
No response, timeout, crash, invalid response or lease expiry restores permission.
The normal original-audit/claim-token finish path retains current legacy source,
audit digest and roster checks. Success is only an unverified building estimate.
No GPS, original source address, device assignment or audit is written.

A provider_error row retains the old schema's mandatory retry timestamp for truthful
schema compatibility. The durable policy removes it from ordinary eligibility
forever; the timestamp does not authorize another request. A crash may leave a
pending row with an expired lease, also permanently excluded. Allowance consumed
means at most one possible provider send, not a claim that a network request
necessarily completed.

## Rollout and limits

Old deployed handlers see the marker but make unprefixed claims, which are denied;
then fallback list/reserve deny the held address. This protects old requests that
have not previously received a send permit. Already-issued permits need the drain
gate below. Do not roll back these durable SQL holds after enrollment.
An in-flight fallback reservation cannot be retroactively stopped; enrollment
rejects any existing active reservation before permission is granted.

Native and legacy projects cannot perform atomic cross-project CAS. An existing
actor-authorized native proof path is required, and final map admission must still
independently reject newer source/GPS/identity conflicts. Do not extend the existing
imported-source read key to new Owner identities without separately reviewing and
approving that persistent access scope. Missing proof fails closed with zero
Census or fallback traffic.

Private enrollment values and production target IDs/hashes do not belong in source,
fixtures or public reports. The parameterized enrollment/readback proposal is kept
with private release evidence. Full PostgreSQL concurrency tests and exact runtime
checks are release prerequisites; focused unit tests alone do not authorize release.

Existing authorized read-many responses expose only the bounded state plus the
native identity/execution digest and a separate source digest for an exact currently
admitted binding. The two-key execution guard and action body remain unchanged. They never
expose enrollment approval references, tokens or before-images. If the audit
fingerprint changes, the whole guarded result is omitted; a guarded success must
never lose its marker and be interpreted as an ordinary unguarded estimate.

The new action is Owner-only. Its native proof must bind the verified authorizing
Owner actor identity as part of the opaque fingerprint. Approved IT retains only
its existing ordinary features; service or cron credentials cannot replace an
Owner actor proof for consuming this allowance.

Before execution, the release owner must verify that the actual deployment's
enforced maximum worker runtime is below the server-enforced 480-second drain. A lease
expiry is not evidence that an old process stopped: old Census handlers do not
recheck a permit immediately before fetch, and cache expiry can overwrite a prior
permit. The SQL rejects every visible outstanding same-address permit and prevents
any newly granted ordinary permit after enrollment. Strict at-most-one execution
also requires allowing the mandatory post-enrollment drain to mature before
consuming the policy. Never imply deployment completion or an expired lease alone proves this.

The drain trusts the hosted database wall clock and worker-lifetime enforcement.
It does not revoke an old request during the waiting interval. The precise bound
is one newly authorized Census attempt after draining and no new ordinary or
Geocodio permits from enrollment onward. If reporting all actual HTTP activity
immediately after enrollment, also verify pre-existing permit/quiescence evidence;
do not infer it from the new policy alone.

## Runtime budgets and visibility

Only guarded claims use a 220-second lease; ordinary claims retain 60 seconds.
Native preparation/proof admission has a 75-second absolute deadline measured
from handler entry, including authentication and envelope decoding. Late inherited
authentication is rejected before any proof work or forwarding; this is a bound on
successful admission, not a hard watchdog for stalled authentication transports.
Each legacy caller allows 80 seconds for the entire native proof response and
asynchronous canonical validation. Both complete target/history/site/epoch rounds
remain serial and unchanged. Every target dependency, Census request and legacy
RPC retains its 10-second limit. Per-dependency maxima need not all fit: exhausting
the aggregate proof deadline fails closed rather than dropping any read.

The targeted guarded worker has a 310-second logical budget. It requires 280
seconds before proof one, 200 before claiming, at least 210 seconds of returned
lease before proof two, and 110 seconds of both worker budget and lease before
the provider send. At least 10 seconds of each must remain before finish. With
80-second proofs, bootstrap authentication/list30 + three proofs240 +
claim/Census/finish30 = 300 seconds, leaving 10 seconds of worker margin. The
220-second lease covers claim response10 + proof80 + Census10 + proof80 +
finish10 = 190 seconds, leaving 30 seconds. Source uncertainty can burn the
allowance without sending; expiry never restores permission. Ordinary processing
retains its 100-second budget and all existing ordinary leases.

Native forwarding waits at most 315 seconds after its successful initial proof.
The nominal native admission75 + forwarding315 = 390 seconds leaves 10 seconds
against the separately verified 400-second worker-lifetime assumption; the
server-enforced enrollment drain remains 480 seconds. These are not delivery or
execution-continuation guarantees. The hosted HTTP idle limit may return at 150
seconds, including on the native-to-legacy call, and disconnect may leave work
uncertain. No timer change creates background ownership or a retry allowance.

The browser observes exact Prepare/Run POSTs for up to 120 seconds and Field Map
GETs for 90 seconds; other requests retain 30 seconds and parent authentication
retains its separate 10-second limit. A slow paired camera-health read can fail
independently without cancelling the Field Map source. These limits apply per
request, not to the whole multi-read preparation interaction. Prepare exposes
only timeout/auth/source_hold/upstream_failure/cancelled failure categories; raw
backend error bodies are discarded. Selection/session cancellation and complete
preflight/readback checks remain mandatory. Run never retries its POST and can
only inspect saved state after uncertainty. Longer observation does not prove
that a slow Run finished or authorize another provider attempt.

The execution proof is bound to the approving Owner actor. A separate immutable,
domain-separated source digest covers the same complete target identity and source
records without actor identity. Existing authorized map readers reproduce that
source proof under their own actor's existing equipment.view, site-membership and
history-RPC permissions. Only matching current source admits the saved building
estimate, including for approved IT; execution remains Owner-only. Hidden native,
site or history drift suppresses the guarded result. No identity substitution, IT
action, raw-history route, new grant or source-key scope is introduced.
