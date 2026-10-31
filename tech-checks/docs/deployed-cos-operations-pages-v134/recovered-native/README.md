# Recovered native source record for v134

Documentation only. Nothing here is imported by the application or selected for deployment. This publication does not change runtime, frontend assets, workflows, permissions or feature flags, and does not establish reproducibility.

## Provenance

The 41 files in `tree/` preserve original bytes from local native source commit `3bb41252b1374fb38143e4d3ec2943f0cb3b4bf7`. They comprise the 27 source sections named in the retained v134 runtime, their relative source dependencies, the original preparation scripts, route-extraction source and package/lock files. `source-manifest.json` pins each original path, Git blob, byte count and SHA256. Five retained release/preservation/test records are copied verbatim into `records/`. Their historical claims and paths describe that release, not a new test execution or current production acceptance.

The native source was separate from frontend integration `7f7756a3e0320f758ae9e26f38bb8b27580825ff`. It was not the older published draft source head `76dd8b76f57c529c61cc266b57f80915bf90dce8`. The latter differs in attestationTransport/fullSource and lacks cancellableIo. productResourceMembership was committed locally beginning at `75e717698e7c1f0a695a3257eca5a42f7d734071`; absence from published branches did not mean it had never been committed.

## Original builder and unresolved inputs

The recorded CLI accepts `node tech-checks/operations/scripts/prepare-attribution-v133.mjs <capture.json> <output.json>`. This states its source-defined interface, not a recovered historical shell command. No build was executed for this publication. The exact original shell invocation, working directory and Node patch version have not been established; retained release records identify Node22 usage.

The original package lock pins esbuild 0.23.1, TypeScript 5.7.3, tsx 4.19.2 and Vite 6.0.11, including integrity values. No package installation is performed here.

The builder requires the exact authorized v133 capture (metadata plus serve/runtime/config bytes), extracts the route from historical index.ts, and invokes git show against baseline `24e2dc78a8b8d08f72daf3fcd5aaa3861519482c` for historical exactProductConnection.ts. This mirror alone does not supply that Git object or the capture. It also does not include the artifact-proof test script and its full fixture dependency closure. Those inputs and the intended execution layout must be reviewed before implementing the check in ../REPRODUCIBILITY-CHECK-REQUIREMENTS.md. Do not run this mirror as a deployable application or infer a successful rebuild from matching recorded hashes.

Raw captures, deployment payloads, environment files, credentials, node_modules and untracked workspace files are excluded. Existing original deployed records outside this directory remain unchanged. A future check must first reproduce the unchanged recorded artifact, stop on mismatch, never rewrite expected hashes automatically, and never deploy.

## Publication checks

Source and retained-record bytes were compared with their originals. Bounded literal scans found no complete private-key bodies, JWT literals, GitHub tokens, AWS access keys or Supabase secret-key literals in this candidate. A private-key header marker in googleSheets.ts is a format check, not a key body. Pattern scanning is not a guarantee against every secret format. The final diff is restricted to this documentation directory.
