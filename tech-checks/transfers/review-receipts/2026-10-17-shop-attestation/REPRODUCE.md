# Local implementation validation

Use the isolated checkout `/workspace/cos-handoff-attestation-proposal` at the
commit/tree in `RECEIPT.json`. The `implementation.patch` applies to 9229fa7;
the full candidate patch applies to current main ba1b742. Both are replayed into
temporary Git indexes and must produce the recorded final tree. The Git bundle
requires base 9229fa7; the source tarball is standalone. No remote write occurred.

From `tech-checks/operations`, with existing project dependencies installed:

```sh
node --import tsx --test tests/handoff-location-handler.test.mjs tests/handoff-location-proof.test.mjs
COS_HANDOFF_TEST_DATABASE_URL=postgresql://postgres:synthetic-local-test-only@127.0.0.1:55439/cos_handoff_test_shop_scoped node --import tsx --test --test-concurrency=1 tests/shop-attestation-sql.test.mjs tests/shop-attestation-integration.test.mjs
COS_HANDOFF_TEST_DATABASE_URL=postgresql://postgres:synthetic-local-test-only@127.0.0.1:55439/cos_handoff_test_legacy_review node --import tsx --test --test-concurrency=1 tests/transfer-assembly.test.mjs tests/transfer-custody-boundaries.test.mjs tests/transfer-custody.test.mjs tests/transfer-delivery-sql.test.mjs tests/transfer-location-sql.test.mjs tests/transfer-partial-returns.test.mjs
npm run typecheck
node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --allowImportingTsExtensions --strict --skipLibCheck ../supabase/functions/cos-operations-pages/handoffLocationProof.ts
npm run build -- --outDir /workspace/cos-handoff-shop-implementation-evidence/dist
PW_DISABLE_TS_ESM=1 NODE_OPTIONS='--import tsx' COS_TEST_CHROMIUM=/usr/bin/chromium COS_IT_DAILY_TEST_DIST=/workspace/cos-handoff-shop-implementation-evidence/dist node_modules/.bin/playwright test --config tests/playwright.transfer.config.mjs
```

The PostgreSQL URL is for a disposable loopback PostgreSQL 17.6 container only.
The password is a public synthetic test literal, not a production credential.
Fixtures enforce loopback host and a `cos_handoff_test_...` database prefix.
Run PostgreSQL suites sequentially: they create/drop global synthetic API roles.
The native integration test uses actual native SQL in PGlite and the actual bridge
to produce a proof consumed by PostgreSQL legacy v7. Its Auth responses are mocked.
Native concurrency uses two real PostgreSQL clients. The 73 browser cases use
synthetic network/data and an earlier handoff fixture; they do not prove the new
v7 path in a live browser or external provider delivery.

`native-effective-access.json` comes from `export-native-access.mjs`, which loads
the captured production reader definitions into a synthetic local fixture,
executes the held install and exact rollback, and compares pre/post catalogs.
It makes no production connection. Existing fixture table grants are not a claim
about every production table's ACL; the new install's lack of ACL changes is
measured locally.

Earlier failed exploratory logs are retained for audit. `native-scoped-final.log`
is an environment restart/ECONNREFUSED run; `native-scoped-recovered.log` is the
successful complete retry after restarting only the disposable local container.
The receipt identifies the authoritative successful results and supplemental
earlier runs. The implementation code was unchanged by final test/doc additions.

The native install and rollback, exact access/disclosure proposal, patch hashes,
remaining review/live verification gaps and cross-project timing limits are in
`NATIVE_SHOP_ATTESTATION_APPROVAL.md`, `RECEIPT.json` and `SHA256SUMS`.
