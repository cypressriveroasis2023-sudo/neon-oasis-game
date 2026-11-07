# IT saved readings: recorded native preparation

## Purpose and scope

PR #361 already scopes saved Fleet presentations to an authorized IT actor, role, mode and boolean feature set. Production `cos-operations-pages` v154 verifies the IT actor but omits its ID from `GET /api/session`. The frontend therefore remains safely uncached for IT until that separately reviewed native response supplies the identifier.

The recipe at `.github/function-patches/cos-operations-pages/it-saved-fleet-actor-v154.json` adds only:

```ts
productionTechnicianUserId: context.actorId
```

It inserts the field inside the existing successful, verified IT session response. The insertion is exactly 43 bytes. Authentication, identity mapping, role and organization checks, feature flags, Owner responses and every unrelated route are unchanged. Reversing that insertion reproduces the original file byte for byte; the other seven recorded files remain byte-identical.

## Recorded source and drift checks

The November 7 readback found the Tech Check Platform function ACTIVE at v154, with archive SHA-256 `254594ed3300a84e9d5b1bc58afffb5ff1698d04fd3bf5c4c2d01d1018bb6d31`. Its immutable import references source commit `baf1418c6884e90cb9e9dd457b2f91dd7aafa8c0` and `tech-checks/docs/fleet-provenance-repair-20261104/source/serve.ts`.

| Source | SHA-256 |
| --- | --- |
| Recorded `serve.ts` | `27119046dacb47d3098e193fb1ae17cf808ff630a19c72588dc507988ae1543f` |
| Prepared `serve.ts` | `d7d4d637eddab89a70afe452d0f1a8f668265320397215dd25c5be319709137e` |

The existing recorded-artifact builder verifies every before/after file hash and the exact edit count. The manifest pins the live version, status and archive precondition. Source or production drift requires a fresh review; it must not be bypassed by replacing expected hashes. The recorded v154 files and deployment record are preserved.

## Offline verification

- 25 native tests pass. They bundle and execute the complete original and prepared handlers with in-memory transport, compare successful IT responses, and prove the added ID belongs to each verified IT actor. Owner responses, the separate technician session, rejected client-supplied IDs, bearer/origin failures, inactive/revoked/mismatched identities and organization denials retain identical responses and transport calls.
- The tests also verify exact byte reversal, unchanged dependencies, source/hash/edit-count drift rejection and live version/archive preconditions.
- The existing recorded-artifact builder's 10 tests pass, including its historical patch and rollback fixtures.
- The new recipe passes `--dry-run`: all eight files match their expected hashes. No deployment was requested.
- 29 focused IT controls, navigation and source-preservation checks pass; protected baselines and reversal rules are unchanged.

From the repository root, the preparation-only command is:

```sh
node .github/scripts/deploy-recorded-function.mjs .github/function-patches/cos-operations-pages/it-saved-fleet-actor-v154.json --dry-run
```

The native test runs from `tech-checks/operations`:

```sh
node --test tests/native-it-saved-fleet-actor.test.mjs
```

## Browser regression follow-up

The shared branch's eight-spec correction is preserved. The remaining IT status-pin fixture initially returned a successful but expired TCP receipt at its second ten-minute read while expecting failed-read retention. That receipt correctly produced Unknown. The failure case now fails both saved health and TCP reads; a separate browser case proves a successfully completed stale TCP read becomes Unknown. No product behavior or timestamp is changed to satisfy either case.

Local browser execution uses Node 22.23.4 and the existing pinned Playwright Chromium. The repository dependency manifest, lockfile, application source and built assets are unchanged by this follow-up.

The latest shared base is `f9b2d1c8e668e6582048cf2abfc372badb156410`. All 24 status-pin browser checks pass at 390, 1024 and 1440 pixels, including the newly added completed-stale case and the shared branch's failed-read retention repair. A broader 282-case local attempt ended without a final summary after beginning the desktop group; it is not claimed as a passing full suite. GitHub CI must finish on the published candidate before full-suite success is claimed.

## Release boundary

This is review preparation, not release approval. The `PREPARATION_ONLY` label is descriptive metadata, not a new deployment interlock. No workflow choice, trigger, permission or deployment setting is added, and no function is deployed.

Current v154 uses a two-file local wrapper importing the immutable recorded source. This recipe prepares its eight dependency files as a local package. Offline handler execution establishes the code delta and auth parity; it does not establish deployed Deno packaging, served-byte readback or authenticated IT reopen behavior. Those checks, the existing PR #359 source/integration gates, and PR #361 release review still apply. The existing `deployment-v154.json` records the exact current wrapper and configuration for rollback review.

Keep PR #361 against the existing #359 review branch. Do not deploy the repository's separate backend `index.ts`, merge #359 to main, change inventory/Field-Shop/IP authority, or alter schedules as part of this preparation.
