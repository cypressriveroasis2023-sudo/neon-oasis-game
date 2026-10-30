# Deployed record: cos-operations-pages v134

**This directory is a record, not code.** Nothing here is imported, built, type-checked
or deployed. It exists so that what is running in production can be read and reviewed.

## Why it exists

No workflow in `.github/workflows` deploys Supabase functions. v134 was published by
hand on 2026-10-29T21:40:46Z, and its source was never committed. Production was
therefore unreproducible from this repository, and a deploy of this function from any
branch would have silently replaced the running implementation.

`source/` is the verbatim source retrieved read-only from the platform.
`manifest.json` records versions, byte counts, SHA-256 digests, and which of the
sources bundled into `productTcpRuntime.ts` are present on `main`.

## State of the drift

- 13 of the 22 sources bundled into `productTcpRuntime.ts` are present on `main`.
- 8 are absent from `main` but present on `origin/draft/cos-exact-product-tcp-20261028`
  (`_shared/exact-product-producer/`).
- 1, `cos-operations-pages/productResourceMembership.ts`, appears in **no commit on any
  branch**. Its only known copy is inside `source/productTcpRuntime.ts` here.

## Before deploying this function

Deploying `cos-operations-pages` from `main` **or** from the draft branch replaces the
running implementation and removes `productTcpRuntime.ts`. That is an unreviewed
behavioural change to the live fleet dashboard. Reconcile the drift under review first.

The deployed `scopedProductTcpEnabled === true` branch POSTs to
`/functions/v1/cos-exact-product-tcp`, which is **not a deployed function**. The flag
reads `false` in the bundle. Do not enable it.
