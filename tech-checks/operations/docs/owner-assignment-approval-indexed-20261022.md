# October 22 Owner assignment approval timeout

The October 22 source-evidence refresh is complete. The live Owner preview and
stage independently verified 1,001 Product IDs, 284 Field and 717 Shop using the
unchanged census validator. The Owner explicitly authorized assignment approval
and final import in chat. No import has committed.

At 23:04:24 UTC (6:04 p.m. Central), PostgreSQL canceled the public assignment
approval RPC with SQLSTATE 57014 at its repeated tracker-record lookup. A fresh
read succeeded, but approval timed out. Readback confirms the stage has no
assignment approval, applied timestamp or applied receipt. This is a processing
failure, not evidence of a CSV mismatch or additional required Owner information.

This candidate replaces only
`public.cos_owner_mhelp_assignment_review_v1(uuid,uuid,uuid,text,text,text,text,text)`.
It indexes review items and prior source/tracker rows once per request, retaining
ordered duplicate groups. STRICT prior-row selection still rejects missing or
duplicate matches. Lazy construction preserves unused-array behavior. Array
accumulation preserves exact row order and null values without rebuilding a large
JSON array on every iteration.

All Owner checks, source/census hashes, stage identity, current-state digest,
explicit approval note, locks, full admission validation, immutable historical
evidence and post-update digest check remain intact. No timeout is raised and no
permission or configuration is changed. No caching across requests is introduced.

The migration refuses installation unless the exact installed definition SHA-256
is `21cb8f20495b403c997aec9d875d2457af0b2686bca8037f652b09ea676a8e11`
and its owner, ACL, volatility, security-definer status and function configuration
match the reviewed production definition. A repeated installation aborts.

Tests execute the complete original and candidate approval functions with a
synthetic 1,001-record/354-review-item fixture and compare complete response JSON,
stored stage rows, downstream admission inputs and idempotent replay. Only the
nondeterministic approval timestamp is excluded from stored-state comparison.
External authorization, identity recovery, locks and full admission validation
are fixture boundaries; the existing guarded transaction suites cover those
dependencies independently. Negative cases cover STRICT duplicate/missing rows,
null IDs, ordered tracker selection, validator rollback, denied actor, stale
digest and migration drift. Both PGlite and PostgreSQL 17 CI run these checks.
Synthetic timing is diagnostic, not a deployed performance claim.

## Release boundary

This PR does not install the migration or import equipment. Wait for exact-head
CI, including the full browser gate. Separate approval is required to merge and
install this new repair. Earlier PR #279 release approval covered census error
diagnostics, not this new database function replacement. The Owner's final import
authorization is recorded and need not be requested again for the same source.

After authorized installation, verify the deployed definition and unchanged
protected functions, then use the existing authenticated Owner UI. Refresh or
restage if its guards or expiry require it; never rewrite saved guards manually.
Completion requires a committed October 22 source receipt plus independent saved
inventory and Fleet/map readback, with preserved identities, operational IPs,
SIMs, camera links, GPS and historical movement records.
