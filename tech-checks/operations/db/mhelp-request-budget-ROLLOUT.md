# Shared mHelp request admission — release prerequisites

This candidate is part of the existing COS reliability repair. It is not a
replacement application, scheduler, or token store. It is **not installed**.
Scheduler jobs 7 and 11 remain Owner-paused. Job 10 remains active.

The new gate debits one durable admission for each vendor call, including every
page, retry, token request and account verification. It uses a shared 400 ms
minimum admission spacing, a configurable 4,800/day COS ceiling and a 200-request
essential reserve within that same ceiling. These are conservative COS policy
settings, not additional vendor allowances. Other account integrations are not
measured by this ledger. Admission counts include abandoned requests and requests
subsequently refused by the existing provider backoff; they are an upper bound on
network calls, not a claimed provider usage meter.

Installation does not know earlier usage for the UTC day. The initial hold waits
for the next UTC reset rather than claiming a new installation resets the vendor
allowance. Genuine provider holds, including holds crossing midnight, remain in
force. Neither essential classification nor the reset bypasses those holds.
Normal browser roles cannot spend, inspect, reset or modify the allowance.

The outer admission wrapper uses the existing inner provider backoff. A local
budget refusal never records a new provider 429. If accounting is unavailable,
requests fail closed. No permission is cached between calls. The accounting
tables contain only days, counts and timing; no credentials or request URLs.

## Required before production installation or resuming reads

1. Pass exact-version normal CI and real PostgreSQL multi-client pacing/daily-cap
   tests; local PGlite tests are not proof of distinct PostgreSQL sessions.
2. Finish persistent identity-bound customer/service/category caching with real
   observation times and address-only refresh. Do not promote cached address
   proof to a fresh vendor observation. Preserve complete-source comparison.
3. Finish measured-cost full-scan admission/cadence. Existing source age guards
   must keep their meaning; stale placement remains queued with real timestamps.
   A daily cap by itself is not a sustainable synchronization strategy.
4. The candidate now includes expiry-aware ensureAccess and revision-bound
   invalid-grant suppression using the existing token lease/CAS manager. Finish
   real multi-client verification and the coordinated deployed-bundle rollout.
   Change EXISTING renewal job 10 to an hourly :01 UTC metadata check ONLY AFTER
   the new readiness worker is verified: its six-hour margin requires a check
   interval shorter than six hours. Do not run the old forced-rotation worker
   hourly. The new renewal action never launches an inventory preview, never
   claims renewal on a not-due check, and preserves a committed pair on a later
   account-read failure. Actual unattended renewal is still unverified.
5. Inspect all current deployed bundles and preserve newer unowned code. Build a
   coordinated delta for operations, readiness, assignments, inventory,
   placement, ticket source and the diagnostic renewal helper. The latter still
   imports an older pinned manager and must not be mistaken for gate coverage.
   Search for other account readers, including external integrations.
6. Record fresh preservation fingerprints. Install the reviewed gate and read
   back its ACL/configuration. Roll out all covered workers while 7/11 remain
   paused; never briefly resume uncovered writers/readers.
7. Resume only after the bounded-cost source strategy passes verification; observe
   two real scheduled source successes, matching placement/address processing,
   measured budget headroom and one real unattended renewal. Do not force token
   expiry or claim completion from this candidate or green CI alone.

No source inventories, credentials, native equipment, IP/SIM/GPS, health, history,
addresses, Google cells, current permissions or production schedules are changed
by authoring this candidate.
