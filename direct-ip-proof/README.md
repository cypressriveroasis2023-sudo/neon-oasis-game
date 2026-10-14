# Generic Direct-IP PostgreSQL and HTTP proof

Local proposal only. No packages have been installed and no PostgreSQL/PostgREST service has been run, published or deployed as part of this preparation. Source-verifier regressions are separate from database/HTTP runtime gates. It contains generic implementation/tests, wholly synthetic records, and fixture SQL extracted from a verified public repository source. It contains no complete deployed handler, provider configuration capture or production data.

## Inputs and provenance

`inputs/schema.sql` and `inputs/baseline.sql` exactly match their sections in [this public test source](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/blob/5b205399868fe154a9898242ce178efa520a53b5/tech-checks/operations/tests/scheduled-direct-source-postgres.py), Git blob `d79573bacce38db6276df2e54bdda3f8be5a0c3d`. Repository visibility and that exact source were checked read-only. The proposed SQL's legacy function body matches the public baseline, with only the final terminator appropriate to its nested block.

The proposed SQL and direct-attempt client helper are unchanged implementation inputs. Their exact hashes are in `PROVENANCE.json`. Fixtures use toy devices, synthetic sites, public fixed test signing material and a fixed disposable database. No production credentials, records, organization identifier literals, deployed source/config packets, or original review logs are included.

`SCOPE.json` is the explicit include/exclude allowlist. `MANIFEST.json` binds every included file except itself. `npm run verify` defaults to committed mode: it checks the exact Git-index subtree against both allowlists, compares every indexed blob to its working bytes, requires the checked index to match HEAD, and verifies exact source hashes. Staged-only preparation must explicitly use `npm run verify -- --mode=index`; hosted execution rejects index-only mode. Untracked generated runtime/dependency output is permitted, but force-tracked output is never excluded. Source integrity is not runtime proof.

## Prepared checks

- Generic SQL contract: registration and completion ordering; R/R/U/R resets to Verifying1; newer unknown barriers; immutable receipts and replay; endpoint/port/revision/source/lifecycle changes; stale tickets; observation bounds.
- Exact ACL behavior: clean supported defaults; direct/inherited/SET/ADMIN access; isolated inherited TRUNCATE; predefined-role boundaries; rollback without rewriting unrelated privileges; existing publisher owner/EXECUTE preservation.
- Direct client helper: uncertain committed/uncommitted registration; committed completion readback without redating; uncommitted completion remains pending; R/R/U/R with SQL. The local adapter is synthetic and not credited as HTTP proof.
- Actual PostgreSQL independent sessions: first-state and same-ID registration contention; duplicate completion; registration/completion commit order; rollback atomicity; stale endpoint edits; normal first-health foreign-key serialization; existing-row and trigger-wait expiry. Waits are proven by `pg_blocking_pids`.
- Actual PostgREST HTTP: JWT-to-role switching, access rejection, begin/complete/read replay, response loss confirmed after an independent commit read, exact helper behavior over HTTP, preference/exception rollback, private-schema nonexposure and publisher definition/owner/EXECUTE preservation.

The standalone two-job workflow is `.github/workflows/direct-ip-proof.yml`, with an exact manifest-bound copy at `direct-ip-proof/ci/proposed-workflow.yml`. It runs only on pull requests targeting `main` that change `direct-ip-proof/**` or that workflow file, or by manual dispatch. Both jobs verify the committed proof subtree and require the workflow to match its manifest-bound copy before installing dependencies or running tests. Each job has its own disposable PostgreSQL 17.6 service. The real HTTP job targets official [PostgREST 14.5](https://github.com/PostgREST/postgrest/releases/tag/v14.5), records the resolved image digest and asserts the actual executable version. No image has been pulled or run for this subset. PostgreSQL 17.6 is the fixture target, not a claim about a deployed server version.

Dependencies are version/lockfile pinned: Node 24.19.0, pg 8.16.3, PGlite 0.5.8, tsx 4.19.2, TypeScript 5.7.3. Official Actions are pinned to full commit SHAs, and PostgreSQL/PostgREST images to immutable multi-platform index digests; the references and primary sources are recorded in `PROVENANCE.json`. These metadata pins are not image-pull or runtime results. The workflow uses narrow pull-request path filters plus optional manual dispatch, read-only repository permissions, no secret inputs and no deployment job. It does not accept caller-provided service destinations or ambient production URLs. Process network guards permit only loopback. Hosted launchers reject ordinary local execution.

## Required expiry gate

The proposed SQL checks a five-minute registration-to-completion ceiling at receipt and after its existing-health-row lock. Its later INSERT/ON CONFLICT/trigger work lacks a further expiry recheck. The native test `GATE: first-health BEFORE INSERT trigger wait past expiry must not publish definitive state` deliberately retains a hard nonpublication assertion. It uses an advisory-lock-backed synthetic trigger, native database clock and a shortened fixture ticket lifetime. The unchanged implementation may fail this gate; there is no expected-failure bypass or continue-on-error.

A separate privileged raw-writer conflict case is diagnostic only, explicitly outside the cooperating service boundary. The normal foreign-key-locking insertion case is asserted separately. Actual production trigger/index/role/writer compatibility is not established by these synthetic fixtures.

## Commands after separately authorized setup

- Committed source integrity: `npm run verify`
- Local staged-only integrity: `npm run verify -- --mode=index`
- Verifier positive/negative regressions: `node --test tests/verifier.test.mjs`
- Generic local tests: `npm run test:local`
- Strict helper types: `npm run typecheck`
- Native hosted tests: `DIRECT_IP_PROOF_POSTGRES=1 npm run test:postgres`
- Actual hosted HTTP: `DIRECT_IP_PROOF_POSTGRES=1 DIRECT_IP_PROOF_HTTP=1 bash http/run-hosted-stage.sh`

Database/client runtime commands are prepared, not executed results for this correction. Source-verifier regressions run only against temporary synthetic Git repositories and must be reported separately. The generic unit selection contains 81 test declarations; the native suite adds eleven independent-session cases. The HTTP runner has its own explicit checks. Prior results from another tree are not represented as passes here.

The HTTP helper uses a minimal SDK-shaped adapter over actual PostgREST fetch. It is not supabase-js, Supabase Auth, Edge or native Deno. Nothing here proves provider socket outcomes/cancellation, platform capacity, current production catalog/permissions, old-invocation drain, deployment compatibility or rollout safety. Those gates remain open.
