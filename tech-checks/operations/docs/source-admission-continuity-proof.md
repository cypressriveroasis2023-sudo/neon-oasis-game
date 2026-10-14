# Source admission continuity proof

This change supplies a proposed SQL mechanism and synthetic verification. Publishing or merging it does not run the SQL, admit sources, or contact any geocoding provider.

A new source row changes the complete graph hashed by an immutable upload binding. The candidate keeps the original upload receipt and graph function unchanged. A private append-only transition records the exact reviewed source-only delta for every affected MHelp and tracker binding. Readers accept only the latest complete graph head for the exact active upload source, payload, pair and original guard.

Admission is administrator-only and insert-only, with a maximum of eight rows. A narrower operator manifest must bind the actual approved records and full membership list to an exact input hash. Each row must match the active upload ProductId, native/tracker IDs and labels, FIELD placement, eligible lifecycle, normalized address components and complete customer label. Held identities, existing sources, API-link overlap and graph drift fail closed.

The transaction requires READ COMMITTED, locks the upload control row, takes sorted native try-advisory locks, then NOWAIT table locks covering complete graph and trigger-side-effect dependencies. It checks exact source/event postimages and all unaffected records. It adds no API grants, service credentials, public mutation endpoint or provider retry behavior.

Rollback tombstones only the unchanged admitted source heads, retains source/event history and appends reverse continuity. Continuity-aware readers and the audit ledger must remain installed afterward. Restoring the old equality-only reader would invalidate identities because historical source rows remain in the full graph.

## Verification

- `source-admission-continuity.test.mjs` executes real SQL graph digests in a disposable PGlite fixture. It covers complete memberships, immutable receipt preservation, atomic failure, role denial, stale/held graphs, source/address/customer mismatch, real archive/recorded-coordinate triggers and exact-head rollback.
- `source-admission-continuity-postgres.mjs` requires a dedicated empty loopback PostgreSQL database with synthetic credentials. It uses real independent sessions to verify lock waits, concurrent phantom writers, advisory contention, repeatable-read rejection, idempotent admission and rollback.
- `cos-source-continuity-proof.yml` runs the multi-session proof using the repository's existing pinned PostgreSQL test client and PostgreSQL service pattern. It does not connect to an application database.
- The trigger baseline is test-only generic deployed behavior. Never apply that fixture baseline to production.

A production admission still requires independent review, exact installed-catalog comparison, current guards and active upload, terminal-cache/hold verification, an atomic rollback-only dry run and complete before/after roster and accepted-point checks. A passing synthetic test does not authorize any private cohort or waive those checks.
