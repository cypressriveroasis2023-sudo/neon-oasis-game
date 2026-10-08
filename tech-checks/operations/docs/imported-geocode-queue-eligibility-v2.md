# Imported geocode queue eligibility v2

`db/geocodio-imported-list-due-v2.sql` replaces only
`public.cos_imported_geocode_list_due(uuid, integer)` in the legacy geocoder
project. Apply it after `geocodio-imported-jobs.sql`; that baseline remains
immutable. The replacement refuses to run if the baseline function is absent.

The old ordered loop runs the expensive legacy device/audit guard even for
completed, in-flight, or deferred address caches. The replacement joins the
existing exact-address caches and filters those rows before entering the loop.
It keeps all candidate units in the original event/kind/native-ID order. It does
not limit or deduplicate candidates before the legacy guard: a held first unit
must leave a later allowed unit at the same address eligible.

The function's service/fixed-organization gate, limit of 80, nonblocking legacy
locks, per-unit legacy guard, and post-guard stage reads are unchanged. So are
all claim/reserve/finish, current-source, Owner-placement, manual-GPS and shared
budget safeguards. There are no grants, role changes, indexes, timeout changes,
Edge Function changes, or provider requests in this artifact. Existing function
ownership and ACLs are preserved by `CREATE OR REPLACE`.

The prefilter uses the candidate query's snapshot. A cache that becomes eligible
after that snapshot can wait until the next worker pass. A selected cache that
changes afterward is checked again after its legacy guard, and claim/reserve
remain authoritative. This change bounds guard work by eligible candidates,
not by the total fleet; many still-due held units can still require many guards.

## Validation

Run from `tech-checks/operations`:

```sh
node --import tsx --test --test-concurrency=1 tests/geocodio-imported-list-due-sql.test.mjs tests/geocodio-imported-jobs-sql.test.mjs tests/geocodio-budget-sql.test.mjs
npm run typecheck
npm run build
```

The shared database fixture loads the immutable baseline then v2, so existing
imported and budget regression tests exercise the replacement. The focused
suite executes the original and replacement SQL against the same synthetic
fixtures, using a counting wrapper around the unchanged real legacy guard.
Coverage includes cache statuses/leases/retries, paid feature/account gates,
Owner and stale-guard suppression, shared-address fallback, exact output order,
deduplication/limits, role and organization rejection, preserved function
attributes/ACLs, and cache changes during the guard.

With 185 completed jobs and three due units, 185 unrelated devices and 740
unrelated audits, local PGlite guard calls fall from 188 to 3. Growing to 555
completed jobs raises the baseline to 558 calls while v2 remains at 3. Timings
are reported diagnostically rather than asserted; local measurements do not
establish production latency or a guaranteed timeout bound. All fixture
addresses, unit labels, and history are synthetic.

## Serialized deployment and rollback

1. Verify the reviewed file hash and intended legacy project. Read and retain
   `pg_get_functiondef('public.cos_imported_geocode_list_due(uuid,integer)'::regprocedure)`
   plus its owner, ACL, security, volatility and `proconfig`. Compare the live
   baseline with the immutable baseline function. Stop if it differs.
2. Apply the exact reviewed v2 artifact once within the existing serialized
   release procedure, away from an active worker invocation. Its transaction
   either replaces the function completely or rolls back. Do not rerun the
   original full baseline migration.
3. Read back the function definition and metadata. Confirm the candidate query
   changed and owner/ACL/security/configuration did not. Verify the other
   imported helpers and claim/reserve/finish definitions are unchanged.
4. Run a bounded read as the actual service role, using the existing timeout,
   and record elapsed time plus returned count/stages without publishing raw
   addresses. This RPC only lists candidates; do not claim/reserve or invoke a
   provider as part of the read check. Observe the next already-scheduled worker
   for a successful queue-read stage and ordinary progress.
5. If verification fails, restore only the captured baseline function with
   `CREATE OR REPLACE FUNCTION` in a transaction, preserving its ACL. Re-read
   its definition and metadata. No cache, job, cursor, budget or provider state
   needs rollback because this artifact does not change them.
