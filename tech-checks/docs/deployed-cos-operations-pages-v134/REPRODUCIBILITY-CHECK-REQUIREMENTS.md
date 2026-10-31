# Requirements for the reproducible-build check (not yet implemented)

Stated by the author on 2026-10-30 and recorded here so they reach whoever builds
this, rather than staying in a chat thread. **This check does not exist yet.** It is
deliberately blocked until step 1 lands.

## Blocked on

Publication, through a reviewed change, of the exact native source and its
build/preservation records from the author's working tree (`3bb41252`). Until then
there is nothing real to build from, and writing the check against an *assumed*
layout would be guessing at a shape instead of reading it.

## Requirements

1. **Build against the actual reviewed layout, tool versions and build command.**
   Not an expected or inferred structure. The published build records define these.
2. **The first run must reproduce the unchanged recorded deployment**, before any
   optimization is attempted or measured. A check that has never once reproduced the
   known-good artifact cannot tell you whether a later difference came from your
   change or from the check itself.
3. **A mismatch must stop the check and explain the difference.** It must never
   update the expected hashes automatically. A check that rewrites its own baseline
   verifies nothing; a green run would then mean only that the check agreed with
   whatever it was handed.
4. **It must not deploy.** Automated deployment is a separate decision requiring its
   own approval.

## Relationship to the existing drift check

`.github/scripts/verify-deployed-function-digest.mjs` is **not** this check and does
not satisfy it. That script verifies that what is *deployed* matches what was
*recorded* (`manifest.json`). It does not verify that the recorded source *rebuilds*
to the recorded artifact. Both are needed: the drift check catches an undeclared
deploy, the reproducibility check catches a record that no longer corresponds to
buildable source.

The drift check already honours requirement 3 — it reads `manifest.json` and never
writes to it. Any future check must keep that property.

## Expected inputs, once available

`manifest.json` already records per-file `sha256` and `bytes` for the three deployed
files, plus the archive digest `ezbr_sha256`. Those are the comparison targets; they
were captured read-only from the platform and independently match the author's
deployment records byte-for-byte.
