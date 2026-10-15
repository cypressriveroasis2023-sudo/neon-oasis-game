# Generic Recon hosted HTTP test harness

This is a generic synthetic proof candidate integrated onto accepted main. No
hosted HTTP, real PostgreSQL, PostgREST or Deno run is claimed by local preparation.
It does not authorize production deployment, private-input publication or local listeners.

`runtime.mjs` loads actual handler bodies and shared modules, stripping only TS
imports and binding explicit dependencies. The Supabase-client-shaped adapter
uses actual PostgREST requests in hosted mode. It is not supabase-js certification.
Auth/profile, credential reads, provider inventory, and unrelated background work
are explicit synthetic boundaries. The network allowlist has no external fallback.

## Public hosted mode

From `tech-checks/operations` inside the separately authorized hosted job:

```sh
node --import tsx ../../recon-proof/http/run-hosted-http.mjs \
  --public-only --source-root .. \
  --fixture-module ../../recon-proof/postgres-fixture.mjs \
  --postgrest-module ../../recon-proof/postgrest.mjs \
  --output-dir ../../recon-proof/evidence/http
```

Requires the parent helper's hosted-only markers plus `RECON_ALLOW_HOSTED_HTTP=1`.
Do not spoof these locally. Public mode runs16 generic groups and explicitly
records2 saved-source groups as NOT_RUN_PRIVATE_CAPTURE_REQUIRED. It never loads
or ships a saved runtime capture. A successful public run cannot clear those gates.

Generic groups cover auth/method/role boundaries; original provider-time ordering;
detector/bridge/siren exclusions; metadata failure with actual ordered health;
audit and health storage failures; unsafe event IDs; genuine unmapped202 versus
lookup-error503; discarded committed acknowledgments and exact-identity recovery;
configuration PT409; partial provider results; inventory/webhook interleavings;
and connector-generated receiver correlation with stable first-ACK redelivery.

## Private saved-source mode

Separately authorized private infrastructure may provision an original saved
runtime source outside the public repository. Omit `--public-only`, add `--v33
<private-file>` and `--v33-sha256 <verified-expected-hash>`. Both are mandatory;
the exact bytes are checked before loading. No actual input, capture hash, customer
record, credential or organizational metadata is included in this generic package.
That mode adds two negative-control groups for legacy snapshot/failure writers.
It remains distinct from deployed compatibility or a coordinated cutover.

## Socket-free checks

Compile/import/identity wiring only:

```sh
node --import tsx ../../recon-proof/http/run-hosted-http.mjs \
  --validate --public-only --source-root ..
```

The optional `validate-offline.mjs` runs source bodies via direct dispatch and an
in-memory REST-shaped shim over PGlite. Pass `-` instead of a private source path
for the public16-case subset. For private18-case validation supply a verified file
and `RECON_PRIVATE_V33_SHA256` in that private process. Neither mode starts sockets
or proves real PostgreSQL/HTTP/Deno behavior.

`--include-native-replay` is intentionally excluded from the public workflow. It
replays an error from separate PostgreSQL clients into handler adapters and is
explicitly not PostgREST retry proof. The dedicated transport test supplies actual
PostgREST14.5 native serialization/retry evidence when it is eventually run.

Each hosted case saves source hashes, image tag, HTTP statuses, safe synthetic
results, and assertions. It excludes JWT/request headers. Cleanup errors fail the
run. Real provider/auth/Storage, binary archive HTTP, Edge runtime, production ACLs
and retention, and full C01–C38 coverage remain separate gates.
