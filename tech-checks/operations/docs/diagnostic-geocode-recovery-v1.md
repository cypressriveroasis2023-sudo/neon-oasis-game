# Bounded historical geocode recovery candidate

This is a local review artifact. It was built from commit `ff7caca`, which matches all ten files of the deployed legacy geocoder v9. No provider request, database deployment, enrollment, publication, credential change, or permission grant is part of this candidate.

The old undifferentiated `no_match` records cannot distinguish a true provider miss from a rejection by the earlier selector. The separate `pre_selector_diagnostic_v1` cohort allows one new Census request and, only after its fresh `no_match`, at most one fallback reservation per reviewed exact address. Successful results use the existing accepted-cache and map projection path. Failed results retain the existing safe, specific reason codes and request receipts.

## Contract

- Add one nullable JSONB column to the existing serialized account-state row. Its first assignment fixes a policy, canonical manifest digest, and one representative full source binding per exact hash, capped at 35 hashes. The reviewed production manifest stays outside the repository.
- Store immutable complete Census and fallback before-images. Runtime comparisons decode those snapshots into the native composite types, preserving full-record equality across session time zones. Both must be terminal plain `no_match`, match the reviewed timestamps, and date from the historical window before the selector fix. Enrollment rejects accepted, pending, changed, or postal-cohort records and does not alter any cache, lease, attempt count, budget, or source.
- A trigger freezes the cohort, bindings and before-images. Each provider request ID changes from null to a real request ID once. The IDs cannot be reset or replaced. The trigger has no callable EXECUTE grant, uses SECURITY INVOKER, and does not create a privilege boundary.
- Extend four existing service-only RPC definitions in place: the ordinary imported queue selector, imported Census claim, imported fallback reserve, and the shared-address Owner fallback reserve. Existing function identities, owners, ACLs, invoker modes and search paths remain. There are no new RPCs, roles, tables, credentials, grants, schedules or worker changes.
- Run the current source bridge reads and current SQL source/Owner/precedence guards. A changed representative fails closed; the worker does not choose an unreviewed replacement binding for the same address. Shared current units still consume the accepted address result through existing projections.
- Consume the one-time allowance only with a real committed request or ledger reservation. Concurrent claims serialize on the existing account lock. Provider errors, lost acknowledgements and expired leases remain spent. No ordinary shared-address path can resend the same current diagnostic revision.
- Preserve the existing free-only control, account stop/cooldown handling, day-boundary send deadline, attempt limits and global 2400-credit cap. Budget/configuration deferral preserves the historical cache and leaves the allowance unspent. A fresh accepted imported or Owner cache stops recovery. A genuinely newer Owner decision retains its existing precedence.
- Preserve the frozen ZIP+4 postal policy and its tables. This candidate does not enroll, modify or extend that policy. The legacy list-due RPC, finish RPCs, source projections and deployed v9 worker stay unchanged.

The JSONB column uses the account row because that row already has the exact backend read/update permissions and serialization lock needed by the worker. A separate table would need new privileges or a definer boundary. Its size and work are bounded by 35 entries; this is a one-time recovery contract, not a general queue design.

## Review artifacts

- `db/geocodio-diagnostic-recovery-v1.sql`: candidate schema and four exact deployed RPC bodies with the bounded additions.
- `db/geocodio-diagnostic-recovery-v1-operator.sql`: existing administrative enrollment workflow, rollback by default. Inputs are current bridge bindings plus the two previously reviewed cache timestamps. Exact replay does not add or reset work; changed membership is rejected.
- `db/geocodio-diagnostic-recovery-v1-report.sql`: read-only, per-hash receipt with request identities, charged day, completion status and safe reasons. It emits no addresses, source bindings, provider bodies or credentials.

Before any separately authorized rollout, compare the four deployed definitions and all owner/ACL/schema settings with the reviewed baseline, reconfirm all 35 current bridge bindings and historical cache timestamps, inspect the rollback preview, and verify the exact immutable membership. The existing worker then consumes the cohort; a worker deployment is unnecessary. The operator script is deliberately not a production manifest.

## Validation

`tests/geocodio-diagnostic-recovery-postgres.py` runs against a disposable database on a localhost-only PostgreSQL server. It uses synthetic identities and addresses. It verifies concurrent cohort enrollment, immutable evidence, duplicate/shared-address claims, real idempotent finishes, stale source/Owner handling, accepted-cache preservation, uncertain lease exhaustion, explicit America/Chicago enrollment versus UTC worker calls, unchanged ordinary queue behavior, Owner fallback precedence, final-credit serialization and every preexisting owner/ACL/invoker/search-path/RLS/private-schema setting.

Example against an already-running disposable local server:

```sh
python tests/geocodio-diagnostic-recovery-postgres.py --psql /path/to/psql --port 55432 --user agent
```

`tests/geocodio-diagnostic-recovery-worker.test.mjs` drives the unchanged live-v9 worker through synthetic native and legacy databases, a stub source bridge and intercepted provider responses. It verifies real accepted map estimates, one shared-address lookup, source GPS changes during a request, permanent charged failures and no resend on the next sweep. All provider traffic is stubbed.

```sh
node --import tsx --test tests/geocodio-diagnostic-recovery-worker.test.mjs
```

The targeted regression set also covers imported pipeline, sibling settlement, postal recovery, safe rejection reasons and ZIP precision. The final local handoff records the exact results and candidate commit separately.
