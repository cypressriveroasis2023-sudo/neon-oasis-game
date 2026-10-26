# Startup projection verification

This change reduces repeated pure computation while preserving source validation.
Owner identity projections reuse exact string normalization within one invocation.
Provider-membership checks index string IDs and retain the original strict-equality
scan for malformed keys. Imported geocode projections reuse hashes of identical
address strings within one invocation. Binding and identity checks still run.

The preparation script rejects unexpected input versions, files, source bytes,
configuration and entrypoints. Its edits are reversible. Complete source captures,
release packets and operational incident evidence remain outside this repository.

## Reproduction

From tech-checks/operations, supply an authorized source capture outside git:

    COS_CPU_V124_CAPTURE=/path/to/captured-v124.json node --import tsx --test tests/startup-v124-artifact.test.mjs
    node --import tsx --test tests/imported-digest-memo.test.mjs tests/owner-identity-label-memo.test.mjs tests/owner-identity-crosswalk.test.mjs
    node scripts/prepare-startup-cpu-v124.mjs /path/to/captured-v124.json /tmp/cos-startup-candidate.json

Capture-dependent tests must run without skips before a release. They compare
complete responses, denied authentication, failures and retries, stale and partial
health, and source changes between reads. Unit tests cover malformed keys,
duplicates, source mutations during asynchronous hashing, rejected digests and
fresh validation across calls. Synthetic timings are not production guarantees.

This code does not deploy a function or modify source data, permissions, provider
schedules or credentials. Release verification requires fresh drift checks and
preservation of the prior artifact for rollback.

## Callback compatibility correction

The initial deployed CPU repair made the binding validator's second parameter a
digest callback. Existing direct Array.map calls supplied their numeric index
instead, causing valid precedence paths to return503. A typeof guard now restores
the original unary-callback behavior while retaining projection-local hashing.
The reproduced401-row handler passes with available, unavailable and freshly
missing precedence evidence against both source and the complete amended v125
artifact. The v125 preparer records one reversible insertion and preserves every
other deployed byte and setting;64 complete response comparisons also pass.
