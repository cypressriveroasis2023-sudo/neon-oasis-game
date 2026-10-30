# Deployed record: cos-operations-pages v134

**This directory is a record, not code.** Nothing here is imported, built, type-checked
or deployed.

## Correction (authoritative, from the author)

An earlier revision of this record claimed that `productResourceMembership.ts` and
`cancellableIo.ts` "appear in no commit on any branch" and that the deployed bundle was
"their only copy." **The "never committed" claim was wrong and is retracted.** It was
true only of the remote branches visible from this session.

- `productResourceMembership.ts` was introduced in `75e71769`, revised in `410bb816`
  and `475e3b2d`, and the original survives on the author machine at
  `/workspace/cos-connection-membership`. It does **not** need reconstructing.
- The reconciliation starting point is **released native source `3bb41252`**, not the
  older draft branch.

## How v134 was deployed

By the author, through the approved identity-repair task, as an **overlay** preserving
verified v133 plus released native source `3bb41252` — not a deployment of the whole
`main` tree. Deployed `2026-10-29T21:40:46.737Z`. The original manifest, preparation
script, preservation checks and rollback record are retained by the author.

Separate reviewed backend delivery was intentional for this release. Permanently
omitting deployment CI was **not** a documented decision; the source-publication gap is
acknowledged and is being fixed in this order:

1. Preserve the exact native source and a reproducible build in reviewed version control.
2. Add CI that **verifies** the artifact without deploying it.
3. Automated deployment is a separate decision requiring approval.

## Independent cross-check

`source/productTcpRuntime.ts`, retrieved read-only from the platform here, hashes to
`613fc3dc4ea79f8072b5f4aa295af870ebfc743920bb0f6f9700f3e08384b2db`, matching the
author's deployment records byte-for-byte from the opposite direction. Archive digest
`fc3e40da7d5dffc53e8a66e8c7551026440ea63ad3d8d91f4b826474cb1c20e9`.

## Draft-branch comparison (author-verified, against draft head `76dd8b76`)

| | files |
|---|---|
| Identical to v134 | `fleetReadPlan`, `model`, `nativeContextAdapter`, `sourceReader`, `statusIntegration` |
| Different | `attestationTransport`, `fullSource` |
| Missing at that draft head | `cancellableIo.ts` |

My own quoted-literal heuristic scored `model.ts` at 50% and flagged it DIFFERENT; the
author confirms it is **identical**. The heuristic produced a false positive, as its
recorded caveat warned it might. It was correct on `attestationTransport` and
`fullSource`. Weight it accordingly.

## Before deploying this function

**Do not deploy bare `main` or the older draft.** Reconcile from released native source
`3bb41252` under review. The deployed `scopedProductTcpEnabled === true` branch POSTs to
`/functions/v1/cos-exact-product-tcp`, which is **not a deployed function**; the flag
reads `false` in the bundle. Do not enable it.
