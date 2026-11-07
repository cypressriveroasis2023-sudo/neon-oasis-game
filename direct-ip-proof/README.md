# Generic Direct-IP PostgreSQL and HTTP proof

Proposed correction only. No packages were installed and no local PostgreSQL/PostgREST service was started for this correction. It has not been published or deployed. Earlier hosted results apply only to the preceding source, as recorded below. Source-verifier regressions are separate from database/HTTP runtime gates. It contains generic implementation/tests, wholly synthetic records, and fixture SQL extracted from a verified public repository source. It contains no complete deployed handler, provider configuration capture or production data.

## Inputs and provenance

`inputs/schema.sql` and `inputs/baseline.sql` exactly match their sections in [this public test source](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/blob/5b205399868fe154a9898242ce178efa520a53b5/tech-checks/operations/tests/scheduled-direct-source-postgres.py), Git blob `d79573bacce38db6276df2e54bdda3f8be5a0c3d`. Repository visibility and that exact source were checked read-only. The proposed SQL's legacy function body matches the public baseline, with only the final terminator appropriate to its nested block.

The proposed SQL now contains the bounded atomic deadline correction described below. The direct-attempt client helper is unchanged. Their exact hashes are in `PROVENANCE.json`. Fixtures use toy devices, synthetic sites, public fixed test signing material and a fixed disposable database. No production credentials, records, organization identifier literals, deployed source/config packets, or original review logs are included.

`SCOPE.json` is the explicit include/exclude allowlist. `MANIFEST.json` binds every included file except itself. `npm run verify` defaults to committed mode: it checks the exact Git-index subtree against both allowlists, compares every indexed blob to its working bytes, requires the checked index to match HEAD, and verifies exact source hashes. Staged-only preparation must explicitly use `npm run verify -- --mode=index`; hosted execution rejects index-only mode. Untracked generated runtime/dependency output is permitted, but force-tracked output is never excluded. Source integrity is not runtime proof.

## Prepared checks

- Generic SQL contract: registration and completion ordering; R/R/U/R resets to Verifying1; newer unknown barriers; immutable receipts and replay; endpoint/port/revision/source/lifecycle changes; stale tickets; observation bounds.
- Exact ACL behavior: clean supported defaults; direct/inherited/SET/ADMIN access; isolated inherited TRUNCATE; predefined-role boundaries; rollback without rewriting unrelated privileges; existing publisher owner/EXECUTE preservation.
- Direct client helper: uncertain committed/uncommitted registration; committed completion readback without redating; uncommitted completion remains pending; R/R/U/R with SQL. The local adapter is synthetic and not credited as HTTP proof.
- Actual PostgreSQL independent sessions: first-state and same-ID registration contention; duplicate completion; registration/completion commit order; rollback atomicity; stale endpoint edits; normal first-health foreign-key serialization; existing-row and trigger-wait expiry. Waits are proven by `pg_blocking_pids`.
- Actual PostgREST HTTP: JWT-to-role switching, access rejection, begin/complete/read replay, response loss confirmed after an independent commit read, exact helper behavior over HTTP, preference/exception rollback, private-schema nonexposure and publisher definition/owner/EXECUTE preservation.

