# Recon synthetic PostgreSQL and HTTP proof candidate

This candidate integrates only the independently reviewed Recon inventory/receipt,
webhook and generic test deltas onto accepted main commit
`6bf7f1b12dbdadd54624ec424ce59a6cba4e9ce6`, tree
`6e71bd54065134720dabfcb1168654adf9e61f26`. It preserves newer unrelated UI,
API, history, pending-barrier and SQL files. Candidate SQL is loaded only into
fresh disposable test databases; this workflow does not install it in production.

`.github/workflows/recon-synthetic-proof.yml` runs on narrowly path-filtered pull
requests and optional manual `SYNTHETIC_ONLY` dispatch. It has read-only repository
permissions, no repository secrets, no deployment and no provider requests.
Evidence is initialized immediately after checkout, before dependency setup;
stdout/stderr logs and receipts are always uploaded, including failures. No step
uses `continue-on-error`; a failed assertion or cleanup leaves the job red.
Publication and hosted execution require separate authorization. Local Node/PGlite
checks are not actual PostgreSQL/HTTP proof.

## Proposed actual PostgreSQL/HTTP stages

- Fresh PostgreSQL17.6 GitHub Actions service; PostgreSQL-specific tests use real
  independent clients, explicit transactions, actual pg_stat_activity waits and
  pg_blocking_pids edges, private uncommitted state, and both COMMIT/ROLLBACK paths.
- Each fixture uses a fresh uniquely named disposable database. An advisory fixture
  mutex prevents synthetic cluster-global role collisions. The original synthetic
  schema creates only its retained baseline roles. Each fixture drops its own DB
  and only the roles it created. The runner must be a fresh dedicated service.
- Actual unchanged v2 SQL, ordered projector and private archive compactor load
  together. Full84 SQL cases test catalog/effective/default/inherited ACLs and the
  exact29-callable/2-trigger surface, rollback injection, replay and clock rules.
- Contention cases cover integration→requested-audit, fresh marker reads after
  waits, same and different deliveries, A/B/A versus never-applied older,
  compactor→projector/receipt→inventory and projector→receipt→inventory waits,
  COMMIT/ROLLBACK, and genuine native40001 on a stale repeatable-read snapshot.
- Official versioned PostgREST14.5 container bound only to loopback. Synthetic
  short-lived HS256 claims select the fixture's existing anon/authenticated/service
  roles. The fixture's postgres connection is only a disposable transport host,
  not a production authenticator architecture. No new production role is proposed.
- Actual PostgREST tests verify response serialization, strict microseconds,
  browser-role denial, unsafe numeric-ID rejection, a discarded committed ACK,
  real PT409→HTTP409 without retries, and a genuine concurrent-update40001
  followed by exactly one PostgREST14.5 internal retry and duplicate HTTP200. The latter uses
  a clearly test-only repeatable-read wrapper and observed advisory wait, never
  an injected RAISE40001. Nontransactional synthetic sequences count two executions/one native abort.
  It measures version-specific transport/retry behavior, not default isolation.
- Actual source handler bodies are hosted by a Node wrapper and use a small
  Supabase-client-shaped adapter to real PostgREST. Auth identities, credentials,
  provider inventory and unrelated services are explicit synthetic boundaries.
  No provider request or real credential can escape the allowlisted adapter.
- UTC and America/Chicago jobs use the same unchanged production source and
  strict assertions. The timezone fix neither truncates microseconds nor changes
  a timestamp's expected instant. One-microsecond and malformed-date negatives
  prevent masking semantic failures.

## Hard safety boundary

The real engine refuses to connect unless `GITHUB_ACTIONS=true`, the explicit
synthetic job marker is set, the backend is hosted-postgres, and the control URL
is loopback with exact `/recon_proof_control` database and `postgres` fixture user.
Do not spoof those guards locally. No local PostgreSQL/listener/Chromium is needed
or permitted for this preparation. PGlite remains in-process synthetic evidence,
never concurrent PostgreSQL or HTTP certification.

## Gates that remain HOLD

Preparing or even passing this generic workflow does not accept the proposed
integration→requested-audit amendment or the20 directly callable helpers. Both
need explicit acceptance. It does not authorize production grants/deployment.

The hosted stages have not run. PostgREST14.5 and PG17.6 are explicitly selected generic versions. These
containers are not proof of any deployed configuration or Edge version. Supabase-js itself,
Deno/Edge import/auth/runtime behavior, real gateway cancellation/lost response,
provider capacity/deadline limits and complete C01–C38 runtime coverage remain
separate. Private saved-source negative controls require separately authorized input
provisioning and are omitted from the public workflow with an explicit HOLD. All writers must be coordinated and old
invocations drained; no deployed compatibility or cutover is certified here.

Production ACL/default privileges/memberships/exposed schemas, unknown triggers,
audit retention/admin writers, already-applied unmarked historical transition,
and production owner authority remain uninspected. No backfill or rollout is
included. No new security/role design is proposed. Official container index digests and Actions commit SHAs are pinned in the
proposal and recorded with read-only source provenance in tooling-lock.json.
These immutable identities still require review before authorized execution;
the job records observed container digests as additional runtime evidence.

## Primary documentation checked during preparation

- https://docs.postgrest.org/en/v14/explanations/install.html
- https://github.com/PostgREST/postgrest/releases/tag/v14.5
- https://docs.postgrest.org/en/v14/references/errors.html
- https://docs.postgrest.org/en/v14/references/transactions.html

No external execution was performed to verify this proposal.

Public mode contains no private runtime capture. Private input/evidence hashes are retained outside this candidate.

The version-specific40001 retry expectation follows official upstream issue https://github.com/PostgREST/postgrest/issues/3673 and changelog https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md. It is deliberately strict, not an accept-either-status assertion.

Retry safety: test-only native/business wrappers have nontransactional attempt ceilings that switch to nonretryable P0001 on excess attempts. Requests have20-second client deadlines, database statements10-second/locks8-second limits, tests60-second limits, and finally blocks force-remove the ephemeral PostgREST container. The runner job has a30-minute limit. No deliberately persistent40001 loop is used.

## Current-main integration and dependency identity

The reviewed input packet was a partial/adjacent snapshot and was not copied over
main. Its four verified source patch chains and generic proof-only delta applied
cleanly to the accepted-main tree. Only those changed paths and the explicit
workflow/readme/manifest integration edits belong to this candidate. The existing
Field recorder and background-intake failure-path tests bind the three newly imported Recon error
classes in their source-body VMs; every original assertion remains unchanged.

`source-manifest.json` records the exact candidate source, fixture, test, lockfile
and discovered local-dependency bytes from this current-main integration. Newer
main dependencies are retained and rehashed; the older packet's hashes are not
used to replace them. The manifest intentionally excludes itself, runtime evidence,
private captures, node_modules and local review artifacts. Verify the manifest
before running the proof, and regenerate it from a newly reviewed integration if
any recorded source or dependency changes. Matching hashes establish identity,
not semantic compatibility or runtime success.

Official PostgREST14.5 linux/amd64 image source sets CMD to `/bin/postgrest` and
has no ENTRYPOINT. The server launcher preserves that default. The isolated
version probe explicitly selects `/bin/postgrest` with `--entrypoint`, so
`--version` cannot accidentally become an executable name:
https://github.com/PostgREST/postgrest/blob/d89826b982808407b67f5db378515db1e6b5d13f/nix/tools/docker/default.nix
