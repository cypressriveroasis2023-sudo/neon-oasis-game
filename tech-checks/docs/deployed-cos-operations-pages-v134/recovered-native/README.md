# Recovered native source record for v134

Documentation only. Nothing here is imported by the application or selected for deployment. This publication does not change runtime, frontend assets, workflows, permissions or feature flags, and does not establish reproducibility.

## Provenance

The initial 41 files in `tree/` preserve original bytes from local native source commit `3bb41252b1374fb38143e4d3ec2943f0cb3b4bf7`. They comprise the 27 source sections named in the retained v134 runtime, their relative source dependencies, the original preparation scripts, route-extraction source and package/lock files. `source-manifest.json` pins each original path, Git blob, byte count and SHA256. Five retained release/preservation/test records are copied verbatim into `records/`. Their historical claims and paths describe that release, not a new test execution or current production acceptance.

The native source was separate from frontend integration `7f7756a3e0320f758ae9e26f38bb8b27580825ff`. It was not the older published draft source head `76dd8b76f57c529c61cc266b57f80915bf90dce8`. The latter differs in attestationTransport/fullSource and lacks cancellableIo. productResourceMembership was committed locally beginning at `75e717698e7c1f0a695a3257eca5a42f7d734071`; absence from published branches did not mean it had never been committed.

## Original builder and unresolved inputs

The recorded CLI accepts `node tech-checks/operations/scripts/prepare-attribution-v133.mjs <capture.json> <output.json>`. This states its source-defined interface, not a recovered historical shell command. No build was executed for this publication. The exact original shell invocation, working directory and Node patch version have not been established; retained release records identify Node22 usage.

The original package lock pins esbuild 0.23.1, TypeScript 5.7.3, tsx 4.19.2 and Vite 6.0.11, including integrity values. No package installation is performed here.

The builder requires the exact authorized v133 capture (metadata plus serve/runtime/config bytes), extracts the route from historical index.ts, and invokes git show against baseline `24e2dc78a8b8d08f72daf3fcd5aaa3861519482c` for historical exactProductConnection.ts. The supplementary record supplies that exact baseline as a single file, plus 18 historical proof-harness dependencies. It does not publish the historical Git object or the capture. The remaining inputs and intended execution layout must still be reviewed before implementing the check in ../REPRODUCIBILITY-CHECK-REQUIREMENTS.md. Do not run this mirror as a deployable application or infer a successful rebuild from matching recorded hashes.

Raw captures, deployment payloads, environment files, credentials, node_modules and untracked workspace files are excluded. Existing original deployed records outside this directory remain unchanged. A future check must first reproduce the unchanged recorded artifact, stop on mismatch, never rewrite expected hashes automatically, and never deploy.

## Publication checks

Source and retained-record bytes were compared with their originals. Bounded literal scans found no complete private-key bodies, JWT literals, GitHub tokens, AWS access keys or Supabase secret-key literals in this candidate. A private-key header marker in googleSheets.ts is a format check, not a key body. Pattern scanning is not a guarantee against every secret format. The final diff is restricted to this documentation directory.

## Supplement: archived baseline and NEW adapter

`baseline-24e2dc78/tech-checks/operations/src/exactProductConnection.ts` is the exact 14,172-byte blob `4488955e31d301c6979df0d13121f0ad7ae5fffb` from commit `24e2dc78a8b8d08f72daf3fcd5aaa3861519482c`, SHA256 `1e435cdfa5c01c09d4414b85102d34029e869a1c3bb40445cc876693a98126d0`. The 18 added `tree/` files are historical proof-harness dependencies from `3bb41252b1374fb38143e4d3ec2943f0cb3b4bf7`; they remain byte-for-byte records, including the original harness imports.

`archive-adapter.mjs` and `archive-adapter.test.mjs` are NEW review-only code. They are not historical build evidence. The adapter checks the archived baseline digest and the complete historical builder digest before substituting the single Git lookup in memory. It resolves imports and source-relative paths against the archived layout. It does not edit the historical builder, run Git, alter expected digests, deploy, or contact a platform. Its output retains the original builder's deployment-payload/rollback shape: keep any such output private pending review.

The source-defined new interface is:

```sh
node archive-adapter.mjs <reviewed-capture.json> <local-output.json>
node --test archive-adapter.test.mjs
```

Run from this directory with the original locked dependencies made available under `tree/tech-checks/operations/node_modules`. These are new proposed commands, not recovered historical invocations. The four dependency-free tests exercise the actual substituted esbuild callback in a temporary directory without Git history, missing-input rejection, both digest mismatches and no hash/file rewriting. A separate local smoke check loaded the adapter from a temporary archive using existing installed dependencies and confirmed the original invalid-deployment guard rejects malformed input. No capture was used, and no unchanged-artifact reconstruction or historical proof-harness run was performed.

The historical `attribution-v133-proof.mjs` still imports the original builder. Supplying dependencies does not silently redirect that harness to the adapter; an explicitly reviewed runner/import adaptation is still needed to run that historical harness without the old Git object. The archived baseline is not a drop-in replacement for an entire commit.

## Capture availability and remaining review

The exact retained v133 capture is available locally and excluded from this package. A bounded structural/literal scan found two `sb_publishable_` literals, no complete JWT literals (therefore no JWT role claims to classify), and no matching `sb_secret_`, complete private-key body, GitHub-token or AWS-access-key literals. Publishable-prefix keys are not service-role JWTs; this scan is not a guarantee that every other sensitive datum has been identified. The capture also includes source/configuration and platform deployment metadata, whose publication has not been approved. Neither key values nor capture metadata are reproduced here. Any future publication requires review of the entire capture. Redaction would change the pinned bytes and fail reconstruction guards. Availability is established; publication permission remains pending, not a demonstrated permanent impossibility of reproduction.

Exact historical Node patch version, working directory and invocation remain unrecorded. Locked dependency versions and matching recorded hashes alone do not establish reproducibility. A future authorized reconstruction must first match the unchanged recorded artifact and stop on any difference without updating expected hashes.

Supplement checks ran on current Node v24.19.0, not a claimed historical Node patch. The complete 69-file candidate scan also found one pre-existing publishable-prefix literal in the historical route source already present in PR322; it was not introduced by this supplement. No capture literals were copied. Historical bytes remain unchanged.

The supplementary staged whitespace check reports original blank lines at EOF in inhandPilot.ts, mhelpImport.ts and privateEvidence.ts. These are preserved intentionally for blob fidelity; no new adapter whitespace warning was reported.