The standalone two-job workflow is `.github/workflows/direct-ip-proof.yml`, with an exact manifest-bound copy at `direct-ip-proof/ci/proposed-workflow.yml`. It runs only on pull requests targeting `main` that change `direct-ip-proof/**` or that workflow file, or by manual dispatch. Both jobs verify the committed proof subtree and require the workflow to match its manifest-bound copy before installing dependencies or running tests. Each job has its own disposable PostgreSQL 17.6 service. The real HTTP job targets official [PostgREST 14.5](https://github.com/PostgREST/postgrest/releases/tag/v14.5), records the resolved image digest and asserts the actual executable version. This correction has not pulled or executed an image. The preceding hosted run pulled the pinned image but failed before the version executable and HTTP cases. The corrected probe explicitly invokes the release-source-verified `/bin/postgrest` CMD, after asserting and retaining the actual pulled amd64 CMD/ENTRYPOINT metadata. PostgreSQL 17.6 is the fixture target, not a claim about a deployed server version.

Dependencies are version/lockfile pinned: Node 24.19.0, pg 8.16.3, PGlite 0.5.8, tsx 4.19.2, TypeScript 5.7.3. Official Actions are pinned to full commit SHAs, and PostgreSQL/PostgREST images to immutable multi-platform index digests; the references and primary sources are recorded in `PROVENANCE.json`. These pins do not establish a successful corrected-source runtime result. The workflow uses narrow pull-request path filters plus optional manual dispatch, read-only repository permissions, no secret inputs and no deployment job. It does not accept caller-provided service destinations or ambient production URLs. Process network guards permit only loopback. Hosted launchers reject ordinary local execution.

## Required expiry gate

[Hosted run 38649662707](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/actions/runs/38649662707) at `57d9f5bb8ea28144627d5c4eb04e259021520486` ran PostgreSQL 17.6: 91 tests passed and the strict first-health BEFORE INSERT expiry test failed. A delayed trigger allowed definitive health to publish after the ticket deadline. The HTTP fixture setup and pinned image pull passed, but `--version` replaced the image's CMD and failed as a nonexistent executable before HTTP cases.

The correction retains the five-minute registration-to-completion ceiling, receipt/admission checks and post-health-lock recheck. It additionally encloses health, device, history, completion receipt and state mutations in one exception subtransaction and checks the database clock after those statements finish. A late deadline rolls all those writes back, then saves the existing immutable `attempt_expired` / `unverified` completion with no definitive observation or seed. The local flag allows only that deliberate P0001 rollback signal to be handled; genuine errors, including a trigger's identical P0001 message, propagate and roll back the outer completion. No custom 40001, new public status, retry permission, threshold or schedule is introduced. Intentional attempt conflicts still return their existing closed response.

The original `GATE: first-health BEFORE INSERT trigger wait past expiry must not publish definitive state` retains its exact strict assertion. Additional native gates wait after health conflict-update, device, history, receipt and state triggers, confirm the independent wait with `pg_blocking_pids`, queue duplicate completions and assert immutable held replay. Synthetic-clock tests cover BEFORE/AFTER mutations, genuine exception rollback and failures while saving the held result. Client tests cover direct and lost-response held completion. Synthetic-clock results do not establish native locking behavior.

This is a completion-statement deadline check, not a guarantee about arbitrary caller delay before COMMIT, deferred commit-time triggers, nontransactional external trigger side effects or hostile writers. Those require separate catalog/writer review. Only the generic proposed SQL is corrected: a source retaining the preceding published SQL SHA-256 `1516724eadca4b38a4b7c670de3a349413d58d0b206946adbc9b0123f4460c0c` no longer has exact SQL parity. It requires the same reviewed correction and fresh validation before corrected-source evidence can apply. No live SQL, grants, roles or deployment migration was changed.

A separate privileged raw-writer conflict case is diagnostic only, explicitly outside the cooperating service boundary. The normal foreign-key-locking insertion case is asserted separately. Actual production trigger/index/role/writer compatibility is not established by these synthetic fixtures.

## Commands after separately authorized setup

- Committed source integrity: `npm run verify`
- Local staged-only integrity: `npm run verify -- --mode=index`
- Verifier positive/negative regressions: `node --test tests/verifier.test.mjs`
- Generic local tests: `npm run test:local`
- Strict helper types: `npm run typecheck`
- Native hosted tests: `DIRECT_IP_PROOF_POSTGRES=1 npm run test:postgres`
- Actual hosted HTTP: `DIRECT_IP_PROOF_POSTGRES=1 DIRECT_IP_PROOF_HTTP=1 bash http/run-hosted-stage.sh`

Local PGlite and source/static checks are separate from the required corrected-source hosted PostgreSQL and HTTP reruns. Source-verifier regressions use temporary synthetic Git repositories. The generic unit selection contains 100 cases; the native suite adds sixteen independent-session cases. The HTTP runner has its own explicit checks. Prior results from another tree are not represented as passes here.

The HTTP helper uses a minimal SDK-shaped adapter over actual PostgREST fetch. It is not supabase-js, Supabase Auth, Edge or native Deno. Nothing here proves provider socket outcomes/cancellation, platform capacity, current production catalog/permissions, old-invocation drain, deployment compatibility or rollout safety. Those gates remain open.
